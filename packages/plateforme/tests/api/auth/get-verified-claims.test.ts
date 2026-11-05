/**
 * api-auth — chemin nominal `getClaims()` (vérification LOCALE du JWT).
 *
 * Le reste de la suite mocke `auth.getUser`/`getSession` sans `getClaims` → tout
 * emprunte le REPLI (ancien code). Ce fichier fournit un mock avec `getClaims` pour
 * exercer explicitement le CHEMIN NOMINAL (celui qui tourne en prod) : succès,
 * 403 rôle, 403 organisation manquante, ET la preuve que `getUser()` (aller-retour
 * réseau) n'est PAS appelé quand getClaims réussit. Plus deux cas de repli.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetClaims = vi.fn();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: mockGetClaims,
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function req(): NextRequest {
  return new NextRequest('http://localhost/api/x', { method: 'GET' });
}
function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
}

beforeEach(() => vi.clearAllMocks());

describe('api-auth — chemin nominal getClaims (vérif locale, sans getUser réseau)', () => {
  it('requireUser : getClaims valide → ctx, et getUser (réseau) JAMAIS appelé', async () => {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'u-1',
          user_role: 'traiteur_manager',
          organisation_id: 'org-1',
        },
      },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.error).toBeUndefined();
    expect(res.ctx).toEqual({
      userId: 'u-1',
      role: 'traiteur_manager',
      organisationId: 'org-1',
    });
    // Preuve que le chemin nominal (getClaims local) est pris, pas le repli réseau.
    expect(mockGetClaims).toHaveBeenCalledTimes(1);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('requireUser : claim impersonator_id porté par getClaims → ctx.impersonatorId (journalisé dans audit_log)', async () => {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'u-1',
          user_role: 'traiteur_manager',
          organisation_id: 'org-1',
          impersonator_id: 'admin-1',
        },
      },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    // Assertion explicite : `toEqual` ignore une propriété `undefined`, il ne
    // verrait pas la perte du claim sur ce chemin (celui de la prod).
    expect(res.ctx?.impersonatorId).toBe('admin-1');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('requireStaff : getClaims valide staff → ctx (organisationId null)', async () => {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'a-1',
          user_role: 'admin_savr',
          organisation_id: null,
          aal: 'aal2',
        },
      },
      error: null,
    });
    const { requireStaff } = await import('@/lib/api-auth.js');
    const res = await requireStaff(req());
    expect(res.ctx).toEqual({
      userId: 'a-1',
      role: 'admin_savr',
      organisationId: null,
    });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('requireUser : rôle non autorisé → 403 (via getClaims, sans repli)', async () => {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'u-1',
          user_role: 'client_organisateur',
          organisation_id: 'org-1',
        },
      },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.ctx).toBeUndefined();
    expect(res.error?.status).toBe(403);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('requireUser : organisation_id absent → 403 (via getClaims)', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'u-1', user_role: 'traiteur_manager' } },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.error?.status).toBe(403);
  });

  it('repli : getClaims lève → getUser (validation serveur) prend le relais', async () => {
    mockGetClaims.mockRejectedValue(new Error('JWKS injoignable'));
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-2' } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeJwt({
            user_role: 'traiteur_manager',
            organisation_id: 'org-9',
          }),
        },
      },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.ctx).toEqual({
      userId: 'u-2',
      role: 'traiteur_manager',
      organisationId: 'org-9',
    });
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it('repli : getClaims sans claims + aucune session → 401', async () => {
    mockGetClaims.mockResolvedValue({
      data: null,
      error: { message: 'no session' },
    });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.error?.status).toBe(401);
  });
});

// ─── Code de vérification de l'équipe Savr (lib/code-verification.ts) ────────
// Tenu dans getVerifiedClaims : toutes les gardes d'API refusent une session de
// l'équipe Savr qui ne l'a pas passé, sur les deux chemins, sans repli.
describe('api-auth — code de vérification de l’équipe Savr', () => {
  // Code demandé en production seulement (lib/code-verification.ts).
  beforeEach(() => vi.stubEnv('VERCEL_ENV', 'production'));
  afterEach(() => vi.unstubAllEnvs());

  it('hors production : admin_savr en aal1 → accepté', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'a-1', user_role: 'admin_savr', aal: 'aal1' } },
      error: null,
    });
    const { requireAdmin } = await import('@/lib/api-auth.js');
    const res = await requireAdmin(req());
    expect(res.error).toBeUndefined();
    expect(res.ctx?.userId).toBe('a-1');
  });

  type Garde = (r: NextRequest) => Promise<{ error?: { status: number } }>;
  async function gardes(): Promise<Array<[string, Garde]>> {
    const m = await import('@/lib/api-auth.js');
    const { requireRegistreUser } = await import('@/lib/registre/guard.js');
    return [
      ['requireStaff', m.requireStaff],
      ['requireAdmin', m.requireAdmin],
      ['requireAnyUser', m.requireAnyUser],
      ['requireProgrammateurOuAdmin', m.requireProgrammateurOuAdmin],
      ['requireRegistreUser', requireRegistreUser],
    ];
  }

  it.each([['aal1'], [undefined]])(
    'getClaims : admin_savr avec aal=%s → 401 sur toutes les gardes, sans repli réseau',
    async (aal) => {
      mockGetClaims.mockResolvedValue({
        data: {
          claims: {
            sub: 'a-1',
            user_role: 'admin_savr',
            organisation_id: 'org-savr',
            aal,
          },
        },
        error: null,
      });
      for (const [nom, garde] of await gardes()) {
        const res = await garde(req());
        expect(res.error?.status, nom).toBe(401);
      }
      expect(mockGetUser).not.toHaveBeenCalled();
    },
  );

  it('getClaims : ops_savr en aal1 → 401', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'o-1', user_role: 'ops_savr', aal: 'aal1' } },
      error: null,
    });
    const { requireStaff } = await import('@/lib/api-auth.js');
    expect((await requireStaff(req())).error?.status).toBe(401);
  });

  it('repli getUser : admin_savr en aal1 → 401 aussi', async () => {
    mockGetClaims.mockRejectedValue(new Error('JWKS injoignable'));
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'a-1' } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeJwt({ user_role: 'admin_savr', aal: 'aal1' }),
        },
      },
      error: null,
    });
    const { requireAdmin } = await import('@/lib/api-auth.js');
    expect((await requireAdmin(req())).error?.status).toBe(401);
  });

  it('client en aal1 → accepté (aucun code pour les clients)', async () => {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: 'u-1',
          user_role: 'traiteur_manager',
          organisation_id: 'org-1',
          aal: 'aal1',
        },
      },
      error: null,
    });
    const { requireUser } = await import('@/lib/api-auth.js');
    const res = await requireUser(req(), ['traiteur_manager']);
    expect(res.error).toBeUndefined();
    expect(res.ctx?.userId).toBe('u-1');
  });
});
