import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { loadAdminBenchmarkFiltres } from '@/lib/dashboards/admin-dashboard-client.js';

// GET /api/v1/admin/dashboard-client/benchmark/filtres
// §06.06 §2 — options de l'encart « Comparer avec » du radar Admin (lieux du
// parc, traiteurs du parc, types d'événements). Équivalent staff de
// /api/v1/dashboards/benchmark/filtres : même contrat de réponse
// ({ data: { lieux, traiteurs, types } }), lu en service_role après requireStaff.
// Lecture seule.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  try {
    const data = await loadAdminBenchmarkFiltres(createAdminSupabaseClient());
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (e) {
    return serverError(e, 'admin.dashboard_client.benchmark.filtres');
  }
}
