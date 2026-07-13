import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { loadBenchmarkFiltres, LoaderError } from '@/lib/dashboards/loaders.js';

// GET /api/v1/dashboards/benchmark/filtres — options des multi-selects de l'encart
// « Filtres benchmark » (§06.05 Bloc 3). Fine enveloppe autour de `loadBenchmarkFiltres`.
// Les rôles traiteur/agence n'obtiennent PAS la liste traiteurs (préservation §04).
const ALLOWED_ROLES = [
  'gestionnaire_lieux',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();

  try {
    const data = await loadBenchmarkFiltres(supabase, auth.ctx);
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
