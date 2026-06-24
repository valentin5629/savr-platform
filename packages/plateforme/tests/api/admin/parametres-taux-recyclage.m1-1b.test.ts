/**
 * M1.1b — Tests API /admin/parametres/taux-recyclage
 * Règles : taux ∈ [0,1], commentaire ≥ 5 chars, admin-only en écriture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn(),
  // R3 : les routes taux/mix passent désormais par une RPC SECURITY DEFINER.
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
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

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  });
}

describe('M1.1b / Taux recyclage / Validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/taux-recyclage/put — 422 si taux > 1', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: 1.5,
        commentaire_modif: 'Test valide',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('0 et 1');
  });

  it('M1.1b/taux-recyclage/put — 422 si taux < 0', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: -0.1,
        commentaire_modif: 'Test valide',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/taux-recyclage/put — 422 si commentaire < 5 chars', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: 0.8,
        commentaire_modif: 'ok',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('5');
  });

  it('M1.1b/taux-recyclage/put — 200 avec valeurs valides', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValueOnce({
      data: { id: 'fil-1', taux_captation: 0.75, code_filiere: 'biodechet' },
      error: null,
    });
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: 0.75,
        commentaire_modif: 'Mise à jour ADEME 2026',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1b/taux-recyclage/put — 403 si ops_savr tente modification', async () => {
    setupAuth('ops_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/[filiere_id]/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/taux-recyclage/fil-1', {
        taux_captation: 0.8,
        commentaire_modif: 'Modif ops',
      }),
      { params: Promise.resolve({ filiere_id: 'fil-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/taux-recyclage/get — 200 liste pour ops_savr (lecture OK)', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.order.mockResolvedValueOnce({
      data: [{ id: 'fil-1', code_filiere: 'biodechet', taux_captation: 0.8 }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/parametres/taux-recyclage/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/parametres/taux-recyclage'),
    );
    expect(res.status).toBe(200);
  });
});

describe('M1.1b / Mix emballages / Validation somme 100', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/mix-emballages/put — 422 si somme ≠ 100', async () => {
    setupAuth('admin_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/mix-emballages/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/mix-emballages', {
        mix: [
          { id: 'm-1', part_pct: 30 },
          { id: 'm-2', part_pct: 50 },
          // total = 80, pas 100
        ],
        commentaire_modif: 'Maj mix test',
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('100');
  });

  it('M1.1b/mix-emballages/put — 403 si ops_savr', async () => {
    setupAuth('ops_savr');
    const { PUT } =
      await import('@/app/api/v1/admin/parametres/mix-emballages/route.js');
    const res = await PUT(
      makeReq('PUT', '/api/v1/admin/parametres/mix-emballages', {
        mix: [{ id: 'm-1', part_pct: 100 }],
      }),
    );
    expect(res.status).toBe(403);
  });
});
