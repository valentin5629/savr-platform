import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError } from '@/lib/api-helpers.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Colonnes réelles de packs_antgaspi (convergées M2.1 / §04). Financier (prix,
// montant, devise) VOLONTAIREMENT exclu : masqué côté gestionnaire de lieux
// (§06.05 — « tarifs AG, tout élément financier masqué »).
const PACK_COLS =
  'id, type_pack, credits_initiaux, credits_consommes, credits_restants, date_achat, date_expiration';

interface PackRow {
  id: string;
  type_pack: string;
  credits_initiaux: number;
  credits_consommes: number;
  credits_restants: number;
  date_achat: string | null;
  date_expiration: string | null;
}

// Mappe une ligne packs_antgaspi vers la forme attendue par l'UI (§06.05 « Mon
// pack AG », comportement identique au Bloc 4 AG §06.04). Pas de colonne
// `reference` dans le data model → `type_pack` tient lieu d'identifiant.
function mapPack(p: PackRow) {
  return {
    id: p.id,
    reference: p.type_pack,
    nb_collectes_total: p.credits_initiaux,
    nb_collectes_restantes: p.credits_restants,
    date_debut: p.date_achat,
    date_fin: p.date_expiration,
  };
}

// Collecte AG telle que les deux lectures de l'historique la demandent. La
// jointure sur le pack est obligatoire (`!inner`) et filtrée par l'appelant sur
// SON organisation : sans `!inner`, le filtre sur le pack embarqué vide l'embed
// et garde la ligne (mesuré sur savr-dev).
const CONSOMMATION_COLS = `id, date_collecte, statut,
       packs_antgaspi!pack_antgaspi_id!inner(id),
       evenements!inner(nom_evenement, date_evenement,
         lieux!lieu_id(nom)),
       attributions_antgaspi:v_attributions_gestionnaire(
         volume_repas_realise, association_nom)`;

interface ConsommationRow {
  id: string;
  date_collecte: string;
  statut: string;
  packs_antgaspi: { id: string }; // to-one + `!inner` : toujours un objet
  evenements: unknown;
  attributions_antgaspi: unknown;
}

function mapConsommation(c: ConsommationRow) {
  const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
  const lieu = (evt as { lieux?: { nom?: string } })?.lieux;
  // Crédit consommé sans collecte réalisée (§05 « Débit d'un crédit », 2e cas).
  const annulee = c.statut === 'annulee';
  // Vue `v_attributions_gestionnaire` (§04) sous la clé `attributions_antgaspi` :
  // embed to-one → objet PostgREST, à envelopper ; nom de l'association à plat.
  // Une collecte annulée garde son attribution (posée avec le pack) mais n'a
  // rien donné : ni repas, ni association bénéficiaire.
  const attrs = annulee
    ? []
    : Array.isArray(c.attributions_antgaspi)
      ? c.attributions_antgaspi
      : c.attributions_antgaspi
        ? [c.attributions_antgaspi]
        : [];
  return {
    collecte_id: c.id,
    date_collecte: c.date_collecte,
    annulee_tardivement: annulee,
    evenement: (evt as { nom_evenement?: string })?.nom_evenement ?? null,
    lieu: lieu?.nom ?? null,
    repas_donnes: attrs.reduce(
      (s, a) =>
        s +
        ((a as { volume_repas_realise?: number }).volume_repas_realise ?? 0),
      0,
    ),
    associations: attrs.map((a) => ({
      nom: (a as { association_nom?: string }).association_nom ?? null,
      repas: (a as { volume_repas_realise?: number }).volume_repas_realise ?? 0,
    })),
  };
}

// GET /api/v1/gestionnaire/pack-ag
// Pack AG actif de l'organisation + historique consommation (§06.05 l.75,
// navigation — entrée « Mon pack AG »). Pas d'historique des packs : le CDC
// l'exclut (« pas d'historique multi-packs », arbitrage Val 2026-10-07).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const { organisationId } = auth.ctx;

  const supabase = createSupabaseServerClient();

  // Pack actif — au plus un par organisation (invariant uniq_pack_actif_par_org).
  // Colonnes M2.1 : credits_initiaux (total), credits_consommes (utilisés), credits_restants (GENERATED)
  const { data: packActif, error: packErr } = await supabase
    .from('packs_antgaspi')
    .select(PACK_COLS)
    .eq('statut', 'actif')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (packErr) return serverError(packErr, 'gestionnaire.pack_ag.list');

  // Historique consommation = collectes AG rattachées à un pack DE
  // L'ORGANISATION de l'appelant (§06.05 l.75, arbitrage Val 2026-10-07). Le
  // gestionnaire lit aussi les collectes des traiteurs tiers sur ses lieux,
  // rattachées à LEUR pack : elles n'y figurent pas.
  const lire = (statuts: string[]) =>
    supabase
      .from('collectes')
      .select(CONSOMMATION_COLS)
      .eq('type', 'anti_gaspi')
      .in('statut', statuts)
      .eq('packs_antgaspi.organisation_id', organisationId)
      .order('date_collecte', { ascending: false });

  // 1er cas de débit : la collecte est réalisée (ou clôturée). Le débit à la
  // réalisation ne laisse pas de ligne d'audit : une réalisée dont le pack
  // réservé n'a pu être débité (plus de pack actif, alerte Admin) reste listée.
  const { data: realisees, error: consoErr } = await lire([
    'realisee',
    'cloturee',
  ]).limit(50);
  // Un historique vide est un état normal (aucun pack, ou pack jamais débité) :
  // une lecture en échec ne doit pas s'y confondre.
  if (consoErr)
    return serverError(consoErr, 'gestionnaire.pack_ag.consommation');

  // 2e cas de débit : l'annulation tardive. Le pack est rattaché à la collecte
  // dès la validation de l'attribution (réservation) : une collecte annulée qui
  // porte un pack n'a donc PAS forcément consommé un crédit. La seule trace
  // exacte du débit est la ligne d'audit du trigger
  // trg_pack_debit_annulation_tardive (pack en `record_id`, collecte en
  // `old_values`).
  const { data: annulees, error: annuleesErr } = await lire(['annulee']);
  if (annuleesErr)
    return serverError(annuleesErr, 'gestionnaire.pack_ag.consommation');

  const candidates = (annulees ?? []) as unknown as ConsommationRow[];
  let debitees: ConsommationRow[] = [];
  if (candidates.length > 0) {
    // `audit_log` est réservé au staff (policy al_select_staff) → lecture
    // service. Elle ne porte que sur les packs des collectes que la session
    // vient de lire pour SON organisation, et ne sert qu'à garder ou écarter
    // ces mêmes collectes : rien du journal ne part dans la réponse.
    const packIds = [...new Set(candidates.map((c) => c.packs_antgaspi.id))];
    const { data: debits, error: debitsErr } = await createAdminSupabaseClient()
      .from('audit_log')
      .select('old_values')
      .eq('table_name', 'packs_antgaspi')
      .eq('action', 'pack_debite_annulation_tardive')
      .in('record_id', packIds);
    if (debitsErr)
      return serverError(debitsErr, 'gestionnaire.pack_ag.consommation');

    const tracees = new Set(
      (debits ?? []).map(
        (d) => (d.old_values as { collecte_id?: string } | null)?.collecte_id,
      ),
    );
    debitees = candidates.filter((c) => tracees.has(c.id));
  }

  const consommation = [
    ...((realisees ?? []) as unknown as ConsommationRow[]),
    ...debitees,
  ]
    .sort((a, b) => b.date_collecte.localeCompare(a.date_collecte))
    .slice(0, 50);

  return NextResponse.json({
    data: {
      pack_actif: packActif ? mapPack(packActif as unknown as PackRow) : null,
      historique_consommation: consommation.map(mapConsommation),
    },
  });
}
