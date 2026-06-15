/**
 * M2.2 — Tests Vitest API : Formulaire AG (complétion)
 * Couvre la route GET /api/v1/programmation/pack-ag (non testée en M1.2)
 * et le cas ajouter-collecte AG avec pack actif.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: mockMaybeSingle,
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

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

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

function setupAuth(
  role: string,
  organisationId = 'org-traiteur-1',
  userId = 'user-1',
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ role, organisation_id: organisationId }),
      },
    },
    error: null,
  });
}

function resetChain() {
  vi.resetAllMocks();
  mockSupabaseChain.from.mockReturnThis();
  mockSupabaseChain.select.mockReturnThis();
  mockSupabaseChain.insert.mockReturnThis();
  mockSupabaseChain.update.mockReturnThis();
  mockSupabaseChain.eq.mockReturnThis();
  mockSupabaseChain.not.mockReturnThis();
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// ── Tests pack-ag route ────────────────────────────────────────────────────

describe('M2.2 / GET /api/v1/programmation/pack-ag', () => {
  beforeEach(resetChain);

  it('pack_ag_actif_credits_restants — 200 avec pack_actif=true et credits_restants', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'pack-uuid-1',
        nb_collectes: 10,
        nb_utilisees: 3,
        nb_annulees: 0,
        credits_restants: 7,
        date_expiration: null,
        statut: 'actif',
      },
      error: null,
    });

    const { GET } = await import('@/app/api/v1/programmation/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/programmation/pack-ag'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.pack_actif).toBe(true);
    expect(json.pack_id).toBe('pack-uuid-1');
    expect(json.credits_restants).toBe(7);
  });

  it('pack_ag_absent — 200 avec pack_actif=false si aucun pack actif', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-2');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { GET } = await import('@/app/api/v1/programmation/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/programmation/pack-ag'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.pack_actif).toBe(false);
    expect(json.pack_id).toBeUndefined();
  });

  it('isolation_cross_org — filtre organisation_id est celui du caller, pas un param externe', async () => {
    setupAuth('traiteur_commercial', 'org-caller');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { GET } = await import('@/app/api/v1/programmation/pack-ag/route.js');
    await GET(makeReq('GET', '/api/v1/programmation/pack-ag'));

    // Vérifier que eq('organisation_id', ...) a été appelé avec l'org du caller
    const eqCalls = mockSupabaseChain.eq.mock.calls as Array<[string, string]>;
    const orgCall = eqCalls.find(([col]) => col === 'organisation_id');
    expect(orgCall).toBeDefined();
    expect(orgCall?.[1]).toBe('org-caller');
  });

  it('pack_ag_credits_zero — 200 avec pack_actif=true même si credits_restants=0 (informationnel)', async () => {
    // La route ne bloque pas selon credits=0 — c'est la route evenements/route.ts qui bloque.
    // pack-ag retourne l'état brut du pack.
    setupAuth('traiteur_manager', 'org-traiteur-3');
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'pack-vide',
        nb_collectes: 5,
        nb_utilisees: 5,
        nb_annulees: 0,
        credits_restants: 0,
        date_expiration: null,
        statut: 'actif',
      },
      error: null,
    });

    const { GET } = await import('@/app/api/v1/programmation/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/programmation/pack-ag'));

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.pack_actif).toBe(true);
    expect(json.credits_restants).toBe(0);
  });
});

// ── Tests ajouter-collecte AG via [id]/collectes ───────────────────────────

describe('M2.2 / POST /api/v1/programmation/evenements/[id]/collectes — type AG', () => {
  beforeEach(resetChain);

  it('ajouter_collecte_ag_pack_actif — 201 si pack actif et crédits disponibles', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    // Ownership check
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'evt-add-ag', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    // f_collecte_editable → true
    mockSupabaseChain.rpc.mockResolvedValueOnce({ data: true, error: null });
    // packs_antgaspi → pack actif avec 3 crédits
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'pack-add-1', credits_restants: 3 },
      error: null,
    });
    // fn_ajouter_collecte_evenement → collecte créée
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte-ag-add-1',
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-add-ag/collectes', {
        type: 'ag',
        date_collecte: '2030-03-10',
        heure_collecte: '09:00',
      }),
      { params: Promise.resolve({ id: 'evt-add-ag' }) },
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { collecte_id: string };
    expect(json.collecte_id).toBe('collecte-ag-add-1');
  });

  it('ajouter_collecte_ag_credits_zero — 422 si pack actif mais credits_restants=0', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    // Ownership check
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'evt-no-credit', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    // f_collecte_editable → true
    mockSupabaseChain.rpc.mockResolvedValueOnce({ data: true, error: null });
    // packs_antgaspi → pack actif mais credits_restants=0 (défense en profondeur)
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'pack-empty', credits_restants: 0 },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq(
        'POST',
        '/api/v1/programmation/evenements/evt-no-credit/collectes',
        { type: 'ag', date_collecte: '2030-03-15', heure_collecte: '10:00' },
      ),
      { params: Promise.resolve({ id: 'evt-no-credit' }) },
    );

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/pack|Anti-Gaspi/i);
  });
});
