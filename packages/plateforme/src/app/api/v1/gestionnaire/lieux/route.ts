import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/lieux
// Liste des lieux de l'organisation via v_lieux_public (masque 4 champs admin-only).
// Colonnes : id, nom, adresse_acces, ville, type_vehicule_max + indicateurs 12 mois.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  // Lieux via v_lieux_public (SECURITY INVOKER — RLS filtre sur organisations_lieux)
  const { data: lieux, error } = await supabase
    .from('v_lieux_public')
    .select(
      'id, nom, adresse_acces, code_postal, ville, region, type_vehicule_max, actif',
    )
    .eq('actif', true)
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Indicateurs 12 mois : nb collectes + tonnage ZD
  const lieuIds = (lieux ?? []).map((l) => l.id as string);
  if (lieuIds.length === 0) return NextResponse.json({ data: [] });

  const since12m = new Date();
  since12m.setMonth(since12m.getMonth() - 12);
  const sinceStr = since12m.toISOString().slice(0, 10);

  const { data: collecteAgg } = await supabase
    .from('collectes')
    .select(
      `id, type, statut,
       evenements!inner(lieu_id),
       collecte_flux(poids_reel_kg)`,
    )
    .eq('statut', 'cloturee')
    .gte('date_collecte', sinceStr)
    .in('evenements.lieu_id', lieuIds);

  // Agréger par lieu
  const byLieu = new Map<string, { nb: number; tonnage: number }>();
  for (const c of collecteAgg ?? []) {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    const lieuId = (evt as { lieu_id?: string })?.lieu_id;
    if (!lieuId) continue;
    const cur = byLieu.get(lieuId) ?? { nb: 0, tonnage: 0 };
    cur.nb += 1;
    if (c.type === 'zero_dechet') {
      const flux = Array.isArray(c.collecte_flux) ? c.collecte_flux : [];
      cur.tonnage += flux.reduce(
        (s, f) => s + ((f as { poids_reel_kg?: number }).poids_reel_kg ?? 0),
        0,
      );
    }
    byLieu.set(lieuId, cur);
  }

  const rows = (lieux ?? []).map((l) => {
    const agg = byLieu.get(l.id as string) ?? { nb: 0, tonnage: 0 };
    return { ...l, nb_collectes_12m: agg.nb, tonnage_12m_kg: agg.tonnage };
  });

  return NextResponse.json({ data: rows });
}
