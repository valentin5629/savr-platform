/**
 * Tests API POST /api/auth/accept-invitation — acceptation d'une invitation self-service.
 * Le rôle et l'organisation viennent des metadata du compte « invited » (posées côté
 * serveur), jamais du body → rattachement garanti + pas d'escalade. CGU obligatoires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifyOtp = vi.fn();
const mockUpdateUserById = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();

const adminChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a),
  insert: (...a: unknown[]) => mockInsert(...a),
  auth: { admin: { updateUserById: mockUpdateUserById } },
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => adminChain,
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

import { _resetSignupRateLimit } from '@/lib/signup-rate-limit.js';

const STRONG_PWD = 'SavrTest2026!';

function makeReq(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/accept-invitation', {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

function invitedUser(metadata: Record<string, unknown>) {
  return {
    data: {
      user: {
        id: 'invited-user-1',
        email: 'jeanne@exemple-perso.fr',
        user_metadata: metadata,
      },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSignupRateLimit();
  mockUpdateUserById.mockResolvedValue({ data: null, error: null });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe('accept-invitation', () => {
  it('happy — 201, insert profil avec org+role des metadata + CGU', async () => {
    mockVerifyOtp.mockResolvedValue(
      invitedUser({
        organisation_id: 'org-kaspia',
        role: 'traiteur_commercial',
      }),
    );
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: 'hh',
      type: 'invite',
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith('invited-user-1', {
      password: STRONG_PWD,
    });
    const insertArgs = mockInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertArgs).toMatchObject({
      id: 'invited-user-1',
      organisation_id: 'org-kaspia',
      role: 'traiteur_commercial',
      prenom: 'Jeanne',
      nom: 'Martin',
      cgu_version: 'v1',
    });
    expect(insertArgs.cgu_accepte_le).toBeTruthy();
  });

  it('token invalide/expiré — 422, pas de création', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'token expired' },
    });
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'bad',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(422);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('metadata org/role manquantes — 422', async () => {
    mockVerifyOtp.mockResolvedValue(invitedUser({}));
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(422);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('déjà acceptée (profil existant) — 409', async () => {
    mockVerifyOtp.mockResolvedValue(
      invitedUser({
        organisation_id: 'org-kaspia',
        role: 'traiteur_commercial',
      }),
    );
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'invited-user-1' },
      error: null,
    });
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('CGU non acceptées — 422 (avant toute création)', async () => {
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: false,
      }),
    );
    expect(res.status).toBe(422);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('mot de passe faible — 422', async () => {
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        prenom: 'Jeanne',
        nom: 'Martin',
        mot_de_passe: 'faible',
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(422);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('champs manquants (prenom/nom) — 422', async () => {
    const { POST } = await import('@/app/api/auth/accept-invitation/route.js');
    const res = await POST(
      makeReq({
        token_hash: 'hh',
        mot_de_passe: STRONG_PWD,
        acceptation_cgu: true,
      }),
    );
    expect(res.status).toBe(422);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });
});
