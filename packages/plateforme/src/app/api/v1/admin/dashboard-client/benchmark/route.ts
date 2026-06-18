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
  const bracket = searchParams.get('bracket');
  const fluxCode = searchParams.get('flux_code');

  const allBrackets = ['XS', 'S', 'M', 'L', 'XL'];
  const bracketsToQuery = bracket ? [bracket] : allBrackets;

  const results = await Promise.all(
    bracketsToQuery.map((b) =>
      supabase.rpc('f_benchmark_kg_pax_zd', {
        p_bracket: b,
        ...(fluxCode ? { p_flux_code: fluxCode } : {}),
      }),
    ),
  );

  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    return NextResponse.json(
      { error: firstError.error.message },
      { status: 500 },
    );
  }

  const data = results.flatMap((r) => r.data ?? []);
  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
