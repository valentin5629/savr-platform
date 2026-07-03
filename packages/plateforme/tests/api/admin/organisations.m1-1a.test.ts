/**
 * M1.1a — Tests API /admin/organisations
 * Scénarios : liste, création, fiche, modification, désactivation, restriction ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

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
  rpc: vi.fn(),
  catch: vi.fn().mockResolvedValue(null),
  is: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// Helper pour générer un JWT factice avec claims
function makeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.sig`;
}

// Mock cookies + createServerClient pour api-auth
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

// ── Helpers ────────────────────────────────────────────────────────────────

function setupAuth(role: string) {
  const token = makeJwt({ user_role: role, organisation_id: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
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

describe('M1.1a / Organisations / Authentification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(401);
  });

  it('M1.1a/orgas/liste — 403 si rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(403);
  });
});

describe('M1.1a / Organisations / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 200 avec data + total pour admin_savr', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'org-1',
          raison_sociale: 'Traiteur Test',
          type: 'traiteur',
          siret: '12345678901234',
          actif: true,
          logo_url: null,
          users: [{ count: 3 }],
        },
      ],
      error: null,
      count: 1,
    });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({
        data: [{ organisation_id: 'org-1', nb: 12 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ organisation_id: 'org-1', nb: 5 }],
        error: null,
      });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[]; total: number };
    expect(json.total).toBe(1);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('M1.1a/orgas/liste — le select N’embarque PAS `evenements` (FK ambiguë → 300)', async () => {
    // Garde anti-régression : `evenements` a 2 FK vers `organisations`
    // (organisation_id + client_organisateur_organisation_id) → un embed non
    // désambiguïsé renvoie HTTP 300 PGRST201 et vide toute la liste Clients.
    // Les compteurs ZD/AG viennent de la RPC count_collectes_par_org, pas d'un
    // embed. Vérifié réel contre savr-dev (206 + 14 organisations).
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    await GET(makeReq('GET', '/api/v1/admin/organisations'));

    const selectArg = mockSupabaseChain.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/evenements/);
    expect(selectArg).toContain('users:users(count)');
  });
});

describe('M1.1a / Organisations / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/creation — 201 avec données valides', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-new',
        raison_sociale: 'Nouvelle Orga',
        type: 'traiteur',
        actif: true,
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        raison_sociale: 'Nouvelle Orga',
        type: 'traiteur',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1a/orgas/creation — 422 si type invalide', async () => {
    setupAuth('ops_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        raison_sociale: 'Test',
        type: 'type_inconnu',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1a/orgas/creation — 422 si raison_sociale manquante', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', { type: 'traiteur' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1a / Organisations / Modification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/tarif-refacture-admin-only — 403 si ops_savr tente de modifier tarif_refacture_pax_zd', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/orgas/modification — 200 si admin_savr modifie tarif_refacture_pax_zd', async () => {
    setupAuth('admin_savr');
    // R15 (§07/06 tarif_refacture_pax_zd_update) : pré-fetch de l'ancien tarif
    // AVANT l'UPDATE pour figer l'avant/après dans audit_log.
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { tarif_refacture_pax_zd: 1.5 },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Orga',
        type: 'traiteur',
        actif: true,
        tarif_refacture_pax_zd: 2.5,
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/orgas/desactivation — 200 pour admin et ops', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', actif: false },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/organisations/[id]/desactiver/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations/org-1/desactiver'),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { actif: boolean };
    expect(json.actif).toBe(false);
  });
});
