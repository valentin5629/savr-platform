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
import { logger } from '@savr/shared/src/logger/index.js';

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

// Lettres hexadécimales voulues : `toUpperCase()` doit produire une AUTRE
// chaîne, sinon les cas « majuscules » ne prouvent rien.
const CIBLE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

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
    // Aucune donnée personnelle recopiée dans la table non modifiable :
    // `record_id` désigne le compte.
    expect(mockInsert).toHaveBeenCalledWith({
      table_name: 'users',
      record_id: CIBLE,
      action: 'code_verification_reinitialise',
      user_id: 'admin-1',
      role: 'admin_savr',
      new_values: { facteurs_retires: 2 },
    });
  });

  it('événement de journal auth.code_verification_reinitialise', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    connecte('admin_savr');
    await reinitialiser();
    expect(warn).toHaveBeenCalledWith('auth.code_verification_reinitialise', {
      by_user: 'admin-1',
      target_user: CIBLE,
      facteurs_retires: 2,
    });
  });

  it('membre sans code ni activation en cours : 200, rien retiré, rien tracé', async () => {
    connecte('admin_savr');
    mockListFactors.mockResolvedValue({
      data: {
        factors: [{ id: 'f-tel', factor_type: 'phone', status: 'verified' }],
      },
      error: null,
    });
    const res = await reinitialiser();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facteurs_retires: 0 });
    expect(mockDeleteFactor).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
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
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    connecte('admin_savr');
    mockDeleteFactor.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'SENTINELLE' },
    });
    const res = await reinitialiser();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('SENTINELLE');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'auth.code_verification_reinitialisation_echec',
      {
        by_user: 'admin-1',
        target_user: CIBLE,
        facteurs_retires: 0,
        code: 'unexpected_failure',
      },
    );
  });

  it('échec partiel : ce qui a été retiré est tracé, 502', async () => {
    connecte('admin_savr');
    mockDeleteFactor
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'unexpected_failure', message: 'x' },
      });
    const res = await reinitialiser();
    expect(res.status).toBe(502);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        record_id: CIBLE,
        new_values: { facteurs_retires: 1 },
      }),
    );
  });

  // Postgres lit un uuid sans tenir compte de la casse ni des accolades : la
  // garde compare l'identifiant relu en base, pas le paramètre d'URL.
  it.each([
    ['majuscules', CIBLE.toUpperCase()],
    ['accolades', `{${CIBLE}}`],
  ])(
    'son propre compte écrit en %s → 422, rien retiré',
    async (_forme, idUrl) => {
      connecte('admin_savr', 'aal2', CIBLE);
      expect((await reinitialiser(idUrl)).status).toBe(422);
      expect(mockListFactors).not.toHaveBeenCalled();
      expect(mockDeleteFactor).not.toHaveBeenCalled();
    },
  );

  it('autre compte écrit en majuscules : les appels Supabase et la trace portent l’identifiant relu en base', async () => {
    connecte('admin_savr');
    await reinitialiser(CIBLE.toUpperCase());
    expect(mockListFactors).toHaveBeenCalledWith({ userId: CIBLE });
    expect(mockDeleteFactor).toHaveBeenCalledWith({
      id: 'f-totp',
      userId: CIBLE,
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ record_id: CIBLE }),
    );
  });

  it('liste des facteurs illisible → 502, journal d’erreur avec l’auteur', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    connecte('admin_savr');
    mockListFactors.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'x' },
    });
    expect((await reinitialiser()).status).toBe(502);
    expect(mockDeleteFactor).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'auth.code_verification_reinitialisation_echec',
      {
        by_user: 'admin-1',
        target_user: CIBLE,
        facteurs_retires: 0,
        code: 'unexpected_failure',
      },
    );
  });

  it('écriture audit_log en échec → 200, journal d’erreur', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    connecte('admin_savr');
    mockInsert.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect((await reinitialiser()).status).toBe(200);
    expect(error).toHaveBeenCalledWith(
      'auth.code_verification_reinitialise.audit_echec',
      { by_user: 'admin-1', target_user: CIBLE, code: '42501' },
    );
  });
});
