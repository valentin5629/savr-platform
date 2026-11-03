/**
 * Saisie directe du nombre de repas réalisés AG par l'équipe Savr (§06.09 §5,
 * scénario correction_volume_repas_realise_regenere_attestation).
 * PATCH /admin/attributions-ag/[collecteId]/repas : collecte AG réalisée ou
 * clôturée seulement ; motif ≥ 10 car. sur correction d'une valeur posée.
 * La régénération d'attestation et du CO₂e est assurée par trg_regenerer_attestation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
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

function setupAuth(role = 'admin_savr'): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'ops-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function req(body: unknown): NextRequest {
  return new NextRequest(
    'http://localhost/api/v1/admin/attributions-ag/col-1/repas',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}
const params = { params: Promise.resolve({ collecteId: 'col-1' }) };

const ROUTE = '@/app/api/v1/admin/attributions-ag/[collecteId]/repas/route.js';
const AG_REALISEE = {
  data: { type: 'anti_gaspi', statut: 'realisee' },
  error: null,
};

describe('M2.4 / saisie Admin des repas réalisés AG', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1re saisie (valeur vide) sans motif → 200, UPDATE direct + audit', async () => {
    setupAuth();
    mockChain.single
      .mockResolvedValueOnce(AG_REALISEE)
      .mockResolvedValueOnce({
        data: { id: 'att-1', volume_repas_realise: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'att-1', volume_repas_realise: 180 },
        error: null,
      });
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(req({ volume_repas_realise: 180 }), params);
    expect(res.status).toBe(200);
    expect(mockChain.update).toHaveBeenCalledWith({
      volume_repas_realise: 180,
    });
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'volume_repas_saisi_admin',
        motif: null,
        old_values: { volume_repas_realise: null },
        new_values: { volume_repas_realise: 180 },
      }),
    );
  });

  it('correction sans motif → 422, aucune écriture', async () => {
    setupAuth();
    mockChain.single.mockResolvedValueOnce(AG_REALISEE).mockResolvedValueOnce({
      data: { id: 'att-1', volume_repas_realise: 200 },
      error: null,
    });
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(
      req({ volume_repas_realise: 180, motif: 'court' }),
      params,
    );
    expect(res.status).toBe(422);
    expect(mockChain.update).not.toHaveBeenCalled();
    expect(mockChain.insert).not.toHaveBeenCalled();
  });

  it('correction avec motif → 200, motif tracé', async () => {
    setupAuth();
    mockChain.single
      .mockResolvedValueOnce({
        data: { type: 'anti_gaspi', statut: 'cloturee' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'att-1', volume_repas_realise: 200 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'att-1', volume_repas_realise: 180 },
        error: null,
      });
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(
      req({
        volume_repas_realise: 180,
        motif: 'Comptage association reçu par email',
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ motif: 'Comptage association reçu par email' }),
    );
  });

  it.each([
    ['programmee', 'anti_gaspi'],
    ['realisee_sans_collecte', 'anti_gaspi'],
    ['realisee', 'zero_dechet'],
  ])('statut %s / type %s → 422', async (statut, type) => {
    setupAuth();
    mockChain.single.mockResolvedValueOnce({
      data: { type, statut },
      error: null,
    });
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(req({ volume_repas_realise: 10 }), params);
    expect(res.status).toBe(422);
    expect(mockChain.update).not.toHaveBeenCalled();
  });

  it.each([[-1], [1.5], ['12'], [100001]])('valeur %s → 422', async (v) => {
    setupAuth();
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(req({ volume_repas_realise: v }), params);
    expect(res.status).toBe(422);
    expect(mockChain.single).not.toHaveBeenCalled();
  });

  it('rôle client → 403', async () => {
    setupAuth('traiteur_manager');
    const { PATCH } = await import(ROUTE);
    const res = await PATCH(req({ volume_repas_realise: 10 }), params);
    expect(res.status).toBe(403);
  });
});
