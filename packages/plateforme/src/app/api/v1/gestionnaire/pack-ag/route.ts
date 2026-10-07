import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Colonnes réelles de packs_antgaspi (convergées M2.1 / §04). Financier (prix,
// montant, devise) VOLONTAIREMENT exclu : masqué côté gestionnaire de lieux
// (§06.05 — « tarifs AG, tout élément financier masqué »).
const PACK_COLS =
  'id, type_pack, credits_initiaux, credits_consommes, credits_restants, date_achat, date_expiration, statut';

interface PackRow {
  id: string;
  type_pack: string;
  credits_initiaux: number;
  credits_consommes: number;
  credits_restants: number;
  date_achat: string | null;
  date_expiration: string | null;
  statut: string;
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
    statut: p.statut,
  };
}

// GET /api/v1/gestionnaire/pack-ag
// Pack AG actif de l'organisation + historique consommation (§06.05 l.75,
// navigation — entrée « Mon pack AG »).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const { organisationId } = auth.ctx;

  const supabase = createSupabaseServerClient();

  // Pack actif (FIFO strict — 1 pack actif max par organisation)
  // Colonnes M2.1 : credits_initiaux (total), credits_consommes (utilisés), credits_restants (GENERATED)
  const { data: packActif, error: packErr } = await supabase
    .from('packs_antgaspi')
    .select(PACK_COLS)
    .eq('statut', 'actif')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (packErr) return serverError(packErr, 'gestionnaire.pack_ag.list');

  // Historique packs (tous statuts, 3 derniers)
  const { data: historique } = await supabase
    .from('packs_antgaspi')
    .select(PACK_COLS)
    .order('created_at', { ascending: false })
    .limit(10);

  // Historique consommation : collectes AG réalisées ou clôturées, débitées sur
  // un pack DE L'ORGANISATION de l'appelant (§06.05 l.75) — le gestionnaire lit
  // aussi celles des traiteurs tiers sur ses lieux, débitées sur LEUR pack.
  // `!inner` est ce qui écarte la collecte : sans lui, le filtre sur le pack
  // embarqué vide l'embed et garde la ligne (mesuré sur savr-dev).
  const { data: consommation, error: consoErr } = await supabase
    .from('collectes')
    .select(
      `id, date_collecte, statut,
       packs_antgaspi!pack_antgaspi_id!inner(id),
       evenements!inner(nom_evenement, date_evenement,
         lieux!lieu_id(nom)),
       attributions_antgaspi:v_attributions_gestionnaire(
         volume_repas_realise, association_nom)`,
    )
    .eq('type', 'anti_gaspi')
    .in('statut', ['realisee', 'cloturee'])
    .eq('packs_antgaspi.organisation_id', organisationId)
    .order('date_collecte', { ascending: false })
    .limit(50);

  // Un historique vide est un état normal (aucun pack, ou pack jamais débité) :
  // une lecture en échec ne doit pas s'y confondre.
  if (consoErr)
    return serverError(consoErr, 'gestionnaire.pack_ag.consommation');

  return NextResponse.json({
    data: {
      pack_actif: packActif ? mapPack(packActif as unknown as PackRow) : null,
      historique_packs: ((historique ?? []) as unknown as PackRow[]).map(
        mapPack,
      ),
      historique_consommation: (consommation ?? []).map((c) => {
        const evt = Array.isArray(c.evenements)
          ? c.evenements[0]
          : c.evenements;
        const lieu = (evt as { lieux?: { nom?: string } })?.lieux;
        // Vue `v_attributions_gestionnaire` (§04) sous la clé `attributions_antgaspi` :
        // embed to-one → objet PostgREST, à envelopper ; nom de l'association à plat.
        const attrs = Array.isArray(c.attributions_antgaspi)
          ? c.attributions_antgaspi
          : c.attributions_antgaspi
            ? [c.attributions_antgaspi]
            : [];
        return {
          collecte_id: c.id,
          date_collecte: c.date_collecte,
          evenement: (evt as { nom_evenement?: string })?.nom_evenement ?? null,
          lieu: lieu?.nom ?? null,
          repas_donnes: attrs.reduce(
            (s, a) =>
              s +
              ((a as { volume_repas_realise?: number }).volume_repas_realise ??
                0),
            0,
          ),
          associations: attrs.map((a) => ({
            nom: (a as { association_nom?: string }).association_nom ?? null,
            repas:
              (a as { volume_repas_realise?: number }).volume_repas_realise ??
              0,
          })),
        };
      }),
    },
  });
}
