/**
 * M1.1b — Tests API /admin/collectes (liste, fiche, dispatch, création)
 * Scénarios P1 critiques : dispatch 409/403/422, outbox G4 via RPC atomique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInsertChain = { select: vi.fn().mockReturnThis(), single: vi.fn() };
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn(() => mockInsertChain),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
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

function setupAuth(role: string, userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ role }) } },
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

// ── Dispatch ───────────────────────────────────────────────────────────────

describe('M1.1b / Dispatch / Statuts terminaux', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const statut of [
    'realisee',
    'cloturee',
    'annulee',
    'realisee_sans_collecte',
  ]) {
    it(`M1.1b/dispatch — 409 si statut=${statut}`, async () => {
      setupAuth('admin_savr');
      mockSupabaseChain.single.mockResolvedValueOnce({
        data: {
          id: 'col-1',
          statut,
          statut_tms: 'envoye',
          tms_reference: 'ref-1',
          type: 'zd',
          date_collecte: '2026-07-01',
          dirty_tms: false,
          prestataire_logistique_id: null,
        },
        error: null,
      });
      const { POST } =
        await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {}),
        {
          params: Promise.resolve({ id: 'col-1' }),
        },
      );
      expect(res.status).toBe(409);
    });
  }
});

describe('M1.1b / Dispatch / Permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/dispatch — 403 si ops tente override prestataire', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/dispatch — 422 si override sans motif suffisant', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
        motif_override_prestataire: 'ok', // < 5 chars
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/dispatch — 422 si override sans motif du tout', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: 'prest-old',
      },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {
        prestataire_logistique_id: 'prest-new',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1b / Dispatch / Outbox G4', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/dispatch — émet E1 collecte.creee sur premier envoi (via RPC atomique)', async () => {
    setupAuth('admin_savr');
    // Validation : collecte non terminale, tms_reference null = premier envoi
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        type: 'zd',
        date_collecte: '2026-07-01',
        dirty_tms: false,
        prestataire_logistique_id: null,
      },
      error: null,
    });
    // RPC fn_dispatcher_collecte → retourne event_type
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.creee',
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/dispatch', {}),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event_type: string };
    expect(body.event_type).toBe('collecte.creee');
    // G4 : RPC atomique appelé (pas deux appels séparés)
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_dispatcher_collecte',
      expect.objectContaining({ p_id: 'col-1' }),
    );
  });

  it('M1.1b/dispatch — émet E2 collecte.modifiee si tms_reference présente (via RPC atomique)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-2',
        statut: 'validee',
        statut_tms: 'envoye',
        tms_reference: 'REF-123',
        type: 'ag',
        date_collecte: '2026-07-02',
        dirty_tms: true,
        prestataire_logistique_id: null,
      },
      error: null,
    });
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'collecte.modifiee',
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-2/dispatch', {}),
      { params: Promise.resolve({ id: 'col-2' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event_type: string };
    expect(body.event_type).toBe('collecte.modifiee');
  });

  it('M1.1b/dispatch — 404 si collecte inconnue', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/dispatch/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/bad-id/dispatch', {}),
      { params: Promise.resolve({ id: 'bad-id' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('M1.1b / Collectes / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/collectes/liste — 200 avec chip non_transmises (filtre tms_reference IS NULL)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      count: 0,
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/collectes?chip=non_transmises'),
    );
    expect(res.status).toBe(200);
    // Le filtre .is('tms_reference', null) doit être appelé
    expect(mockSupabaseChain.is).toHaveBeenCalledWith('tms_reference', null);
  });
});

describe('M1.1b / Collectes / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/collectes/create — 422 si champs obligatoires manquants', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', { evenement_id: 'evt-1' }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/collectes/create — outbox E1 atomique via fn_creer_collecte', async () => {
    setupAuth('admin_savr');

    // RPC fn_creer_collecte → retourne collecte_id
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: 'col-new',
      error: null,
    });
    // SELECT collecte après création (retourne la fiche complète)
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'col-new',
        type: 'zd',
        date_collecte: '2026-07-01',
        statut: 'programmee',
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes', {
        evenement_id: 'evt-1',
        type: 'zd',
        date_collecte: '2026-07-01',
        heure_collecte: '09:00',
      }),
    );
    expect(res.status).toBe(201);
    // G4 : fn_creer_collecte appelée (INSERT + outbox E1 atomiques)
    expect(mockSupabaseChain.rpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_evenement_id: 'evt-1',
        p_type: 'zd',
        p_date_collecte: '2026-07-01',
      }),
    );
  });
});
