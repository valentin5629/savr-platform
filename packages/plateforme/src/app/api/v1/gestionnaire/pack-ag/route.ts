import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/pack-ag
// Pack AG actif de l'organisation + historique consommation (§06.05 §4).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  // Pack actif (FIFO strict — 1 pack actif max par organisation)
  const { data: packActif, error: packErr } = await supabase
    .from('packs_antgaspi')
    .select(
      `id, reference, nb_collectes_total, nb_collectes_utilises,
       nb_collectes_restantes, date_debut, date_fin, statut,
       prix_ht, devise`,
    )
    .eq('statut', 'actif')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (packErr)
    return NextResponse.json({ error: packErr.message }, { status: 500 });

  // Historique packs (tous statuts, 3 derniers)
  const { data: historique } = await supabase
    .from('packs_antgaspi')
    .select(
      `id, reference, nb_collectes_total, nb_collectes_utilises,
       date_debut, date_fin, statut`,
    )
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
      pack_actif: packActif,
      historique_packs: historique ?? [],
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
