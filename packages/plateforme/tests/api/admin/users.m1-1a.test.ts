/**
 * M1.1a — Tests API /admin/users
 * Scénarios : liste, invitation, changement rôle, impersonation (admin-only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockAdminCreateUser = vi.fn();
const mockAdminDeleteUser = vi.fn();
const mockAdminGenerateLink = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  catch: vi.fn().mockResolvedValue(null),
  auth: {
    admin: {
      createUser: mockAdminCreateUser,
      deleteUser: mockAdminDeleteUser,
      generateLink: mockAdminGenerateLink,
    },
  },
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
import { sendEmail } from '@savr/shared/src/email/index.js';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, userId = 'user-admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.1a / Users / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/users/liste — 200 pour staff', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });

    const { GET } = await import('@/app/api/v1/admin/users/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/users'));
    expect(res.status).toBe(200);
  });

  it('M1.1a/users/liste — 403 pour rôle traiteur', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/users/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/users'));
    expect(res.status).toBe(403);
  });
});

describe('M1.1a / Users / Invitation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/users/invitation — 201 invitation valide', async () => {
    setupAuth('admin_savr');
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'new-user-id' } },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'new-user-id',
        email: 'test@traiteur.fr',
        prenom: 'Jean',
        nom: 'Dupont',
        role: 'traiteur_manager',
      },
      error: null,
    });
    mockAdminGenerateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://app.gosavr.io/auth/confirm?token=xxx',
        },
      },
      error: null,
    });
    // Nom de l'organisation pour le template d'invitation (ONB-04).
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { nom: 'Traiteur Test' },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users', {
        email: 'test@traiteur.fr',
        prenom: 'Jean',
        nom: 'Dupont',
        role: 'traiteur_manager',
        organisation_id: 'org-1',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1a/users/promotion-admin-bloquee-ops — 403 si ops_savr tente de créer admin_savr', async () => {
    setupAuth('ops_savr');
    const { POST } = await import('@/app/api/v1/admin/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users', {
        email: 'newadmin@gosavr.io',
        prenom: 'Admin',
        nom: 'Test',
        role: 'admin_savr',
        organisation_id: 'org-savr',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/users/invitation — 422 si champs manquants', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users', { email: 'test@test.fr' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1a / Users / Changement de rôle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/users/changement-role — ops_savr ne peut pas promouvoir admin_savr', async () => {
    setupAuth('ops_savr');
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { role: 'admin_savr' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/users/suspension — ops_savr PEUT suspendre un user non-admin (actif)', async () => {
    // BL-P1-AUTH-03 : §09 autorise ops à suspendre — ex-403 était une divergence.
    setupAuth('ops_savr');
    // SELECT target (non-admin)
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'user-1', role: 'traiteur_manager' },
      error: null,
    });
    // UPDATE result
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        prenom: 'Jean',
        nom: 'D',
        email: 'j@d.fr',
        role: 'traiteur_manager',
        actif: false,
      },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { actif: false }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/users/protection-admin — ops_savr ne peut pas modifier un admin_savr', async () => {
    setupAuth('ops_savr');
    // SELECT target user : c'est un admin_savr
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'admin-user', role: 'admin_savr' },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/admin-user', { prenom: 'Hacker' }),
      { params: Promise.resolve({ id: 'admin-user' }) },
    );
    expect(res.status).toBe(403);
  });

  it("M1.1a/users/changement-role — admin_savr peut changer n'importe quel rôle", async () => {
    setupAuth('admin_savr');
    // SELECT target user (vérification protection admin)
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'user-1', role: 'ops_savr' },
      error: null,
    });
    // UPDATE result
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        prenom: 'Jean',
        nom: 'D',
        email: 'j@d.fr',
        role: 'ops_savr',
        actif: true,
      },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { role: 'ops_savr' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(200);
  });
});

describe('M0.4 — gating ops users (BL-P1-AUTH-03)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.4 — BL-P1-AUTH-03 : ops_savr réassigne un rôle NON-admin → 200', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'user-1', role: 'traiteur_commercial' },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        prenom: 'Jean',
        nom: 'D',
        email: 'j@d.fr',
        role: 'traiteur_manager',
        actif: true,
      },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', {
        role: 'traiteur_manager',
      }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M0.4 — BL-P1-AUTH-03 : ops_savr promeut en admin_savr → 403', async () => {
    setupAuth('ops_savr');
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { role: 'admin_savr' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M0.4 — BL-P1-AUTH-03 : ops_savr ne peut pas modifier un compte admin_savr → 403', async () => {
    setupAuth('ops_savr');
    // SELECT target : c'est un admin_savr → intouchable par ops (rétrogradation/suspension)
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'admin-user', role: 'admin_savr' },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/admin-user', { actif: false }),
      { params: Promise.resolve({ id: 'admin-user' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M0.4 — BL-P1-AUTH-03 : admin_savr peut toujours promouvoir en admin_savr → 200', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'user-1', role: 'ops_savr' },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'user-1',
        prenom: 'A',
        nom: 'B',
        email: 'a@b.fr',
        role: 'admin_savr',
        actif: true,
      },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { role: 'admin_savr' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(200);
  });
});

describe('M1.1a / Users / Impersonation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/users/impersonation-admin-only — 403 si ops_savr', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/users/[id]/impersoner/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users/user-1/impersoner'),
      {
        params: Promise.resolve({ id: 'user-1' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("M1.1a/users/impersonation-ok — admin_savr reçoit un lien d'impersonation", async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'user-cible',
        email: 'cible@traiteur.fr',
        prenom: 'Paul',
        nom: 'M',
        role: 'traiteur_manager',
        actif: true,
      },
      error: null,
    });
    mockAdminGenerateLink.mockResolvedValue({
      data: {
        properties: {
          // Le callback consomme le hashed_token via verifyOtp (pas l'action_link).
          hashed_token: 'imp-token-hash-xxx',
        },
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/users/[id]/impersoner/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users/user-cible/impersoner'),
      {
        params: Promise.resolve({ id: 'user-cible' }),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { lien_impersonation: string };
    // URL callback : /auth/impersonate-callback?token_hash=...&type=magiclink&impersonator=...
    expect(json.lien_impersonation).toContain('/auth/impersonate-callback');
    expect(json.lien_impersonation).toContain('token_hash=imp-token-hash-xxx');
    expect(json.lien_impersonation).toContain('type=magiclink');
  });
});

describe('M0.4 — email invitation admin (BL-P1-ONB-04)', () => {
  beforeEach(() => vi.clearAllMocks());

  it("M0.4 — l'invitation admin appelle sendEmail('invitation_utilisateur') avec les variables requises", async () => {
    setupAuth('admin_savr');
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: 'new-user-id' } },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'new-user-id',
        email: 'invite@traiteur.fr',
        prenom: 'Marie',
        nom: 'Martin',
        role: 'traiteur_commercial',
      },
      error: null,
    });
    mockAdminGenerateLink.mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://app.gosavr.io/auth/new-password?token=zzz',
        },
      },
      error: null,
    });
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { nom: 'Traiteur Martin SAS' },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/users', {
        email: 'invite@traiteur.fr',
        prenom: 'Marie',
        nom: 'Martin',
        role: 'traiteur_commercial',
        organisation_id: 'org-42',
      }),
    );

    expect(res.status).toBe(201);
    // Slug réel seedé (plus 'bienvenue_invitation' inexistant → throw avalé) + les
    // 3 variables requises du template (prenom + organisation_nom + lien_invitation).
    expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(
      'invitation_utilisateur',
      'invite@traiteur.fr',
      expect.objectContaining({
        prenom: 'Marie',
        organisation_nom: 'Traiteur Martin SAS',
        lien_invitation: 'https://app.gosavr.io/auth/new-password?token=zzz',
      }),
    );
  });
});

describe('M1.1a / Coefficients / Permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/coefficients/creation-admin-only — 403 si ops_savr tente de créer', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/coefficients-perte-labo/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/coefficients-perte-labo', {
        organisation_id: 'org-1',
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/coefficients/creation-ok — 201 si admin_savr avec données valides', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'coef-1',
        organisation_id: 'org-1',
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/coefficients-perte-labo/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/coefficients-perte-labo', {
        organisation_id: 'org-1',
        annee_reference: 2025,
        coefficient_kg_couvert: 0.15,
      }),
    );
    expect(res.status).toBe(201);
  });
});
