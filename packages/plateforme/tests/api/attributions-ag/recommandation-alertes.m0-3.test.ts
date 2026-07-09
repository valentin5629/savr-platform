/**
 * M0.3 — BL-P2-30 — Alertes Admin AG « aucune option » émises depuis la route
 * recommandation (§05 l.61 aucune association éligible ; §05 l.83 aucun
 * transporteur / branche aucun_prestataire). In-app via f_upsert_alerte_admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock Supabase (rpc routé par 1er argument) ────────────────────────────────
const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// ── Mock auth (staff) ─────────────────────────────────────────────────────────
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

function setupAuth(role = 'admin_savr', userId = 'user-admin-1'): void {
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

function makeReq(collecteId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/admin/attributions-ag/${collecteId}/recommandation`,
    { method: 'GET' },
  );
}

interface AlgoResult {
  associations: unknown[];
  assoc_count: number;
  transporteur: unknown;
  branche: string;
  is_idf: boolean;
  no_asso: boolean;
  no_prestataire: boolean;
  delai_minutes: number;
  nb_pax: number;
}

function algo(partial: Partial<AlgoResult>): AlgoResult {
  return {
    associations: [],
    assoc_count: 0,
    transporteur: null,
    branche: 'ag_province_proximite',
    is_idf: false,
    no_asso: false,
    no_prestataire: false,
    delai_minutes: 240,
    nb_pax: 200,
    ...partial,
  };
}

// Route le mock rpc : l'algo renvoie `data`, f_upsert_alerte_admin renvoie ok.
function routeRpc(algoData: AlgoResult, upsertError: unknown = null): void {
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'fn_calculer_algo_attribution_ag')
      return Promise.resolve({ data: algoData, error: null });
    if (fn === 'f_upsert_alerte_admin')
      return Promise.resolve({ data: null, error: upsertError });
    return Promise.resolve({ data: null, error: null });
  });
}

function upsertCalls(): unknown[][] {
  return mockRpc.mock.calls.filter((c) => c[0] === 'f_upsert_alerte_admin');
}

async function callGet(collecteId: string) {
  const { GET } =
    await import('@/app/api/v1/admin/attributions-ag/[collecteId]/recommandation/route.js');
  return GET(makeReq(collecteId), {
    params: Promise.resolve({ collecteId }),
  });
}

describe('M0.3 — recommandation AG : alertes Admin « aucune option »', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it('M0.3-1 — aucune association éligible (no_asso) → alerte attribution_aucune_asso émise', async () => {
    routeRpc(
      algo({ no_asso: true, assoc_count: 0, transporteur: { id: 't1' } }),
    );
    const res = await callGet('coll-1');
    expect(res.status).toBe(200);
    const calls = upsertCalls();
    const codes = calls.map((c) => (c[1] as { p_code: string }).p_code);
    expect(codes).toContain('attribution_aucune_asso');
    const asso = calls.find(
      (c) => (c[1] as { p_code: string }).p_code === 'attribution_aucune_asso',
    )![1] as { p_entity_type: string; p_entity_id: string };
    expect(asso.p_entity_type).toBe('collecte');
    expect(asso.p_entity_id).toBe('coll-1');
  });

  it('M0.3-2 — aucun transporteur éligible (no_prestataire) → alerte attribution_aucun_prestataire émise', async () => {
    routeRpc(
      algo({
        no_prestataire: true,
        branche: 'aucun_prestataire',
        transporteur: null,
      }),
    );
    const res = await callGet('coll-2');
    expect(res.status).toBe(200);
    const codes = upsertCalls().map((c) => (c[1] as { p_code: string }).p_code);
    expect(codes).toContain('attribution_aucun_prestataire');
    expect(codes).not.toContain('attribution_aucune_asso');
  });

  it('M0.3-3 — reco complète (association + transporteur) → aucune alerte attribution émise', async () => {
    routeRpc(
      algo({
        no_asso: false,
        no_prestataire: false,
        assoc_count: 2,
        transporteur: { id: 't1', nom: 'Marathon' },
      }),
    );
    const res = await callGet('coll-3');
    expect(res.status).toBe(200);
    expect(upsertCalls()).toHaveLength(0);
  });

  it('M0.3-4 — best-effort : échec f_upsert_alerte_admin n’empêche pas la réponse 200', async () => {
    routeRpc(algo({ no_asso: true }), { message: 'boom' });
    const res = await callGet('coll-4');
    expect(res.status).toBe(200);
    // L'alerte a bien été tentée (best-effort), la reco est quand même renvoyée.
    expect(upsertCalls().length).toBeGreaterThanOrEqual(1);
    const body = (await res.json()) as { data: AlgoResult };
    expect(body.data.no_asso).toBe(true);
  });
});
