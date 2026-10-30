/**
 * M1.2 / R12b — Tests Vitest : Formulaire de programmation (BL-P1-PROG-01..05).
 * Couvre : override lieu → fn_creer_collecte + notif Admin (PROG-01), traiteur shadow +
 * fix colonne-DB (PROG-02), récap email programmeur + tarif (PROG-04), auto-accept AG à
 * la confirmation sur le type 'anti_gaspi' (PROG-05 ; la garde pack qui l'accompagnait
 * est retirée — décision Val 2026-10-16). Le payload E1 (PROG-03) est
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
// Facturation sur la plateforme allumée : PROG-04 vérifie la ligne de tarif telle
// qu'elle reviendra. Au go-live elle est retirée (décision Val 2026-10-22), ce que
// prouve tests/api/facturation-hors-plateforme.test.ts.
vi.mock('@/lib/facturation-plateforme.js', () => ({
  facturationPlateformeActive: () => true,
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
  vi.mocked(emailModule.sendEmail).mockResolvedValue({ statut: 'sent' });
  // resetAllMocks efface aussi l'implémentation du mock tarif (défini au factory) → réarmer.
  vi.mocked(calculer_tarif_zd).mockResolvedValue({
    montant_ht: 120,
    montant_brut_ht: 120,
  } as Awaited<ReturnType<typeof calculer_tarif_zd>>);
  routerTables();
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

// ── Cartes du formulaire (refonte, lot B2 ; décisions Val 2026-10-22/24) ────
// Chaque collecte est une carte qui porte son type d'événement et ses contacts ;
// la route vérifie les types dans le référentiel (`.in('id', …).eq('actif',
// true)`, attendue sans terminal), puis enregistre événement et collectes en
// une transaction (fn_enregistrer_programmation).
const TYPE_EVT = '11111111-1111-4111-8111-111111111111';

type Thenable<T> = {
  then: (
    ok: (r: T) => unknown,
    ko?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};
interface LectureTypes extends Thenable<{
  data: { id: string }[];
  error: null;
}> {
  select: () => LectureTypes;
  in: (col: string, ids: string[]) => LectureTypes;
  eq: (col: string, valeur: unknown) => LectureTypes;
}

/** Référentiel des types : applique `.in('id')` et `.eq('actif')` comme PostgREST. */
function lectureTypesEvenements(): LectureTypes {
  let lignes = [{ id: TYPE_EVT, actif: true }];
  const q: LectureTypes = {
    select: () => q,
    in: (col, ids) => {
      if (col !== 'id') throw new Error(`filtre inattendu : ${col}`);
      lignes = lignes.filter((l) => ids.includes(l.id));
      return q;
    },
    eq: (col, valeur) => {
      if (col !== 'actif') throw new Error(`filtre inattendu : ${col}`);
      lignes = lignes.filter((l) => l.actif === valeur);
      return q;
    },
    then: (ok, ko) =>
      Promise.resolve({
        data: lignes.map(({ id }) => ({ id })),
        error: null as null,
      }).then(ok, ko),
  };
  return q;
}

/**
 * Collectes de l'événement relues par l'email récapitulatif (une ligne par
 * collecte, numérotée par type) : chaîne attendue sans terminal. Ses maillons
 * restent enregistrés sur les espions partagés.
 */
let collectesEnBase: Record<string, unknown>[] | null = null;
function lectureCollectes() {
  const q: Record<string, unknown> & Thenable<unknown> = {
    then: (ok, ko) =>
      Promise.resolve({ data: collectesEnBase, error: null }).then(ok, ko),
  };
  for (const m of ['select', 'eq', 'in', 'is', 'update'] as const)
    q[m] = (...a: unknown[]) => {
      (mockSupabaseChain[m] as (...x: unknown[]) => unknown)(...a);
      return q;
    };
  q.maybeSingle = (...a: unknown[]) => mockMaybeSingle(...a);
  q.single = (...a: unknown[]) => mockSingle(...a);
  return q;
}

/**
 * Le référentiel des types à part ; les collectes aussi quand le test les pose
 * (email récapitulatif) ; toute autre table sur la chaîne partagée.
 */
function routerTables(collectes: Record<string, unknown>[] | null = null) {
  collectesEnBase = collectes;
  mockSupabaseChain.from.mockImplementation((table: string) => {
    if (table === 'types_evenements') return lectureTypesEvenements();
    if (table === 'collectes' && collectesEnBase) return lectureCollectes();
    return mockSupabaseChain;
  });
}

/** Réponse de fn_enregistrer_programmation. */
const enregistree = (evenement_id: string, ...collecte_ids: string[]) => ({
  data: { evenement_id, collecte_ids },
  error: null,
});

const CARTE = {
  type_evenement_id: TYPE_EVT,
  contact_principal_nom: 'Jean Martin',
  contact_principal_telephone: '0612345678',
  contact_secours_nom: 'Sam Roux',
  contact_secours_telephone: '0733333333',
};

const BODY_ZD = {
  lieu_id: 'lieu-1',
  nom_evenement: 'Gala 2030',
  nom_client_organisateur: 'Traiteur Dupont',
  controle_acces_requis: false,
  collectes: [
    {
      type: 'zd',
      date_collecte: '2097-01-15',
      heure_collecte: '08:00',
      pax: 80,
      ...CARTE,
    },
  ],
  confirmer: true,
};

// ── PROG-01 : override lieu → fn_creer_collecte + notif Admin + audit_log ──────
describe('M1.2 / PROG-01 override lieu', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-01 override lieu : lieu_overrides passé à fn_enregistrer_programmation + notif Admin + audit_log', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // entité de facturation
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockRpc
      .mockResolvedValueOnce(enregistree('evt-1', 'collecte-zd-1')) // fn_enregistrer_programmation
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
    // Override transmis à la RPC d'enregistrement, qui le passe à
    // fn_creer_collecte pour chaque collecte (→ écrit sur la ligne ET dans le
    // payload E1, dans la même transaction).
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_enregistrer_programmation',
      expect.objectContaining({
        p_evenement: expect.objectContaining({
          lieu_overrides: { adresse_acces: '12 rue Neuve' },
        }),
      }),
    );
    // Badge « Info incomplète » sur les collectes créées.
    expect(mockSupabaseChain.update).toHaveBeenCalledWith({
      informations_completes: false,
    });
    expect(mockSupabaseChain.in).toHaveBeenCalledWith('id', ['collecte-zd-1']);
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
    mockRpc.mockResolvedValueOnce(enregistree('evt-2', 'brouillon-1'));

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
    // Le brouillon enregistré porte lieu_overrides (sinon perdu à la
    // confirmation) ; le signalement Admin attend la confirmation.
    expect(mockRpc).toHaveBeenCalledWith(
      'fn_enregistrer_programmation',
      expect.objectContaining({
        p_evenement: expect.objectContaining({
          lieu_overrides: { ville: 'Lyon' },
        }),
        p_confirmer: false,
      }),
    );
    expect(mockRpc).not.toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.anything(),
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

  // Fuite fermée (revue sécurité #363, 2026-09-22) : la route tourne en
  // service_role, donc la RLS ne la borne pas — le SIRET de TOUS les traiteurs du
  // référentiel partait au gestionnaire et à l'agence, alors que §06.05 ne leur
  // laisse rien au-delà du nom (la liste déroulante §06.01 n'affiche que
  // `nom || raison_sociale`). Oracle sur la REQUÊTE : la liste du select et les
  // motifs de recherche prouvent ce qui est lu en base, pas la fixture.
  for (const role of ['gestionnaire_lieux', 'agence'] as const) {
    it(`M1.2 — GET traiteurs : ${role} ne reçoit pas le SIRET (§06.05)`, async () => {
      setupAuth(role, 'org-client-1');
      const { GET } =
        await import('@/app/api/v1/programmation/organisations/traiteurs/route.js');
      const res = await GET(
        makeReq(
          'GET',
          '/api/v1/programmation/organisations/traiteurs?q=dupond',
        ),
      );
      expect(res.status).toBe(200);
      const selectArg = String(
        mockSupabaseChain.select.mock.calls[0]?.[0] ?? '',
      );
      expect(selectArg).not.toContain('siret');
      expect(selectArg).toContain('nom');
      // Chercher par SIRET le confirmerait sans l'afficher.
      const orArg = String(mockSupabaseChain.or.mock.calls[0]?.[0] ?? '');
      expect(orArg).not.toContain('siret');
      expect(orArg).toContain('nom.ilike');
    });
  }

  it('M1.2 — GET traiteurs : le staff garde le SIRET (support)', async () => {
    setupAuth('admin_savr', 'org-savr');
    const { GET } =
      await import('@/app/api/v1/programmation/organisations/traiteurs/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/programmation/organisations/traiteurs?q=12345'),
    );
    expect(res.status).toBe(200);
    expect(String(mockSupabaseChain.select.mock.calls[0]?.[0] ?? '')).toContain(
      'siret',
    );
    expect(String(mockSupabaseChain.or.mock.calls[0]?.[0] ?? '')).toContain(
      'siret.ilike',
    );
  });
});

// ── PROG-04 : récap email programmeur + tarif ─────────────────────────────────
describe('M1.2 / PROG-04 récap programmation', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-04 récap programmation envoyé au programmeur avec tarif ZD', async () => {
    setupAuth('traiteur_commercial');
    // L'email relit les collectes de l'événement après leur création.
    routerTables([
      {
        id: 'collecte-zd-1',
        type: 'zero_dechet',
        date_collecte: '2097-01-15',
        heure_collecte: '08:00:00',
        pax: 80,
        created_at: '2097-01-01T10:00:00Z',
      },
    ]);
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // entité de facturation
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockRpc.mockResolvedValueOnce(enregistree('evt-1', 'collecte-zd-1'));

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
        nombre_collectes: '1 collecte',
        liste_collectes: expect.stringContaining('Collecte Zéro Déchet #1'),
      }),
      expect.anything(),
    );
    // Tarif calculé sur le pax de la collecte relue.
    expect(vi.mocked(calculer_tarif_zd)).toHaveBeenCalledWith(
      80,
      'org-traiteur-1',
      expect.any(Date),
      expect.anything(),
      'lieu-1',
    );
  });

  it('M1.2 — PROG-04 récap non envoyé si destinataire non résolu', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // entité de facturation
      .mockResolvedValueOnce({ data: null, error: null }); // users récap → pas d'email
    mockRpc.mockResolvedValueOnce(enregistree('evt-1', 'collecte-zd-1'));

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements', BODY_ZD),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(emailModule.sendEmail)).not.toHaveBeenCalled();
  });
});

// ── PROG-05 : auto-accept AG à la confirmation (type 'anti_gaspi') ────────────
describe('M1.2 / PROG-05 auto-accept AG', () => {
  beforeEach(resetChain);

  it('M1.2 — PROG-05 auto-accept AG déclenché à la confirmation', async () => {
    setupAuth('traiteur_commercial');
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { id: 'entite-1' }, error: null }) // entité de facturation
      .mockResolvedValueOnce({ data: { email: 'prog@x.fr' }, error: null }); // users récap
    mockRpc
      .mockResolvedValueOnce(enregistree('evt-ag-1', 'collecte-ag-1')) // fn_enregistrer_programmation
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
          {
            type: 'ag',
            date_collecte: '2097-01-15',
            heure_collecte: '08:00',
            pax: 80,
            ...CARTE,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith('rpc_evaluer_auto_accept_ag', {
      p_collecte_id: 'collecte-ag-1',
    });
  });

  it('M1.2 — PROG-05 confirmation d’un brouillon AG sans pack actif : 200 + auto-accept (type anti_gaspi)', async () => {
    // Les collectes viennent de la DB (type='anti_gaspi', jamais l'alias 'ag') :
    // l'auto-accept filtre sur cette valeur. Sans pack actif, rien ne bloque — la
    // collecte sera facturée à l'unité (décision Val 2026-10-16) : aucun pack lu.
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'evt-b',
        organisation_id: 'org-traiteur-1',
        nom_evenement: 'B',
        nom_client_organisateur: 'Entreprise Dupont',
        pax: 50,
        lieu_id: 'lieu-1',
        // Le commercial confirme SON propre brouillon (created_by = caller).
        created_by: 'user-1',
      },
      error: null,
    });
    const collectesData = [
      {
        id: 'c1',
        type: 'anti_gaspi',
        date_collecte: '2097-01-15',
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
    // Contact de secours complet (obligatoire, décision Val 2026-10-30).
    const contactsData = [
      {
        collecte_id: 'c1',
        contact_secours_nom: 'Sam Roux',
        contact_secours_telephone: '0733333333',
      },
    ];
    const contactsChain = {
      select: () => contactsChain,
      in: () => contactsChain,
      then: (
        resolve: (v: { data: typeof contactsData; error: null }) => void,
      ) => Promise.resolve({ data: contactsData, error: null }).then(resolve),
    };
    mockSupabaseChain.from.mockImplementation((table: string) =>
      table === 'collectes'
        ? collectesChain
        : table === 'collecte_contacts'
          ? contactsChain
          : mockSupabaseChain,
    );
    mockRpc
      .mockResolvedValueOnce({ data: null, error: null }) // fn_confirmer_programmation_brouillon
      .mockResolvedValueOnce({ data: { auto_accepted: false }, error: null }); // rpc_evaluer_auto_accept_ag

    const { PATCH } =
      await import('@/app/api/v1/programmation/evenements/[id]/confirmer/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/programmation/evenements/evt-b/confirmer'),
      { params: Promise.resolve({ id: 'evt-b' }) },
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('rpc_evaluer_auto_accept_ag', {
      p_collecte_id: 'c1',
    });
    expect(mockSupabaseChain.from).not.toHaveBeenCalledWith('packs_antgaspi');
  });

  it('M1.2 — PROG-04/05 ajout collecte AG à un événement existant déclenche auto-accept + récap', async () => {
    setupAuth('traiteur_commercial', 'org-traiteur-1');
    routerTables([
      {
        id: 'new-collecte-ag',
        type: 'anti_gaspi',
        date_collecte: '2097-02-01',
        heure_collecte: '10:00:00',
        pax: 80,
        created_at: '2097-01-01T10:00:00Z',
      },
    ]);
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
      .mockResolvedValueOnce({ data: 'new-collecte-ag', error: null }) // fn_creer_collecte_carte
      .mockResolvedValueOnce({ data: { auto_accepted: false }, error: null }); // rpc_evaluer_auto_accept_ag
    mockMaybeSingle.mockResolvedValueOnce({
      data: { email: 'prog@x.fr' },
      error: null,
    }); // users récap

    const { POST } =
      await import('@/app/api/v1/programmation/evenements/[id]/collectes/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/evenements/evt-1/collectes', {
        type: 'ag',
        date_collecte: '2097-02-01',
        heure_collecte: '10:00',
        pax: 80,
        ...CARTE,
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
      expect.objectContaining({
        tarif_ligne: expect.any(String),
        liste_collectes: expect.stringContaining('Collecte Anti-Gaspi #1'),
      }),
      expect.anything(),
    );
  });
});
