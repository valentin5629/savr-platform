/**
 * Changement de l'association d'une collecte AG déjà attribuée (décisions Val
 * 2026-11-13) — route POST /api/v1/admin/attributions-ag/[collecteId]/association.
 * Motif obligatoire (≥ 5 car., admin Savr seul) si l'association choisie n'est
 * pas le n°1 de l'algo ; refus métier de la fonction SQL rendus lisibles ;
 * l'ordre en file part sans attendre (envoi immédiat).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRpc = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ rpc: mockRpc }),
}));

const mockAlgo = vi.fn();
vi.mock('@/lib/attribution-ag/algo.js', () => ({
  calculerAlgoAttributionAg: (...a: unknown[]) => mockAlgo(...a),
}));

const mockEnvoi = vi.fn();
vi.mock('@/lib/envoi-immediat.js', () => ({
  envoyerOrdresSansAttendre: (...a: unknown[]) => mockEnvoi(...a),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify({ aal: 'aal2', ...claims })).toString('base64url')}.s`;
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
function setupAuth(
  role: string,
  userId = 'b1111111-0000-0000-0000-000000000001',
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: { access_token: makeJwt({ user_role: role, sub: userId }) },
    },
    error: null,
  });
}

const COLLECTE = 'c0000000-0000-0000-0000-000000000001';
const TOP1 = 'a0000000-0000-0000-0000-000000000001';
const AUTRE = 'a0000000-0000-0000-0000-000000000002';

async function post(body: unknown, collecteId = COLLECTE) {
  const { POST } =
    await import('@/app/api/v1/admin/attributions-ag/[collecteId]/association/route.js');
  const req = new NextRequest(
    `http://localhost/api/v1/admin/attributions-ag/${collecteId}/association`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
  return POST(req, { params: Promise.resolve({ collecteId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAlgo.mockResolvedValue({ associations: [{ id: TOP1 }] });
  mockRpc.mockResolvedValue({ data: 'collecte.creee', error: null });
});

describe('Changement d’association AG — route Admin', () => {
  it('n°1 de l’algo : sans motif, la fonction SQL est appelée et l’envoi part sans attendre', async () => {
    setupAuth('ops_savr');
    const res = await post({ association_id: TOP1 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      event_type: 'collecte.creee',
    });
    expect(mockRpc).toHaveBeenCalledWith('fn_changer_association_ag', {
      p_collecte_id: COLLECTE,
      p_association_id: TOP1,
      p_modifie_par: 'b1111111-0000-0000-0000-000000000001',
      p_motif_override: undefined,
      p_motif_override_libre: undefined,
    });
    expect(mockEnvoi).toHaveBeenCalledWith(COLLECTE);
  });

  it('autre que le n°1, sans motif : 422, rien n’est écrit', async () => {
    setupAuth('admin_savr');
    const res = await post({ association_id: AUTRE, motif_override: 'abc' });

    expect(res.status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEnvoi).not.toHaveBeenCalled();
  });

  it('autre que le n°1, avec motif : motif rangé sous le code « autre »', async () => {
    setupAuth('admin_savr');
    const res = await post({
      association_id: AUTRE,
      motif_override: '  Association plus proche  ',
    });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_changer_association_ag',
      expect.objectContaining({
        p_association_id: AUTRE,
        p_motif_override: 'autre',
        p_motif_override_libre: 'Association plus proche',
      }),
    );
  });

  it('autre que le n°1 par ops_savr : 403 (réservé aux admin Savr)', async () => {
    setupAuth('ops_savr');
    const res = await post({
      association_id: AUTRE,
      motif_override: 'Association plus proche',
    });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('algo indisponible : pas de référence, pas de motif exigé', async () => {
    setupAuth('ops_savr');
    mockAlgo.mockRejectedValue(new Error('algo down'));
    const res = await post({ association_id: AUTRE });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it.each([
    ['P0043', 409],
    ['P0046', 422],
    ['P0047', 422],
    ['P0045', 422],
  ])('refus SQL %s → %i, sans envoi', async (code, status) => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValue({ data: null, error: { code, message: 'x' } });
    const res = await post({ association_id: TOP1 });

    expect(res.status).toBe(status);
    expect(mockEnvoi).not.toHaveBeenCalled();
  });

  it('association absente ou mal formée : 422', async () => {
    setupAuth('admin_savr');
    expect((await post({})).status).toBe(422);
    expect((await post({ association_id: 'pas-un-uuid' })).status).toBe(422);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('client : refusé', async () => {
    setupAuth('traiteur_manager');
    const res = await post({ association_id: TOP1 });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
