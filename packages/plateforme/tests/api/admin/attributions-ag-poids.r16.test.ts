/**
 * R16 sous-lot C — correction volume AG (BL-P1-RM-10).
 * M2.4 : PATCH /admin/attributions-ag/[collecteId]/poids exige un motif SUR CORRECTION
 * (poids déjà saisi, §06.09 l.183) ; la 1re saisie (poids null, l.177) ne l'exige pas.
 * La régénération d'attestation est assurée par les triggers DB (hors périmètre route).
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
    'http://localhost/api/v1/admin/attributions-ag/col-1/poids',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}
const params = { params: Promise.resolve({ collecteId: 'col-1' }) };

describe('M2.4 / correction volume AG (RM-10)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M2.4/RM-10 — correction (poids déjà saisi) sans motif → 422', async () => {
    setupAuth();
    // Attribution déjà pesée → correction.
    mockChain.single.mockResolvedValueOnce({
      data: { id: 'att-1', poids_repas_kg: 40, volume_repas_realise: 90 },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(req({ poids_repas_kg: 50 }), params);
    expect(res.status).toBe(422);
    // Aucune écriture : pas d'UPDATE, pas d'audit.
    expect(mockChain.update).not.toHaveBeenCalled();
    expect(mockChain.insert).not.toHaveBeenCalled();
  });

  it('M2.4/RM-10 — correction avec motif ≥10 → 200 + audit poids_repas_saisi_ops motivé', async () => {
    setupAuth();
    mockChain.single
      .mockResolvedValueOnce({
        data: { id: 'att-1', poids_repas_kg: 40, volume_repas_realise: 90 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'att-1', poids_repas_kg: 50, volume_repas_realise: 112 },
        error: null,
      });
    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(
      req({
        poids_repas_kg: 50,
        motif: 'Volume aberrant corrigé après vérification des photos de pesée',
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockChain.update).toHaveBeenCalledWith({ poids_repas_kg: 50 });
    // Le motif est tracé (le trigger DB audite sans contexte requête).
    expect(mockChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'poids_repas_saisi_ops',
        motif: 'Volume aberrant corrigé après vérification des photos de pesée',
        table_name: 'attributions_antgaspi',
      }),
    );
  });

  it('M2.4/RM-10 — 1re saisie (poids null) sans motif → 200, pas d’audit route', async () => {
    setupAuth();
    mockChain.single
      .mockResolvedValueOnce({
        data: { id: 'att-1', poids_repas_kg: null, volume_repas_realise: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'att-1', poids_repas_kg: 45, volume_repas_realise: 100 },
        error: null,
      });
    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(req({ poids_repas_kg: 45 }), params);
    expect(res.status).toBe(200);
    expect(mockChain.update).toHaveBeenCalledWith({ poids_repas_kg: 45 });
    // 1re saisie : pas de motif exigé → pas d'entrée audit motivée depuis la route
    // (le trigger DB écrit poids_repas_saisi_ops de son côté).
    expect(mockChain.insert).not.toHaveBeenCalled();
  });

  it('M2.4/RM-10 — poids_repas_kg <= 0 → 422', async () => {
    setupAuth();
    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(req({ poids_repas_kg: 0 }), params);
    expect(res.status).toBe(422);
  });
});
