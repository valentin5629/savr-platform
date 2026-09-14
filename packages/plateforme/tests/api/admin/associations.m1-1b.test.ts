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

  // §06.06 §5 « N° RUP — Édition admin-only » (arbitrage Val 2026-09-14).
  it('M1.1b/associations/patch — 403 si ops tente modifier numero_rup', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        numero_rup: 'W751234567',
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1b/associations/patch — admin persiste numero_rup, vide ⇒ NULL', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO },
        error: null,
      });
    const { PATCH } =
      await import('@/app/api/v1/admin/associations/[id]/route.js');

    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        numero_rup: 'W751234567',
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ numero_rup: 'W751234567' }),
    );

    // Champ vidé dans la modale ⇒ effacement (NULL), pas la chaîne vide :
    // l'instantané du Cerfa doit valoir NULL, pas ''.
    mockSupabaseChain.update.mockClear();
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: 'asso-1', ...BASE_ASSO },
        error: null,
      });
    const res2 = await PATCH(
      makeReq('PATCH', '/api/v1/admin/associations/asso-1', {
        numero_rup: '',
      }),
      { params: Promise.resolve({ id: 'asso-1' }) },
    );
    expect(res2.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ numero_rup: null }),
    );
  });

  it('M1.1b/associations/create — numero_rup transmis à l’INSERT (vide ⇒ NULL)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    await POST(
      makeReq('POST', '/api/v1/admin/associations', {
        ...BASE_ASSO,
        numero_rup: 'W751234567',
      }),
    );
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ numero_rup: 'W751234567' }),
    );

    mockSupabaseChain.insert.mockClear();
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-2', ...BASE_ASSO },
      error: null,
    });
    await POST(makeReq('POST', '/api/v1/admin/associations', BASE_ASSO));
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ numero_rup: null }),
    );
  });

  // ── CRÉATION — symétrie avec le PATCH (revue reviewer-rls-securite, PR #299) ──
  // Le POST n'était gardé que par requireStaff alors que son insert accepte les
  // colonnes admin-only (§06.06 §5 l.425-426) : un ops pouvait POSER à la création
  // ce que ce PATCH lui refuse. Aucune barrière DB ne rattrape cette route (elle
  // écrit en service_role : RLS bypassée, f_app_role() NULL → les triggers
  // trg_ops_immutable_cols s'exemptent) — l'oracle est donc ici, pas en pgTAP.
  it.each([
    ['siren', { siren: '123456789' }],
    ['numero_rup', { numero_rup: 'W751234567' }],
    ['habilitee_attestation_fiscale', { habilitee_attestation_fiscale: true }],
    [
      'date_expiration_habilitation',
      { date_expiration_habilitation: '2027-12-31' },
    ],
    ['id_point_collecte_mts1', { id_point_collecte_mts1: 'PC-42' }],
  ])(
    'M1.1b/associations/create — 403 si ops pose %s à la création',
    async (champ, patch) => {
      setupAuth('ops_savr');
      const { POST } = await import('@/app/api/v1/admin/associations/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/admin/associations', {
          ...BASE_ASSO,
          ...patch,
        }),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(champ);
      // Rien ne part en base, et l'API adresse n'est pas appelée pour une requête
      // rejetée (la garde passe avant le géocodage).
      expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
      const { geocodeAdresse } = await import('@/lib/geocoding.js');
      expect(geocodeAdresse).not.toHaveBeenCalled();
    },
  );

  it('M1.1b/associations/create — 201 pour ops quand le bloc admin est neutre (la modale envoie toujours ces clés)', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    // Forme exacte du payload de association-modal.tsx : les clés admin sont
    // présentes mais vides/false. Les refuser sur leur seule PRÉSENCE rendrait
    // toute création impossible à ops — la garde porte sur la valeur posée.
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', {
        ...BASE_ASSO,
        siren: null,
        numero_rup: null,
        habilitee_attestation_fiscale: false,
        date_expiration_habilitation: null,
        id_point_collecte_mts1: null,
      }),
    );
    expect(res.status).toBe(201);
  });

  it("M1.1b/associations/create — chaîne vide sur un champ admin-only ⇒ NULL en base (pas de '')", async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    // `''` n'est pas une valeur posée (la garde laisse passer) : il doit donc être
    // normalisé à l'insert — NULL pour les colonnes texte/date, `false` pour la
    // colonne booléenne. Sinon ops écrirait bel et bien `''` dans une colonne
    // admin-only, et `''::date` / `''::boolean` remonteraient un 500 PG brut.
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', {
        ...BASE_ASSO,
        siren: '',
        numero_rup: '',
        date_expiration_habilitation: '',
        id_point_collecte_mts1: '',
        habilitee_attestation_fiscale: '',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        siren: null,
        numero_rup: null,
        date_expiration_habilitation: null,
        id_point_collecte_mts1: null,
        // Colonne booléenne : `''` ne doit pas atteindre PG (`''::boolean` = 500).
        habilitee_attestation_fiscale: false,
      }),
    );
  });

  it('M1.1b/associations/create — admin persiste les champs admin-only', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'asso-1', ...BASE_ASSO },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/associations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/associations', {
        ...BASE_ASSO,
        siren: '123456789',
        numero_rup: 'W751234567',
        habilitee_attestation_fiscale: true,
        date_expiration_habilitation: '2027-12-31',
        id_point_collecte_mts1: 'PC-42',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        siren: '123456789',
        numero_rup: 'W751234567',
        habilitee_attestation_fiscale: true,
        date_expiration_habilitation: '2027-12-31',
        id_point_collecte_mts1: 'PC-42',
      }),
    );
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
