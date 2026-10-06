import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { ROLE_PREFIXES, ROUTES } from '@/lib/routes';

// ⚠ EMPLACEMENT : ce fichier DOIT rester dans `src/`. Next 15 cherche le middleware
// dans `path.join(pagesDir || appDir, '..')` ; l'app vivant dans `src/app` (sans
// `pages/`), un `middleware.ts` à la racine du package n'est JAMAIS chargé. Jusqu'au
// 2026-09-11 il y était : `middleware-manifest.json` vide, aucun filtrage par rôle
// n'a jamais tourné (seules les gardes serveur des layouts/routes protégeaient).
// Cliquet : tests/securite/middleware-actif.test.ts.

// Gating par espace (§09). Doit rester aligné sur les gardes serveur des layouts
// (requireStaffPage / requirePageSession) et des routes API correspondantes.
// Table dérivée de la définition unique rôle → espace (`lib/routes.ts`, module
// pur compatible Edge) ; réexportée pour les tests et appelants existants.
export { ROLE_PREFIXES };

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function getRolesForPath(pathname: string): string[] | null {
  for (const [prefix, roles] of Object.entries(ROLE_PREFIXES)) {
    if (matchesPrefix(pathname, prefix)) return roles;
  }
  return null;
}

// Chemins jamais filtrés par le middleware.
//  • `/api/*` : chaque route handler porte sa propre garde et répond en JSON
//    (401/403) — une redirection 307 vers /login casserait ce contrat et, surtout,
//    les appelants tiers : Vercel Cron (`/api/cron/*`, Bearer CRON_SECRET), webhooks
//    emails/logistique (`/api/webhooks/*`, signature/jeton), Better Uptime (`/api/health*`).
//    Déjà exclu par le `matcher` ; redoublé ici si le matcher venait à changer.
//  • `/auth/*` : callback d'impersonation, validé par son OTP (sans session préalable).
//  • pages d'authentification, /403 (cible des refus → pas de boucle), assets.
const PUBLIC_PREFIXES = [
  '/api',
  '/auth',
  ROUTES.login,
  ROUTES.signup,
  ROUTES.verifyEmail,
  ROUTES.resetPassword,
  // Texte des CGU : accepté à l'inscription, donc lisible AVANT d'avoir un compte.
  ROUTES.cgu,
  ROUTES.interdit,
  // Pages de smoke-test de composants (dev-only, présentationnel, sans donnée
  // sensible) — délibérément hors du gating /admin/* réservé admin_savr/ops_savr.
  // 404 sur tout build de production : garde dans src/app/dev/layout.tsx.
  '/dev',
  '/_next',
];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix)) ||
    pathname.startsWith('/favicon')
  );
}

// Décodage du payload JWT compatible Edge Runtime (pas de `Buffer`). La signature
// n'est pas vérifiée ici : `getUser()` a déjà validé la session auprès de GoTrue.
function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Pattern @supabase/ssr : un token rafraîchi est reposé sur la requête (pour les
  // Server Components de CE rendu) ET sur la réponse (pour le navigateur). La
  // réponse est recréée APRÈS mise à jour des cookies de requête : NextResponse
  // fige les en-têtes de requête à sa construction.
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            req.cookies.set(name, value),
          );
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Toute redirection reprend les cookies éventuellement rafraîchis : sinon le
  // navigateur garderait un refresh token déjà consommé (rotation) → déconnexion.
  const redirect = (url: URL): NextResponse => {
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
    return res;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Non authentifié → /login
  if (!user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = ROUTES.login;
    loginUrl.search = '';
    loginUrl.searchParams.set('next', pathname);
    return redirect(loginUrl);
  }

  // Email non vérifié → /verify-email (§09 : un compte non vérifié ne programme pas)
  if (!user.email_confirmed_at) {
    const verifyUrl = req.nextUrl.clone();
    verifyUrl.pathname = ROUTES.verifyEmail;
    verifyUrl.search = '';
    return redirect(verifyUrl);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = parseJwtClaims(session?.access_token ?? '');

  const appDomain = (claims['app_domain'] as string | undefined) ?? null;
  const role = (claims['user_role'] as string | undefined) ?? null;

  // app_domain != 'plateforme' → 403 (§09 : un compte TMS ne se logue jamais ici)
  if (appDomain !== null && appDomain !== 'plateforme') {
    return redirect(new URL(ROUTES.interdit, req.url));
  }

  // Vérification du rôle requis pour le préfixe de route (fail-closed) : si la
  // route exige un rôle, l'accès est refusé tant que le claim n'est PAS un rôle
  // autorisé — y compris quand `user_role` est absent du JWT.
  const requiredRoles = getRolesForPath(pathname);
  if (
    requiredRoles !== null &&
    (role === null || !requiredRoles.includes(role))
  ) {
    return redirect(new URL(ROUTES.interdit, req.url));
  }

  return response;
}

// `api/` exclu : cf. PUBLIC_PREFIXES. Littéral obligatoire (analysé statiquement
// par Next au build).
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
