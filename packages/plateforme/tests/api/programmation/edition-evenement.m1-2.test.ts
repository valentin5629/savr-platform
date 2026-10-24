/**
 * M1.2 — Édition des champs ÉVÉNEMENT + COLLECTE par TOUS les rôles programmateurs.
 * Décision produit Val 2026-06-26 (§06.04 l.444, §05 §4, §09).
 * Couvre : PATCH événement unifié (manager/commercial/agence/gestionnaire),
 * champs verrouillés (lieu_id), fenêtre f_collecte_editable, périmètre d'écriture
 * (commercial=créateur, cloisonnement org), édition collecte gestionnaire (route
 * ajoutée), refus champs système.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { _reinitialiserFreinEcritures } from '@/lib/frein-ecritures-client.js';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  // Tous les appels, dans l'ordre : prouve qu'un UPDATE est suivi de ses filtres.
  const ordre: [string, unknown[]][] = [];
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
    ordre.push([name, args]);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
    __ordre: ordre,
    push(r: Result) {
      queue.push(r);
      return chain;
    },
  };
  for (const m of [
    'from',
    'select',
    'eq',
    'is',
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'limit',
    'update',
    'insert',
  ]) {
    chain[m] = (...args: unknown[]) => {
      record(m, args);
      return chain;
    };
  }
  chain.maybeSingle = () => Promise.resolve(next());
  chain.single = () => Promise.resolve(next());
  chain.rpc = (...args: unknown[]) => {
    record('rpc', args);
    return Promise.resolve(next());
  };
  chain.then = (resolve: (r: Result) => unknown) => resolve(next());
  return chain as Record<string, unknown> & {
    push(r: Result): unknown;
    __calls: Record<string, unknown[][]>;
    __ordre: [string, unknown[]][];
  };
}

let rls = makeChain();
let admin = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => admin,
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role: string,
  organisationId = 'org-1',
  userId = 'user-1',
  extraClaims: Record<string, unknown> = {},
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
          ...extraClaims,
        }),
      },
    },
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

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
  // Ce fichier modifie le même événement plus de dix fois : chaque cas repart
  // d'un frein de débit vide (lib/frein-ecritures-client).
  _reinitialiserFreinEcritures();
});

// Contacts sur place d'une collecte avant l'écriture (`collecte_contacts`, lot
// B1, décision Val 2026-10-23) : les routes collecte des espaces clients les
// lisent à chaque modification (état « avant » de l'email et de l'audit).
const CONTACTS_AVANT = {
  contact_principal_nom: 'Paul Il',
  contact_principal_telephone: '0611111111',
  contact_secours_nom: null,
  contact_secours_telephone: null,
};

// Queue le chemin nominal d'un PATCH événement réussi.
function queueEventOk(
  evt: { organisation_id?: string; created_by?: string },
  editable = true,
  avant: Record<string, unknown> = {},
) {
  rls.push({
    data: { id: 'e1', organisation_id: 'org-1', created_by: 'user-1', ...evt },
    error: null,
  }); // maybeSingle event
  rls.push({ data: editable, error: null }); // rpc f_collecte_editable
  admin.push({ data: { id: 'e1', ...avant }, error: null }); // before select
  admin.push({ data: { id: 'e1', pax: 300 }, error: null }); // rpc fn_modifier_evenement
  admin.push({ data: null, error: null }); // audit insert
}

async function patchEvent(body: unknown) {
  const { PATCH } =
    await import('@/app/api/v1/programmation/evenements/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/programmation/evenements/e1', body), {
    params: Promise.resolve({ id: 'e1' }),
  });
}

// ── Édition ÉVÉNEMENT : les 4 rôles programmateurs ──────────────────────────
describe('M1.2 / édition événement — 4 rôles programmateurs', () => {
  const ROLES: Array<
    [string, { organisation_id?: string; created_by?: string }]
  > = [
    ['traiteur_manager', { organisation_id: 'org-1' }],
    ['traiteur_commercial', { created_by: 'user-1', organisation_id: 'org-1' }],
    ['agence', { organisation_id: 'org-1' }],
    ['gestionnaire_lieux', { organisation_id: 'org-1' }],
  ];

  // Titre cité par le manifeste M1.2, gardé tel quel. Depuis le lot B1
  // (décision Val 2026-10-23), le type d'événement et les contacts se modifient
  // sur chaque collecte et fn_modifier_evenement n'émet plus d'E2 (aucun champ
  // de l'événement ne part au prestataire) : ce cas prouve l'édition des champs
  // qui restent à l'événement, par les quatre rôles.
  for (const [role, evt] of ROLES) {
    it(`M1.2 — édition événement par ${role} : 200 + fn_modifier_evenement (E2 par collecte)`, async () => {
      setupAuth(role, 'org-1', 'user-1');
      queueEventOk(evt);
      const res = await patchEvent({
        nom_evenement: 'Gala 2031',
        nom_client_organisateur: 'Maison Client',
      });
      expect(res.status).toBe(200);
      const rpcCalls = admin.__calls.rpc ?? [];
      const call = rpcCalls.find(([fn]) => fn === 'fn_modifier_evenement');
      expect(call).toBeTruthy();
      const args = call![1] as {
        p_updates: Record<string, unknown>;
        p_champs_modifies: string[];
      };
      expect(args.p_champs_modifies).toContain('nom_evenement');
      expect(args.p_champs_modifies).toContain('nom_client_organisateur');
      expect(args.p_updates).toEqual({
        nom_evenement: 'Gala 2031',
        nom_client_organisateur: 'Maison Client',
      });
    });
  }
});

// ── Réponse du PATCH : jamais la ligne brute (arbitrage Val C1 2026-10-01) ───
// `fn_modifier_evenement` rend `to_jsonb(evenements)` : sans filtre, le client qui
// a programmé l'événement relisait `notes_internes` (notes Admin Savr) et
// `entite_facturation_id` par un simple PATCH sans effet — deux colonnes fermées à
// tous les rôles clients (migration 20261001103000).
describe('M1.2 / édition événement — réponse filtrée', () => {
  const LIGNE_BRUTE = {
    id: 'e1',
    organisation_id: 'org-1',
    traiteur_operationnel_organisation_id: 'org-1',
    client_organisateur_organisation_id: null,
    entite_facturation_id: 'ef-secrete',
    lieu_id: 'l1',
    created_by: 'user-1',
    nom_evenement: 'Gala',
    type_evenement_id: 't1',
    date_evenement: '2026-10-28',
    pax: 300,
    contact_principal_nom: 'Bob',
    contact_principal_telephone: '+33611111111',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    nom_client_organisateur: 'Maison Client',
    logo_client_organisateur_url: null,
    reference_affaire: 'AFF-1',
    notes_internes: 'NOTE ADMIN SECRÈTE',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };

  for (const role of ['traiteur_manager', 'agence', 'gestionnaire_lieux']) {
    it(`M1.2/edition_evenement_reponse_filtree — ${role} : ni notes internes ni entité de facturation dans la réponse`, async () => {
      setupAuth(role, 'org-1', 'user-1');
      rls.push({
        data: { id: 'e1', organisation_id: 'org-1', created_by: 'user-1' },
        error: null,
      }); // maybeSingle event
      rls.push({ data: true, error: null }); // rpc f_collecte_editable
      admin.push({ data: LIGNE_BRUTE, error: null }); // before select
      admin.push({ data: LIGNE_BRUTE, error: null }); // rpc fn_modifier_evenement
      admin.push({ data: null, error: null }); // audit insert

      const res = await patchEvent({ nom_evenement: 'Gala' });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: Record<string, unknown> };
      const texte = JSON.stringify(json);
      expect(texte).not.toContain('notes_internes');
      expect(texte).not.toContain('NOTE ADMIN SECRÈTE');
      expect(texte).not.toContain('entite_facturation_id');
      expect(texte).not.toContain('ef-secrete');
      // Liste blanche exacte : l'id et les champs éditables, rien d'autre. Le
      // type d'événement et les contacts n'en sont plus (lot B1, 2026-10-23) :
      // la copie qu'en garde l'événement n'est pas un champ qu'il modifie.
      expect(Object.keys(json.data).sort()).toEqual(
        [
          'id',
          'logo_client_organisateur_url',
          'nom_client_organisateur',
          'nom_evenement',
          'reference_affaire',
        ].sort(),
      );
      // Non-vacuité : la valeur éditée est bien rendue.
      expect(json.data.nom_evenement).toBe('Gala');
    });
  }
});

// ── §09 manager_update_dans_fenetre_edition_ok (révisé 2026-09-16) ──────────
// Depuis le REVOKE table-level sur `evenements` (20260915190000), l'UPDATE direct
// PostgREST lève 42501 : le succès ne passe plus QUE par la route. Moitié DB
// (fenêtre vue par le manager, fn_modifier_evenement sous service_role, direct
// refusé) : SECU__rls_09_ecriture_directe_revoke.test.sql B1-B5.
describe('§09 / manager_update_dans_fenetre_edition_ok', () => {
  it('manager_update_dans_fenetre_edition_ok — la route réussit et n’écrit JAMAIS par le client de session', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true);

    const res = await patchEvent({ reference_affaire: 'AFF-300' });

    expect(res.status).toBe(200);
    // La fenêtre est lue sous le JWT du manager…
    expect(rls.__calls.rpc?.map(([fn]) => fn)).toEqual(['f_collecte_editable']);
    // … mais aucune écriture ne part par la session : elle lèverait 42501.
    expect(rls.__calls.update).toBeUndefined();
    expect(rls.__calls.insert).toBeUndefined();
    // L'écriture passe par la RPC service_role.
    expect(admin.__calls.rpc?.map(([fn]) => fn)).toContain(
      'fn_modifier_evenement',
    );
  });
});

// ── §09 écriture `evenements` par la route (révision 2026-09-16) ────────────
// Depuis le REVOKE table-level (20260915190000), ces scénarios « 0 ligne affectée /
// réussit » ne s'expriment plus qu'à travers la route. Moitié DB — chaque valeur
// que ces mocks injectent (visibilité RLS, organisation_id/created_by lus,
// f_collecte_editable sur de vrais statuts, lookups service_role, audit_log) :
// SECU__rls_09_ecriture_par_route_predicats.test.sql C1-C9. Ici : le code HTTP, et
// qu'un refus n'écrit RIEN (ni RPC d'écriture, ni UPDATE/INSERT, ni audit).
function expectAucuneEcriture() {
  expect(admin.__calls.rpc).toBeUndefined();
  expect(admin.__calls.update).toBeUndefined();
  expect(admin.__calls.insert).toBeUndefined();
  expect(rls.__calls.update).toBeUndefined();
  expect(rls.__calls.insert).toBeUndefined();
}

async function patchEventAdmin(body: unknown) {
  const { PATCH } = await import('@/app/api/v1/admin/evenements/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/admin/evenements/e1', body), {
    params: Promise.resolve({ id: 'e1' }),
  });
}

// Une carte par collecte (refonte du formulaire, lot B2) : son type
// d'événement est vérifié dans le référentiel AVANT les gardes de périmètre —
// première lecture de la route, première réponse de la file.
const TYPE_EVT_CARTE = '11111111-1111-4111-8111-111111111111';
const TYPES_ACTIFS = { data: [{ id: TYPE_EVT_CARTE }], error: null };

const BODY_PROGRAMMATION = {
  lieu_id: 'lieu-1',
  controle_acces_requis: false,
  nom_evenement: 'Gala 2030',
  nom_client_organisateur: 'ACME',
  collectes: [
    {
      type: 'zd',
      date_collecte: '2030-01-15',
      heure_collecte: '08:00',
      pax: 80,
      type_evenement_id: TYPE_EVT_CARTE,
      contact_principal_nom: 'Alice',
      contact_principal_telephone: '+33611111111',
    },
  ],
  confirmer: true,
};

async function postProgrammation(body: unknown) {
  const { POST } =
    await import('@/app/api/v1/programmation/evenements/route.js');
  return POST(makeReq('POST', '/api/v1/programmation/evenements', body));
}

describe('§09 / écriture evenements par la route', () => {
  it('traiteur_operationnel_ne_peut_pas_modifier_programmation_tierce — 403, rien n’est écrit', async () => {
    // manager_kaspia VOIT l'événement de l'agence D (traiteur opérationnel, C1),
    // fenêtre ouverte (C1c) : seul organisation_id ≠ JWT le refuse (C1b).
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia');
    queueEventOk({ organisation_id: 'org-agence-d', created_by: 'agence-d' });

    const res = await patchEvent({ reference_affaire: 'AFF-300' });

    expect(res.status).toBe(403);
    // Refus AVANT la lecture de la fenêtre : aucune RPC, même de lecture.
    expect(rls.__calls.rpc).toBeUndefined();
    expectAucuneEcriture();
  });

  it('manager_update_hors_fenetre_denied — 422, rien n’est écrit', async () => {
    // f_collecte_editable = false sur collectes realisee + cloturee (C2b).
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia');
    queueEventOk({ organisation_id: 'org-kaspia' }, false);

    const res = await patchEvent({ reference_affaire: 'AFF-300' });

    expect(res.status).toBe(422);
    expect(rls.__calls.rpc?.map(([fn]) => fn)).toEqual(['f_collecte_editable']);
    expect(rls.__calls.rpc?.[0]?.[1]).toEqual({ p_evenement_id: 'e1' });
    expectAucuneEcriture();
  });

  it('agence_update_hors_fenetre_denied — 422, rien n’est écrit', async () => {
    // f_collecte_editable = false sur collectes toutes cloturee (C3b).
    setupAuth('agence', 'org-agence-d', 'agence-d');
    queueEventOk(
      { organisation_id: 'org-agence-d', created_by: 'agence-d' },
      false,
    );

    const res = await patchEvent({ reference_affaire: 'AFF-300' });

    expect(res.status).toBe(422);
    expect(rls.__calls.rpc?.map(([fn]) => fn)).toEqual(['f_collecte_editable']);
    expectAucuneEcriture();
  });

  it('admin_update_hors_fenetre_reste_possible — la route back-office écrit sans garde de fenêtre', async () => {
    // Même événement 100 % clôturé (C4 : f_collecte_editable = false) ; la route
    // /admin/evenements/[id] ne lit pas la fenêtre et écrit sous service_role (C4b).
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: { id: 'e1', pax: 180 }, error: null }); // rpc fn_modifier_evenement

    const res = await patchEventAdmin({ reference_affaire: 'AFF-180' });

    expect(res.status).toBe(200);
    expect(rls.__calls.rpc).toBeUndefined();
    expect(admin.__calls.rpc?.map(([fn]) => fn)).toEqual([
      'fn_modifier_evenement',
    ]);
    expect(admin.__calls.rpc?.[0]?.[1]).toMatchObject({
      p_id: 'e1',
      p_updates: { reference_affaire: 'AFF-180' },
    });
  });

  it('admin_update_hors_fenetre_reste_possible — la route client reste fermée au staff (403)', async () => {
    // Le forçage passe par le back-office, jamais par la route programmateur.
    setupAuth('admin_savr', 'org-savr', 'val');

    const res = await patchEvent({ reference_affaire: 'AFF-180' });

    expect(res.status).toBe(403);
    expectAucuneEcriture();
  });

  it('commercial_update_sa_collecte_dans_fenetre — 200, écriture par la RPC service_role', async () => {
    // created_by = self (C5), collecte validee → f_collecte_editable = true (C5b).
    setupAuth('traiteur_commercial', 'org-kaspia', 'commercial1');
    queueEventOk(
      { organisation_id: 'org-kaspia', created_by: 'commercial1' },
      true,
    );

    const res = await patchEvent({ reference_affaire: 'AFF-140' });

    expect(res.status).toBe(200);
    expect(rls.__calls.update).toBeUndefined();
    expect(rls.__calls.insert).toBeUndefined();
    expect(admin.__calls.rpc?.map(([fn]) => fn)).toEqual([
      'fn_modifier_evenement',
    ]);
  });

  it('commercial_update_collecte_d_un_collegue_refuse — 403 malgré la même organisation, rien n’est écrit', async () => {
    // Visible (lecture org-wide, C8), même organisation (C8d), fenêtre ouverte
    // (C8c) : seul created_by = commercial2 le refuse (C8b).
    setupAuth('traiteur_commercial', 'org-kaspia', 'commercial1');
    queueEventOk(
      { organisation_id: 'org-kaspia', created_by: 'commercial2' },
      true,
    );

    const res = await patchEvent({ reference_affaire: 'AFF-300' });

    expect(res.status).toBe(403);
    expect(rls.__calls.rpc).toBeUndefined();
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_lieu_hors_perimetre_refuse — 403, aucun INSERT', async () => {
    // organisations_lieux (gestionnaire × L4) → 0 ligne (C6).
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push(TYPES_ACTIFS); // référentiel des types (cartes)
    admin.push({ data: null, error: null }); // lookup organisations_lieux

    const res = await postProgrammation({
      ...BODY_PROGRAMMATION,
      lieu_id: 'lieu-L4',
      traiteur_operationnel_organisation_id: 'org-kaspia',
    });

    expect(res.status).toBe(403);
    expect(admin.__calls.from?.map(([t]) => t)).toEqual([
      'types_evenements',
      'organisations_lieux',
    ]);
    expect(admin.__calls.eq).toEqual([
      ['actif', true], // référentiel des types
      ['organisation_id', 'org-viparis'],
      ['lieu_id', 'lieu-L4'],
    ]);
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_traiteur_shadow_refuse — 403, aucun INSERT', async () => {
    // Lieu dans le parc (C6b), traiteur shadow → 0 ligne au lookup référentiel (C7).
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push(TYPES_ACTIFS); // référentiel des types (cartes)
    admin.push({ data: { id: 'ol-1' }, error: null }); // organisations_lieux
    admin.push({ data: null, error: null }); // organisations (référentiel)

    const res = await postProgrammation({
      ...BODY_PROGRAMMATION,
      traiteur_operationnel_organisation_id: 'org-shadow',
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /référentiel/,
    );
    expect(admin.__calls.from?.map(([t]) => t)).toEqual([
      'types_evenements',
      'organisations_lieux',
      'organisations',
    ]);
    // Le lookup porte le prédicat de evt_gestionnaire_insert (C7e) + actif
    // (après le filtre du référentiel des types et les deux du parc).
    expect(admin.__calls.eq?.slice(3)).toEqual([
      ['id', 'org-shadow'],
      ['actif', true],
      ['type', 'traiteur'],
      ['est_shadow', false],
    ]);
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_traiteur_shadow_refuse — sans traiteur opérant : 422, jamais l’organisation du gestionnaire', async () => {
    // Ancien défaut : traiteur_operationnel = organisation du gestionnaire (C7d).
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push(TYPES_ACTIFS); // référentiel des types (cartes)
    admin.push({ data: { id: 'ol-1' }, error: null }); // organisations_lieux

    const res = await postProgrammation(BODY_PROGRAMMATION);

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /traiteur_operationnel_organisation_id requis/,
    );
    // Refus avant le profil entreprise : le 422 n'est pas celui du SIRET.
    expect(admin.__calls.from?.map(([t]) => t)).toEqual([
      'types_evenements',
      'organisations_lieux',
    ]);
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_traiteur_shadow_refuse — contre-épreuve : traiteur référencé, la garde laisse passer', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push(TYPES_ACTIFS); // référentiel des types (cartes)
    admin.push({ data: { id: 'ol-1' }, error: null }); // organisations_lieux
    admin.push({ data: { id: 'org-kaspia' }, error: null }); // référentiel (C7c)

    const res = await postProgrammation({
      ...BODY_PROGRAMMATION,
      traiteur_operationnel_organisation_id: 'org-kaspia',
    });

    // La suite (profil entreprise, mocké vide) répond autre chose que le 403 traiteur.
    const json = (await res.json()) as { error?: string };
    expect(json.error ?? '').not.toMatch(/Traiteur opérationnel non autorisé/);
    expect(admin.__calls.from?.map(([t]) => t).slice(0, 4)).toEqual([
      'types_evenements',
      'organisations_lieux',
      'organisations',
      'entites_facturation',
    ]);
  });

  it('impersonation_journalisee — audit_log porte user_id = identité assumée ET impersonator_id = admin', async () => {
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia', {
      impersonator_id: 'val',
    });
    queueEventOk({ organisation_id: 'org-kaspia' }, true);

    const res = await patchEvent({ reference_affaire: 'AFF-160' });

    expect(res.status).toBe(200);
    const audit = (admin.__calls.insert ?? []).map(([row]) => row);
    expect(audit).toEqual([
      expect.objectContaining({
        table_name: 'evenements',
        record_id: 'e1',
        action: 'UPDATE',
        user_id: 'manager-kaspia',
        impersonator_id: 'val',
      }),
    ]);
  });

  it('impersonation_journalisee — hors impersonation, impersonator_id reste null', async () => {
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia');
    queueEventOk({ organisation_id: 'org-kaspia' }, true);

    const res = await patchEvent({ reference_affaire: 'AFF-160' });

    expect(res.status).toBe(200);
    const [row] = (admin.__calls.insert ?? []).map(([r]) => r);
    expect(row).toMatchObject({
      user_id: 'manager-kaspia',
      impersonator_id: null,
    });
  });

  it('impersonation_journalisee — la RLS du rôle impersoné s’applique : événement Kardamome invisible → 404', async () => {
    // Sous le JWT impersoné, la lecture RLS ne rend pas l'événement Kardamome (C9b).
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia', {
      impersonator_id: 'val',
    });
    rls.push({ data: null, error: null }); // maybeSingle : invisible

    const res = await patchEvent({ reference_affaire: 'AFF-160' });

    expect(res.status).toBe(404);
    expectAucuneEcriture();
  });
});

describe('M1.2 / édition événement — gardes', () => {
  it('M1.2 — édition événement champ verrouillé lieu_id → 422', async () => {
    setupAuth('traiteur_manager');
    const res = await patchEvent({ lieu_id: 'autre-lieu' });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles?: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M1.2 — édition événement hors fenêtre (f_collecte_editable=false) → 422', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, false);
    const res = await patchEvent({ reference_affaire: 'AFF-250' });
    expect(res.status).toBe(422);
  });

  it('M1.2 — édition événement commercial non-créateur → 403', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'paul');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-1', created_by: 'marie' },
      error: null,
    });
    const res = await patchEvent({ reference_affaire: 'AFF-250' });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition événement cloisonnement cross-org (autre org) → 403', async () => {
    setupAuth('agence', 'org-1', 'user-1');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-AUTRE', created_by: 'x' },
      error: null,
    });
    const res = await patchEvent({ reference_affaire: 'AFF-250' });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition événement aucun champ modifiable → 422', async () => {
    setupAuth('traiteur_manager');
    const res = await patchEvent({ statut: 'cloturee', co2_net_kg: 5 });
    expect(res.status).toBe(422);
  });
});

// ── Édition COLLECTE gestionnaire (route ajoutée) ────────────────────────────
async function patchGestionnaireCollecte(body: unknown) {
  const { PATCH } =
    await import('@/app/api/v1/gestionnaire/collectes/[id]/route.js');
  return PATCH(makeReq('PATCH', '/api/v1/gestionnaire/collectes/c1', body), {
    params: Promise.resolve({ id: 'c1' }),
  });
}

describe('M1.2 / édition collecte gestionnaire', () => {
  it('M1.2 — édition collecte gestionnaire : 200 + fn_modifier_collecte', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // (reacceptation update — date non modifiée ici, pas appelé) / audit
    admin.push({ data: null, error: null }); // audit insert
    const res = await patchGestionnaireCollecte({
      informations_supplementaires: 'Accès par la cour',
    });
    expect(res.status).toBe(200);
    const rpcCalls = admin.__calls.rpc ?? [];
    expect(rpcCalls.some(([fn]) => fn === 'fn_modifier_collecte')).toBe(true);
    // Audit_log écrit (§05 l.330) — assertion explicite (pas de mock complaisant).
    const fromCalls = admin.__calls.from ?? [];
    expect(fromCalls.some(([t]) => t === 'audit_log')).toBe(true);
  });

  it('M1.2 — édition collecte gestionnaire réacceptation prestataire (date + statut_tms=acceptee)', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null }); // before
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // update statut_tms (réacceptation)
    admin.push({ data: null, error: null }); // audit insert
    const res = await patchGestionnaireCollecte({
      date_collecte: '2031-01-15',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      flags: { reacceptation_requise: boolean };
    };
    expect(json.flags.reacceptation_requise).toBe(true);
    // fn_modifier_collecte reçoit statut='programmee' (la collecte n'est plus acceptée).
    const rpcCalls = admin.__calls.rpc ?? [];
    const modif = rpcCalls.find(([fn]) => fn === 'fn_modifier_collecte');
    expect(
      (modif![1] as { p_updates: { statut?: string } }).p_updates.statut,
    ).toBe('programmee');
    // statut_tms repassé en attente d'acceptation.
    const updateCalls = admin.__calls.update ?? [];
    expect(
      updateCalls.some(
        ([u]) =>
          (u as { statut_tms?: string }).statut_tms ===
          'attribuee_en_attente_acceptation',
      ),
    ).toBe(true);
  });

  it('M1.2 — édition collecte gestionnaire champ verrouillé lieu_id → 422', async () => {
    setupAuth('gestionnaire_lieux');
    const res = await patchGestionnaireCollecte({ lieu_id: 'autre' });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles?: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  it('M1.2 — édition collecte gestionnaire cloisonnement cross-org → 403', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-AUTRE' },
      },
      error: null,
    });
    const res = await patchGestionnaireCollecte({
      informations_supplementaires: 'x',
    });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition collecte gestionnaire hors fenêtre (en_cours) → 422', async () => {
    setupAuth('gestionnaire_lieux', 'org-1', 'user-1');
    rls.push({
      data: {
        id: 'c1',
        statut: 'en_cours',
        statut_tms: 'acceptee',
        date_collecte: '2030-12-31',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-1' },
      },
      error: null,
    });
    const res = await patchGestionnaireCollecte({
      informations_supplementaires: 'x',
    });
    expect(res.status).toBe(422);
  });
});

// ── BL-P1-TRAIT-04 — recompute informations_completes sur édition événement ──
// Depuis le lot B1 (décision Val 2026-10-23), le téléphone du contact n'est plus
// un champ que la route événement reçoit (422) : il est lu sur la ligne avant
// modification, copie de la collecte n°1 tenue par la base.
describe('M3.1 / cascade édition — recompute informations_completes (BL-P1-TRAIT-04)', () => {
  it('M3.1/recompute_infos_completes_true — contact + nom de l’événement renseignés → collectes.informations_completes=true', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true, {
      contact_principal_telephone: '+33611111111',
      nom_evenement: null,
    });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_evenement: 'Gala 2030' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    const recompute = updateCalls.find(
      ([u]) =>
        (u as { informations_completes?: boolean }).informations_completes !==
        undefined,
    );
    expect(recompute).toBeTruthy();
    expect(
      (recompute![0] as { informations_completes: boolean })
        .informations_completes,
    ).toBe(true);
    // Restreint aux collectes sans override lieu (.is('lieu_overrides', null)).
    const isCalls = admin.__calls.is ?? [];
    expect(isCalls.some(([col]) => col === 'lieu_overrides')).toBe(true);
  });

  // Décision Val 2026-10-19 : le nom de l'événement est obligatoire, le client
  // final facultatif ; seul le premier compte dans « Info incomplète ».
  // Contre-épreuve du cas précédent : le téléphone vient bien de la ligne avant
  // modification, il n'est pas supposé présent.
  it('M3.1/recompute_infos_completes_avant — nom de l’événement seul, téléphone lu sur la ligne avant modification : absent → false', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true, {
      contact_principal_telephone: null,
      nom_evenement: null,
      nom_client_organisateur: null,
    });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_evenement: 'Gala 2030' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    const recompute = updateCalls.find(
      ([u]) =>
        (u as { informations_completes?: boolean }).informations_completes !==
        undefined,
    );
    expect(
      (recompute![0] as { informations_completes: boolean })
        .informations_completes,
    ).toBe(false);
  });

  it('M3.1/recompute_infos_completes_false — nom de l’événement vidé → informations_completes=false', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true, {
      contact_principal_telephone: '+33611111111',
      nom_evenement: 'Gala 2030',
    });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_evenement: '' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    const recompute = updateCalls.find(
      ([u]) =>
        (u as { informations_completes?: boolean }).informations_completes !==
        undefined,
    );
    expect(
      (recompute![0] as { informations_completes: boolean })
        .informations_completes,
    ).toBe(false);
  });

  it('M3.1/recompute_infos_completes_espaces — nom de l’événement fait d’espaces → informations_completes=false', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true, {
      contact_principal_telephone: '+33611111111',
      nom_evenement: 'Gala 2030',
    });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_evenement: '   ' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    const recompute = updateCalls.find(
      ([u]) =>
        (u as { informations_completes?: boolean }).informations_completes !==
        undefined,
    );
    expect(
      (recompute![0] as { informations_completes: boolean })
        .informations_completes,
    ).toBe(false);
  });

  it('M3.1/recompute_borne_a_l_evenement — l’UPDATE du badge ne vise que les collectes de cet événement, sans surcharge de lieu', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' }, true, {
      contact_principal_telephone: '+33611111111',
    });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_evenement: 'Gala 2030' });
    expect(res.status).toBe(200);
    const ordre = admin.__ordre;
    const i = ordre.findIndex(
      ([m, args]) =>
        m === 'update' &&
        (args[0] as { informations_completes?: boolean })
          .informations_completes !== undefined,
    );
    expect(i).toBeGreaterThan(0);
    expect(ordre[i - 1]).toEqual(['from', ['collectes']]);
    expect(ordre[i + 1]).toEqual(['eq', ['evenement_id', 'e1']]);
    expect(ordre[i + 2]).toEqual(['is', ['lieu_overrides', null]]);
  });

  it('M3.1/recompute_absent_client_final_vide — client final vidé → pas de recompute (champ facultatif)', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });
    const res = await patchEvent({ nom_client_organisateur: '' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    expect(
      updateCalls.some(
        ([u]) =>
          (u as { informations_completes?: boolean }).informations_completes !==
          undefined,
      ),
    ).toBe(false);
  });

  it('M3.1/recompute_absent_si_champs_hors_completude — édition de la référence d’affaire seule → pas de recompute', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });
    const res = await patchEvent({ reference_affaire: 'AFF-250' });
    expect(res.status).toBe(200);
    const updateCalls = admin.__calls.update ?? [];
    expect(
      updateCalls.some(
        ([u]) =>
          (u as { informations_completes?: boolean }).informations_completes !==
          undefined,
      ),
    ).toBe(false);
  });
});

// ── C1 (arbitrage Val 2026-09-29) — notes internes = champ Admin (§04) ──────
describe('M3.1 / notes internes Admin — route événement programmateur', () => {
  it('M3.1/edition_evenement_notes_internes_ignorees — un programmateur ne peut plus écrire evenements.notes_internes', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });

    const res = await patchEvent({
      reference_affaire: 'AFF-300',
      notes_internes: 'écrasement',
    });

    expect(res.status).toBe(200);
    const modif = (admin.__calls.rpc ?? []).find(
      ([fn]) => fn === 'fn_modifier_evenement',
    );
    const updates = (modif?.[1] as { p_updates: Record<string, unknown> })
      .p_updates;
    expect(updates).toMatchObject({ reference_affaire: 'AFF-300' });
    expect(updates).not.toHaveProperty('notes_internes');
  });

  it('M3.1/edition_evenement_notes_internes_seules_422 — notes_internes seule : aucun champ modifiable', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });

    const res = await patchEvent({ notes_internes: 'écrasement' });

    expect(res.status).toBe(422);
    expect(admin.__calls.rpc).toBeUndefined();
  });
});

// ── Email à l'équipe Savr (§06.02 n°19) — enregistrement qui ne touche que
// l'événement : aucune requête collecte ne suit, l'email part d'ici. ─────────
describe('M3.1 / email équipe — modification de l’événement seul', () => {
  let recus: CapturedEmail[] = [];
  beforeEach(() => {
    recus = [];
    setEmailCaptureSink((email) => recus.push(email));
  });
  afterEach(() => setEmailCaptureSink(null));

  // PATCH { reference_affaire: 'AFF-1500' } réussi sur un événement dont la
  // référence était 'AFF-2000' (le pax est porté par la collecte depuis le
  // 2026-10-20 : il n'est plus un champ de l'événement). `collecte` : ce que
  // rend la recherche de la collecte nommée parmi celles de l'événement.
  function queueReferenceModifiee(collecte: { id: string } | null | undefined) {
    rls.push({
      data: { id: 'e1', organisation_id: 'org-1', created_by: 'user-1' },
      error: null,
    }); // maybeSingle event
    rls.push({ data: true, error: null }); // rpc f_collecte_editable
    admin.push({
      data: { id: 'e1', reference_affaire: 'AFF-2000' },
      error: null,
    }); // before select
    admin.push({
      data: { id: 'e1', reference_affaire: 'AFF-1500' },
      error: null,
    }); // rpc fn_modifier_evenement
    admin.push({ data: null, error: null }); // audit insert
    admin.push({ data: null, error: null }); // collecte représentative (tpl 21) : aucune
    if (collecte === undefined) return;
    admin.push({ data: collecte, error: null }); // collecte nommée ∈ événement ?
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        statut: 'validee',
        statut_tms: 'acceptee',
        tms_reference: null,
        prestataire_logistique_id: 'presta-1',
        date_collecte: '2099-01-14',
        heure_collecte: '16:45:00',
        attributions_antgaspi: null,
        pax: 2000,
        evenement: {
          created_by: 'user-1',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    }); // email : collecte après écriture
    admin.push({
      data: { prenom: 'Julie', nom: 'Martin', telephone: null },
      error: null,
    }); // email : programmateur
  }

  it('M3.1/email_modification_un_seul_email — événement seul, traiteur : un email, référence avant / après', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueReferenceModifiee({ id: 'c1' });
    const res = await patchEvent({
      reference_affaire: 'AFF-1500',
      collecte_id: 'c1',
    });
    expect(res.status).toBe(200);
    expect(recus).toHaveLength(1);
    // La collecte nommée n'est pas un champ de l'événement : elle n'atteint pas
    // la RPC.
    const rpc = (admin.__calls.rpc ?? []).find(
      ([fn]) => fn === 'fn_modifier_evenement',
    );
    expect((rpc![1] as { p_updates: unknown }).p_updates).toEqual({
      reference_affaire: 'AFF-1500',
    });
    expect(recus[0]!.slug).toBe('admin_modification_collecte_traiteur');
    expect(recus[0]!.variables).toEqual({
      organisation_nom: 'Kaspia',
      date_initiale: '14/01/2099',
      // Pax de la collecte (décision Val 2026-10-20).
      pax_initial: '2000',
      liste_modifications:
        "<ul><li>Référence d'affaire : avant AFF-2000. Maintenant AFF-1500</li></ul>",
      programmateur: 'Julie Martin',
      statut_collecte: 'Validée',
      priorite_urgence: 'false',
      lien_fiche: expect.stringMatching(/\/admin\/collectes\/c1$/),
    });
  });

  it('M3.1/email_modification_un_seul_email — collecte d’un autre événement : aucun email', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueReferenceModifiee(null);
    const res = await patchEvent({
      reference_affaire: 'AFF-1500',
      collecte_id: 'c-autre',
    });
    expect(res.status).toBe(200);
    expect(recus).toEqual([]);
    // La collecte nommée par la requête est cherchée PARMI celles de l'événement
    // modifié : le filtre sur l'événement suit immédiatement celui sur l'id.
    const filtres = admin.__calls.eq ?? [];
    const i = filtres.findIndex(([col, v]) => col === 'id' && v === 'c-autre');
    expect(filtres[i + 1]).toEqual(['evenement_id', 'e1']);
    // … et parmi les seules collectes encore modifiables.
    expect(admin.__calls.in).toContainEqual([
      'statut',
      ['programmee', 'validee'],
    ]);
  });

  it('M3.1/email_modification_un_seul_email — sans collecte nommée (la requête collecte suit) : aucun email ici', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueReferenceModifiee(undefined);
    const res = await patchEvent({ reference_affaire: 'AFF-1500' });
    expect(res.status).toBe(200);
    expect(recus).toEqual([]);
  });

  it('M3.1/email_modification_un_seul_email — la ligne d’audit écrite par la route événement est celle que relit la route collecte', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    // 1. Requête événement ; la requête collecte suit, donc aucune collecte nommée.
    queueReferenceModifiee(undefined);
    expect((await patchEvent({ reference_affaire: 'AFF-1500' })).status).toBe(
      200,
    );
    expect(recus).toEqual([]);
    const audit = (admin.__calls.insert ?? [])
      .map(([ligne]) => ligne as Record<string, unknown>)
      .find((ligne) => ligne.table_name === 'evenements');
    expect(audit).toBeTruthy();

    // 2. Requête collecte du même enregistrement : le journal d'audit lui rend
    //    la ligne écrite en 1, telle quelle.
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2099-01-15',
        heure_collecte: '16:45:00',
        evenement: { created_by: 'user-1', organisation_id: 'org-1' },
      },
      error: null,
    }); // collecte visible de l'utilisateur
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        date_collecte: '2099-01-15',
        heure_collecte: '16:45:00',
      },
      error: null,
    }); // before
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // audit insert
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        prestataire_logistique_id: null,
        date_collecte: '2099-01-14',
        heure_collecte: '16:45:00',
        attributions_antgaspi: null,
        pax: 2000,
        evenement: {
          created_by: 'user-1',
          organisation: { nom: 'Kaspia' },
        },
      },
      error: null,
    }); // email : collecte après écriture
    admin.push({ data: [audit], error: null }); // email : audit relu
    admin.push({
      data: { prenom: 'Julie', nom: 'Martin', telephone: null },
      error: null,
    }); // email : programmateur
    const { PATCH } =
      await import('@/app/api/v1/traiteur/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/traiteur/collectes/c1', {
        date_collecte: '2099-01-14',
        evenement_modifie: true,
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(res.status).toBe(200);
    expect(recus).toHaveLength(1);
    expect(recus[0]!.variables.liste_modifications).toBe(
      "<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Référence d'affaire : avant AFF-2000. Maintenant AFF-1500</li></ul>",
    );
    expect(recus[0]!.variables.pax_initial).toBe('2000');
  });

  // Arbitrage Val 2026-10-09 : agence et gestionnaire de lieux déclenchent le
  // même email que le traiteur.
  it.each(['agence', 'gestionnaire_lieux'])(
    'M3.1/email_modification_un_seul_email — événement seul, %s : le même email',
    async (role) => {
      setupAuth(role, 'org-1', 'user-1');
      queueReferenceModifiee({ id: 'c1' });
      const res = await patchEvent({
        reference_affaire: 'AFF-1500',
        collecte_id: 'c1',
      });
      expect(res.status).toBe(200);
      expect(recus).toHaveLength(1);
      expect(recus[0]!.variables.liste_modifications).toBe(
        "<ul><li>Référence d'affaire : avant AFF-2000. Maintenant AFF-1500</li></ul>",
      );
    },
  );

  // Collecte après écriture + programmateur, lus par l'email.
  function queueLecturesEmail(auditEvenement?: Record<string, unknown>) {
    admin.push({
      data: {
        id: 'c1',
        evenement_id: 'e1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        tms_reference: null,
        prestataire_logistique_id: null,
        date_collecte: '2099-01-14',
        heure_collecte: '16:45:00',
        attributions_antgaspi: null,
        pax: 2000,
        evenement: {
          created_by: 'user-1',
          lieu: { nom: 'Pavillon Gabriel' },
          organisation: { nom: 'Agence Lumière' },
        },
      },
      error: null,
    }); // email : collecte après écriture
    if (auditEvenement) admin.push({ data: [auditEvenement], error: null }); // email : audit relu
    admin.push({
      data: { prenom: 'Julie', nom: 'Martin', telephone: null },
      error: null,
    }); // email : programmateur
  }
  const COLLECTE_VISIBLE = {
    id: 'c1',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    date_collecte: '2099-01-15',
    heure_collecte: '16:45:00',
    evenement: { created_by: 'user-1', organisation_id: 'org-1' },
  };
  const AVANT = {
    id: 'c1',
    evenement_id: 'e1',
    date_collecte: '2099-01-15',
    heure_collecte: '16:45:00',
  };

  // Les deux routes relaient le signalement du formulaire ; seule celle du
  // gestionnaire écrit une ligne d'audit avant l'email.
  it.each([
    ['agence', 'agence', false],
    ['gestionnaire', 'gestionnaire_lieux', true],
  ] as const)(
    'M3.1/email_modification_un_seul_email — %s, référence et date du même enregistrement : un seul email, les deux champs',
    async (espace, role, ecritAudit) => {
      setupAuth(role, 'org-1', 'user-1');
      rls.push({ data: COLLECTE_VISIBLE, error: null }); // collecte visible
      admin.push({ data: AVANT, error: null }); // before
      admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
      admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
      if (ecritAudit) admin.push({ data: null, error: null }); // audit insert
      queueLecturesEmail({
        old_values: { reference_affaire: 'AFF-2000' },
        new_values: { updates: { reference_affaire: 'AFF-1500' } },
      });
      const { PATCH } =
        espace === 'agence'
          ? await import('@/app/api/v1/agence/collectes/[id]/route.js')
          : await import('@/app/api/v1/gestionnaire/collectes/[id]/route.js');
      const res = await PATCH(
        makeReq('PATCH', `/api/v1/${espace}/collectes/c1`, {
          date_collecte: '2099-01-14',
          evenement_modifie: true,
        }),
        { params: Promise.resolve({ id: 'c1' }) },
      );
      expect(res.status).toBe(200);
      expect(recus).toHaveLength(1);
      expect(recus[0]!.variables.liste_modifications).toBe(
        "<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Référence d'affaire : avant AFF-2000. Maintenant AFF-1500</li></ul>",
      );
      // Le signalement n'est pas un champ de la collecte : il n'atteint pas la RPC.
      const rpc = (admin.__calls.rpc ?? []).find(
        ([fn]) => fn === 'fn_modifier_collecte',
      );
      expect((rpc![1] as { p_updates: unknown }).p_updates).toEqual({
        date_collecte: '2099-01-14',
      });
    },
  );
});

// ── Lot B1 (décisions Val 2026-10-23) : type d'événement et contacts portés par
// chaque collecte. La route événement les refuse ; les routes collecte les
// acceptent, les valident, et l'email à l'équipe les compare au niveau de la
// collecte (« avant » lu dans `collecte_contacts`). ─────────────────────────────
describe('M1.2 / lot B1 — type d’événement et contacts : sur la collecte, refusés sur l’événement', () => {
  const CHAMPS_B1 = [
    'type_evenement_id',
    'contact_principal_nom',
    'contact_principal_telephone',
    'contact_secours_nom',
    'contact_secours_telephone',
  ];
  const TYPE_AVANT = '11111111-1111-4111-8111-111111111111';
  const TYPE_APRES = '22222222-2222-4222-8222-222222222222';

  let recus: CapturedEmail[] = [];
  beforeEach(() => {
    recus = [];
    setEmailCaptureSink((email) => recus.push(email));
  });
  afterEach(() => setEmailCaptureSink(null));

  it.each(CHAMPS_B1)(
    'M1.2/evenement_type_contacts_refuses — PATCH /programmation/evenements/[id] avec %s : 422 champs_verrouilles, rien n’est lu ni écrit',
    async (champ) => {
      setupAuth('traiteur_manager', 'org-1', 'user-1');
      // Piège : tout le chemin d'écriture réussirait s'il était parcouru.
      queueEventOk({ organisation_id: 'org-1' });
      const res = await patchEvent({
        nom_evenement: 'Gala 2031',
        [champ]: 'x',
      });
      expect(res.status).toBe(422);
      const json = (await res.json()) as { champs_verrouilles?: string[] };
      expect(json.champs_verrouilles).toEqual([champ]);
      // Refusé avant la lecture de l'événement : le nom, valide, n'est pas
      // écrit seul (refusé plutôt qu'ignoré).
      expect(rls.__calls.from).toBeUndefined();
      expectAucuneEcriture();
    },
  );

  // Ordre de lecture identique sur les trois routes collecte des espaces clients.
  const ROUTES_COLLECTE = [
    {
      espace: 'traiteur',
      role: 'traiteur_manager',
      ecritAudit: true,
      charger: () => import('@/app/api/v1/traiteur/collectes/[id]/route.js'),
    },
    {
      espace: 'agence',
      role: 'agence',
      ecritAudit: false,
      charger: () => import('@/app/api/v1/agence/collectes/[id]/route.js'),
    },
    {
      espace: 'gestionnaire',
      role: 'gestionnaire_lieux',
      ecritAudit: true,
      charger: () =>
        import('@/app/api/v1/gestionnaire/collectes/[id]/route.js'),
    },
  ] as const;
  const COLLECTE_VISIBLE = {
    id: 'c1',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    date_collecte: '2099-01-15',
    heure_collecte: '16:45:00',
    evenement: { created_by: 'user-1', organisation_id: 'org-1' },
  };
  const AVANT = {
    id: 'c1',
    evenement_id: 'e1',
    date_collecte: '2099-01-15',
    heure_collecte: '16:45:00',
    type_evenement_id: TYPE_AVANT,
  };
  const CONTACTS_AVANT_AVEC_SECOURS = {
    ...CONTACTS_AVANT,
    contact_secours_nom: 'Léa',
    contact_secours_telephone: '0655443322',
  };

  async function patchCollecteEspace(
    route: (typeof ROUTES_COLLECTE)[number],
    body: Record<string, unknown>,
  ) {
    const { PATCH } = await route.charger();
    return PATCH(
      makeReq('PATCH', `/api/v1/${route.espace}/collectes/c1`, body),
      { params: Promise.resolve({ id: 'c1' }) },
    );
  }

  it.each(ROUTES_COLLECTE)(
    'M1.2/collecte_type_contacts_modifiables — PATCH /$espace/collectes/[id] : type et contacts passent à fn_modifier_collecte, normalisés, et l’email compare ceux de la collecte',
    async (route) => {
      setupAuth(route.role, 'org-1', 'user-1');
      admin.push({ data: { id: TYPE_APRES }, error: null }); // type d'événement connu ?
      rls.push({ data: COLLECTE_VISIBLE, error: null }); // collecte visible
      admin.push({ data: AVANT, error: null }); // before
      admin.push({ data: CONTACTS_AVANT_AVEC_SECOURS, error: null }); // contacts de la collecte (avant)
      admin.push({ data: { id: 'c1' }, error: null }); // rpc fn_modifier_collecte
      if (route.ecritAudit) admin.push({ data: null, error: null }); // audit insert
      admin.push({
        data: {
          id: 'c1',
          evenement_id: 'e1',
          statut: 'programmee',
          statut_tms: 'non_envoye',
          tms_reference: null,
          prestataire_logistique_id: null,
          date_collecte: '2099-01-15',
          heure_collecte: '16:45:00',
          attributions_antgaspi: null,
          pax: 200,
          evenement: {
            created_by: 'user-1',
            organisation: { nom: 'Kaspia' },
          },
        },
        error: null,
      }); // email : collecte après écriture
      admin.push({
        data: [
          { id: TYPE_AVANT, libelle: 'Cocktail apéritif' },
          { id: TYPE_APRES, libelle: 'Dîner assis' },
        ],
        error: null,
      }); // email : libellés des types d'événement
      admin.push({
        data: { prenom: 'Julie', nom: 'Martin', telephone: null },
        error: null,
      }); // email : programmateur

      const res = await patchCollecteEspace(route, {
        type_evenement_id: TYPE_APRES,
        contact_principal_nom: '  Arthus  ',
        contact_principal_telephone: '0699990002',
        // Secours vidé : `''` comme blancs valent « absent » (null).
        contact_secours_nom: '',
        contact_secours_telephone: '   ',
      });

      expect(res.status).toBe(200);
      // Le type est vérifié dans le référentiel avant toute lecture de la collecte.
      expect(admin.__ordre[0]).toEqual(['from', ['types_evenements']]);
      expect(admin.__calls.eq?.[0]).toEqual(['id', TYPE_APRES]);
      // Les contacts « avant » sont ceux de CETTE collecte.
      expect(admin.__calls.from).toContainEqual(['collecte_contacts']);
      expect(admin.__calls.eq).toContainEqual(['collecte_id', 'c1']);
      const rpc = (admin.__calls.rpc ?? []).find(
        ([fn]) => fn === 'fn_modifier_collecte',
      );
      expect((rpc![1] as { p_updates: unknown }).p_updates).toEqual({
        type_evenement_id: TYPE_APRES,
        contact_principal_nom: 'Arthus',
        contact_principal_telephone: '0699990002',
        contact_secours_nom: null,
        contact_secours_telephone: null,
      });
      // Aucune écriture sur l'événement.
      expect(admin.__calls.rpc?.map(([fn]) => fn)).toEqual([
        'fn_modifier_collecte',
      ]);
      if (route.ecritAudit) {
        const audit = (admin.__calls.insert ?? [])
          .map(([ligne]) => ligne as Record<string, unknown>)
          .find((ligne) => ligne.table_name === 'collectes');
        // L'état « avant » de l'audit porte les contacts de la collecte.
        expect(audit?.old_values).toMatchObject(CONTACTS_AVANT_AVEC_SECOURS);
      }
      expect(recus).toHaveLength(1);
      expect(recus[0]!.variables.liste_modifications).toBe(
        "<ul><li>Contact : avant Paul Il (0611111111). Maintenant Arthus (0699990002)</li><li>Contact de secours : avant Léa (0655443322). Maintenant non renseigné</li><li>Type d'événement : avant Cocktail apéritif. Maintenant Dîner assis</li></ul>",
      );
    },
  );

  it.each(ROUTES_COLLECTE)(
    'M1.2/collecte_contacts_avant_illisibles_500 — PATCH /$espace/collectes/[id] : lecture des contacts en échec → 500, rien n’est écrit ni envoyé',
    async (route) => {
      setupAuth(route.role, 'org-1', 'user-1');
      rls.push({ data: COLLECTE_VISIBLE, error: null }); // collecte visible
      admin.push({ data: AVANT, error: null }); // before
      admin.push({ data: null, error: { message: 'boom' } }); // contacts : échec
      const res = await patchCollecteEspace(route, {
        contact_principal_telephone: '0699990002',
      });
      expect(res.status).toBe(500);
      expect(admin.__calls.rpc).toBeUndefined();
      expect(admin.__calls.insert).toBeUndefined();
      expect(recus).toEqual([]);
    },
  );

  it.each(ROUTES_COLLECTE)(
    'M1.2/collecte_type_evenement_inconnu — PATCH /$espace/collectes/[id], type absent du référentiel : 422, la collecte n’est ni lue ni écrite',
    async (route) => {
      setupAuth(route.role, 'org-1', 'user-1');
      admin.push({ data: null, error: null }); // type d'événement : inconnu
      const res = await patchCollecteEspace(route, {
        type_evenement_id: TYPE_APRES,
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { champ?: string }).champ).toBe(
        'type_evenement_id',
      );
      expect(rls.__calls.from).toBeUndefined();
      expect(admin.__calls.from).toEqual([['types_evenements']]);
      expect(admin.__calls.rpc).toBeUndefined();
    },
  );

  it('M1.2/collecte_type_evenement_invalide — identifiant mal formé ou vidé : 422 sans interroger le référentiel', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    for (const valeur of ['type-1', null, '']) {
      admin = makeChain();
      const res = await patchCollecteEspace(ROUTES_COLLECTE[0], {
        type_evenement_id: valeur,
      });
      expect(res.status).toBe(422);
      expect(admin.__calls.from).toBeUndefined();
      expect(admin.__calls.rpc).toBeUndefined();
    }
  });

  it('M1.2/collecte_type_evenement_lecture_500 — lecture du référentiel en échec : 500, rien n’est écrit', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    admin.push({ data: null, error: { message: 'boom' } }); // référentiel : échec
    const res = await patchCollecteEspace(ROUTES_COLLECTE[0], {
      type_evenement_id: TYPE_APRES,
    });
    expect(res.status).toBe(500);
    expect(admin.__calls.rpc).toBeUndefined();
  });

  // Back-office : l'équipe Savr modifie type et contacts sans motif (B1-Q3) ;
  // les contacts « avant » ne sont lus que si l'un d'eux est envoyé.
  async function patchCollecteAdmin(body: Record<string, unknown>) {
    const { PATCH } =
      await import('@/app/api/v1/admin/collectes/[id]/route.js');
    return PATCH(makeReq('PATCH', '/api/v1/admin/collectes/c1', body), {
      params: Promise.resolve({ id: 'c1' }),
    });
  }

  it('M1.2/admin_collecte_contacts_sans_motif — PATCH /admin/collectes/[id] : contact modifié sans motif, « avant » de l’audit lu dans collecte_contacts', async () => {
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: { id: 'c1', statut: 'programmee' }, error: null }); // before
    admin.push({ data: CONTACTS_AVANT, error: null }); // contacts de la collecte (avant)
    admin.push({ data: { id: 'c1', statut: 'programmee' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // audit insert

    const res = await patchCollecteAdmin({
      contact_principal_telephone: '  0699990003  ',
    });

    expect(res.status).toBe(200);
    const rpc = (admin.__calls.rpc ?? []).find(
      ([fn]) => fn === 'fn_modifier_collecte',
    );
    expect((rpc![1] as { p_updates: unknown }).p_updates).toEqual({
      contact_principal_telephone: '0699990003',
    });
    expect(admin.__calls.eq).toContainEqual(['collecte_id', 'c1']);
    const [audit] = (admin.__calls.insert ?? []).map(
      ([ligne]) => ligne as Record<string, unknown>,
    );
    expect(audit).toMatchObject({
      table_name: 'collectes',
      action: 'UPDATE',
      old_values: expect.objectContaining(CONTACTS_AVANT),
      // Les contacts ne sont pas dans la ligne rendue par la RPC : la ligne
      // d'audit porte à part la nouvelle valeur.
      new_values: expect.objectContaining({
        contact_principal_telephone: '0699990003',
      }),
    });
    expect(audit).not.toHaveProperty('motif');
  });

  it('M1.2/admin_collecte_type_evenement_inconnu — PATCH /admin/collectes/[id], type absent du référentiel : 422, rien n’est lu ni écrit', async () => {
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: null, error: null }); // type d'événement : inconnu
    const res = await patchCollecteAdmin({ type_evenement_id: TYPE_APRES });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { champ?: string }).champ).toBe(
      'type_evenement_id',
    );
    expect(admin.__calls.from).toEqual([['types_evenements']]);
    expect(admin.__calls.rpc).toBeUndefined();
    expect(admin.__calls.insert).toBeUndefined();
  });

  it('M1.2/admin_collecte_contact_principal_vide — PATCH /admin/collectes/[id], contact principal vidé : 422, rien n’est écrit', async () => {
    setupAuth('admin_savr', 'org-savr', 'val');
    const res = await patchCollecteAdmin({ contact_principal_nom: '   ' });
    expect(res.status).toBe(422);
    expect(admin.__calls.rpc).toBeUndefined();
    expect(admin.__calls.insert).toBeUndefined();
  });

  it('M1.2/admin_collecte_contacts_non_lus — PATCH /admin/collectes/[id] sans type ni contact : collecte_contacts n’est pas lue', async () => {
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: { id: 'c1', statut: 'programmee' }, error: null }); // before
    admin.push({ data: { id: 'c1', statut: 'programmee' }, error: null }); // rpc fn_modifier_collecte
    admin.push({ data: null, error: null }); // audit insert

    const res = await patchCollecteAdmin({
      informations_supplementaires: 'Quai B',
    });

    expect(res.status).toBe(200);
    expect(admin.__calls.from).not.toContainEqual(['collecte_contacts']);
    expect(admin.__calls.from).not.toContainEqual(['types_evenements']);
  });

  it('M1.2/admin_collecte_contacts_illisibles_500 — PATCH /admin/collectes/[id] : lecture des contacts en échec → 500, rien n’est écrit', async () => {
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: { id: 'c1', statut: 'programmee' }, error: null }); // before
    admin.push({ data: null, error: { message: 'boom' } }); // contacts : échec

    const res = await patchCollecteAdmin({ contact_secours_nom: 'Léa' });

    expect(res.status).toBe(500);
    expect(admin.__calls.rpc).toBeUndefined();
    expect(admin.__calls.insert).toBeUndefined();
  });
});
