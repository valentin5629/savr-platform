import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export type StaffRole = 'admin_savr' | 'ops_savr';

export interface AuthContext {
  userId: string;
  role: StaffRole;
  organisationId: string | null;
}

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

function createSupabaseServerClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          const cookieStore = await cookies();
          return cookieStore.getAll();
        },
        async setAll(cookiesToSet) {
          const cookieStore = await cookies();
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}

// Extrait l'utilisateur courant depuis la session et vérifie son rôle.
// Retourne { ctx } si ok, { error } avec la NextResponse à renvoyer si ko.
export async function requireStaff(
  _req: NextRequest,
): Promise<
  { ctx: AuthContext; error?: never } | { ctx?: never; error: NextResponse }
> {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = parseJwtClaims(session?.access_token ?? '');
  const role = claims['role'] as string | undefined;

  if (role !== 'admin_savr' && role !== 'ops_savr') {
    return {
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    };
  }

  return {
    ctx: {
      userId: user.id,
      role: role as StaffRole,
      organisationId: (claims['organisation_id'] as string) ?? null,
    },
  };
}

// Variante réservée à admin_savr uniquement.
export async function requireAdmin(
  req: NextRequest,
): Promise<
  { ctx: AuthContext; error?: never } | { ctx?: never; error: NextResponse }
> {
  const result = await requireStaff(req);
  if (result.error) return result;
  if (result.ctx.role !== 'admin_savr') {
    return {
      error: NextResponse.json(
        { error: 'Action réservée admin Savr' },
        { status: 403 },
      ),
    };
  }
  return result;
}
