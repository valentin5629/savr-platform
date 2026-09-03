/**
 * M1.1b — Tests API /admin/lieux
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
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

describe('M1.1b / Lieux / Auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/lieux/liste — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/lieux'));
    expect(res.status).toBe(401);
  });

  it('M1.1b/lieux/liste — 403 si rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/lieux'));
    expect(res.status).toBe(403);
  });
});

describe('M1.1b / Lieux / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/lieux/liste — 200 avec data pour admin_savr', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'lieu-1',
          nom: 'Salle Pleyel',
          ville: 'Paris',
          code_postal: '75008',
          type_vehicule_max: 'fourgon',
          actif: true,
          reference_citeo: false,
        },
      ],
      count: 1,
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/lieux'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('M1.1b/lieux/liste — 200 pour ops_savr', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      count: 0,
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/lieux'));
    expect(res.status).toBe(200);
  });

  it('M1.1b/lieux/liste — gestionnaire_nom enrichi (batch organisations_lieux, raison_sociale prioritaire, null si sans lien)', async () => {
    setupAuth('admin_savr');
    // Requête 1 (lieux) → terminée par .range
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        { id: 'lieu-1', nom: 'Pavillon Gabriel', ville: 'Paris', actif: true },
        { id: 'lieu-2', nom: 'Salle Wagram', ville: 'Paris', actif: true },
      ],
      count: 2,
      error: null,
    });
    // Requête 2 (organisations_lieux) → awaitée directement, terminée par .in.
    // lieu-1 rattaché (raison_sociale doit primer sur nom) ; lieu-2 sans lien.
    mockSupabaseChain.in.mockResolvedValueOnce({
      data: [
        {
          lieu_id: 'lieu-1',
          organisations: { nom: 'Viparis', raison_sociale: 'Viparis SAS' },
        },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/lieux'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; gestionnaire_nom: string | null }>;
      total: number;
    };
    expect(body.total).toBe(2);
    const l1 = body.data.find((l) => l.id === 'lieu-1');
    const l2 = body.data.find((l) => l.id === 'lieu-2');
    expect(l1?.gestionnaire_nom).toBe('Viparis SAS');
    expect(l2?.gestionnaire_nom).toBeNull();
  });
});

describe('M1.1b / Lieux / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/lieux/create — 422 si champs obligatoires manquants', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux', { nom: 'Test' }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1b/lieux/create — 201 avec tous les champs', async () => {
    setupAuth('admin_savr');
    const newLieu = {
      id: 'lieu-new',
      nom: 'Nouveau Lieu',
      adresse_acces: '1 rue de la Paix',
      code_postal: '75001',
      ville: 'Paris',
      type_vehicule_max: 'fourgon',
      actif: false,
    };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: newLieu,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux', {
        nom: 'Nouveau Lieu',
        adresse_acces: '1 rue de la Paix',
        code_postal: '75001',
        ville: 'Paris',
        type_vehicule_max: 'fourgon',
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe('M1.1b / Lieux / Normalisation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/lieux/normaliser — 404 si lieu inexistant', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });
    const { POST } =
      await import('@/app/api/v1/admin/lieux/[id]/normaliser/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux/bad-id/normaliser'),
      {
        params: Promise.resolve({ id: 'bad-id' }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('M1.1b/lieux/normaliser — 200 : actif passe à true', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: { id: 'lieu-1', actif: false, nom: 'Test' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'lieu-1', actif: true, nom: 'Test' },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null }); // audit_log
    const { POST } =
      await import('@/app/api/v1/admin/lieux/[id]/normaliser/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux/lieu-1/normaliser'),
      {
        params: Promise.resolve({ id: 'lieu-1' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actif: boolean };
    expect(body.actif).toBe(true);
  });
});
