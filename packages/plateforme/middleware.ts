import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const ROLE_PREFIXES: Record<string, string[]> = {
  '/admin': ['admin_savr', 'ops_savr'],
  '/traiteur': ['traiteur_manager', 'traiteur_commercial'],
  '/agence': ['agence'],
  '/gestionnaire': ['gestionnaire_lieux'],
  '/client-organisateur': ['client_organisateur'],
  '/programmer': [
    'traiteur_commercial',
    'traiteur_manager',
    'agence',
    'gestionnaire_lieux',
    'admin_savr',
  ],
  '/brouillons': [
    'traiteur_commercial',
    'traiteur_manager',
    'agence',
    'gestionnaire_lieux',
    'admin_savr',
  ],
};

function getRolesForPath(pathname: string): string[] | null {
  for (const [prefix, roles] of Object.entries(ROLE_PREFIXES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return roles;
    }
  }
  return null;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Routes publiques : pas de vérification
  if (
    pathname.startsWith('/api/auth') ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/verify-email' ||
    pathname === '/reset-password' ||
    pathname === '/403' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Non authentifié → /login
  if (!user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Email non vérifié → /verify-email
  if (!user.email_confirmed_at) {
    const verifyUrl = req.nextUrl.clone();
    verifyUrl.pathname = '/verify-email';
    return NextResponse.redirect(verifyUrl);
  }

  // Lire les claims JWT
  const claims =
    ((user as unknown as { claims?: Record<string, unknown> }).claims ??
    (await supabase.auth.getSession()).data.session?.access_token)
      ? parseJwtClaims(
          (await supabase.auth.getSession()).data.session?.access_token ?? '',
        )
      : {};

  const appDomain = (claims['app_domain'] as string | undefined) ?? null;
  const role = (claims['user_role'] as string | undefined) ?? null;

  // app_domain != 'plateforme' → 403
  if (appDomain !== null && appDomain !== 'plateforme') {
    return NextResponse.redirect(new URL('/403', req.url));
  }

  // Vérification du rôle requis pour le préfixe de route
  const requiredRoles = getRolesForPath(pathname);
  if (requiredRoles !== null && role !== null) {
    if (!requiredRoles.includes(role)) {
      return NextResponse.redirect(new URL('/403', req.url));
    }
  }

  return response;
}

function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
