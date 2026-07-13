import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import {
  loadTraiteurDashboard,
  LoaderError,
} from '@/lib/dashboards/loaders.js';

/**
 * GET /api/v1/dashboards/traiteur-full — endpoint CONSOLIDÉ du dashboard traiteur.
 *
 * Exécute tous les loaders de l'onglet demandé (kpi + évolution + blocs + marge|pack)
 * en UN seul Promise.all serveur, à côté de la base, et renvoie un payload unique.
 * Le composant client l'utilise pour ses re-fetch (changement d'onglet / de période)
 * → 1 aller-retour au lieu de ~4. Le benchmark (Bloc 3 ZD) est piloté par ses
 * propres filtres et reste servi par /dashboards/benchmark (inchangé).
 *
 * Réservé aux rôles traiteur (le premier rendu se fait en SSR côté page ; ceci ne
 * sert QUE les re-fetch interactifs). N-1 toujours actif.
 */
const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;

  try {
    const data = await loadTraiteurDashboard(supabase, auth.ctx, {
      from: sp.get('from'),
      to: sp.get('to'),
      type: sp.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet',
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
