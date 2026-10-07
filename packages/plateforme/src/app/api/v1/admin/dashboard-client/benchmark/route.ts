import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { loadAdminBenchmarkComparaison } from '@/lib/dashboards/admin-dashboard-client.js';

// GET /api/v1/admin/dashboard-client/benchmark
// §06.06 §2 — ligne de référence du radar Bloc 3 ZD côté Dashboard Client Admin
// (« Moyenne parc » paramétrable, décision Val 2026-10-02). requireStaff +
// service_role : kg/pax par flux des collectes clôturées ZD du parc, période fixe
// 24 mois glissants, restreint aux filtres reçus — SANS k-anonymat (l'Admin voit
// déjà chaque organisation en clair ; cf. loadAdminBenchmarkComparaison). Les
// dashboards clients continuent de passer par f_benchmark_kg_pax_zd (k-anonyme).
// Lecture seule. Paramètres (CSV, tous facultatifs, même contrat que la route
// client) : traiteur_ids, lieu_ids, type_evenement_ids, taille_evenement_codes.
// Réponse : { data: { kgParPaxParFlux, nbCollectes, periode } }.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const csv = (k: string): string[] => {
    const v = searchParams.get(k);
    if (!v) return [];
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  try {
    const data = await loadAdminBenchmarkComparaison(
      createAdminSupabaseClient(),
      {
        traiteurIds: csv('traiteur_ids'),
        lieuIds: csv('lieu_ids'),
        typeEvtIds: csv('type_evenement_ids'),
        tailleEvts: csv('taille_evenement_codes'),
      },
    );
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (e) {
    return serverError(e, 'admin.dashboard_client.benchmark.list');
  }
}
