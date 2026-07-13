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

export interface VerifiedClaims {
  userId: string;
  role: string | undefined;
  organisationId: string | undefined;
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

/**
 * Récupère l'identité de l'appelant (userId + claims métier) depuis le JWT.
 *
 * Chemin nominal — `getClaims()` : vérifie la signature du token LOCALEMENT
 * (ES256/WebCrypto), avec le JWKS mis en cache au niveau du process (GLOBAL_JWKS,
 * partagé entre requêtes). => zéro aller-retour réseau à GoTrue par requête, là où
 * `getUser()` en faisait un à CHAQUE appel d'API. Le claim `sub` EST l'id
 * utilisateur ; `user_role` / `organisation_id` sont posés par le hook JWT.
 * Sécurité équivalente pour de l'auth de route (tokens courte durée), recommandé
 * par Supabase.
 *
 * Repli — `getUser()` : conservé comme filet si getClaims échoue (JWKS
 * momentanément injoignable, WebCrypto absent) et comme chemin des environnements
 * sans getClaims (mocks de test). Retourne null si aucune session valide.
 *
 * Exporté (R-perf) pour la garde des Server Components qui veulent l'auth LOCALE
 * (0 aller-retour) plutôt que le `getUser()` de `requirePageSession` — cf. la page
 * dashboard traiteur (SSR). Le `layout.tsx` du sous-arbre a déjà validé la session
 * via `getUser()` ; la page se contente donc des claims locaux.
 */
export async function getVerifiedClaims(
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<VerifiedClaims | null> {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const { auth } = supabase;

  if (typeof auth.getClaims === 'function') {
    try {
      const { data } = await auth.getClaims();
      const claims = data?.claims as Record<string, unknown> | undefined;
      if (claims && typeof claims['sub'] === 'string') {
        return {
          userId: claims['sub'] as string,
          role: str(claims['user_role']),
          organisationId: str(claims['organisation_id']),
        };
      }
    } catch {
      // Repli sur la validation serveur ci-dessous.
    }
  }

  const {
    data: { user },
  } = await auth.getUser();
  if (!user) return null;
  const {
    data: { session },
  } = await auth.getSession();
  const claims = parseJwtClaims(session?.access_token ?? '');
  return {
    userId: user.id,
    role: str(claims['user_role']),
    organisationId: str(claims['organisation_id']),
  };
}

/**
 * Client Supabase serveur (schéma `plateforme`, clé anon, RLS appliquée sous
 * l'identité de l'appelant via ses cookies).
 *
 * `readonly` (défaut `false`) : mode Server Component. Un rendu de page NE PEUT PAS
 * écrire de cookies (`cookies().set` lève hors Server Action / Route Handler) — on
 * neutralise donc `setAll`. Les Route Handlers gardent l'écriture (rafraîchissement
 * de token). Un chargement de dashboard ne fait que LIRE : `readonly` est sûr.
 */
export function createSupabaseServerClient({
  readonly = false,
}: { readonly?: boolean } = {}) {
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
          if (readonly) return;
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

  const claims = await getVerifiedClaims(supabase);
  if (!claims) {
    return {
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    };
  }

  const role = claims.role;
  if (role !== 'admin_savr' && role !== 'ops_savr') {
    return {
      error: NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 }),
    };
  }

  return {
    ctx: {
      userId: claims.userId,
      role: role as StaffRole,
      organisationId: claims.organisationId ?? null,
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

  const claims = await getVerifiedClaims(supabase);
  if (!claims) {
    return {
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    };
  }

  const role = claims.role;
  const organisationId = claims.organisationId;

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
      userId: claims.userId,
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

  const claims = await getVerifiedClaims(supabase);
  if (!claims) {
    return {
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    };
  }

  const role = claims.role;
  const organisationId = claims.organisationId;

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
      userId: claims.userId,
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

  const claims = await getVerifiedClaims(supabase);
  if (!claims) {
    return {
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    };
  }

  const role = claims.role;
  const organisationId = claims.organisationId;

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
      userId: claims.userId,
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
