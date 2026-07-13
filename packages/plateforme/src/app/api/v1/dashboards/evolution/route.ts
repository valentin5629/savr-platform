import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { loadEvolution, LoaderError } from '@/lib/dashboards/loaders.js';

/**
 * GET /api/v1/dashboards/evolution — Bloc 2 (évolution mensuelle) + Bloc 4 (donut)
 * du dashboard client (§11, §06.04/§06.05). « 1 dashboard, 3 contextes » : endpoint
 * PARTAGÉ traiteur / agence / gestionnaire. Fine enveloppe autour de `loadEvolution`
 * (périmètre par rôle + granularité auto = lib/dashboards/loaders).
 */
const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;

  try {
    const data = await loadEvolution(supabase, auth.ctx, {
      type: sp.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet',
      from: sp.get('from'),
      to: sp.get('to'),
      lieuIds: sp.getAll('lieu_ids[]'),
      traiteurIds: sp.getAll('traiteur_ids[]'),
      typeEvtIds: sp.getAll('type_evenement_ids[]'),
      tailleEvts: sp.getAll('taille_evenements[]'),
    });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
