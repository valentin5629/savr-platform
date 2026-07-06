import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

// GET /api/v1/admin/dashboard-client/benchmark
// §06.06 §2 — jauges benchmark parc (Bloc 3 ZD) côté Dashboard Client Admin.
// Équivalent staff de /api/v1/dashboards/benchmark : la route client n'autorise
// que les rôles gestionnaire/traiteur ; ici requireStaff + service-role appelle
// f_benchmark_kg_pax_zd (k-anonymat ≥5 appliqué côté fonction, inchangé).
// Lecture seule. Paramètres : bracket (XS|S|M|L|XL, sinon les 5), flux_code.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  // bracket → filtre taille de la fonction 7-params (BL-P1-GEST-04) ; flux_code
  // filtré client-side dans BenchmarkGauge.
  const bracket = searchParams.get('bracket');

  const allBrackets = ['XS', 'S', 'M', 'L', 'XL'];
  const { data, error } = await supabase.rpc('f_benchmark_kg_pax_zd', {
    p_taille_evenement_codes: bracket ? [bracket] : allBrackets,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { data: data ?? [] },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
