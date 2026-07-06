import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/api-auth.js';

// GET /api/v1/dashboards/benchmark/filtres
// §06.05 Bloc 3 — données des multi-selects de l'encart « Filtres benchmark » :
//   - lieux du parc + traiteurs du parc (fonctions SECURITY DEFINER, id+nom, k-anonymat
//     n'expose aucune donnée métier) ;
//   - types d'événement (référentiel).
// Les rôles traiteur n'obtiennent PAS la liste traiteurs (préservation compétitive §04).
const ALLOWED_ROLES = [
  'gestionnaire_lieux',
  'traiteur_manager',
  'traiteur_commercial',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'plateforme' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );

  const isTraiteur =
    auth.ctx.role === 'traiteur_manager' ||
    auth.ctx.role === 'traiteur_commercial';

  const [lieux, traiteurs, types] = await Promise.all([
    supabase.rpc('f_benchmark_lieux_parc'),
    // Rôle traiteur : pas de filtre par traiteur nommé (compétitif) → liste vide.
    isTraiteur
      ? Promise.resolve({ data: [], error: null })
      : supabase.rpc('f_benchmark_traiteurs_parc'),
    supabase
      .from('types_evenements')
      .select('id, libelle')
      .eq('actif', true)
      .order('ordre_affichage'),
  ]);

  const firstError = lieux.error ?? traiteurs.error ?? types.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      data: {
        lieux: lieux.data ?? [],
        traiteurs: traiteurs.data ?? [],
        types: types.data ?? [],
      },
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
