/**
 * Tests API admin — lecteur des alertes Admin in-app (follow-up R22e).
 *
 * Ferme le gap systémique : plateforme.alertes_admin avait ~9 émetteurs et 0
 * lecteur applicatif (§07 Observabilité /03 §3 « le canal d'action est l'écran
 * Admin »). Couvre :
 *   · GET /admin/alertes            → liste filtrée par statut (défaut ouverte) ;
 *   · GET /admin/alertes?statut=xxx → 400 statut invalide ;
 *   · GET /admin/alertes/count      → { count } ouvertes ;
 *   · PATCH /admin/alertes/[id]     → resoudre (200) / 404 / 409 / 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';

const state = {
  list: { data: [] as unknown, error: null as unknown },
  count: { count: 0 as number | null, error: null as unknown },
  single: { data: null as unknown, error: null as unknown },
  update: { error: null as unknown },
};
let updateCalls: Array<Record<string, unknown>> = [];
let orderCalls: Array<{ col: string; opts: unknown }> = [];
let eqCalls: Array<{ col: string; val: unknown }> = [];

// Query-builder mock : `select/order/eq` renvoient le builder (thenable →
// résout state.list) ; `select(_, {head})` renvoie un thenable count ;
// `maybeSingle` résout state.single ; `update().eq()` résout state.update.
function makeBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) {
        const c: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            eqCalls.push({ col, val });
            return c;
          },
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(state.count).then(res),
        };
        return c;
      }
      return b;
    },
    order: (col: string, opts: unknown) => {
      orderCalls.push({ col, opts });
      return b;
    },
    eq: (col: string, val: unknown) => {
      eqCalls.push({ col, val });
      return b;
    },
    maybeSingle: () => Promise.resolve(state.single),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(state.list).then(res),
    update: (payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return { eq: () => Promise.resolve(state.update) };
    },
  };
  return b;
}

const mockClient = { from: () => makeBuilder() };

vi.mock('@/lib/api-auth.js', () => ({
  requireAdmin: vi.fn(async () => ({
    ctx: { userId: 'admin-1', role: 'admin_savr', organisationId: null },
  })),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockClient,
}));

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}
function patchReq(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/admin/alertes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls = [];
  orderCalls = [];
  eqCalls = [];
  state.list = { data: [], error: null };
  state.count = { count: 0, error: null };
  state.single = { data: null, error: null };
  state.update = { error: null };
});

describe('gate admin_savr (requireAdmin)', () => {
  it('non-admin → 403 propagé (GET liste, aucun accès données)', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      error: NextResponse.json(
        { error: 'Action réservée admin Savr' },
        { status: 403 },
      ),
    } as Awaited<ReturnType<typeof requireAdmin>>);
    const { GET } = await import('@/app/api/v1/admin/alertes/route.js');
    const res = await GET(getReq('/api/v1/admin/alertes'));
    expect(res.status).toBe(403);
  });

  it('non-admin → 403 propagé (PATCH resoudre, aucun update)', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      error: NextResponse.json({ error: 'x' }, { status: 403 }),
    } as Awaited<ReturnType<typeof requireAdmin>>);
    const { PATCH } = await import('@/app/api/v1/admin/alertes/[id]/route.js');
    const res = await PATCH(patchReq('a1', { action: 'resoudre' }), {
      params: Promise.resolve({ id: 'a1' }),
    });
    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });
});

describe('GET /api/v1/admin/alertes', () => {
  it('liste par défaut = alertes ouvertes, triées created_at desc', async () => {
    state.list = {
      data: [{ id: 'a1', code: 'pack_ag_epuise', statut: 'ouverte' }],
      error: null,
    };
    const { GET } = await import('@/app/api/v1/admin/alertes/route.js');
    const res = await GET(getReq('/api/v1/admin/alertes'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    // filtre statut=ouverte appliqué + tri created_at desc
    expect(eqCalls).toContainEqual({ col: 'statut', val: 'ouverte' });
    expect(orderCalls[0]).toMatchObject({ col: 'created_at' });
  });

  it('statut=all → aucun filtre eq(statut) appliqué', async () => {
    const { GET } = await import('@/app/api/v1/admin/alertes/route.js');
    const res = await GET(getReq('/api/v1/admin/alertes?statut=all'));
    expect(res.status).toBe(200);
    expect(eqCalls.find((c) => c.col === 'statut')).toBeUndefined();
  });

  it('statut invalide → 400', async () => {
    const { GET } = await import('@/app/api/v1/admin/alertes/route.js');
    const res = await GET(getReq('/api/v1/admin/alertes?statut=pouet'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/alertes/count', () => {
  it('renvoie le nombre d’alertes ouvertes', async () => {
    state.count = { count: 4, error: null };
    const { GET } = await import('@/app/api/v1/admin/alertes/count/route.js');
    const res = await GET(getReq('/api/v1/admin/alertes/count'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(4);
    expect(eqCalls).toContainEqual({ col: 'statut', val: 'ouverte' });
  });
});

describe('PATCH /api/v1/admin/alertes/[id]', () => {
  const ctx = { params: Promise.resolve({ id: 'a1' }) };

  it('resoudre une alerte ouverte → 200 + statut=resolue + resolue_par', async () => {
    state.single = { data: { id: 'a1', statut: 'ouverte' }, error: null };
    const { PATCH } = await import('@/app/api/v1/admin/alertes/[id]/route.js');
    const res = await PATCH(patchReq('a1', { action: 'resoudre' }), ctx);
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      statut: 'resolue',
      resolue_par_user_id: 'admin-1',
    });
    expect(updateCalls[0]?.resolue_at).toBeTruthy();
  });

  it('alerte inconnue → 404 (aucun update)', async () => {
    state.single = { data: null, error: null };
    const { PATCH } = await import('@/app/api/v1/admin/alertes/[id]/route.js');
    const res = await PATCH(patchReq('a1', { action: 'resoudre' }), ctx);
    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it('alerte déjà résolue → 409 (aucun update)', async () => {
    state.single = { data: { id: 'a1', statut: 'resolue' }, error: null };
    const { PATCH } = await import('@/app/api/v1/admin/alertes/[id]/route.js');
    const res = await PATCH(patchReq('a1', { action: 'resoudre' }), ctx);
    expect(res.status).toBe(409);
    expect(updateCalls).toHaveLength(0);
  });

  it('action invalide → 400', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/alertes/[id]/route.js');
    const res = await PATCH(patchReq('a1', { action: 'supprimer' }), ctx);
    expect(res.status).toBe(400);
  });
});
