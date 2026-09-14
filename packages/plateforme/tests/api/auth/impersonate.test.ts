/**
 * M0.4 — Impersonation : route callback + endpoint de sortie (BL-P1-AUTH-01).
 *
 * Le callback ne pose `impersonator_id` que si l'impersonation a été enregistrée
 * côté serveur par POST /admin/users/[id]/impersoner (jeton + admin + cible,
 * délai court, usage unique) — revue sécurité #281 : un OTP magiclink obtenu pour
 * son propre compte ne doit pas permettre de s'attribuer un admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  CLE_IMPERSONATION_EN_ATTENTE,
  IMPERSONATION_LIEN_TTL_MS,
  preparerImpersonation,
} from '@/lib/impersonation.js';

const mockVerifyOtp = vi.fn();
const mockRefreshSession = vi.fn();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockSignOut = vi.fn();
const mockUpdateUserById = vi.fn();
const mockGenerateLink = vi.fn();
const mockSingle = vi.fn();

const adminChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  single: mockSingle,
  auth: {
    admin: {
      updateUserById: mockUpdateUserById,
      generateLink: mockGenerateLink,
    },
  },
};

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      refreshSession: mockRefreshSession,
      getUser: mockGetUser,
      getSession: mockGetSession,
      signOut: mockSignOut,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => adminChain,
}));

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}
function postReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'POST' });
}
function jwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const ADMIN = 'admin-9';
const CIBLE = 'cible-1';

function lien(params: Record<string, string>): string {
  return `/auth/impersonate-callback?${new URLSearchParams({
    token_hash: 'abc',
    type: 'magiclink',
    ...params,
  }).toString()}`;
}

/** verifyOtp établit la session de CIBLE, dont l'app_metadata est `appMetadata`. */
function sessionCible(appMetadata: Record<string, unknown>): void {
  mockVerifyOtp.mockResolvedValue({
    data: {
      user: { id: CIBLE, email: 'cible@x.fr', app_metadata: appMetadata },
    },
    error: null,
  });
}

/** Aucun app_metadata d'impersonation n'a été posé. */
function aucunImpersonatorPose(): void {
  for (const [, attrs] of mockUpdateUserById.mock.calls) {
    const meta = (attrs as { app_metadata: Record<string, unknown> })
      .app_metadata;
    expect(meta.impersonator_id ?? null).toBeNull();
    expect(meta.impersonation_expires_at ?? null).toBeNull();
  }
}

async function callback(url: string) {
  const { GET } = await import('@/app/auth/impersonate-callback/route.js');
  return GET(getReq(url));
}

describe('M0.4 — impersonate callback (BL-P1-AUTH-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
    mockRefreshSession.mockResolvedValue({ data: {}, error: null });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("M0.4 — nominal : pose impersonator_id, consomme l'entrée, redirige vers /", async () => {
    const { jeton, enAttente } = preparerImpersonation(ADMIN, CIBLE);
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });

    const res = await callback(lien({ impersonator: ADMIN, jeton }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/');
    expect(mockUpdateUserById).toHaveBeenCalledTimes(1);
    expect(mockUpdateUserById).toHaveBeenCalledWith(CIBLE, {
      app_metadata: {
        impersonator_id: ADMIN,
        impersonation_expires_at: expect.any(String),
        [CLE_IMPERSONATION_EN_ATTENTE]: null,
      },
    });
    expect(mockRefreshSession).toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('M0.4 — poignée de main réelle : le lien émis par /impersoner est accepté par le callback', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: ADMIN } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: jwt({ user_role: 'admin_savr' }) } },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: {
        id: CIBLE,
        email: 'cible@x.fr',
        prenom: 'P',
        nom: 'M',
        role: 'traiteur_manager',
        organisation_id: 'org-1',
        actif: true,
      },
      error: null,
    });
    mockGenerateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'imp-hash' } },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/users/[id]/impersoner/route.js');
    const resLien = await POST(
      postReq(`/api/v1/admin/users/${CIBLE}/impersoner`),
      { params: Promise.resolve({ id: CIBLE }) },
    );
    expect(resLien.status).toBe(200);

    // L'entrée en attente est posée sur la cible AVANT la génération de l'OTP.
    expect(mockUpdateUserById).toHaveBeenCalledTimes(1);
    const [cibleId, attrs] = mockUpdateUserById.mock.calls[0]!;
    expect(cibleId).toBe(CIBLE);
    const enAttente = (attrs as { app_metadata: Record<string, unknown> })
      .app_metadata[CLE_IMPERSONATION_EN_ATTENTE];
    expect(enAttente).toEqual({
      empreinte: expect.stringMatching(/^[0-9a-f]{64}$/),
      expire_le: expect.any(String),
    });
    expect(mockUpdateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      mockGenerateLink.mock.invocationCallOrder[0]!,
    );
    // Ni l'id admin ni le jeton ne sont stockés en clair (app_metadata ⊂ JWT).
    expect(JSON.stringify(enAttente)).not.toContain(ADMIN);

    const { lien_impersonation } = (await resLien.json()) as {
      lien_impersonation: string;
    };
    const url = new URL(lien_impersonation, 'http://localhost');
    expect(url.pathname).toBe('/auth/impersonate-callback');
    expect(JSON.stringify(enAttente)).not.toContain(
      url.searchParams.get('jeton'),
    );

    mockUpdateUserById.mockClear();
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });
    const res = await callback(`${url.pathname}${url.search}`);
    expect(res.headers.get('location')).toBe('http://localhost/');
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      CIBLE,
      expect.objectContaining({
        app_metadata: expect.objectContaining({ impersonator_id: ADMIN }),
      }),
    );
  });

  it('M0.4 — impersonator forgé (OTP de son propre compte, aucune entrée) → refus, aucun app_metadata', async () => {
    sessionCible({});

    const res = await callback(
      lien({ impersonator: ADMIN, jeton: 'jeton-invente' }),
    );

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockRefreshSession).not.toHaveBeenCalled();
    // Seule la session ouverte par verifyOtp est révoquée.
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("M0.4 — entrée en attente d'un vrai admin mais jeton inconnu → refus, entrée intacte", async () => {
    const { enAttente } = preparerImpersonation(ADMIN, CIBLE);
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });

    const res = await callback(
      lien({ impersonator: ADMIN, jeton: 'jeton-devine' }),
    );

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('M0.4 — jeton valide mais impersonator substitué (autre admin) → refus', async () => {
    const { jeton, enAttente } = preparerImpersonation(ADMIN, CIBLE);
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });

    const res = await callback(lien({ impersonator: 'admin-autre', jeton }));

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('M0.4 — jeton émis pour un autre user → refus', async () => {
    const { jeton, enAttente } = preparerImpersonation(ADMIN, 'autre-user');
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });

    const res = await callback(lien({ impersonator: ADMIN, jeton }));

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('M0.4 — lien rejoué (entrée déjà consommée) → refus, aucun app_metadata', async () => {
    const { jeton } = preparerImpersonation(ADMIN, CIBLE);
    // Après la 1re utilisation, l'entrée vaut null (GoTrue retire la clé).
    sessionCible({ impersonator_id: ADMIN });

    const res = await callback(lien({ impersonator: ADMIN, jeton }));

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it('M0.4 — lien expiré → refus, entrée purgée, aucun impersonator_id', async () => {
    const { jeton, enAttente } = preparerImpersonation(
      ADMIN,
      CIBLE,
      Date.now() - IMPERSONATION_LIEN_TTL_MS - 1000,
    );
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });

    const res = await callback(lien({ impersonator: ADMIN, jeton }));

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).toHaveBeenCalledWith(CIBLE, {
      app_metadata: { [CLE_IMPERSONATION_EN_ATTENTE]: null },
    });
    aucunImpersonatorPose();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("M0.4 — refresh en échec → flag retiré (le user réel n'hérite pas du claim)", async () => {
    const { jeton, enAttente } = preparerImpersonation(ADMIN, CIBLE);
    sessionCible({ [CLE_IMPERSONATION_EN_ATTENTE]: enAttente });
    mockRefreshSession.mockResolvedValue({
      data: {},
      error: { message: 'refresh ko' },
    });

    const res = await callback(lien({ impersonator: ADMIN, jeton }));

    expect(res.headers.get('location')).toContain(
      '/login?error=impersonation_echouee',
    );
    expect(mockUpdateUserById).toHaveBeenLastCalledWith(CIBLE, {
      app_metadata: { impersonator_id: null, impersonation_expires_at: null },
    });
  });

  it('M0.4 — lien invalide (token_hash ou jeton manquant) → /login, pas de verifyOtp', async () => {
    for (const url of [
      '/auth/impersonate-callback?type=magiclink&impersonator=admin-9&jeton=j',
      '/auth/impersonate-callback?token_hash=abc&type=magiclink&impersonator=admin-9',
    ]) {
      const res = await callback(url);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain(
        '/login?error=impersonation_lien_invalide',
      );
    }
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('M0.4 — verifyOtp échoue → /login, pas de pose app_metadata', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'otp invalide' },
    });
    const res = await callback(lien({ impersonator: ADMIN, jeton: 'j' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });
});

describe('M0.4 — exit impersonation (BL-P1-AUTH-01)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.4 — exit purge le flag impersonation et clôt la session → 200', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'cible-1' } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
    mockSignOut.mockResolvedValue({ error: null });

    const { POST } = await import('@/app/api/auth/exit-impersonation/route.js');
    const res = await POST(postReq('/api/auth/exit-impersonation'));
    expect(res.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'cible-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({ impersonator_id: null }),
      }),
    );
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('M0.4 — exit sans session → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/auth/exit-impersonation/route.js');
    const res = await POST(postReq('/api/auth/exit-impersonation'));
    expect(res.status).toBe(401);
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
