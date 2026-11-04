/**
 * DELETE /api/v1/admin/users/[id]/code-verification — réinitialisation du code
 * de vérification d'un membre de l'équipe Savr (téléphone perdu ou changé).
 *
 * Épinglé : admin_savr seul et avec code passé, jamais sur son propre compte,
 * seulement un compte de l'équipe Savr, facteurs TOTP retirés, trace audit_log
 * (auteur = l'administrateur, ligne = le compte réinitialisé).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

const mockSingle = vi.fn();
const mockInsert = vi.fn();
const mockListFactors = vi.fn();
const mockDeleteFactor = vi.fn();
const fromAppele: string[] = [];
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      fromAppele.push(table);
      return {
        select: () => ({ eq: () => ({ single: mockSingle }) }),
        insert: mockInsert,
      };
    },
    auth: {
      admin: {
        mfa: { listFactors: mockListFactors, deleteFactor: mockDeleteFactor },
      },
    },
  }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

function connecte(role: string, aal = 'aal2', userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, aal, organisation_id: null }),
      },
    },
  });
}

const CIBLE = '11111111-1111-4111-8111-111111111111';

async function reinitialiser(id = CIBLE) {
  const { DELETE } =
    await import('@/app/api/v1/admin/users/[id]/code-verification/route.js');
  return DELETE(
    new NextRequest(
      `http://localhost/api/v1/admin/users/${id}/code-verification`,
      { method: 'DELETE' },
    ),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fromAppele.length = 0;
  mockSingle.mockResolvedValue({
    data: { id: CIBLE, email: 'ops@gosavr.io', role: 'ops_savr' },
    error: null,
  });
  mockListFactors.mockResolvedValue({
    data: {
      factors: [
        { id: 'f-totp', factor_type: 'totp', status: 'verified' },
        { id: 'f-attente', factor_type: 'totp', status: 'unverified' },
        { id: 'f-tel', factor_type: 'phone', status: 'verified' },
      ],
    },
    error: null,
  });
  mockDeleteFactor.mockResolvedValue({ data: {}, error: null });
  mockInsert.mockResolvedValue({ data: null, error: null });
});

describe('réinitialisation du code de vérification', () => {
  it('admin avec code : facteurs TOTP retirés, trace audit_log', async () => {
    connecte('admin_savr');
    const res = await reinitialiser();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facteurs_retires: 2 });
    expect(mockDeleteFactor).toHaveBeenCalledWith({
      id: 'f-totp',
      userId: CIBLE,
    });
    expect(mockDeleteFactor).toHaveBeenCalledWith({
      id: 'f-attente',
      userId: CIBLE,
    });
    expect(mockDeleteFactor).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f-tel' }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        table_name: 'users',
        record_id: CIBLE,
        action: 'code_verification_reinitialise',
        user_id: 'admin-1',
        role: 'admin_savr',
      }),
    );
  });

  it('admin SANS code sur cette session → 401, rien retiré', async () => {
    connecte('admin_savr', 'aal1');
    expect((await reinitialiser()).status).toBe(401);
    expect(mockListFactors).not.toHaveBeenCalled();
  });

  it('ops_savr → 403 (réservé admin_savr)', async () => {
    connecte('ops_savr');
    expect((await reinitialiser()).status).toBe(403);
    expect(mockListFactors).not.toHaveBeenCalled();
  });

  it('son propre compte → 422 : la procédure passe par un autre administrateur', async () => {
    connecte('admin_savr', 'aal2', CIBLE);
    expect((await reinitialiser()).status).toBe(422);
    expect(mockListFactors).not.toHaveBeenCalled();
  });

  it('compte client → 422, rien retiré (aucun code pour les clients)', async () => {
    connecte('admin_savr');
    mockSingle.mockResolvedValue({
      data: { id: CIBLE, email: 'chef@traiteur.fr', role: 'traiteur_manager' },
      error: null,
    });
    expect((await reinitialiser()).status).toBe(422);
    expect(mockListFactors).not.toHaveBeenCalled();
  });

  it('compte inconnu → 404', async () => {
    connecte('admin_savr');
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    expect((await reinitialiser()).status).toBe(404);
  });

  it('échec Supabase au retrait → 502, aucune trace de réussite', async () => {
    connecte('admin_savr');
    mockDeleteFactor.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'SENTINELLE' },
    });
    const res = await reinitialiser();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('SENTINELLE');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
