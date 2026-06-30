/**
 * M0.4 / A1 — politique de mot de passe appliquée au reset/changement (pas seulement
 * au signup). POST /api/auth/update-password vérifie validatePasswordStrength côté
 * serveur AVANT updateUser, et exige une session (récupération ou normale).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, updateUser: mockUpdateUser },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/update-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
  mockUpdateUser.mockResolvedValue({ data: {}, error: null });
});

describe('M0.4 — update-password : politique mot de passe au reset (A1)', () => {
  it('mot de passe faible → 422 AVANT toute mise à jour', async () => {
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'abc' }));
    expect(res.status).toBe(422);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('mot de passe manquant → 422', async () => {
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(422);
  });

  it('sans session de récupération → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('session + mot de passe conforme → 200 + updateUser appelé', async () => {
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'SavrTest2026!',
    });
  });
});
