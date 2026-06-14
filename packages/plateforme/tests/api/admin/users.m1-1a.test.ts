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
    data: { session: { access_token: makeJwt({ role }) } },
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

  it('M1.1a/users/changement-role — ops_savr ne peut pas modifier role', async () => {
    setupAuth('ops_savr');
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { role: 'admin_savr' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/users/changement-role — ops_savr ne peut pas modifier actif', async () => {
    setupAuth('ops_savr');
    const { PATCH } = await import('@/app/api/v1/admin/users/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/users/user-1', { actif: false }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );
    expect(res.status).toBe(403);
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
          action_link:
            'https://app.gosavr.io/auth/confirm?token=impersonate-xxx',
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
    expect(json.lien_impersonation).toContain('impersonate');
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
