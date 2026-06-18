/**
 * M3.6 — Tests API Dashboard Client Admin (§06.06 §2).
 * Vue LECTURE SEULE répliquant le dashboard gestionnaire, agrégée par organisation.
 * Couverture : gardes de rôle, agrégation « Toutes les organisations » (sans
 * filtre org) vs périmètre sélectionné (filtre evenements.organisation_id),
 * exactitude KPI ZD/AG, liste organisations, benchmark staff (service-role).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock client admin (service-role) : builder awaitable + rpc ────────────────
let queryResult: { data: unknown; error: unknown } = { data: [], error: null };
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };

const adminClient: Record<string, unknown> = {
  from: vi.fn(() => adminClient),
  select: vi.fn(() => adminClient),
  eq: vi.fn(() => adminClient),
  in: vi.fn(() => adminClient),
  gte: vi.fn(() => adminClient),
  lte: vi.fn(() => adminClient),
  order: vi.fn(() => Promise.resolve(queryResult)),
  rpc: vi.fn(() => Promise.resolve(rpcResult)),
  // Rend le builder awaitable (la route KPI fait `await q` sans méthode terminale).
  then: (resolve: (v: unknown) => void) => resolve(queryResult),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => adminClient,
}));

// ─── Mock auth (requireStaff) ──────────────────────────────────────────────────
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

function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function setupNoAuth(): void {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

function inCalls(): unknown[][] {
  return (adminClient.in as ReturnType<typeof vi.fn>).mock.calls;
}

function gteCalls(): unknown[][] {
  return (adminClient.gte as ReturnType<typeof vi.fn>).mock.calls;
}

function lteCalls(): unknown[][] {
  return (adminClient.lte as ReturnType<typeof vi.fn>).mock.calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryResult = { data: [], error: null };
  rpcResult = { data: [], error: null };
});

// ─── Gardes de rôle ────────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / gardes', () => {
  it('M3.6/auth_guard_non_authentifie_401 — 401 sans session', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client'));
    expect(res.status).toBe(401);
  });

  it('M3.6/auth_guard_non_staff_403 — 403 pour un rôle client', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client'));
    expect(res.status).toBe(403);
  });

  it('M3.6/auth_guard_non_staff_403 — ops_savr autorisé (200)', async () => {
    setupAuth('ops_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?from=2026-01-01&to=2026-12-31'),
    );
    expect(res.status).toBe(200);
  });
});

// ─── Agrégation par périmètre ───────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / périmètre', () => {
  it('M3.6/kpi_toutes_organisations_sans_filtre_org — aucun filtre organisation_id', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=zero_dechet'),
    );
    expect(res.status).toBe(200);
    // « Toutes les organisations » : .in ne doit JAMAIS cibler organisation_id.
    const orgFilter = inCalls().find(
      (c) => c[0] === 'evenements.organisation_id',
    );
    expect(orgFilter).toBeUndefined();
  });

  it('M3.6/kpi_organisations_selectionnees_filtre_in — filtre evenements.organisation_id IN', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/admin/dashboard-client?type=zero_dechet&organisation_ids[]=org-1&organisation_ids[]=org-2',
      ),
    );
    expect(res.status).toBe(200);
    const orgFilter = inCalls().find(
      (c) => c[0] === 'evenements.organisation_id',
    );
    expect(orgFilter).toBeDefined();
    expect(orgFilter?.[1]).toEqual(['org-1', 'org-2']);
  });
});

// ─── Filtre de période ─────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / filtre période', () => {
  it('M3.6/kpi_filtre_periode_date_collecte — from/to ciblent date_collecte (pas realisee_at)', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/admin/dashboard-client?type=zero_dechet&from=2025-06-01&to=2026-04-30',
      ),
    );
    expect(res.status).toBe(200);
    // Parité avec les vues KPI M3.5 + règle revenus §06.06 §1 : la période se
    // filtre sur date_collecte (NOT NULL), jamais sur realisee_at (nullable).
    const gteCol = gteCalls().map((c) => c[0]);
    const lteCol = lteCalls().map((c) => c[0]);
    expect(gteCol).toContain('date_collecte');
    expect(lteCol).toContain('date_collecte');
    expect(gteCol).not.toContain('realisee_at');
    expect(lteCol).not.toContain('realisee_at');
    expect(gteCalls()).toContainEqual(['date_collecte', '2025-06-01']);
    expect(lteCalls()).toContainEqual(['date_collecte', '2026-04-30']);
  });
});

// ─── Exactitude KPI ──────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / KPI', () => {
  it('M3.6/kpi_zd_4_indicateurs_pondere — tonnage, taux pondéré (NULL exclus), kg/pax', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          taux_recyclage: 80,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 50 }],
          attributions_antgaspi: [],
        },
        {
          taux_recyclage: 60,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 150 }],
          attributions_antgaspi: [],
        },
        {
          taux_recyclage: null,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 100 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=zero_dechet'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { kpi: Record<string, number> };
    };
    const kpi = body.data.kpi;
    expect(kpi.nb_collectes).toBe(3);
    expect(kpi.tonnage_kg).toBe(300);
    // Pondéré par tonnage, 3e collecte (taux NULL) exclue : (80*50 + 60*150)/200 = 65.
    expect(kpi.taux_recyclage_pondere).toBeCloseTo(65, 5);
    expect(kpi.kg_par_pax).toBeCloseTo(1, 5);
  });

  it('M3.6/kpi_ag_repas_donnes — repas donnés et repas/pax', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          taux_recyclage: null,
          evenements: [{ pax: 100 }],
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 40 }],
        },
        {
          taux_recyclage: null,
          evenements: [{ pax: 100 }],
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 60 }],
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=anti_gaspi'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { kpi: Record<string, number> };
    };
    const kpi = body.data.kpi;
    expect(kpi.nb_collectes).toBe(2);
    expect(kpi.nb_repas_donnes).toBe(100);
    expect(kpi.pax_total).toBe(200);
    expect(kpi.repas_par_pax).toBeCloseTo(0.5, 5);
  });
});

// ─── Organisations (sélecteur) ─────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / organisations', () => {
  it('M3.6/organisations_liste_pour_selecteur — liste id/raison_sociale/type', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          id: 'o1',
          nom: 'Alpha',
          raison_sociale: 'Alpha SAS',
          type: 'traiteur',
        },
        {
          id: 'o2',
          nom: 'Beta',
          raison_sociale: null,
          type: 'gestionnaire_lieux',
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/organisations'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { nom: string; raison_sociale: string | null }[];
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.nom).toBe('Alpha');
    // Types client uniquement (traiteur, agence, gestionnaire_lieux).
    const typeFilter = inCalls().find((c) => c[0] === 'type');
    expect(typeFilter?.[1]).toEqual([
      'traiteur',
      'agence',
      'gestionnaire_lieux',
    ]);
  });

  it('M3.6/organisations_liste_pour_selecteur — 403 rôle client', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/organisations'),
    );
    expect(res.status).toBe(403);
  });
});

// ─── Benchmark staff (service-role) ────────────────────────────────────────────

describe('M3.6 / Dashboard Client / benchmark', () => {
  it('M3.6/benchmark_staff_service_role — admin accède au benchmark parc', async () => {
    setupAuth('admin_savr');
    rpcResult = {
      data: [
        {
          flux_code: 'biodechet',
          bracket: 'M',
          median_kg_pax: 1.2,
          nb_collectes: 8,
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/benchmark?bracket=M'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      'f_benchmark_kg_pax_zd',
      expect.objectContaining({ p_bracket: 'M' }),
    );
  });

  it('M3.6/benchmark_staff_service_role — 401 sans session', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/benchmark?bracket=M'),
    );
    expect(res.status).toBe(401);
  });
});
