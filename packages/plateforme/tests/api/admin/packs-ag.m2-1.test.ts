/**
 * M2.1 — Tests API nouveaux endpoints AG
 * Scénarios : annuler-credit collecte AG, versioning tarifs packs AG.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
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

function setupAuth(role: string) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
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

// ── Tests annuler-credit ───────────────────────────────────────────────────

describe('M2.1 / annuler-credit collecte AG', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M2.1/annuler-credit/ok — 200 admin_savr sur collecte realisee AG', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: { ok: true, pack_antgaspi_id: 'pack-1' },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/annuler-credit/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/annuler-credit', {
        motif: 'Collecte annulée côté logistique post-réalisation',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('M2.1/annuler-credit/422-motif-court — motif < 10 chars retourne 422', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/annuler-credit/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/annuler-credit', {
        motif: 'Court',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('M2.1/annuler-credit/404-collecte — P0002 → 404', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'Collecte non trouvée' },
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/annuler-credit/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-inexistant/annuler-credit', {
        motif: 'Test collecte inexistante',
      }),
      { params: Promise.resolve({ id: 'col-inexistant' }) },
    );
    expect(res.status).toBe(404);
  });

  it('M2.1/annuler-credit/409-deja-annule — P0005 → 409', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0005',
        message: 'Crédit déjà annulé pour cette collecte',
      },
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/annuler-credit/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/annuler-credit', {
        motif: 'Tentative doublon annulation crédit',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('M2.1/annuler-credit/401-non-staff — traiteur_manager ne peut pas', async () => {
    setupAuth('traiteur_manager');
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-traiteur' } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeJwt({ role: 'traiteur_manager' }),
        },
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/collectes/[id]/annuler-credit/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/collectes/col-1/annuler-credit', {
        motif: 'Tentative non autorisée par traiteur',
      }),
      { params: Promise.resolve({ id: 'col-1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Tests tarifs-packs-ag ──────────────────────────────────────────────────

describe('M2.1 / Tarifs packs AG — versioning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M2.1/tarifs-ag/get-ok — staff peut lister les tarifs actifs', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.or.mockReturnThis();
    const fakeTarifs = [
      {
        id: 'tarif-1',
        type_pack: 'pack_10',
        credits: 10,
        prix_unitaire_ht: 130,
        montant_total_ht: 1300,
        mensualisable: false,
        nb_mensualites: null,
        valide_du: '2026-01-01',
        valide_jusqu_au: null,
      },
    ];
    // order() is the last chain call before resolution
    mockSupabaseChain.order.mockResolvedValueOnce({
      data: fakeTarifs,
      error: null,
    });

    const { GET } = await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/tarifs-packs-ag'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });

  it('M2.1/tarifs-ag/creation-ok — admin crée un nouveau tarif (versioning)', async () => {
    setupAuth('admin_savr');
    // update (fermeture ancienne ligne) → pas de retour attendu
    mockSupabaseChain.update.mockReturnThis();
    mockSupabaseChain.is.mockReturnThis();
    // insert + single
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'tarif-2',
        type_pack: 'pack_10',
        credits: 10,
        prix_unitaire_ht: 140,
        montant_total_ht: 1400,
        valide_du: '2026-07-01',
        valide_jusqu_au: null,
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const valide_du = tomorrow.toISOString().slice(0, 10);

    const res = await POST(
      makeReq('POST', '/api/v1/admin/tarifs-packs-ag', {
        type_pack: 'pack_10',
        credits: 10,
        prix_unitaire_ht: 140,
        valide_du,
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M2.1/tarifs-ag/422-date-passee — valide_du dans le passé → 422', async () => {
    setupAuth('admin_savr');
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/tarifs-packs-ag', {
        type_pack: 'pack_10',
        credits: 10,
        prix_unitaire_ht: 140,
        valide_du: '2020-01-01',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M2.1/tarifs-ag/403-non-admin — ops_savr ne peut pas créer un tarif', async () => {
    setupAuth('ops_savr');
    const { POST } =
      await import('@/app/api/v1/admin/tarifs-packs-ag/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/tarifs-packs-ag', {
        type_pack: 'pack_10',
        credits: 10,
        prix_unitaire_ht: 140,
        valide_du: '2026-08-01',
      }),
    );
    expect(res.status).toBe(403);
  });
});
