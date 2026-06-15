/**
 * M2.3 — Tests API attribution AG
 * Couvre : GET /recommandation, POST /valider, PATCH /poids, GET /pending, PATCH /parametres-algo
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks Supabase ────────────────────────────────────────────────────────────

const mockRpc = vi.fn();
const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn(),
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// ── Mock auth ─────────────────────────────────────────────────────────────────

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
    data: { session: { access_token: makeJwt({ role, sub: userId }) } },
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

// ── Tests : GET recommandation ─────────────────────────────────────────────────

describe('M2.3 / GET /attributions-ag/:id/recommandation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('ops_savr');
  });

  it('retourne les suggestions algo (200)', async () => {
    const algoData = {
      associations: [
        {
          id: 'asso-1',
          nom: 'Restos',
          distance_km: 2.1,
          capacite_max_beneficiaires: 500,
        },
      ],
      assoc_count: 1,
      transporteur: { id: 'transp-1', nom: 'Marathon', type_tms: 'mts1' },
      branche: 'ag_marathon_nuit',
      is_idf: true,
      no_asso: false,
      no_prestataire: false,
      delai_minutes: 240,
      nb_pax: 200,
    };
    mockRpc.mockResolvedValue({ data: algoData, error: null });

    const { GET } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/recommandation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/attributions-ag/coll-1/recommandation'),
      {
        params: Promise.resolve({ collecteId: 'coll-1' }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: typeof algoData };
    expect(body.data.branche).toBe('ag_marathon_nuit');
    expect(mockRpc).toHaveBeenCalledWith('fn_calculer_algo_attribution_ag', {
      p_collecte_id: 'coll-1',
    });
  });

  it('retourne 404 si collecte introuvable', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'P0030 Collecte AG introuvable' },
    });

    const { GET } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/recommandation/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/attributions-ag/bad/recommandation'),
      {
        params: Promise.resolve({ collecteId: 'bad' }),
      },
    );

    expect(res.status).toBe(404);
  });
});

// ── Tests : POST valider ────────────────────────────────────────────────────────

describe('M2.3 / POST /attributions-ag/:id/valider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it('valide une attribution (201)', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        attribution_id: 'attr-1',
        outbox_id: 'out-1',
        pack_id: null,
      },
      error: null,
    });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-1',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_top1',
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it('retourne 422 si champs obligatoires manquants', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-1',
        // transporteur_id manquant
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('retourne 422 si mode_override sans motif', async () => {
    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-2',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_override',
        // motif_override manquant
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(422);
  });

  it('retourne 409 si attribution déjà existante (DUPLICATE)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0044', message: 'Attribution déjà existante' },
    });

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-1',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_top1',
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('refus 403 pour rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');

    const { POST } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/valider/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/attributions-ag/coll-1/valider', {
        association_id: 'asso-1',
        transporteur_id: 'transp-1',
        branche_attribution: 'ag_marathon_nuit',
        mode_validation: 'manuel_top1',
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Tests : PATCH poids ────────────────────────────────────────────────────────

describe('M2.3 / PATCH /attributions-ag/:id/poids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('ops_savr');
  });

  it('met à jour le poids et retourne volume calculé (200)', async () => {
    mockSupabaseChain.single.mockResolvedValue({
      data: { id: 'attr-1', poids_repas_kg: 135.0, volume_repas_realise: 300 },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/attributions-ag/coll-1/poids', {
        poids_repas_kg: 135.0,
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { volume_repas_realise: number };
    };
    expect(body.data.volume_repas_realise).toBe(300);
  });

  it('retourne 422 si poids <= 0', async () => {
    const { PATCH } =
      await import('@/app/api/v1/admin/attributions-ag/[collecteId]/poids/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/attributions-ag/coll-1/poids', {
        poids_repas_kg: -5,
      }),
      { params: Promise.resolve({ collecteId: 'coll-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ── Tests : GET pending ────────────────────────────────────────────────────────

describe('M2.3 / GET /attributions-ag/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('ops_savr');
  });

  it("retourne la file d'attente (200)", async () => {
    const pendingData = [
      {
        id: 'coll-1',
        date_collecte: '2026-07-01',
        heure_collecte: '10:00',
        volume_estime_repas: 200,
        statut: 'programmee',
        evenements: {
          nom_evenement: 'Gala test',
          pax: 200,
          organisations: { raison_sociale: 'OrgTest' },
          lieux: { nom: 'Lieu', ville: 'Paris', code_postal: '75001' },
        },
      },
    ];
    // Simuler la chaîne select → range
    mockSupabaseChain.range.mockResolvedValue({
      data: pendingData,
      error: null,
      count: 1,
    });

    const { GET } =
      await import('@/app/api/v1/admin/attributions-ag/pending/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/admin/attributions-ag/pending'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});

// ── Tests : PATCH parametres-algo ─────────────────────────────────────────────

describe('M2.3 / PATCH /parametres-algo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth('admin_savr');
  });

  it('met à jour un paramètre algo (200)', async () => {
    mockSupabaseChain.single.mockResolvedValue({
      data: {
        cle: 'a_toutes_indisponible',
        valeur: false,
        type_valeur: 'bool',
        updated_at: '2026-06-15T12:00:00Z',
      },
      error: null,
    });

    const { PATCH } =
      await import('@/app/api/v1/admin/parametres-algo/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/parametres-algo', {
        cle: 'a_toutes_indisponible',
        valeur: false,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { cle: string } };
    expect(body.data.cle).toBe('a_toutes_indisponible');
  });

  it('refus 403 pour rôle ops_savr', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/parametres-algo/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/parametres-algo', {
        cle: 'a_toutes_indisponible',
        valeur: true,
      }),
    );
    expect(res.status).toBe(403);
  });

  it('retourne 422 si cle manquante', async () => {
    const { PATCH } =
      await import('@/app/api/v1/admin/parametres-algo/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/parametres-algo', { valeur: true }),
    );
    expect(res.status).toBe(422);
  });
});
