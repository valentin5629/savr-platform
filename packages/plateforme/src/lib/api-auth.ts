import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export type StaffRole = 'admin_savr' | 'ops_savr';
export type ClientRole =
  | 'traiteur_commercial'
  | 'traiteur_manager'
  | 'agence'
  | 'gestionnaire_lieux'
  | 'client_organisateur';

export type AnyRole = StaffRole | ClientRole;

export interface AuthContext {
  userId: string;
  role: StaffRole;
  organisationId: string | null;
}

export interface UserAuthContext {
  userId: string;
  role: AnyRole;
  organisationId: string;
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

export function createSupabaseServerClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Schéma métier par défaut (sinon supabase-js cible `public` → PGRST205).
      // Pour les tables shared.*, utiliser .schema('shared') explicitement.
      db: { schema: 'plateforme' },
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
  const role = claims['user_role'] as string | undefined;

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

// Vérifie qu'un utilisateur client est authentifié avec l'un des rôles autorisés.
// Toutes les routes /programmation/* utilisent cette fonction.
export async function requireUser(
  _req: NextRequest,
  allowed: ClientRole[],
): Promise<
  { ctx: UserAuthContext; error?: never } | { ctx?: never; error: NextResponse }
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
  const role = claims['user_role'] as string | undefined;
  const organisationId = claims['organisation_id'] as string | undefined;

  if (!role || !allowed.includes(role as ClientRole)) {
    return {
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    };
  }

  if (!organisationId) {
    return {
      error: NextResponse.json(
        { error: 'Organisation manquante dans le JWT' },
        { status: 403 },
      ),
    };
  }

  return {
    ctx: {
      userId: user.id,
      role: role as AnyRole,
      organisationId,
    },
  };
}

export interface AnyUserAuthContext {
  userId: string;
  role: AnyRole;
  /** Organisation métier (null pour le staff admin/ops, périmètre global). */
  organisationId: string | null;
  isStaff: boolean;
}

// Authentifie un utilisateur quel que soit son rôle (staff OU client) et renvoie
// son rôle métier. Utilisé par l'endpoint d'export unifié, qui applique ensuite
// sa propre matrice d'autorisation par entité. Un client sans organisation_id
// dans le JWT est refusé (403) ; le staff n'a pas cette contrainte.
export async function requireAnyUser(
  _req: NextRequest,
): Promise<
  | { ctx: AnyUserAuthContext; error?: never }
  | { ctx?: never; error: NextResponse }
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
  const role = claims['user_role'] as string | undefined;
  const organisationId = claims['organisation_id'] as string | undefined;

  const isStaff = role === 'admin_savr' || role === 'ops_savr';
  const isClient =
    role != null &&
    (
      [
        'traiteur_commercial',
        'traiteur_manager',
        'agence',
        'gestionnaire_lieux',
        'client_organisateur',
      ] as string[]
    ).includes(role);

  if (!isStaff && !isClient) {
    return {
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    };
  }

  if (!isStaff && !organisationId) {
    return {
      error: NextResponse.json(
        { error: 'Organisation manquante dans le JWT' },
        { status: 403 },
      ),
    };
  }

  return {
    ctx: {
      userId: user.id,
      role: role as AnyRole,
      organisationId: organisationId ?? null,
      isStaff,
    },
  };
}

export const PROGRAMMATION_ROLES: ClientRole[] = [
  'traiteur_commercial',
  'traiteur_manager',
  'agence',
  'gestionnaire_lieux',
];

// Shortcut : tous les rôles clients qui peuvent programmer une collecte.
export async function requireProgrammateur(
  req: NextRequest,
): Promise<
  { ctx: UserAuthContext; error?: never } | { ctx?: never; error: NextResponse }
> {
  return requireUser(req, PROGRAMMATION_ROLES);
}

// Shortcut : programmation de support admin_savr (tous périmètres).
// organisationId proviendra du body (champ organisation_id requis).
export async function requireProgrammateurOuAdmin(
  _req: NextRequest,
): Promise<
  | { ctx: UserAuthContext & { isAdmin: boolean }; error?: never }
  | { ctx?: never; error: NextResponse }
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
  const role = claims['user_role'] as string | undefined;
  const organisationId = claims['organisation_id'] as string | undefined;

  const isAdmin = role === 'admin_savr' || role === 'ops_savr';
  const isProgrammateur = PROGRAMMATION_ROLES.includes(role as ClientRole);

  if (!isAdmin && !isProgrammateur) {
    return {
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    };
  }

  if (!isAdmin && !organisationId) {
    return {
      error: NextResponse.json(
        { error: 'Organisation manquante dans le JWT' },
        { status: 403 },
      ),
    };
  }

  return {
    ctx: {
      userId: user.id,
      role: role as AnyRole,
      organisationId: organisationId ?? '', // admin: '' — sera remplacé par body.organisation_id dans la route
      isAdmin,
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
