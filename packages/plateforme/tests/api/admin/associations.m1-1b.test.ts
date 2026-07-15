/**
 * M1.1b — Tests API /admin/associations
 * Règles : description_rapport_impact ≥ 30 chars, champs admin-only protégés pour ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// R17 : les routes POST/PATCH appellent geocodeAdresse (fetch réseau vers
// api-adresse.data.gouv.fr, fail-open). Stubbé ici pour éviter tout appel réseau
// live pendant les tests (flakiness/CI) — le géocodage est couvert par
// packages/plateforme/src/lib/geocoding.test.ts.
vi.mock('@/lib/geocoding.js', () => ({
  geocodeAdresse: vi.fn().mockResolvedValue(null),
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

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

const BASE_ASSO = {
  nom: 'Les Restos du Cœur',
  adresse: '42 rue de la Solidarité',
  region: 'idf',
  ville: 'Paris',
  contact_email: 'contact@restos.fr',
  description_rapport_impact:
    'Nous distribuons des repas aux personnes en difficulté depuis 1985.',
};

describe('M1.1b / Associations / Validation description', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/associations/create — 422 si description < 30 chars', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', {
        ...BASE_ASSO,
        description_rapport_impact: 'Trop court.',
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('30');
  });

  it('M1.1b/associations/create — 201 si description ≥ 30 chars', async () => {
    setupAuth('admin_savr');
    const created = { id: 'asso-1', ...BASE_ASSO };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: created,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', BASE_ASSO),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1b/associations/create — 422 si champs obligatoires manquants', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', { nom: 'Test' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1b / Associations / Champs protégés ops', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/associations/patch — 403 si ops tente modifier habilitee_attestation_fiscale', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        habilitee_attestation_fiscale: true,
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/associations/patch — 403 si ops tente modifier actif', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', { actif: false }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/associations/patch — 200 si ops modifie contact_nom (champ autorisé)', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO, contact_nom: 'Marie Curie' },
        error: null,
      });
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        contact_nom: 'Marie Curie',
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1b/associations/patch — 422 si description modifiée < 30 chars', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        description_rapport_impact: 'Trop court.',
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1b / Associations / GET fiche + KPI collectes 30j', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/associations/get — expose collectes_realisees_30j depuis le count, filtres AG réalisées', async () => {
    setupAuth('admin_savr');
    // 1er appel = fiche (single), 2e appel = count KPI (terminé par .gte).
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    mockSupabaseChain.gte.mockResolvedValueOnce({ count: 4, error: null });
    const { GET } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/associations/asso-1'), {
      params: Promise.resolve({ id: 'asso-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collectes_realisees_30j: number };
    expect(body.collectes_realisees_30j).toBe(4);
    // Garde le rattachement + le périmètre « AG réalisées seulement » (décision Val).
    expect(mockSupabaseChain.from).toHaveBeenCalledWith(
      'attributions_antgaspi',
    );
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith(
      'association_id',
      'asso-1',
    );
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('collectes.statut', [
      'realisee',
      'cloturee',
    ]);
  });

  it('M1.1b/associations/get — dégradation gracieuse : count null/erreur → 0', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    mockSupabaseChain.gte.mockResolvedValueOnce({
      count: null,
      error: { message: 'boom' },
    });
    const { GET } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/associations/asso-1'), {
      params: Promise.resolve({ id: 'asso-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collectes_realisees_30j: number };
    expect(body.collectes_realisees_30j).toBe(0);
  });
});
