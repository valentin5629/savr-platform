/**
 * M0.6 — API /admin/templates-email (BL-P2-07, lecture seule)
 * GET liste les templates actifs pour le viewer read-only (édition = V1.1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockChain,
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

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

describe('M0.6 — Templates emails API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.6/templates/get — 200 liste les templates actifs (ops_savr peut lire)', async () => {
    setupAuth('ops_savr');
    mockChain.order.mockResolvedValueOnce({
      data: [
        {
          id: 't-1',
          code: 'confirmation_collecte',
          sujet: 'Confirmée',
          description: null,
          variables: ['prenom'],
          corps_html: '<p>x</p>',
          actif: true,
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/templates-email/route.js');
    const res = await GET(makeReq('/api/v1/admin/templates-email'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { code: string }[] };
    expect(body.data[0]!.code).toBe('confirmation_collecte');
    // filtre actif=true appliqué
    expect(mockChain.eq).toHaveBeenCalledWith('actif', true);
  });

  it('M0.6/templates/get — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/admin/templates-email/route.js');
    const res = await GET(makeReq('/api/v1/admin/templates-email'));
    expect(res.status).toBe(401);
  });
});
