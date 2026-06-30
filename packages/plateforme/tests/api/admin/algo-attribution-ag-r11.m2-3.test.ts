/**
 * M2.3 / R11 — Tests API reste de l'algo attribution AG (BL-P1-ALGO-01..06)
 * Couvre : criticité file (ALGO-02), recherche libre asso filtres (ALGO-03),
 * recherche libre transporteur (ALGO-04), audit aucune-reco (ALGO-03),
 * cron registration (ALGO-05), auto-accept évaluation (ALGO-06).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

// ── Mock Supabase : chaîne thenable (awaitable) + rpc ──────────────────────────

interface ChainResult {
  data: unknown;
  error: unknown;
  count?: number;
}

const mockRpc = vi.fn();
let chainResult: ChainResult = { data: [], error: null, count: 0 };
const chainCalls = {
  gte: vi.fn(),
  eq: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  is: vi.fn(),
};

function makeChain() {
  const chain: Record<string, unknown> = {};
  const passthrough = [
    'from',
    'select',
    'order',
    'range',
    'limit',
    'update',
    'insert',
    'lte',
  ];
  for (const m of passthrough) chain[m] = vi.fn().mockReturnValue(chain);
  // Méthodes filtre tracées
  for (const m of Object.keys(chainCalls)) {
    chain[m] = vi.fn((...args: unknown[]) => {
      (chainCalls as Record<string, ReturnType<typeof vi.fn>>)[m]?.(...args);
      return chain;
    });
  }
  chain.single = vi.fn(() => Promise.resolve(chainResult));
  chain.rpc = mockRpc;
  // Thenable : `await chain` résout chainResult
  chain.then = (resolve: (v: ChainResult) => unknown) => resolve(chainResult);
  return chain;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => makeChain(),
}));

// ── Mock auth ──────────────────────────────────────────────────────────────────

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

function setupAuth(role: string, userId = 'user-admin-1') {
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

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chainResult = { data: [], error: null, count: 0 };
});

// ── ALGO-02 : criticité < 48h dans la file d'attente ────────────────────────────

describe('M2.3 / R11 ALGO-02 file criticité', () => {
  it('marque criticite=true si collecte < 48h, false sinon', async () => {
    setupAuth('ops_savr');
    const proche = new Date(Date.now() + 12 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const lointain = new Date(Date.now() + 10 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    chainResult = {
      data: [
        {
          id: 'c-urgent',
          date_collecte: proche,
          heure_collecte: '10:00:00',
          volume_estime_repas: 100,
          statut: 'programmee',
          evenements: null,
        },
        {
          id: 'c-loin',
          date_collecte: lointain,
          heure_collecte: '10:00:00',
          volume_estime_repas: 100,
          statut: 'programmee',
          evenements: null,
        },
      ],
      error: null,
      count: 2,
    };

    const { GET } =
      await import('@/app/api/v1/admin/attributions-ag/pending/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/attributions-ag/pending'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; criticite: boolean }[];
    };
    const urgent = body.data.find((r) => r.id === 'c-urgent');
    const loin = body.data.find((r) => r.id === 'c-loin');
    expect(urgent?.criticite).toBe(true);
    expect(loin?.criticite).toBe(false);
  });
});

// ── ALGO-03 : recherche libre association (filtres capacité + habilitation) ─────

describe('M2.3 / R11 ALGO-03 recherche libre association', () => {
  it('applique les filtres capacite_min et habilitee', async () => {
    setupAuth('admin_savr');
    chainResult = { data: [], error: null, count: 0 };

    const { GET } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/admin/associations?q=Paris&capacite_min=300&habilitee=true',
      ),
    );
    expect(res.status).toBe(200);
    expect(chainCalls.gte).toHaveBeenCalledWith(
      'capacite_max_beneficiaires',
      300,
    );
    expect(chainCalls.eq).toHaveBeenCalledWith(
      'habilitee_attestation_fiscale',
      true,
    );
  });
});

// ── ALGO-04 : recherche libre transporteur ──────────────────────────────────────

describe('M2.3 / R11 ALGO-04 recherche libre transporteur', () => {
  it('filtre les transporteurs par nom (q)', async () => {
    setupAuth('admin_savr');
    chainResult = { data: [], error: null, count: 0 };

    const { GET } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/transporteurs?q=Marathon'),
    );
    expect(res.status).toBe(200);
    expect(chainCalls.ilike).toHaveBeenCalledWith('nom', '%Marathon%');
  });
});

// ── ALGO-03 : audit attribution_manuelle_aucune_reco à la validation ───────────

describe('M2.3 / R11 ALGO-03 audit aucune-reco', () => {
  it('appelle rpc_log_attribution_aucune_reco quand aucune_reco=true', async () => {
    setupAuth('admin_savr');
    // 1er rpc = rpc_valider_attribution_ag ; 2e = rpc_log_attribution_aucune_reco
    mockRpc
      .mockResolvedValueOnce({
        data: {
          ok: true,
          attribution_id: 'attr-9',
          outbox_id: 'o',
          pack_id: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-libre',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_top1',
        aucune_reco: true,
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith('rpc_log_attribution_aucune_reco', {
      p_collecte_id: 'coll-1',
      p_attribution_id: 'attr-9',
      p_user_id: 'user-admin-1',
    });
  });

  it("n'appelle PAS l'audit quand aucune_reco absent", async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        attribution_id: 'attr-10',
        outbox_id: 'o',
        pack_id: null,
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-2/valider', {
        association_id: 'asso-1',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_top1',
      }),
      { params: Promise.resolve({ collecteId: 'coll-2' }) },
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'rpc_log_attribution_aucune_reco',
      expect.anything(),
    );
  });
});

// ── ALGO-06 : auto-accept évaluation (déclenchement + SINON) ────────────────────

describe('M2.3 / R11 ALGO-06 auto-accept', () => {
  it('retourne auto_accepted=true si config match', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValue({
      data: {
        auto_accepted: true,
        reason: 'config_match',
        attribution_id: 'a-1',
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/auto-accept/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/auto-accept'),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { auto_accepted: boolean };
    };
    expect(body.data.auto_accepted).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('rpc_evaluer_auto_accept_ag', {
      p_collecte_id: 'coll-1',
    });
  });

  it('retourne auto_accepted=false (SINON) si pas de config', async () => {
    setupAuth('admin_savr');
    mockRpc.mockResolvedValue({
      data: { auto_accepted: false, reason: 'no_config_match' },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/auto-accept/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-3/auto-accept'),
      { params: Promise.resolve({ collecteId: 'coll-3' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { auto_accepted: boolean; reason: string };
    };
    expect(body.data.auto_accepted).toBe(false);
    expect(body.data.reason).toBe('no_config_match');
  });

  it('refuse 403 pour rôle ops_savr (override AG = admin only)', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/auto-accept/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/auto-accept'),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── ALGO-05 : cron process-attributions-ag enregistré dans vercel.json ──────────

describe('M2.3 / R11 ALGO-05 cron registration', () => {
  it('vercel.json déclare le cron /api/cron/process-attributions-ag', () => {
    const vercelPath = fileURLToPath(
      new URL('../../../vercel.json', import.meta.url),
    );
    const vercel = JSON.parse(readFileSync(vercelPath, 'utf8')) as {
      crons: { path: string }[];
    };
    const paths = vercel.crons.map((c) => c.path);
    expect(paths).toContain('/api/cron/process-attributions-ag');
  });
});
