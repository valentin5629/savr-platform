/**
 * M1.1b — Liste associations : KPI « Collectes (30 j) » agrégé PAR LIGNE côté API
 * (revue E2E 2026-07-15). Vérifie l'agrégation par association_id (sans double
 * comptage), la valeur exposée, et la dégradation gracieuse si la requête KPI
 * échoue (compteurs à 0, la liste ne casse pas).
 *
 * Le GET liste `await`-e directement le query-builder (pas de `.single()`), donc
 * le mock est un builder THENABLE qui résout une file de résultats dans l'ordre :
 * 1er await = requête associations, 2e await = requête attributions KPI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

let resultQueue: QueryResult[] = [];

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const m of [
    'from',
    'select',
    'order',
    'range',
    'eq',
    'or',
    'ilike',
    'in',
    'gte',
  ]) {
    builder[m] = vi.fn(() => builder);
  }
  // Thenable : chaque `await` consomme le prochain résultat de la file.
  builder.then = (resolve: (v: QueryResult) => unknown) =>
    resolve(resultQueue.shift() ?? { data: [], error: null, count: 0 });
  return builder;
}

const mockBuilder = makeBuilder();

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockBuilder,
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

function setupAdmin() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: 'admin_savr' }) } },
    error: null,
  });
}

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

describe('M1.1b / Associations / liste — KPI collectes 30j par ligne', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue = [];
  });

  it('agrège collectes_realisees_30j par association_id (pas de double comptage)', async () => {
    setupAdmin();
    // 1er await = associations (2 lignes) ; 2e await = attributions KPI.
    resultQueue = [
      {
        data: [{ id: 'a1' }, { id: 'a2' }],
        error: null,
        count: 2,
      },
      {
        // a1 = 2 collectes réalisées, a2 = 1.
        data: [
          { association_id: 'a1' },
          { association_id: 'a1' },
          { association_id: 'a2' },
        ],
        error: null,
      },
    ];
    const { GET } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await GET(makeReq('/api/v1/admin/associations?actif=true'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; collectes_realisees_30j: number }[];
      total: number;
    };
    expect(body.total).toBe(2);
    const byId = Object.fromEntries(
      body.data.map((r) => [r.id, r.collectes_realisees_30j]),
    );
    expect(byId).toEqual({ a1: 2, a2: 1 });
  });

  it('dégradation gracieuse : KPI en erreur → compteurs à 0, liste servie', async () => {
    setupAdmin();
    resultQueue = [
      { data: [{ id: 'a1' }], error: null, count: 1 },
      { data: null, error: { message: 'boom' } },
    ];
    const { GET } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await GET(makeReq('/api/v1/admin/associations?actif=true'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; collectes_realisees_30j: number }[];
    };
    expect(body.data[0]?.collectes_realisees_30j).toBe(0);
  });

  it('page vide : aucune requête KPI, réponse cohérente', async () => {
    setupAdmin();
    resultQueue = [{ data: [], error: null, count: 0 }];
    const { GET } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await GET(makeReq('/api/v1/admin/associations?actif=true'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
  });
});
