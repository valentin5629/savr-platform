/**
 * M3.5 — API /dashboards/evolution (Bloc 2 évolution + Bloc 4 donut, BL-P1-PARITE-01).
 * Couvre la logique SERVEUR (les tests UI mockent le fetch — ils ne prouvent pas
 * l'agrégation) : périmètre par rôle, agrégation par bucket, taux pondéré (exclusion
 * NULL), pax distinct par événement, granularité auto, gardes d'auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

// Chaîne supabase routée par table (organisations_lieux puis collectes), thenable —
// le `await q` de l'endpoint résout `results[table]` quelle que soit la dernière méthode.
type Res = { data: unknown; error: unknown };
let results: Record<string, Res> = {};
let calls: Record<string, unknown[][]> = {};
let current = '';
function rec(n: string, a: unknown[]) {
  (calls[n] ??= []).push(a);
}
const chain: Record<string, unknown> = {};
chain.from = (t: string) => {
  current = t;
  rec('from', [t]);
  return chain;
};
for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'not']) {
  chain[m] = (...a: unknown[]) => {
    rec(m, a);
    return chain;
  };
}
chain.then = (resolve: (r: Res) => unknown) =>
  resolve(results[current] ?? { data: [], error: null });

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (t: string) => (chain.from as (t: string) => unknown)(t),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string, orgId = 'org-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
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
    error: { message: 'no auth' },
  });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}
function req(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

function evt(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    lieu_id: 'lieu-1',
    pax: 100,
    organisation_id: 'org-1',
    type_evenement_id: 'te-1',
    traiteur_operationnel_organisation_id: null,
    ...extra,
  };
}

async function loadGET() {
  return (await import('@/app/api/v1/dashboards/evolution/route.js')).GET;
}

beforeEach(() => {
  vi.clearAllMocks();
  results = {};
  calls = {};
  current = '';
});

describe('M3.5 / dashboards/evolution', () => {
  it('M3.5/evolution_perimetre_traiteur — scope evenements.organisation_id', async () => {
    setupAuth('traiteur_manager', 'org-42');
    results['collectes'] = { data: [], error: null };
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/evolution?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    expect(res.status).toBe(200);
    const eqArgs = calls.eq ?? [];
    expect(
      eqArgs.some(
        (a) => a[0] === 'evenements.organisation_id' && a[1] === 'org-42',
      ),
    ).toBe(true);
    // Un traiteur ne requête jamais organisations_lieux (périmètre gestionnaire).
    expect((calls.from ?? []).some((a) => a[0] === 'organisations_lieux')).toBe(
      false,
    );
  });

  it('M3.5/evolution_perimetre_gestionnaire — scope organisations_lieux + in(lieu_id)', async () => {
    setupAuth('gestionnaire_lieux', 'org-7');
    results['organisations_lieux'] = {
      data: [{ lieu_id: 'lieu-1' }, { lieu_id: 'lieu-2' }],
      error: null,
    };
    results['collectes'] = { data: [], error: null };
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/evolution?type=zero_dechet&from=2026-06-01&to=2026-06-30',
      ),
    );
    expect(res.status).toBe(200);
    expect((calls.from ?? []).some((a) => a[0] === 'organisations_lieux')).toBe(
      true,
    );
    const inArgs = calls.in ?? [];
    expect(inArgs.some((a) => a[0] === 'evenements.lieu_id')).toBe(true);
    // Le gestionnaire ne scope PAS par organisation_id (c'est le parc de lieux).
    expect(
      (calls.eq ?? []).some((a) => a[0] === 'evenements.organisation_id'),
    ).toBe(false);
  });

  it('M3.5/evolution_zd_barres_5_flux_taux_pondere — sommes par flux + taux pondéré (exclut NULL)', async () => {
    setupAuth('traiteur_manager');
    results['collectes'] = {
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          taux_recyclage: 80,
          date_collecte: '2026-06-15',
          evenements: evt('evt-1'),
          collecte_flux: [
            { poids_reel_kg: 100, flux_dechets: { code: 'biodechet' } },
            { poids_reel_kg: 50, flux_dechets: { code: 'emballage' } },
          ],
          attributions_antgaspi: [],
        },
        {
          id: 'c2',
          type: 'zero_dechet',
          taux_recyclage: null, // exclu du taux pondéré
          date_collecte: '2026-06-20',
          evenements: evt('evt-2'),
          collecte_flux: [
            { poids_reel_kg: 50, flux_dechets: { code: 'biodechet' } },
          ],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    };
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/evolution?type=zero_dechet&from=2025-06-01&to=2026-06-30',
      ),
    );
    const json = (await res.json()) as {
      data: {
        granularite: string;
        series: Array<Record<string, number | null>>;
      };
    };
    expect(json.data.granularite).toBe('mois');
    const bucket = json.data.series[0]!;
    expect(bucket.biodechet).toBe(150); // 100 + 50
    expect(bucket.emballage).toBe(50);
    expect(bucket.tonnage_total).toBe(200);
    // Taux pondéré = 80*150 / 150 (c2 sans taux exclu du numérateur ET dénominateur).
    expect(bucket.taux_recyclage).toBe(80);
  });

  it('M3.5/evolution_ag_ratio_pax_distinct — repas sommés, pax compté une fois par événement', async () => {
    setupAuth('traiteur_manager');
    results['collectes'] = {
      data: [
        {
          id: 'c1',
          type: 'anti_gaspi',
          taux_recyclage: null,
          date_collecte: '2026-06-10',
          evenements: evt('evt-1', { pax: 100 }),
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 30 }],
        },
        {
          id: 'c2',
          type: 'anti_gaspi',
          taux_recyclage: null,
          date_collecte: '2026-06-12',
          evenements: evt('evt-1', { pax: 100 }), // MÊME événement → pax compté 1×
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 40 }],
        },
      ],
      error: null,
    };
    const GET = await loadGET();
    const res = await GET(
      req(
        '/api/v1/dashboards/evolution?type=anti_gaspi&from=2025-06-01&to=2026-06-30',
      ),
    );
    const json = (await res.json()) as {
      data: { series: Array<Record<string, number | null>> };
    };
    const bucket = json.data.series[0]!;
    expect(bucket.repas_donnes).toBe(70); // 30 + 40
    expect(bucket.pax).toBe(100); // même événement → 1 seule fois
    expect(bucket.ratio).toBeCloseTo(0.7, 5);
  });

  it('M3.5/evolution_granularite_auto — jour <30j / semaine <12mois / mois sinon', async () => {
    setupAuth('traiteur_manager');
    results['collectes'] = { data: [], error: null };
    const GET = await loadGET();
    const gran = async (from: string, to: string) => {
      const res = await GET(
        req(
          `/api/v1/dashboards/evolution?type=zero_dechet&from=${from}&to=${to}`,
        ),
      );
      return ((await res.json()) as { data: { granularite: string } }).data
        .granularite;
    };
    expect(await gran('2026-06-01', '2026-06-10')).toBe('jour');
    expect(await gran('2026-06-01', '2026-08-01')).toBe('semaine');
    expect(await gran('2025-01-01', '2026-06-01')).toBe('mois');
  });

  it('M3.5/evolution_auth_401_sans_jwt — non authentifié bloqué', async () => {
    setupNoAuth();
    const GET = await loadGET();
    const res = await GET(req('/api/v1/dashboards/evolution?type=zero_dechet'));
    expect([401, 403]).toContain(res.status);
  });

  it('M3.5/evolution_role_client_bloque — rôle hors périmètre bloqué', async () => {
    setupAuth('client_organisateur');
    const GET = await loadGET();
    const res = await GET(req('/api/v1/dashboards/evolution?type=zero_dechet'));
    expect([401, 403]).toContain(res.status);
  });
});
