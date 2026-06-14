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
        access_token: makeJwt({ role, organisation_id: organisationId }),
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
  mockSupabaseChain.order.mockReturnThis();
  mockSupabaseChain.limit.mockReturnThis();
  mockSupabaseChain.is.mockReturnThis();
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
});
