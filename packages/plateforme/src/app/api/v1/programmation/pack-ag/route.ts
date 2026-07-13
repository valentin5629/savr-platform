import { NextRequest, NextResponse } from 'next/server';
import { requireProgrammateur } from '@/lib/api-auth.js';
import { loadPackAg, LoaderError } from '@/lib/dashboards/loaders.js';

// GET /api/v1/programmation/pack-ag — pack unique actif de l'organisation du caller.
// Fine enveloppe autour de `loadPackAg` (lecture service_role, filtrée sur l'org).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateur(req);
  if (auth.error) return auth.error;

  try {
    const result = await loadPackAg(auth.ctx);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
