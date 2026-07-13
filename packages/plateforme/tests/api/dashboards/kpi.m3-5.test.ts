/**
 * M3.5 — Tests API dashboards KPI (5 routes)
 * Couverture : 200 JWT valide, 401 sans JWT, garde traiteur_ids benchmark, 403 garde rôle kpi-admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mocks communs ────────────────────────────────────────────────────────────

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: () => mockClientChain,
    rpc: mockRpc,
  }),
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => mockAdminChain,
    rpc: mockAdminRpc,
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

const mockClientChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null }),
  // BL-P3-02 : la route kpi-traiteur lit organisations.tarif_refacture_pax_zd
  // (traiteur only) pour le tooltip Marge → requête terminée par maybeSingle().
  maybeSingle: vi
    .fn()
    .mockResolvedValue({ data: { tarif_refacture_pax_zd: 1.5 }, error: null }),
};

const mockAdminChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [], error: null }),
};

const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
const mockAdminRpc = vi.fn().mockResolvedValue({ data: null, error: null });

function setupAuth(role: string, orgId = 'org-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({ user_role: role, organisation_id: orgId }),
      },
    },
    error: null,
  });
}

function setupNoAuth() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

// ─── kpi-traiteur ─────────────────────────────────────────────────────────────

describe('M3.5 / kpi-traiteur', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 — traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-traiteur'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });

  it('200 — traiteur_commercial', async () => {
    setupAuth('traiteur_commercial');
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-traiteur'));
    expect(res.status).toBe(200);
  });

  it('200 — agence', async () => {
    setupAuth('agence');
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-traiteur'));
    expect(res.status).toBe(200);
  });

  it('401 — sans JWT', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-traiteur'));
    expect(res.status).toBe(401);
  });

  // Cockpit R24 — N-1 : une seule requête de vue couvrant [N-1 → courante], puis
  // découpe en JS. Vérifie que les lignes sont partitionnées par fenêtre à partir
  // d'UNE seule résolution de `.order()` (au lieu de 2 requêtes de vue en série).
  it('compare=n1 — découpe courante / précédente sur une requête unique', async () => {
    setupAuth('traiteur_manager');
    const rowCurrent = {
      organisation_id: 'org-1',
      mois: '2025-08-01',
      type_collecte: 'zero_dechet',
      nb_collectes: 3,
    };
    const rowPrev = {
      organisation_id: 'org-1',
      mois: '2024-09-01',
      type_collecte: 'zero_dechet',
      nb_collectes: 1,
    };
    // La vue n'est interrogée qu'une fois → une seule résolution de order().
    mockClientChain.order.mockResolvedValueOnce({
      data: [rowCurrent, rowPrev],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/dashboards/kpi-traiteur?from=2025-07-01&to=2026-06-30&type=zero_dechet&compare=n1',
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // from/to = fenêtre courante (12 mois) ; previousWindow rend [2024-07-02,
    // 2025-06-30] → rowPrev (2024-09) tombe dans previous, rowCurrent (2025-08)
    // dans data.
    expect(body.data).toEqual([rowCurrent]);
    expect(body.previous).toEqual([rowPrev]);
    // Une seule requête de vue (un seul appel terminal .order()).
    expect(mockClientChain.order).toHaveBeenCalledTimes(1);
  });
});

// ─── kpi-lieu ─────────────────────────────────────────────────────────────────

describe('M3.5 / kpi-lieu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 — gestionnaire_lieux', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/kpi-lieu/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-lieu'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });

  it('401 — sans JWT', async () => {
    setupNoAuth();
    const { GET } = await import('@/app/api/v1/dashboards/kpi-lieu/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-lieu'));
    expect(res.status).toBe(401);
  });
});

// ─── kpi-admin ────────────────────────────────────────────────────────────────

describe('M3.5 / kpi-admin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 — admin_savr (action cards + kpi)', async () => {
    setupAuth('admin_savr');
    // Simuler les 7 appels parallèles : les 6 counts + la query kpi
    // Les 4 queries count se terminent par .in(), les 2 autres par .eq()/.not() — toutes retournent mockAdminChain
    // (await d'un non-Promise retourne l'objet ; .count ?? 0 donne 0, .error undefined → filtré)
    const kpiResult = { data: [], error: null };
    mockAdminChain.order.mockResolvedValueOnce(kpiResult);

    const { GET } = await import('@/app/api/v1/dashboards/kpi-admin/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-admin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('cartes_actions');
    expect(body).toHaveProperty('kpi');
  });

  it('401 — sans JWT', async () => {
    setupNoAuth();
    const { GET } = await import('@/app/api/v1/dashboards/kpi-admin/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/kpi-admin'));
    expect(res.status).toBe(401);
  });
});

// ─── kpi-client-organisateur ─────────────────────────────────────────────────

describe('M3.5 / kpi-client-organisateur', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 — client_organisateur', async () => {
    setupAuth('client_organisateur');
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-client-organisateur/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/kpi-client-organisateur'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });

  it('401 — sans JWT', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-client-organisateur/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/kpi-client-organisateur'),
    );
    expect(res.status).toBe(401);
  });
});

// ─── benchmark ────────────────────────────────────────────────────────────────

describe('M3.5 / benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: [
        {
          flux_id: 'f-compost',
          flux_code: 'COMPOST',
          type_evenement_id: 't-cocktail',
          taille_evenement: 'M',
          kg_par_pax_moyen: 1.2,
          nb_collectes_segment: 8,
          nb_organisations_distinctes: 3,
        },
      ],
      error: null,
    });
  });

  it('200 — gestionnaire_lieux', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark?bracket=M'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });

  it('403 — traiteur_manager passe traiteur_ids (garde §04)', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?bracket=M&traiteur_ids=some-uuid'),
    );
    expect(res.status).toBe(403);
  });

  it('403 — traiteur_commercial passe traiteur_ids (garde §04)', async () => {
    setupAuth('traiteur_commercial');
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/dashboards/benchmark?bracket=M&traiteur_ids=some-uuid'),
    );
    expect(res.status).toBe(403);
  });

  it('401 — sans JWT', async () => {
    setupNoAuth();
    const { GET } = await import('@/app/api/v1/dashboards/benchmark/route.js');
    const res = await GET(makeReq('/api/v1/dashboards/benchmark?bracket=M'));
    expect(res.status).toBe(401);
  });
});
