import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { loadKpiTraiteur, LoaderError } from '@/lib/dashboards/loaders.js';

/**
 * GET /api/v1/dashboards/kpi-traiteur — Bloc 1 (KPIs) + N-1 + facteurs/méthode CO₂.
 * Fine enveloppe autour de `loadKpiTraiteur` (logique + contrat = lib/dashboards/loaders).
 */
const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);

  try {
    const result = await loadKpiTraiteur(supabase, auth.ctx, {
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      type: searchParams.get('type'),
      compare: searchParams.get('compare'),
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
