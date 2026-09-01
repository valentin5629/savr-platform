/**
 * M1.1a — Tests API /admin/organisations
 * Scénarios : liste, création, fiche, modification, désactivation, restriction ops.
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
  order: vi.fn().mockReturnThis(),
  range: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  catch: vi.fn().mockResolvedValue(null),
  is: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

// Helper pour générer un JWT factice avec claims
function makeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.sig`;
}

// Mock cookies + createServerClient pour api-auth
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

// ── Helpers ────────────────────────────────────────────────────────────────

function setupAuth(role: string) {
  const token = makeJwt({ user_role: role, organisation_id: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-admin-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.1a / Organisations / Authentification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 401 si non authentifié', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(401);
  });

  it('M1.1a/orgas/liste — 403 si rôle traiteur_manager', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(403);
  });
});

describe('M1.1a / Organisations / Liste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/liste — 200 : les compteurs ZD/AG viennent de la RPC (oracle + anti-vacuité)', async () => {
    // Bug pré-existant réparé : la RPC count_collectes_par_org n'existait pas en
    // base → 0 partout. Ce test ne se contente PAS de vérifier le status : il
    // FAKE la RPC en FILTRANT sur `type_collecte` (zd ≠ ag) et asserte le
    // mapping réel des compteurs dans chaque ligne. Sans ces assertions, un
    // retour figé / un swap zd↔ag / une RPC ignorée resteraient verts.
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [
        {
          id: 'org-1',
          raison_sociale: 'Traiteur Un',
          type: 'traiteur',
          siret: '12345678901234',
          actif: true,
          logo_url: null,
          users: [{ count: 3 }],
        },
        {
          id: 'org-2',
          raison_sociale: 'Traiteur Deux',
          type: 'traiteur',
          siret: '43210987654321',
          actif: true,
          logo_url: null,
          users: [{ count: 1 }],
        },
      ],
      error: null,
      count: 2,
    });

    // Fake FILTRANT : renvoie des données DIFFÉRENTES selon `type_collecte`.
    // org-2 est volontairement ABSENTE du jeu ZD → doit retomber à 0 (anti-vacuité).
    // Toute RPC inattendue throw (fail-closed) : une dérive de la route casse fort.
    mockSupabaseChain.rpc.mockImplementation(
      (fn: string, params: { type_collecte: string; depuis: string }) => {
        if (fn !== 'count_collectes_par_org') {
          throw new Error(`RPC inattendue: ${fn}`);
        }
        const parType: Record<
          string,
          { organisation_id: string; nb: number }[]
        > = {
          zd: [{ organisation_id: 'org-1', nb: 12 }],
          ag: [
            { organisation_id: 'org-1', nb: 5 },
            { organisation_id: 'org-2', nb: 7 },
          ],
        };
        return Promise.resolve({
          data: parType[params.type_collecte] ?? [],
          error: null,
        });
      },
    );

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        nb_collectes_zd_12m: number;
        nb_collectes_ag_12m: number;
      }[];
      total: number;
    };
    expect(json.total).toBe(2);

    const byId = Object.fromEntries(json.data.map((r) => [r.id, r]));
    // org-1 : présente dans ZD (12) ET AG (5) → mapping correct, pas de swap.
    expect(byId['org-1']?.nb_collectes_zd_12m).toBe(12);
    expect(byId['org-1']?.nb_collectes_ag_12m).toBe(5);
    // org-2 : ABSENTE du jeu ZD → 0 (défaut `?? 0`) ; présente en AG (7).
    expect(byId['org-2']?.nb_collectes_zd_12m).toBe(0);
    expect(byId['org-2']?.nb_collectes_ag_12m).toBe(7);

    // Contrat d'appel : 1 appel zd + 1 appel ag, `depuis` au format date (12 mois).
    const rpcCalls = mockSupabaseChain.rpc.mock.calls as [
      string,
      { type_collecte: string; depuis: string },
    ][];
    expect(rpcCalls.map((c) => c[1].type_collecte).sort()).toEqual([
      'ag',
      'zd',
    ]);
    for (const [fn, args] of rpcCalls) {
      expect(fn).toBe('count_collectes_par_org');
      expect(args.depuis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Fenêtre glissante : `depuis` ≈ aujourd'hui − 1 an.
    const attendu = new Date();
    attendu.setFullYear(attendu.getFullYear() - 1);
    expect(rpcCalls[0]?.[1].depuis).toBe(attendu.toISOString().slice(0, 10));
  });

  it('M1.1a/orgas/liste — le select N’embarque PAS `evenements` (FK ambiguë → 300)', async () => {
    // Garde anti-régression : `evenements` a 2 FK vers `organisations`
    // (organisation_id + client_organisateur_organisation_id) → un embed non
    // désambiguïsé renvoie HTTP 300 PGRST201 et vide toute la liste Clients.
    // Les compteurs ZD/AG viennent de la RPC count_collectes_par_org, pas d'un
    // embed. Vérifié réel contre savr-dev (206 + 14 organisations).
    setupAuth('admin_savr');
    mockSupabaseChain.range.mockResolvedValueOnce({
      data: [],
      error: null,
      count: 0,
    });
    mockSupabaseChain.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const { GET } = await import('@/app/api/v1/admin/organisations/route.js');
    await GET(makeReq('GET', '/api/v1/admin/organisations'));

    const selectArg = mockSupabaseChain.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/evenements/);
    expect(selectArg).toContain('users:users(count)');
  });
});

describe('M1.1a / Organisations / Création', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/creation — 201 avec données valides', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-new',
        raison_sociale: 'Nouvelle Orga',
        type: 'traiteur',
        actif: true,
      },
      error: null,
    });

    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        raison_sociale: 'Nouvelle Orga',
        type: 'traiteur',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('M1.1a/orgas/creation — 422 si type invalide', async () => {
    setupAuth('ops_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', {
        raison_sociale: 'Test',
        type: 'type_inconnu',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('M1.1a/orgas/creation — 422 si raison_sociale manquante', async () => {
    setupAuth('admin_savr');
    const { POST } = await import('@/app/api/v1/admin/organisations/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations', { type: 'traiteur' }),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.1a / Organisations / Modification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/tarif-refacture-admin-only — 403 si ops_savr tente de modifier tarif_refacture_pax_zd', async () => {
    setupAuth('ops_savr');
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('M1.1a/orgas/modification — 200 si admin_savr modifie tarif_refacture_pax_zd', async () => {
    setupAuth('admin_savr');
    // R15 (§07/06 tarif_refacture_pax_zd_update) : pré-fetch de l'ancien tarif
    // AVANT l'UPDATE pour figer l'avant/après dans audit_log.
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { tarif_refacture_pax_zd: 1.5 },
      error: null,
    });
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Orga',
        type: 'traiteur',
        actif: true,
        tarif_refacture_pax_zd: 2.5,
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/admin/organisations/org-1', {
        tarif_refacture_pax_zd: 2.5,
      }),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
  });

  it('M1.1a/orgas/desactivation — 200 pour admin et ops', async () => {
    setupAuth('ops_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: { id: 'org-1', actif: false },
      error: null,
    });
    const { POST } =
      await import('@/app/api/v1/admin/organisations/[id]/desactiver/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/admin/organisations/org-1/desactiver'),
      {
        params: Promise.resolve({ id: 'org-1' }),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { actif: boolean };
    expect(json.actif).toBe(false);
  });
});

describe('M1.1a / Organisations / Fiche (GET [id])', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1.1a/orgas/fiche — 200 + select sans colonnes/relations fantômes', async () => {
    // Garde anti-régression du crash « écran blanc » (P0) : le select de la
    // fiche ne doit référencer NI `code_postal`/`ville` (colonnes inexistantes,
    // HTTP 400) NI `type_remise` (réel = `activite`) et doit désambiguïser
    // `tarifs_negocie!organisation_id` (2 FK → HTTP 300 sinon). Vérifié réel
    // contre savr-dev (HTTP 200).
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: {
        id: 'org-1',
        raison_sociale: 'Kaspia',
        type: 'traiteur',
        entites_facturation: [],
        organisations_domaines_email: [],
        users: [],
        packs_antgaspi: [],
        tarifs_negocie: [],
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations/org-1'), {
      params: Promise.resolve({ id: 'org-1' }),
    });
    expect(res.status).toBe(200);

    const selectArg = mockSupabaseChain.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toMatch(/code_postal|ville|type_remise/);
    expect(selectArg).toContain('tarifs_negocie!organisation_id');
    expect(selectArg).toContain('activite');
  });

  it('M1.1a/orgas/fiche — 404 si organisation introuvable', async () => {
    setupAuth('admin_savr');
    mockSupabaseChain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    });
    const { GET } =
      await import('@/app/api/v1/admin/organisations/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/admin/organisations/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
