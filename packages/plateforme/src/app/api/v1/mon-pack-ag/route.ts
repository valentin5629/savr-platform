import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError } from '@/lib/api-helpers.js';

// Onglet « Mon pack Anti-Gaspi » de tous les espaces client (Val 2026-11-02) :
// l'Admin n'y a pas accès.
const ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];

// Financier (prix, montant, devise) VOLONTAIREMENT exclu : masqué côté
// gestionnaire de lieux (§06.05 — « tarifs AG, tout élément financier masqué »),
// et absent du bloc du dashboard pour les autres rôles.
const PACK_COLS =
  'id, type_pack, statut, credits_initiaux, credits_consommes, credits_restants, date_achat, date_expiration, created_at';

interface PackRow {
  id: string;
  type_pack: string;
  statut: 'actif' | 'epuise' | 'annule';
  credits_initiaux: number;
  credits_consommes: number;
  credits_restants: number;
  date_achat: string | null;
  date_expiration: string | null;
  created_at: string;
}

function mapPack(p: PackRow) {
  return {
    id: p.id,
    type_pack: p.type_pack,
    statut: p.statut,
    credits_initiaux: p.credits_initiaux,
    credits_consommes: p.credits_consommes,
    credits_restants: p.credits_restants,
    date_achat: p.date_achat,
    date_expiration: p.date_expiration,
  };
}

// Collecte AG rattachée à un pack. La jointure sur le pack est obligatoire
// (`!inner`) et filtrée sur l'organisation de l'appelant : sans `!inner`, le
// filtre sur le pack embarqué vide l'embed et garde la ligne (mesuré sur
// savr-dev).
const CONSOMMATION_COLS = `id, date_collecte, statut,
       packs_antgaspi!pack_antgaspi_id!inner(id),
       evenements!inner(nom_evenement, lieux!lieu_id(nom)),
       attributions_antgaspi(volume_repas_realise, associations(nom))`;

interface ConsommationRow {
  id: string;
  date_collecte: string;
  statut: string;
  packs_antgaspi: { id: string }; // to-one + `!inner` : toujours un objet
  evenements: unknown;
  attributions_antgaspi: unknown;
}

interface AttributionRow {
  volume_repas_realise?: number | null;
  associations?: { nom?: string | null } | null;
}

const STATUTS_A_VENIR = [
  'programmee',
  'validee',
  'en_cours',
  'annulation_demandee',
];

function mapConsommation(c: ConsommationRow) {
  const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
  const lieu = (evt as { lieux?: { nom?: string } })?.lieux;
  // Crédit consommé sans collecte réalisée (§05 « Débit d'un crédit », 2e cas).
  const annulee = c.statut === 'annulee';
  // Crédit décompté à la programmation, collecte pas encore faite (2026-11-02).
  const aVenir = STATUTS_A_VENIR.includes(c.statut);
  // Une collecte annulée garde son attribution (posée avec le pack) mais n'a
  // rien donné : ni repas, ni association bénéficiaire.
  const attrs: AttributionRow[] = annulee
    ? []
    : Array.isArray(c.attributions_antgaspi)
      ? c.attributions_antgaspi
      : c.attributions_antgaspi
        ? [c.attributions_antgaspi as AttributionRow]
        : [];
  return {
    collecte_id: c.id,
    pack_id: c.packs_antgaspi.id,
    date_collecte: c.date_collecte,
    annulee_tardivement: annulee,
    a_venir: aVenir,
    evenement: (evt as { nom_evenement?: string })?.nom_evenement ?? null,
    lieu: lieu?.nom ?? null,
    repas_donnes: attrs.reduce((s, a) => s + (a.volume_repas_realise ?? 0), 0),
    associations: attrs.map((a) => ({
      nom: a.associations?.nom ?? null,
      repas: a.volume_repas_realise ?? 0,
    })),
  };
}

// GET /api/v1/mon-pack-ag
// Pack courant, historique des packs et collectes rattachées aux packs de
// l'organisation de l'appelant (onglet « Mon pack Anti-Gaspi », Val 2026-11-02).
//
// Lecture SERVICE : la policy pa_select_programmateurs n'ouvre packs_antgaspi
// qu'au manager, à l'agence et au gestionnaire ; le commercial lit pourtant le
// solde de son organisation (§06.04 Bloc 4 AG, même lecture que `loadPackAg`
// du dashboard). Chaque requête est donc bornée À LA MAIN à l'organisation du
// JWT (`organisationId`), jamais à un paramètre de la requête.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const { organisationId } = auth.ctx;

  const service = createAdminSupabaseClient();

  // Tous les packs de l'organisation, du plus récent au plus ancien par date
  // d'achat (puis de création) : le plus ancien en bas (Val 2026-11-02).
  const { data: packsLus, error: packErr } = await service
    .from('packs_antgaspi')
    .select(PACK_COLS)
    .eq('organisation_id', organisationId)
    .order('date_achat', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (packErr) return serverError(packErr, 'mon_pack_ag.packs');
  const packsParDate = (packsLus ?? []) as unknown as PackRow[];

  // Pack affiché en tête : l'actif (au plus un, uniq_pack_actif_par_org), sinon
  // le dernier pack s'il est épuisé (§11 Bloc Mon pack AG, arbitrage Val
  // 2026-10-08). Un dernier pack annulé n'est pas un solde : rien en tête.
  const packCourant =
    packsParDate.find((p) => p.statut === 'actif') ??
    (packsParDate[0]?.statut === 'epuise' ? packsParDate[0] : null);
  // Le pack en cours en haut de la liste, quelle que soit sa date d'achat.
  const packs = packCourant
    ? [packCourant, ...packsParDate.filter((p) => p !== packCourant)]
    : packsParDate;

  // Collectes AG rattachées à un pack DE L'ORGANISATION de l'appelant. Le
  // gestionnaire voit aussi les collectes des traiteurs tiers sur ses lieux,
  // rattachées à LEUR pack : elles n'y figurent pas.
  const lire = (statuts: string[]) =>
    service
      .from('collectes')
      .select(CONSOMMATION_COLS)
      .eq('type', 'anti_gaspi')
      .in('statut', statuts)
      .eq('packs_antgaspi.organisation_id', organisationId)
      .order('date_collecte', { ascending: false });

  const consommation: ConsommationRow[] = [];
  if (packs.length > 0) {
    // Le crédit est décompté dès la programmation (Val 2026-11-02) : toute
    // collecte non annulée qui porte un pack de l'organisation l'a consommé, à
    // venir comme passée. Une collecte programmée sans crédit restant n'en
    // porte pas (facturée à l'unité) et n'est donc pas listée, sauf si l'Admin
    // la rattache ensuite à un pack de l'organisation. Une annulation à temps
    // rend le crédit et retire le pack ; une refusée par le prestataire aussi.
    // Sans plafond : l'écran range les collectes par pack, un plafond global
    // viderait les packs les plus anciens. Volume borné par l'organisation :
    // chaque rattachement à un pack décompte normalement un crédit (le seed
    // démo, lui, en rattache plus que ses crédits).
    const { data: realisees, error: consoErr } = await lire([
      ...STATUTS_A_VENIR,
      'realisee',
      'realisee_sans_collecte',
      'cloturee',
    ]);
    // Une liste vide est un état normal (pack jamais débité) : une lecture en
    // échec ne doit pas s'y confondre.
    if (consoErr) return serverError(consoErr, 'mon_pack_ag.consommation');

    // Annulées : seule une annulation tardive garde son crédit. Avant le
    // 2026-11-02, le pack était posé dès l'attribution (réservation) : une
    // collecte annulée qui porte un pack n'a donc PAS forcément consommé un
    // crédit (données d'avant cette date). Les seules
    // traces exactes du débit sont la ligne d'audit du trigger
    // trg_pack_debit_annulation_tardive (pack en `record_id`, collecte en
    // `old_values`) et, pour une annulée tardive rattachée après coup par
    // l'Admin, celle de rpc_rattacher_collecte_pack (collecte en `record_id`).
    const { data: annulees, error: annuleesErr } = await lire(['annulee']);
    if (annuleesErr)
      return serverError(annuleesErr, 'mon_pack_ag.consommation');

    const candidates = (annulees ?? []) as unknown as ConsommationRow[];
    let debitees: ConsommationRow[] = [];
    if (candidates.length > 0) {
      // Le journal ne porte que sur les packs des collectes lues ci-dessus pour
      // l'organisation, et ne sert qu'à garder ou écarter ces mêmes collectes :
      // aucune valeur du journal ne part dans la réponse.
      const packIds = [...new Set(candidates.map((c) => c.packs_antgaspi.id))];
      const [debitsLus, rattachementsLus] = await Promise.all([
        service
          .from('audit_log')
          .select('old_values')
          .eq('table_name', 'packs_antgaspi')
          .eq('action', 'pack_debite_annulation_tardive')
          .in('record_id', packIds),
        service
          .from('audit_log')
          .select('record_id')
          .eq('table_name', 'collectes')
          .eq('action', 'pack_rattache_collecte')
          .in(
            'record_id',
            candidates.map((c) => c.id),
          ),
      ]);
      const erreurAudit = debitsLus.error ?? rattachementsLus.error;
      if (erreurAudit)
        return serverError(erreurAudit, 'mon_pack_ag.consommation');

      const tracees = new Set([
        ...(debitsLus.data ?? []).map(
          (d) => (d.old_values as { collecte_id?: string } | null)?.collecte_id,
        ),
        ...(rattachementsLus.data ?? []).map((r) => r.record_id),
      ]);
      debitees = candidates.filter((c) => tracees.has(c.id));
    }

    consommation.push(
      ...((realisees ?? []) as unknown as ConsommationRow[]),
      ...debitees,
    );
  }

  return NextResponse.json({
    data: {
      pack_courant: packCourant ? mapPack(packCourant) : null,
      packs: packs.map(mapPack),
      collectes: consommation
        .sort((a, b) => b.date_collecte.localeCompare(a.date_collecte))
        .map(mapConsommation),
    },
  });
}
