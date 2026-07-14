import { NextRequest, NextResponse } from 'next/server';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { loadPackAg, LoaderError } from '@/lib/dashboards/loaders.js';

// GET /api/v1/programmation/pack-ag — pack unique actif de l'organisation du caller.
// Fine enveloppe autour de `loadPackAg` (lecture service_role, filtrée sur l'org).
// Admin support (§06.01 l.15) : programme pour le compte d'une org → le pack ciblé
// vient de `?organisation_id=`, pas du caller (admin n'a pas d'organisation propre).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  let organisationId = auth.ctx.organisationId;
  if (auth.ctx.isAdmin) {
    const orgParam = new URL(req.url).searchParams.get('organisation_id');
    // Pas d'org cible encore sélectionnée → pas de pack à vérifier (l'UI bloque l'AG).
    if (!orgParam) return NextResponse.json({ pack_actif: false });
    organisationId = orgParam;
  }

  try {
    const result = await loadPackAg({ ...auth.ctx, organisationId });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
