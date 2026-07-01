/**
 * M0.4 — Impersonation : route callback + endpoint de sortie (BL-P1-AUTH-01).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifyOtp = vi.fn();
const mockRefreshSession = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockUpdateUserById = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      refreshSession: mockRefreshSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}
function postReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'POST' });
}

describe('M0.4 — impersonate callback (BL-P1-AUTH-01)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M0.4 — callback pose app_metadata.impersonator_id et redirige vers / ', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: 'cible-1', email: 'cible@x.fr' } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
    mockRefreshSession.mockResolvedValue({ data: {}, error: null });

    const { GET } = await import('@/app/auth/impersonate-callback/route.js');
    const res = await GET(
      getReq(
        '/auth/impersonate-callback?token_hash=abc&type=magiclink&impersonator=admin-9',
      ),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/');
    // app_metadata posé avec l'id de l'admin impersonateur + fenêtre 1h.
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      'cible-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({ impersonator_id: 'admin-9' }),
      }),
    );
    expect(mockRefreshSession).toHaveBeenCalled();
  });

  it('M0.4 — callback lien invalide (token_hash manquant) → redirect /login', async () => {
    const { GET } = await import('@/app/auth/impersonate-callback/route.js');
    const res = await GET(
      getReq('/auth/impersonate-callback?type=magiclink&impersonator=admin-9'),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('M0.4 — callback verifyOtp échoue → redirect /login, pas de pose app_metadata', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'otp invalide' },
    });
    const { GET } = await import('@/app/auth/impersonate-callback/route.js');
    const res = await GET(
      getReq(
        '/auth/impersonate-callback?token_hash=abc&type=magiclink&impersonator=admin-9',
      ),
    );
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
