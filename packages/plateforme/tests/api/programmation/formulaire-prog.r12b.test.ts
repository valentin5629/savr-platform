/**
 * M1.2 / R12b — Tests Vitest : Formulaire de programmation (BL-P1-PROG-01..05).
 * Couvre : override lieu → fn_creer_collecte + notif Admin (PROG-01), traiteur shadow +
 * fix colonne-DB (PROG-02), récap email programmeur + tarif (PROG-04), auto-accept AG à
 * la confirmation + fix gate pack 'anti_gaspi' (PROG-05). Le payload E1 (PROG-03) est
 * couvert par pgTAP (supabase/tests/M1_2__programmation.test.sql) et l'adapter comment
 * par packages/adapters (adapter.m1-5a).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as emailModule from '@savr/shared/src/email/index.js';
import { calculer_tarif_zd } from '@/lib/tarif-zd.js';

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

// Tarif ZD calculé backend (PROG-04) — mocké pour la ligne du récap.
vi.mock('@/lib/tarif-zd.js', () => ({
  calculer_tarif_zd: vi
    .fn()
    .mockResolvedValue({ montant_ht: 120, montant_brut_ht: 120 }),
  TarifZdError: class extends Error {},
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
): void {
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

function resetChain(): void {
  vi.resetAllMocks();
  vi.mocked(emailModule.sendEmail).mockResolvedValue(undefined);
  // resetAllMocks efface aussi l'implémentation du mock tarif (défini au factory) → réarmer.
  vi.mocked(calculer_tarif_zd).mockResolvedValue({
    montant_ht: 120,
    montant_brut_ht: 120,
  } as Awaited<ReturnType<typeof calculer_tarif_zd>>);
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

// ── PROG-01 : override lieu → fn_creer_collecte + notif Admin + audit_log ──────
describe('M1.2 / PROG-01 override lieu', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-01 override lieu : lieu_overrides passé à fn_creer_collecte + notif Admin + audit_log', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: 'collecte-zd-1', error: null }) // fn_creer_collecte
      .mockResolvedValueOnce({ data: null, error: null }); // f_upsert_alerte_admin

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        lieu_overrides: { adresse_acces: '12 rue Neuve' },
      }),
    );

    expect(res.status).toBe(201);
    // p_lieu_overrides transmis à la RPC (→ écrit sur la ligne ET dans le payload E1)
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_creer_collecte',
      expect.objectContaining({
        p_lieu_overrides: { adresse_acces: '12 rue Neuve' },
      }),
    );
    // Signalement Admin léger + trace audit_log
    expect(mockRpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({ p_code: 'lieu_override_programmation' }),
    );
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lieu_override_programmation' }),
    );
  });

  it('M1.2 — PROG-01 brouillon persiste lieu_overrides', async () => {
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
        lieu_overrides: { ville: 'Lyon' },
      }),
    );

    expect(res.status).toBe(201);
    // L'INSERT brouillon porte lieu_overrides (sinon perdu à la confirmation).
    expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lieu_overrides: { ville: 'Lyon' } }),
    );
  });
});

// ── PROG-02 : traiteur shadow + fix colonne-DB ────────────────────────────────
describe('M1.2 / PROG-02 traiteur shadow', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-02 shadow traiteur créé par agence (201)', async () => {
    setupAuth('agence', 'org-agence-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'shadow-1',
        nom: 'Traiteur X',
        raison_sociale: 'X SAS',
        siret: null,
        est_shadow: true,
      },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null }); // f_upsert_alerte_admin

    const { POST } =
      await import('@/app/api/v1/programmation/organisations/shadow/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/organisations/shadow', {
        raison_sociale: 'X SAS',
        nom_commercial: 'Traiteur X',
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe('shadow-1');
  });

  it('M1.2 — PROG-02 shadow refusé hors agence (403)', async () => {
    setupAuth('gestionnaire_lieux', 'org-gest-1');
    const { POST } =
      await import('@/app/api/v1/programmation/organisations/shadow/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/organisations/shadow', {
        raison_sociale: 'Y SAS',
        nom_commercial: 'Traiteur Y',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M1.2 — PROG-02 GET traiteurs sélectionne des colonnes réelles (pas nom_commercial/ville)', async () => {
    setupAuth('agence', 'org-agence-1');
    const { GET } =
      await import('@/app/api/v1/programmation/organisations/traiteurs/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/programmation/organisations/traiteurs'),
    );
    expect(res.status).toBe(200);
    const selectArg = String(mockSupabaseChain.select.mock.calls[0]?.[0] ?? '');
    expect(selectArg).not.toContain('nom_commercial');
    expect(selectArg).not.toContain('ville');
    expect(selectArg).toContain('raison_sociale');
  });
});

// ── PROG-04 : récap email programmeur + tarif ─────────────────────────────────
describe('M1.2 / PROG-04 récap programmation', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-04 récap programmation envoyé au programmeur avec tarif ZD', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-zd-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(emailModule.sendEmail)).toHaveBeenCalledWith(
      'collecte_programmee',
      'prog@x.fr',
      expect.objectContaining({
        tarif_ligne: expect.stringContaining('120.00'),
      }),
      expect.anything(),
    );
  });

  it('M1.2 — PROG-04 récap non envoyé si destinataire non résolu', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: null, error: null }); // users récap → pas d'email
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-1', nom_evenement: 'Gala' },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: 'collecte-zd-1', error: null });

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(emailModule.sendEmail)).not.toHaveBeenCalled();
  });
});

// ── PROG-05 : auto-accept AG à la confirmation + fix gate pack 'anti_gaspi' ────
describe('M1.2 / PROG-05 auto-accept AG', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-05 auto-accept AG déclenché à la confirmation', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({
        data: { id: 'pack-1', credits_restants: 5 },
        error: null,
      }) // pack
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockSingle.mockResolvedValueOnce({
      data: { id: 'evt-ag-1', nom_evenement: 'AG' },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: 'collecte-ag-1', error: null }) // fn_creer_collecte
      .mockResolvedValueOnce({
        data: { auto_accepted: false, reason: 'no_config' },
        error: null,
      }); // rpc_evaluer_auto_accept_ag

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', {
        ...BODY_ZD,
        collectes: [
          { type: 'ag', date_collecte: '2030-01-15', heure_collecte: '08:00' },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith('rpc_evaluer_auto_accept_ag', {
      p_collecte_id: 'collecte-ag-1',
    });
  });

  it('M1.2 — PROG-05 gate pack AG à la confirmation (type anti_gaspi)', async () => {
    // Oracle du fix 'ag'→'anti_gaspi' : les collectes viennent de la DB (type='anti_gaspi').
    // Avec l'ancien `=== 'ag'`, hasAg=false → la gate serait sautée (200). Ici : 422.
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-b',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'B',
        pax: 50,
        lieu_id: 'lieu-1',
      },
      error: null,
    });
    const collectesData = [
      {
        id: 'c1',
        type: 'anti_gaspi',
        date_collecte: '2030-01-15',
        lieu_overrides: null,
      },
    ];
    const collectesChain = {
      select: () => collectesChain,
      eq: () => collectesChain,
      then: (
        resolve: (v: { data: typeof collectesData; error: null }) => void,
      ) => Promise.resolve({ data: collectesData, error: null }).then(resolve),
    };
    mockSupabaseChain.from.mockImplementation((table: string) =>
      table === 'collectes' ? collectesChain : mockSupabaseChain,
    );
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // SIRET
      .mockResolvedValueOnce({ data: null, error: null }); // pack absent → 422

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-b/confirmer'),
      { params: Promise.resolve({ id: 'evt-b' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/pack|Anti-Gaspi/i);
  });

  it('M1.2 — PROG-04/05 ajout collecte AG à un événement existant déclenche auto-accept + récap', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-1',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'Gala',
        pax: 50,
      },
      error: null,
    });
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null }) // f_collecte_editable
      .mockResolvedValueOnce({ data: 'new-collecte-ag', error: null }) // fn_ajouter_collecte_evenement
      .mockResolvedValueOnce({ data: { auto_accepted: false }, error: null }); // rpc_evaluer_auto_accept_ag
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { id: 'pack-1', credits_restants: 5 },
        error: null,
      }) // pack
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'ag',
        date_collecte: '2030-02-01',
        heure_collecte: '10:00',
      }),
      { params: Promise.resolve({ id: 'evt-1' }) },
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith('rpc_evaluer_auto_accept_ag', {
      p_collecte_id: 'new-collecte-ag',
    });
    expect(vi.mocked(emailModule.sendEmail)).toHaveBeenCalledWith(
      'collecte_programmee',
      'prog@x.fr',
      expect.objectContaining({ tarif_ligne: expect.any(String) }),
      expect.anything(),
    );
  });
});
