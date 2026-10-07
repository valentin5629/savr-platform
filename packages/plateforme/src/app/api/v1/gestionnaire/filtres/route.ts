import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import {
  loadFiltresParcGestionnaire,
  LoaderError,
  type FiltresParcGestionnaire,
} from '@/lib/dashboards/loaders.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/filtres
// Options des filtres globaux du dashboard + de la liste Événements (§06.05 §1 l.99-107) :
//  - Lieux    : lieux rattachés à l'organisation (organisations_lieux)
//  - Traiteurs: traiteurs intervenus sur ≥ 1 collecte sur ces lieux (24 derniers mois)
//  - Types    : référentiel types_evenements (actif)
// Lieux et Traiteurs viennent de `loadFiltresParcGestionnaire`, que l'encart
// benchmark (/api/v1/dashboards/benchmark/filtres) appelle aussi : mêmes listes
// des deux côtés (décision Val 2026-10-06).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  let parc: FiltresParcGestionnaire;
  try {
    parc = await loadFiltresParcGestionnaire(supabase);
  } catch (e) {
    // Lecture en échec : 500 au libellé neutre (l'erreur réelle est déjà
    // journalisée par le loader), jamais des listes vides qui se liraient
    // « aucun lieu rattaché ».
    if (e instanceof LoaderError)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
    throw e;
  }
  const { sansLieu, lieux, traiteurs } = parc;
  if (sansLieu) {
    return NextResponse.json({
      data: { lieux: [], traiteurs: [], types: [] },
    });
  }

  // Types d'événement (référentiel).
  const { data: types } = await supabase
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });

  return NextResponse.json({
    data: {
      lieux,
      traiteurs,
      types: (types ?? []).map((t) => ({
        id: t.id as string,
        libelle: t.libelle as string,
      })),
    },
  });
}
