/**
 * M1.1b — Tests API /admin/transporteurs
 * Règles critiques : code_transporteur_mts1 obligatoire si type_tms=mts1 ;
 * prestataire_logistique_id obligatoire si type_tms ∈ {mts1, a_toutes} ;
 * type_tms et prestataire_logistique_id immuables après création.
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

const BASE_TRANSPORTEUR = {
  nom: 'Strike Paris',
  siren: '123456789',
  adresse: '1 rue Test',
  code_postal: '75001',
  ville: 'Paris',
  types_vehicules: ['camion_16m3'],
  contact_nom: 'Jean Dupont',
  contact_email: 'jean@strike.fr',
  contact_telephone: '0600000000',
};

const PRESTA_ID = '0e85a867-df41-5f22-96b7-f7d639365ebf';

describe('M1.1b / Transporteurs / Validation MTS-1', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1b/transporteurs/create — 422 si type_tms=mts1 sans code', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'mts1',
        // pas de code_transporteur_mts1
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('code_transporteur_mts1');
  });

  it('M1.1b/transporteurs/create — 201 si type_tms=mts1 avec code', async () => {
    setupAuth('admin_savr');
    const created = {
      id: 'tr-1',
      ...BASE_TRANSPORTEUR,
      type_tms: 'mts1',
      code_transporteur_mts1: 'STRIKE-001',
      prestataire_logistique_id: PRESTA_ID,
    };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: created,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'mts1',
        code_transporteur_mts1: 'STRIKE-001',
        prestataire_logistique_id: PRESTA_ID,
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1b/transporteurs/create — 201 si type_tms=autre sans code', async () => {
    setupAuth('admin_savr');
    const created = { id: 'tr-2', ...BASE_TRANSPORTEUR, type_tms: 'autre' };
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: created,
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'autre',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1b/transporteurs/create — 403 si rôle client', async () => {
    setupAuth('traiteur_manager');
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', BASE_TRANSPORTEUR),
    );
    expect(res.status).toBe(403);
  });
});

describe('M1.1b / Transporteurs / Modification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseChain.single.mockReset();
  });

  it('M1.1b/transporteurs/patch — 422 si un transporteur mts1 perd son code (type lu en base)', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'tr-1',
        type_tms: 'mts1',
        code_transporteur_mts1: 'CODE-OLD',
        nom: 'Test',
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/transporteurs/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/transporteurs/tr-1', {
        code_transporteur_mts1: '',
      }),
      { params: Promise.resolve({ id: 'tr-1' }) },
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });
});

// Lien transporteur → prestataire logistique : seul moyen pour les adapters de
// reconnaître les tournées d'un provider (#327). Un transporteur mts1/a_toutes
// sans lien envoie 100 % de ses événements en file d'erreur.
describe('Transporteurs / Lien prestataire logistique', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` ne vide PAS les réponses `mockResolvedValueOnce` en
    // attente. Le test « 422 si changement type_tms=mts1 sans code » en laisse
    // une (sa route refuse avant de lire la base) : sans ce reset, elle serait
    // servie au premier `.single()` du bloc ci-dessous.
    mockSupabaseChain.single.mockReset();
  });

  it.each(['mts1', 'a_toutes'])(
    "create — 422 si type_tms=%s sans prestataire logistique, rien n'est écrit",
    async (type_tms) => {
      setupAuth('admin_savr');
      const { POST } =
        await import('@/app/api/v1/admin/transporteurs/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/admin/transporteurs', {
          ...BASE_TRANSPORTEUR,
          type_tms,
          code_transporteur_mts1: 'CODE-001',
        }),
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('prestataire_logistique_id');
      expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
    },
  );

  it("create — 422 si prestataire_logistique_id n'est pas un UUID (jamais un 500)", async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'par_mail',
        prestataire_logistique_id: '',
      }),
    );
    expect(res.status).toBe(422);
    expect(mockSupabaseChain.insert).not.toHaveBeenCalled();
  });

  it('create — a_toutes avec prestataire : le lien est ÉCRIT', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'tr-9' },
      error: null,
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'a_toutes',
        prestataire_logistique_id: PRESTA_ID,
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ prestataire_logistique_id: PRESTA_ID }),
    );
  });

  it('create — prestataire déjà rattaché (23505) → 409 lisible, sans message Postgres', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "uniq_transporteur_par_prestataire"',
      },
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'a_toutes',
        prestataire_logistique_id: PRESTA_ID,
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('déjà rattaché');
    expect(body.error).not.toContain('uniq_transporteur_par_prestataire');
  });

  it('create — prestataire inexistant (23503) → 422 lisible, sans message Postgres', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23503',
        message:
          'insert or update on table "transporteurs" violates foreign key constraint "transporteurs_prestataire_logistique_id_fkey"',
      },
    });
    const { POST } = await import('@/app/api/v1/admin/transporteurs/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/transporteurs', {
        ...BASE_TRANSPORTEUR,
        type_tms: 'par_telephone',
        prestataire_logistique_id: PRESTA_ID,
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('introuvable');
    expect(body.error).not.toContain('foreign key');
  });

  // type_tms et prestataire_logistique_id : posés à la création, JAMAIS
  // modifiables (arbitrage Val 2026-09-16). Le PATCH les refuse explicitement ;
  // la garde en base (trg_transporteur_cols_immuables) couvre PostgREST et SQL.
  it.each([
    ['type_tms', { type_tms: 'a_toutes' }],
    ['prestataire_logistique_id', { prestataire_logistique_id: PRESTA_ID }],
    ['prestataire_logistique_id', { prestataire_logistique_id: null }],
  ])(
    "patch — %s dans le corps → 422 « créez un nouveau transporteur », rien n'est écrit",
    async (champ, corps) => {
      setupAuth('admin_savr');
      mockSupabaseChain.single.mockResolvedValue({
        data: {
          id: 'tr-1',
          type_tms: 'autre',
          prestataire_logistique_id: null,
        },
        error: null,
      });
      const { PATCH } =
        await import('@/app/api/v1/admin/transporteurs/[id]/route.js');
      const res = await PATCH(
        makeReq('PATCH', '/api/v1/admin/transporteurs/tr-1', {
          nom: 'Renommé',
          ...corps,
        }),
        { params: Promise.resolve({ id: 'tr-1' }) },
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(champ);
      expect(body.error).toContain('créez un nouveau transporteur');
      expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    },
  );

  it("patch — refus même quand la valeur envoyée est identique à l'existant", async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValue({
      data: { id: 'tr-1', type_tms: 'mts1', code_transporteur_mts1: 'C' },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/transporteurs/[id]/route.js');
    const res = await PATCH(
      // `nom` rend le corps modifiable par ailleurs : sans lui, le 422 viendrait
      // de « Aucun champ modifiable » et le test passerait sans la règle.
      makeReq('PATCH', '/api/v1/admin/transporteurs/tr-1', {
        nom: 'Renommé',
        type_tms: 'mts1',
      }),
      { params: Promise.resolve({ id: 'tr-1' }) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('créez un nouveau transporteur');
    expect(mockSupabaseChain.update).not.toHaveBeenCalled();
  });

  it("patch — « Désactiver » un transporteur mts1 sans prestataire reste LIBRE, et n'écrit que actif", async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single
      .mockResolvedValueOnce({
        data: {
          id: 'tr-1',
          type_tms: 'mts1',
          code_transporteur_mts1: 'CODE-OLD',
          prestataire_logistique_id: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'tr-1' }, error: null });
    const { PATCH } =
      await import('@/app/api/v1/admin/transporteurs/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/transporteurs/tr-1', { actif: false }),
      { params: Promise.resolve({ id: 'tr-1' }) },
    );
    expect(res.status).toBe(200);
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({ actif: false });
  });
});
