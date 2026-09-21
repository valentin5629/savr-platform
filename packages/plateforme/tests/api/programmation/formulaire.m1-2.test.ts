/**
 * M1.2 — Tests Vitest API : Formulaire programmation collecte
 * Scénarios P1 : création ZD/AG, validations bloquantes, pack AG, facturation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as emailModule from '@savr/shared/src/email/index.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabaseChain = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  rpc: mockRpc,
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => mockSupabaseChain,
}));

vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Chaîne de requête « authenticated » — DISTINCTE de mockSupabaseChain
// (service_role). Les tenir séparées est ce qui permet de prouver SOUS QUELLE
// IDENTITÉ une route lit : la RLS ne s'applique que sur celle-ci.
const MAILLONS_AUTH = [
  'from',
  'select',
  'eq',
  'in',
  'not',
  'or',
  'order',
  'limit',
] as const;
type MaillonAuth = (typeof MAILLONS_AUTH)[number];
type AuthChainMock = Record<MaillonAuth, ReturnType<typeof vi.fn>> & {
  then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise<void>;
};

let resultatAuth: unknown = { data: [], error: null };
function setResultatAuth(r: unknown) {
  resultatAuth = r;
}

const mockAuthChain = {
  from: vi.fn(() => mockAuthChain),
  select: vi.fn(() => mockAuthChain),
  eq: vi.fn(() => mockAuthChain),
  in: vi.fn(() => mockAuthChain),
  not: vi.fn(() => mockAuthChain),
  or: vi.fn(() => mockAuthChain),
  order: vi.fn(() => mockAuthChain),
  limit: vi.fn(() => mockAuthChain),
  // Thenable : `await query` résout quel que soit le dernier maillon appelé.
  then: (res: (v: unknown) => void, rej: (e: unknown) => void) =>
    Promise.resolve(resultatAuth).then(res, rej),
} as AuthChainMock;

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...args: unknown[]) => mockAuthChain.from(...args),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(
  role: string,
  organisationId = 'org-traiteur-1',
  userId = 'user-1',
) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: makeJwt({
          user_role: role,
          organisation_id: organisationId,
        }),
      },
    },
    error: null,
  });
}

function resetChain() {
  vi.resetAllMocks();
  // Restore default chaining behavior after reset
  vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined);
  mockSupabaseChain.from.mockReturnThis();
  mockSupabaseChain.select.mockReturnThis();
  mockSupabaseChain.insert.mockReturnThis();
  mockSupabaseChain.update.mockReturnThis();
  mockSupabaseChain.delete.mockReturnThis();
  mockSupabaseChain.in.mockReturnThis();
  mockSupabaseChain.eq.mockReturnThis();
  mockSupabaseChain.not.mockReturnThis();
  mockSupabaseChain.or.mockReturnThis();
  mockSupabaseChain.order.mockReturnThis();
  mockSupabaseChain.limit.mockReturnThis();
  mockSupabaseChain.is.mockReturnThis();
  resultatAuth = { data: [], error: null };
  for (const k of MAILLONS_AUTH) {
    mockAuthChain[k].mockImplementation(() => mockAuthChain);
  }
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

const BODY_ZD = {
  pax: 80,
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  collectes: [
    { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
  ],
  confirmer: true,
};

const BODY_AG = {
  ...BODY_ZD,
  collectes: [
    { type: 'ag', date_collecte: '2030-01-15', heure_collecte: '08:00' },
  ],
};

const BODY_MIXTE = {
  ...BODY_ZD,
  collectes: [
    { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
    { type: 'ag', date_collecte: '2030-01-15', heure_collecte: '09:00' },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.2 / Programmation ZD — flux confirmé', () => {
  beforeEach(resetChain);

  it('programmation_zd_simple_creee — 201 avec outbox E1 ZD', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala 2030' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-zd-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      evenement_id: string;
      collecte_ids: string[];
    };
    expect(json.evenement_id).toBe('evt-1');
    expect(json.collecte_ids).toContain('collecte-zd-1');
  });

  it('programmation_zd_brouillon — 201 sans appel fn_creer_collecte', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockSingle
      .mockResolvedValueOnce({
        data: { id: 'evt-2', nom_evenement: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'brouillon-1' }, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        confirmer: false,
      }),
    );
    expect(res.status).toBe(201);
    expect(mockRpc).not.toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.anything(),
    );
  });
});

describe('M1.2 / Programmation AG — pack actif', () => {
  beforeEach(resetChain);

  it('programmation_ag_pack_actif — 201 sans envoi TMS', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null })
      .mockResolvedValueOnce({
        data: { id: 'pack-1', credits_restants: 5 },
        error: null,
      });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-ag-1', nom_evenement: 'AG Test' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-ag-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_AG),
    );
    expect(res.status).toBe(201);
  });

  it('ag_bloquee_sans_pack_actif — 422 si aucun pack actif', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_AG),
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/pack/i);
  });

  it('ag_bloquee_pack_credits_zero — 422 si credits_restants = 0', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null })
      .mockResolvedValueOnce({
        data: { id: 'pack-1', credits_restants: 0 },
        error: null,
      });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_AG),
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.2 / Programmation mixte ZD+AG', () => {
  beforeEach(resetChain);

  it('programmation_mixte_zd_ag — 201 deux collectes créées', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null })
      .mockResolvedValueOnce({
        data: { id: 'pack-1', credits_restants: 3 },
        error: null,
      });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-mixte-1', nom_evenement: 'Mixte' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: 'collecte-zd-m', error: null })
      .mockResolvedValueOnce({ data: 'collecte-ag-m', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_MIXTE),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { collecte_ids: string[] };
    expect(json.collecte_ids).toHaveLength(2);
  });
});

describe('M1.2 / Validations bloquantes', () => {
  beforeEach(resetChain);

  it('validations_champs_manquants — 422 si pax absent', async () => {
    setupAuth('traiteur_commercial');
    // Pas de mock DB — la route court-circuite avant toute requête

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        type_evenement_id: 'type-1',
        lieu_id: 'lieu-1',
        contact_principal_nom: 'Jean',
        contact_principal_telephone: '0612345678',
        collectes: [
          { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
        ],
        confirmer: true,
        controle_acces_requis: false,
        // pax absent → 422 avant tout appel DB
      }),
    );
    expect(res.status).toBe(422);
  });

  it('validations_date_passe — 422 si date_collecte dans le passé', async () => {
    setupAuth('traiteur_commercial');

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        collectes: [
          { type: 'zd', date_collecte: '2020-01-01', heure_collecte: '08:00' },
        ],
      }),
    );
    expect(res.status).toBe(422);
  });

  it('validations_sans_collectes — 422 si tableau collectes vide', async () => {
    setupAuth('traiteur_commercial');

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        collectes: [],
      }),
    );
    expect(res.status).toBe(422);
  });

  it('programmation_bloquee_facturation_incomplete — 422 si SIRET non vérifié', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // pas d'entite vérifiée

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/SIRET|profil/i);
  });

  it('programmation_admin_sans_org — 422 si admin_savr sans organisation_id dans le body', async () => {
    setupAuth('admin_savr', ''); // admin_savr n'a pas d'organisation_id dans son JWT

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    // admin_savr autorisé mais doit fournir organisation_id dans le body (support programmation)
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/organisation_id/i);
  });

  it('programmation_admin_org_cible — effectiveOrgId = organisation_id du body, jamais l’org interne du staff', async () => {
    // Régression : le staff a une org interne RÉELLE (org_savr, users.organisation_id
    // est NOT NULL) → la programmation de support doit cibler l'org du body, pas org_savr.
    setupAuth('admin_savr', 'org-savr-interne');
    mockMaybeSingle.mockResolvedValue({ data: null, error: null }); // org cible sans SIRET vérifié → 422

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        organisation_id: 'org-kaspia-cible',
      }),
    );

    // Le gate de complétude (entites_facturation) est interrogé sur l'ORG CIBLE…
    expect(mockSupabaseChain.eq).toHaveBeenCalledWith(
      'organisation_id',
      'org-kaspia-cible',
    );
    // …et jamais sur l'org interne du staff (sinon régression du bug !organisationId).
    expect(mockSupabaseChain.eq).not.toHaveBeenCalledWith(
      'organisation_id',
      'org-savr-interne',
    );
    expect(res.status).toBe(422); // s'arrête au gate SIRET de l'org cible
  });
});

describe('M1.2 / Ajout collecte à événement existant', () => {
  beforeEach(resetChain);

  it('ajout_collecte_zd_evenement_existant — 201 collecte ajoutée', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null }) // f_collecte_editable
      .mockResolvedValueOnce({ data: 'new-collecte-1', error: null }); // fn_ajouter_collecte_evenement

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { collecte_id: string };
    expect(json.collecte_id).toBe('new-collecte-1');
  });

  it('ajout_collecte_non_editable — 422 si événement terminal', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-2', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: false, error: null }); // f_collecte_editable=false

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-2/collectes', {
        type: 'zd',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
      }),
      { params: Promise.resolve({ id: 'evt-2' }) },
    );
    expect(res.status).toBe(422);
  });

  it('ajout_collecte_org_mismatch — 404 si organisation différente', async () => {
    setupAuth('traiteur_commercial', 'org-autre');
    mockSingle.mockResolvedValueOnce({ data: null, error: null }); // ownership fail

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'zd',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('M1.2 / Confirmation brouillon', () => {
  beforeEach(resetChain);

  it('confirmer_brouillon — 200 statut=programmee', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');

    // Ownership check (from='evenements') → single()
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-b',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'B',
        // Le commercial confirme SON propre brouillon (created_by = caller) : miroir
        // de col_delete_brouillon (§09), un commercial ne confirme que ses créations.
        created_by: 'user-1',
      },
      error: null,
    });

    // La query collectes n'a pas de terminal .single() — elle est awaitable directement.
    // On surcharge `from` pour intercepter la table 'collectes' et retourner un thenable.
    const collectesData = [
      { id: 'c1', type: 'zd', date_collecte: '2030-01-15' },
    ];
    const collectesChain = {
      select: () => collectesChain,
      eq: () => collectesChain,
      then: (
        resolve: (v: { data: typeof collectesData; error: null }) => void,
        _reject?: (e: unknown) => void,
      ) => Promise.resolve({ data: collectesData, error: null }).then(resolve),
    };
    mockSupabaseChain.from.mockImplementation((table: string) => {
      if (table === 'collectes') return collectesChain;
      return mockSupabaseChain;
    });

    // Gate SIRET — entites_facturation (nouveau)
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'entite-1' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null }); // fn_confirmer_programmation_brouillon

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-b/confirmer'),
      { params: Promise.resolve({ id: 'evt-b' }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { statut: string };
    expect(json.statut).toBe('programmee');
  });

  it('confirmer_brouillon_sans_siret — 422 si entite_facturation non vérifiée', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-d',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'D',
        created_by: 'user-1',
      },
      error: null,
    });
    const collectesChain2 = {
      select: () => collectesChain2,
      eq: () => collectesChain2,
      then: (
        resolve: (v: {
          data: { id: string; type: string; date_collecte: string }[];
          error: null;
        }) => void,
      ) =>
        Promise.resolve({
          data: [{ id: 'c1', type: 'zd', date_collecte: '2030-01-15' }],
          error: null,
        }).then(resolve),
    };
    mockSupabaseChain.from.mockImplementation((table: string) => {
      if (table === 'collectes') return collectesChain2;
      return mockSupabaseChain;
    });
    // entites_facturation → non vérifiée
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-d/confirmer'),
      { params: Promise.resolve({ id: 'evt-d' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/SIRET|profil/i);
  });

  it('confirmer_brouillon_sans_collectes — 422 si aucun brouillon', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-c',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'C',
        created_by: 'user-1',
      },
      error: null,
    });

    // Collectes vides
    const emptyChain = {
      select: () => emptyChain,
      eq: () => emptyChain,
      then: (
        resolve: (v: { data: never[]; error: null }) => void,
        _reject?: (e: unknown) => void,
      ) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    mockSupabaseChain.from.mockImplementation((table: string) => {
      if (table === 'collectes') return emptyChain;
      return mockSupabaseChain;
    });

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-c/confirmer'),
      { params: Promise.resolve({ id: 'evt-c' }) },
    );
    expect(res.status).toBe(422);
  });
});

describe('M1.2 / Sécurité isolation cross-org', () => {
  beforeEach(resetChain);

  it('gestionnaire_lieu_non_autorise — 403 si gestionnaire_lieux programme sur lieu hors périmètre', async () => {
    setupAuth('gestionnaire_lieux', 'org-gest-1');
    // Gap A : organisations_lieux check → null (lieu hors périmètre)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        traiteur_operationnel_organisation_id: 'traiteur-1',
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/lieu/i);
  });

  it('agence_traiteur_non_autorise — 403 si agence spécifie un traiteur non shadow de son compte', async () => {
    setupAuth('agence', 'org-agence-1');
    // Gap B : organisations check → null (pas une shadow org de cette agence)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        traiteur_operationnel_organisation_id: 'traiteur-autre',
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/traiteur/i);
  });

  it('ajout_collecte_ag_sans_pack_existant — 422 si AG ajouté sans pack actif', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    // Ownership check
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-sec', organisation_id: 'org-traiteur-1' },
      error: null,
    });
    // f_collecte_editable → true
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    // packs_antgaspi → null (pas de pack)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-sec/collectes', {
        type: 'ag',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
      }),
      { params: Promise.resolve({ id: 'evt-sec' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/pack|Anti-Gaspi/i);
  });

  it('agence_traiteur_reel_autorise — 201 si agence spécifie un traiteur réel non-shadow', async () => {
    setupAuth('agence', 'org-agence-1');
    // Gap B : traiteur réel (est_shadow=false, type=traiteur)
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'traiteur-reel-1',
          type: 'traiteur',
          est_shadow: false,
          cree_par_organisation_id: null,
        },
        error: null,
      })
      // SIRET gate
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-agence-1', nom_evenement: 'Gala Agence' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-agence-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        traiteur_operationnel_organisation_id: 'traiteur-reel-1',
      }),
    );
    expect(res.status).toBe(201);
  });
});

type ChaineMock = {
  select: () => ChaineMock;
  eq: (col?: string, val?: unknown) => ChaineMock;
  in: (col: string, vals: string[]) => ChaineMock;
  not: () => ChaineMock;
  or: () => ChaineMock;
  order: () => ChaineMock;
  limit: () => ChaineMock;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise<void>;
};

// Ids réellement transmis au `.in('id', …)` de la requête finale `lieux` du
// chemin admin : c'est l'ensemble « lieux proposés à l'autocomplétion ».
let idsProposes: string[] = [];

/**
 * Route les tables du chemin ADMIN (service_role). Les deux lectures de
 * `evenements` sont distinguées par la COLONNE filtrée, ce qui vérifie au
 * passage que la branche 4 interroge bien
 * `traiteur_operationnel_organisation_id`.
 */
function setupTablesAdmin(opts: {
  typeOrg?: string | null;
  rattaches?: string[];
  programmes?: string[];
  operes?: string[];
}) {
  idsProposes = [];
  const ok = (data: unknown) => ({ data, error: null });
  const lignes = (ids: string[] = []) => ids.map((lieu_id) => ({ lieu_id }));

  const simple = (data: unknown, capture = false): ChaineMock => {
    const c: ChaineMock = {
      select: () => c,
      eq: () => c,
      in: (_col, vals) => {
        if (capture) idsProposes = vals;
        return c;
      },
      not: () => c,
      or: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(ok(data)),
      then: (res, rej) => Promise.resolve(ok(data)).then(res, rej),
    };
    return c;
  };

  // Une chaîne NEUVE par lecture de `evenements` : les deux requêtes sont
  // construites avant d'être résolues (Promise.all), donc une chaîne partagée
  // verrait sa colonne écrasée par la seconde et les deux résoudraient pareil.
  const chaineEvt = (): ChaineMock => {
    let colonne = '';
    const evt: ChaineMock = {
      select: () => evt,
      eq: (col) => {
        colonne = col ?? '';
        return evt;
      },
      in: () => evt,
      not: () => evt,
      or: () => evt,
      order: () => evt,
      limit: () => evt,
      maybeSingle: () => Promise.resolve(ok(null)),
      then: (res, rej) =>
        Promise.resolve(
          ok(
            lignes(
              colonne === 'traiteur_operationnel_organisation_id'
                ? opts.operes
                : opts.programmes,
            ),
          ),
        ).then(res, rej),
    };
    return evt;
  };

  mockSupabaseChain.from.mockImplementation((table: string) => {
    if (table === 'organisations')
      return simple(opts.typeOrg ? { type: opts.typeOrg } : null);
    if (table === 'organisations_lieux') return simple(lignes(opts.rattaches));
    if (table === 'evenements') return chaineEvt();
    if (table === 'lieux') return simple([], true);
    throw new Error(`table inattendue dans le chemin admin : ${table}`);
  });
}

async function getLieux(url = '/api/v1/programmation/lieux') {
  const { GET } = await import('@/app/api/v1/programmation/lieux/route.js');
  return GET(makeReq('GET', url));
}

/**
 * Alignement de l'autocomplétion Lieux sur la policy `lieux_clients_select`.
 *
 * Avant ce lot, la route lisait en service_role et re-transcrivait 2 des 4
 * branches de la policy : la branche « traiteur opérationnel » (§09, migration
 * 20260921140000) n'atteignait donc jamais l'autocomplétion.
 */
describe('M1.2 / Lieux — alignement sur la RLS', () => {
  beforeEach(resetChain);

  // ── Rôles clients : la policy filtre, la route ne transcrit rien ──────────

  it('lieux_client_lu_sous_authenticated — lecture RLS, jamais en service_role', async () => {
    setupAuth('traiteur_manager', 'org-traiteur-1');
    setResultatAuth({
      data: [{ id: 'lieu-opere-1', nom: 'Lieu opéré par un tiers' }],
      error: null,
    });

    const res = await getLieux();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'lieu-opere-1', nom: 'Lieu opéré par un tiers' },
    ]);

    // Lu sous `authenticated`, via la vue en liste blanche de colonnes.
    expect(mockAuthChain.from).toHaveBeenCalledWith('v_lieux_clients');
    // Et JAMAIS via le client service_role : c'est ce qui garantit que la
    // policy — donc ses 4 branches — décide seule.
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
  });

  it('lieux_client_aucune_transcription_du_predicat — ni organisations_lieux ni evenements', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    setResultatAuth({ data: [{ id: 'lieu-1' }], error: null });

    await getLieux();

    const tablesLues = mockAuthChain.from.mock.calls.map((c) => c[0]);
    expect(tablesLues).not.toContain('organisations_lieux');
    expect(tablesLues).not.toContain('evenements');
    expect(tablesLues).toEqual(['v_lieux_clients']);
  });

  it('lieux_traiteur_scope_vide — 200 [] si la RLS ne rend aucun lieu', async () => {
    setupAuth('traiteur_commercial', 'org-new');
    setResultatAuth({ data: [], error: null });

    const res = await getLieux();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('lieux_client_recherche — le terme q est appliqué à la requête RLS', async () => {
    setupAuth('gestionnaire_lieux', 'org-gl-1');
    setResultatAuth({ data: [], error: null });

    await getLieux('/api/v1/programmation/lieux?q=Pavillon');

    expect(mockAuthChain.or).toHaveBeenCalledWith(
      expect.stringContaining('Pavillon'),
    );
  });

  // ── Admin support : service_role, filtre transcrit, aligné sur la policy ──

  it('lieux_admin_sans_org_cible — 200 [] (pas de fuite cross-organisation)', async () => {
    setupAuth('admin_savr', 'org-savr');
    setupTablesAdmin({ typeOrg: 'traiteur', rattaches: ['lieu-a'] });

    const res = await getLieux();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    // Aucune lecture : l'absence d'org cible court-circuite avant toute requête.
    expect(mockSupabaseChain.from).not.toHaveBeenCalled();
  });

  it('lieux_admin_branche_traiteur_operationnel — le lieu opéré est proposé', async () => {
    setupAuth('admin_savr', 'org-savr');
    setupTablesAdmin({
      typeOrg: 'traiteur',
      rattaches: ['lieu-rattache'],
      programmes: ['lieu-programme'],
      operes: ['lieu-opere'],
    });

    const res = await getLieux(
      '/api/v1/programmation/lieux?organisation_id=org-traiteur-1',
    );
    expect(res.status).toBe(200);
    expect([...idsProposes].sort()).toEqual([
      'lieu-opere',
      'lieu-programme',
      'lieu-rattache',
    ]);
  });

  it('lieux_admin_org_non_traiteur — la branche 4 reste gardée par le rôle', async () => {
    setupAuth('admin_savr', 'org-savr');
    setupTablesAdmin({
      typeOrg: 'agence',
      rattaches: ['lieu-rattache'],
      operes: ['lieu-opere'],
    });

    const res = await getLieux(
      '/api/v1/programmation/lieux?organisation_id=org-agence-1',
    );
    expect(res.status).toBe(200);
    // Non-vacuité : la donnée « opérée » EXISTE dans la fixture et a bien été
    // lue — c'est la garde de rôle de la policy (transposée en type d'org) qui
    // l'écarte, pas une fixture vide.
    expect(idsProposes).toContain('lieu-rattache');
    expect(idsProposes).not.toContain('lieu-opere');
  });
});
