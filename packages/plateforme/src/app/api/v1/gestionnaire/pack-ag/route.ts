import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

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
// Pack AG actif de l'organisation + historique consommation (§06.05 §4).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

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

  if (packErr)
    return NextResponse.json({ error: packErr.message }, { status: 500 });

  // Historique packs (tous statuts, 3 derniers)
  const { data: historique } = await supabase
    .from('packs_antgaspi')
    .select(PACK_COLS)
    .order('created_at', { ascending: false })
    .limit(10);

  // Historique consommation : collectes AG cloturées avec débit pack
  const { data: consommation } = await supabase
    .from('collectes')
    .select(
      `id, date_collecte, statut,
       evenements!inner(nom_evenement, date_evenement,
         lieux!lieu_id(nom)),
       attributions_antgaspi(
         id, volume_repas_realise,
         associations!association_id(nom))`,
    )
    .eq('type', 'anti_gaspi')
    .in('statut', ['realisee', 'cloturee'])
    .not('pack_antgaspi_id', 'is', null)
    .order('date_collecte', { ascending: false })
    .limit(50);

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
        const attrs = Array.isArray(c.attributions_antgaspi)
          ? c.attributions_antgaspi
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
            nom:
              (a as { associations?: { nom?: string } })?.associations?.nom ??
              null,
            repas:
              (a as { volume_repas_realise?: number }).volume_repas_realise ??
              0,
          })),
        };
      }),
    },
  });
}
