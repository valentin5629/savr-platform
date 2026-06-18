import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Role } from '@/lib/nav-config';

export interface PageSession {
  userId: string;
  role: Role;
  organisationId: string;
  email: string;
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

/**
 * Garde serveur pour les pages Server Components.
 * Redirige vers /login si non connecté, vers /403 si le rôle n'est pas autorisé.
 * Retourne le contexte session (rôle + organisation depuis les claims JWT).
 */
export async function requirePageSession(
  allowedRoles: readonly Role[],
): Promise<PageSession> {
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
  const claims = parseJwtClaims(session?.access_token ?? '');
  const role = claims['user_role'] as Role | undefined;
  const organisationId = claims['organisation_id'] as string | undefined;

  if (!role || !allowedRoles.includes(role)) redirect('/403');
  if (!organisationId) redirect('/403');

  return {
    userId: user.id,
    role,
    organisationId,
    email: user.email ?? '',
  };
}

export type StaffRole = 'admin_savr' | 'ops_savr';

export interface StaffPageSession {
  userId: string;
  role: StaffRole;
  email: string;
}

/**
 * Garde serveur pour les pages staff (back-office Admin).
 * Autorise `admin_savr` + `ops_savr` (le type Role de nav-config n'inclut pas
 * `ops_savr`, et le staff n'a pas toujours d'organisation_id → requirePageSession
 * ne convient pas). Le middleware garde déjà /admin/* ; ceci est la défense en
 * profondeur côté Server Component. Redirige /login si non connecté, /403 sinon.
 */
export async function requireStaffPage(): Promise<StaffPageSession> {
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
  const claims = parseJwtClaims(session?.access_token ?? '');
  const role = claims['user_role'] as string | undefined;

  if (role !== 'admin_savr' && role !== 'ops_savr') redirect('/403');

  return {
    userId: user.id,
    role: role as StaffRole,
    email: user.email ?? '',
  };
}
