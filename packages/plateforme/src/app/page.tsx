import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Page racine `/` : redirige vers l'espace du rôle (ou /login si non connecté).
// Évite le 404 sur `/` pour les utilisateurs authentifiés. L'appel à cookies()
// force le rendu dynamique (pas de 404 statique mis en cache par le CDN).

const HOME_BY_ROLE: Record<string, string> = {
  admin_savr: '/admin/dashboard',
  ops_savr: '/admin/dashboard',
  traiteur_manager: '/traiteur',
  traiteur_commercial: '/traiteur',
  agence: '/agence',
  gestionnaire_lieux: '/gestionnaire',
  client_organisateur: '/organisateur',
};

function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function RootPage(): Promise<never> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const role = parseJwtClaims(session?.access_token ?? '')['user_role'] as
    | string
    | undefined;

  redirect((role && HOME_BY_ROLE[role]) || '/login');
}
