/**
 * M0.4 / A1 — politique de mot de passe appliquée au reset/changement (pas seulement
 * au signup). POST /api/auth/update-password vérifie validatePasswordStrength côté
 * serveur AVANT updateUser, et exige une session (récupération ou normale).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
    },
  }),
}));
const mockAdminUpdateUserById = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    auth: { admin: { updateUserById: mockAdminUpdateUserById } },
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
  mockAdminUpdateUserById.mockResolvedValue({ data: {}, error: null });
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

describe('update-password : un lien d’invitation encore valable devient caduc', () => {
  it('compte invité qui choisit son mot de passe par « mot de passe oublié » : le nonce d’invitation est effacé', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-1', app_metadata: { invitation_nonce: 'n-1' } } },
      error: null,
    });
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
    expect(mockAdminUpdateUserById).toHaveBeenCalledWith('u-1', {
      app_metadata: { invitation_nonce: null },
    });
  });

  it('compte sans invitation en cours : aucune écriture de service', async () => {
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
    expect(mockAdminUpdateUserById).not.toHaveBeenCalled();
  });

  it('effacement en échec : le mot de passe reste changé (200)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-1', app_metadata: { invitation_nonce: 'n-1' } } },
      error: null,
    });
    mockAdminUpdateUserById.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure' },
    });
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
  });
});

// Code de vérification de l'équipe Savr (lib/code-verification.ts) : un compte
// qui a déjà un code ne change son mot de passe qu'une fois le code saisi sur
// cette session — un lien « mot de passe oublié » seul ne suffit pas.
describe('update-password : code de vérification de l’équipe Savr', () => {
  const ACTIF = { id: 'f-1', factor_type: 'totp', status: 'verified' };
  const jeton = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  function connecte(role: string, aal: string, factors = [ACTIF]) {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-1', factors } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: jeton({ user_role: role, aal }) } },
    });
  }

  it('admin avec code actif, session sans code (aal1) → 403, mot de passe inchangé', async () => {
    connecte('admin_savr', 'aal1');
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('admin avec code actif, code saisi (aal2) → 200', async () => {
    connecte('admin_savr', 'aal2');
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalled();
  });

  it('admin sans code actif (premier mot de passe) → 200, le code viendra à l’entrée dans l’application', async () => {
    connecte('admin_savr', 'aal1', []);
    const { POST } = await import('@/app/api/auth/update-password/route.js');
    const res = await POST(makeReq({ mot_de_passe: 'SavrTest2026!' }));
    expect(res.status).toBe(200);
  });
});
