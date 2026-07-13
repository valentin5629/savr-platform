import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { loadMargeAttente, LoaderError } from '@/lib/dashboards/loaders.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/marge-attente-facturation — badge F3 (§06.04 KPI Marge).
// Fine enveloppe autour de `loadMargeAttente`.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);

  try {
    const data = await loadMargeAttente(supabase, {
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
