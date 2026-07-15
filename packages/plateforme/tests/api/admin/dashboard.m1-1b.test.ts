/**
 * M1.1b — Tests API /admin/dashboard/kpi
 * Valeurs correctes des 5 cartes KPI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// File d'attente des counts, consommée dans l'ordre des requêtes du Promise.all.
let countQueue: number[] = [];

// Chaîne Supabase mock : chaque méthode renvoie la chaîne (fluent) ; la chaîne est
// thenable → `await`ée par la route (head+count) et résout le prochain count en file.
// Une chaîne fraîche par `.from()` → robuste à la position des filtres (`.in`, `.not`…).
function makeChain() {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  Object.assign(chain, {
    select: ret,
    eq: ret,
    in: ret,
    is: ret,
    not: ret,
    gte: ret,
    lte: ret,
    then: (
      onF: (v: { count: number; error: null }) => unknown,
      onR?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ count: countQueue.shift() ?? 0, error: null }).then(
        onF,
        onR,
      ),
  });
  return chain;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({ from: () => makeChain() }),
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

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function makeReq(method: string, url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method });
}

describe('M1.1b / Dashboard KPI / Valeurs correctes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countQueue = [];
  });

  it('M1.1b/dashboard/kpi — 200 avec 5 cartes correctement structurées', async () => {
    setupAuth('admin_savr');

    // Ordre du Promise.all de la route : non_transmises_zd, non_transmises_ag,
    // attente_prestataire, dirty_tms, collectes_48h_non_validees.
    countQueue = [3, 5, 2, 1, 4];

    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.non_transmises_zd).toBe(3);
    expect(body.non_transmises_ag).toBe(5);
    expect(body.attente_prestataire).toBe(2);
    expect(body.dirty_tms).toBe(1);
    expect(body.collectes_48h_non_validees).toBe(4);
  });

  it('M1.1b/dashboard/kpi — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(401);
  });

  it('M1.1b/dashboard/kpi — 403 si rôle traiteur', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/dashboard/kpi/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/dashboard/kpi'));
    expect(res.status).toBe(403);
  });
});
