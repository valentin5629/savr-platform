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
  delete: vi.fn().mockReturnThis(),
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

// Rattachement gestionnaire : réservé aux organisations `gestionnaire_lieux`
// (CDC §04 `organisations_lieux`). Une organisation d'un autre type rattachée
// à un lieu lirait, via f_collecte_visible, les collectes datées de ce lieu.
describe('Lieux / Rattachement gestionnaire — type imposé serveur', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks ne vide pas les files `mockResolvedValueOnce` : le bloc
    // Normalisation en laisse une (audit_log n'appelle pas .single).
    mockSupabaseChain.single.mockReset();
    mockSupabaseChain.maybeSingle.mockReset();
  });

  const corpsLieu = {
    nom: 'Lieu',
    adresse_acces: '1 rue de la Paix',
    code_postal: '75001',
    ville: 'Paris',
    type_vehicule_max: 'fourgon',
  };

  function tablesEcrites(): string[] {
    return mockSupabaseChain.from.mock.calls
      .map((c) => c[0] as string)
      .filter((t) => t !== 'organisations');
  }

  it('POST — 422 si l’organisation est un traiteur, aucun lieu créé', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { type: 'traiteur' },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux', {
        ...corpsLieu,
        gestionnaire_organisation_id: 'org-traiteur',
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { champs_invalides: string[] };
    expect(body.champs_invalides).toEqual(['gestionnaire_organisation_id']);
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith('id', 'org-traiteur');
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    expect(tablesEcrites()).toEqual([]);
  });

  it('POST — 422 si l’organisation est introuvable', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux', {
        ...corpsLieu,
        gestionnaire_organisation_id: 'org-inconnue',
      }),
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });

  it('POST — 201 et rattachement posé si l’organisation est gestionnaire_lieux', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { type: 'gestionnaire_lieux' },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'lieu-new', ...corpsLieu },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/lieux/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/lieux', {
        ...corpsLieu,
        gestionnaire_organisation_id: 'org-gest',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organisation_id: 'org-gest',
        lieu_id: 'lieu-new',
      }),
    );
  });

  it('PATCH — 422 si l’organisation est un traiteur, lien existant conservé', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'lieu-1', nom: 'Lieu' },
      error: null,
    });
    mockSupabaseChain.maybeSingle.mockResolvedValueOnce({
      data: { type: 'traiteur' },
      error: null,
    });
    const { PATCH } = await import('@/app/api/v1/admin/lieux/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/lieux/lieu-1', {
        nom: 'Renommé',
        gestionnaire_organisation_id: 'org-traiteur',
      }),
      { params: Promise.resolve({ id: 'lieu-1' }) },
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    expect(mockSupabaseChain.delete).not.toHaveBeenCalled();
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });

  it('PATCH — chaîne vide = détachement, sans lecture d’organisation', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({ data: { id: 'lieu-1' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'lieu-1' }, error: null });
    const { PATCH } = await import('@/app/api/v1/admin/lieux/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/lieux/lieu-1', {
        gestionnaire_organisation_id: '',
      }),
      { params: Promise.resolve({ id: 'lieu-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.from).not.toHaveBeenCalledWith('organisations');
    expect(mockSupabaseChain.delete).toHaveBeenCalled();
    expect(mockSupabaseChain.insert).not.toHaveBeenCalledWith(
      expect.objectContaining({ lieu_id: 'lieu-1', organisation_id: '' }),
    );
  });
});
