import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/api-auth.js';

// Rôles autorisés à appeler le benchmark (§04 f_benchmark_kg_pax_zd)
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
      // La fonction RPC f_benchmark_kg_pax_zd vit dans le schéma `plateforme`
      // (cf. api-auth.ts) : sans cette option supabase-js cible `public.*`
      // (Accept-Profile: public) → fonction introuvable → 500.
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

  const { searchParams } = new URL(req.url);
  // bracket obligatoire (XS|S|M|L|XL) — sans bracket on retourne tous les brackets via mv
  const bracket = searchParams.get('bracket');
  const fluxCode = searchParams.get('flux_code');

  // Garde : les rôles traiteur ne peuvent pas passer traiteur_ids (§04 préservation compétitive)
  const traiteurIdsRaw = searchParams.get('traiteur_ids');
  const isTraiteur =
    auth.ctx.role === 'traiteur_manager' ||
    auth.ctx.role === 'traiteur_commercial';
  if (isTraiteur && traiteurIdsRaw) {
    return NextResponse.json(
      {
        error:
          'Le filtre traiteur_ids est interdit pour ce rôle (§04 préservation compétitive)',
      },
      { status: 403 },
    );
  }

  // Sans bracket : on retourne les données pré-calculées de la vue matérialisée via la fonction
  // Avec bracket : on appelle la fonction directement pour ce bracket
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
