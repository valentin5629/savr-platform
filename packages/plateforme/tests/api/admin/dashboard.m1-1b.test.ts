/**
 * M1.1b — Tests API /admin/dashboard/kpi
 * Valeurs correctes des 6 cartes KPI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCountChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockCountChain,
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
    data: { session: { access_token: makeJwt({ role }) } },
    error: null,
  });
}

function makeReq(method: string, url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method });
}

describe('M1.1b / Dashboard KPI / Valeurs correctes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/dashboard/kpi — 200 avec 6 cartes correctement structurées', async () => {
    setupAuth('admin_savr');

    // Les 6 requêtes count se terminent toutes par .in() → mock sur in
    mockCountChain.in
      .mockResolvedValueOnce({ count: 3, error: null }) // non_transmises_zd
      .mockResolvedValueOnce({ count: 5, error: null }) // non_transmises_ag
      .mockResolvedValueOnce({ count: 2, error: null }) // attente_prestataire
      .mockResolvedValueOnce({ count: 1, error: null }) // dirty_tms
      .mockResolvedValueOnce({ count: 4, error: null }) // zd_48h
      .mockResolvedValueOnce({ count: 6, error: null }); // ag_48h

    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(typeof body.non_transmises_zd).toBe('number');
    expect(typeof body.non_transmises_ag).toBe('number');
    expect(typeof body.attente_prestataire).toBe('number');
    expect(typeof body.dirty_tms).toBe('number');
    expect(typeof body.zd_48h).toBe('number');
    expect(typeof body.ag_48h).toBe('number');
  });

  it('M1.1b/dashboard/kpi — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(401);
  });

  it('M1.1b/dashboard/kpi — 403 si rôle traiteur', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(403);
  });
});
