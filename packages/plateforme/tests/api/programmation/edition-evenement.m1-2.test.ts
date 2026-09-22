/**
 * M1.2 — Édition des champs ÉVÉNEMENT + COLLECTE par TOUS les rôles programmateurs.
 * Décision produit Val 2026-06-26 (§06.04 l.444, §05 §4, §09).
 * Couvre : PATCH événement unifié (manager/commercial/agence/gestionnaire),
 * champs verrouillés (lieu_id), fenêtre f_collecte_editable, périmètre d'écriture
 * (commercial=créateur, cloisonnement org), édition collecte gestionnaire (route
 * ajoutée), refus champs système.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Result = { data: unknown; error: unknown };

function makeChain() {
  const queue: Result[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const next = (): Result => queue.shift() ?? { data: null, error: null };

  const chain: Record<string, unknown> = {
    __queue: queue,
    __calls: calls,
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
});

// Queue le chemin nominal d'un PATCH événement réussi.
function queueEventOk(
  evt: { organisation_id?: string; created_by?: string },
  editable = true,
) {
  rls.push({
    data: { id: 'e1', organisation_id: 'org-1', created_by: 'user-1', ...evt },
    error: null,
  }); // maybeSingle event
  rls.push({ data: editable, error: null }); // rpc f_collecte_editable
  admin.push({ data: { id: 'e1' }, error: null }); // before select
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

  for (const [role, evt] of ROLES) {
    it(`M1.2 — édition événement par ${role} : 200 + fn_modifier_evenement (E2 par collecte)`, async () => {
      setupAuth(role, 'org-1', 'user-1');
      queueEventOk(evt);
      const res = await patchEvent({
        contact_principal_nom: 'Bob',
        contact_principal_telephone: '+33611111111',
        pax: 300,
      });
      expect(res.status).toBe(200);
      const rpcCalls = admin.__calls.rpc ?? [];
      const call = rpcCalls.find(([fn]) => fn === 'fn_modifier_evenement');
      expect(call).toBeTruthy();
      const args = call![1] as { p_champs_modifies: string[] };
      expect(args.p_champs_modifies).toContain('pax');
      expect(args.p_champs_modifies).toContain('contact_principal_nom');
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

    const res = await patchEvent({ pax: 300 });

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

const BODY_PROGRAMMATION = {
  pax: 120,
  type_evenement_id: 'type-1',
  lieu_id: 'lieu-1',
  controle_acces_requis: false,
  contact_principal_nom: 'Alice',
  contact_principal_telephone: '+33611111111',
  nom_client_organisateur: 'ACME',
  collectes: [
    { type: 'zd', date_collecte: '2030-01-15', heure_collecte: '08:00' },
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

    const res = await patchEvent({ pax: 300 });

    expect(res.status).toBe(403);
    // Refus AVANT la lecture de la fenêtre : aucune RPC, même de lecture.
    expect(rls.__calls.rpc).toBeUndefined();
    expectAucuneEcriture();
  });

  it('manager_update_hors_fenetre_denied — 422, rien n’est écrit', async () => {
    // f_collecte_editable = false sur collectes realisee + cloturee (C2b).
    setupAuth('traiteur_manager', 'org-kaspia', 'manager-kaspia');
    queueEventOk({ organisation_id: 'org-kaspia' }, false);

    const res = await patchEvent({ pax: 300 });

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

    const res = await patchEvent({ pax: 300 });

    expect(res.status).toBe(422);
    expect(rls.__calls.rpc?.map(([fn]) => fn)).toEqual(['f_collecte_editable']);
    expectAucuneEcriture();
  });

  it('admin_update_hors_fenetre_reste_possible — la route back-office écrit sans garde de fenêtre', async () => {
    // Même événement 100 % clôturé (C4 : f_collecte_editable = false) ; la route
    // /admin/evenements/[id] ne lit pas la fenêtre et écrit sous service_role (C4b).
    setupAuth('admin_savr', 'org-savr', 'val');
    admin.push({ data: { id: 'e1', pax: 180 }, error: null }); // rpc fn_modifier_evenement

    const res = await patchEventAdmin({ pax: 180 });

    expect(res.status).toBe(200);
    expect(rls.__calls.rpc).toBeUndefined();
    expect(admin.__calls.rpc?.map(([fn]) => fn)).toEqual([
      'fn_modifier_evenement',
    ]);
    expect(admin.__calls.rpc?.[0]?.[1]).toMatchObject({
      p_id: 'e1',
      p_updates: { pax: 180 },
    });
  });

  it('admin_update_hors_fenetre_reste_possible — la route client reste fermée au staff (403)', async () => {
    // Le forçage passe par le back-office, jamais par la route programmateur.
    setupAuth('admin_savr', 'org-savr', 'val');

    const res = await patchEvent({ pax: 180 });

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

    const res = await patchEvent({ pax: 140 });

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

    const res = await patchEvent({ pax: 300 });

    expect(res.status).toBe(403);
    expect(rls.__calls.rpc).toBeUndefined();
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_lieu_hors_perimetre_refuse — 403, aucun INSERT', async () => {
    // organisations_lieux (gestionnaire × L4) → 0 ligne (C6).
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push({ data: null, error: null }); // lookup organisations_lieux

    const res = await postProgrammation({
      ...BODY_PROGRAMMATION,
      lieu_id: 'lieu-L4',
      traiteur_operationnel_organisation_id: 'org-kaspia',
    });

    expect(res.status).toBe(403);
    expect(admin.__calls.from?.map(([t]) => t)).toEqual([
      'organisations_lieux',
    ]);
    expect(admin.__calls.eq).toEqual([
      ['organisation_id', 'org-viparis'],
      ['lieu_id', 'lieu-L4'],
    ]);
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_traiteur_shadow_refuse — 403, aucun INSERT', async () => {
    // Lieu dans le parc (C6b), traiteur shadow → 0 ligne au lookup référentiel (C7).
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
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
      'organisations_lieux',
      'organisations',
    ]);
    // Le lookup porte le prédicat de evt_gestionnaire_insert (C7e) + actif.
    expect(admin.__calls.eq?.slice(2)).toEqual([
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
    admin.push({ data: { id: 'ol-1' }, error: null }); // organisations_lieux

    const res = await postProgrammation(BODY_PROGRAMMATION);

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /traiteur_operationnel_organisation_id requis/,
    );
    // Refus avant le profil entreprise : le 422 n'est pas celui du SIRET.
    expect(admin.__calls.from?.map(([t]) => t)).toEqual([
      'organisations_lieux',
    ]);
    expectAucuneEcriture();
  });

  it('gestionnaire_insert_evenement_traiteur_shadow_refuse — contre-épreuve : traiteur référencé, la garde laisse passer', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis', 'gest-viparis');
    admin.push({ data: { id: 'ol-1' }, error: null }); // organisations_lieux
    admin.push({ data: { id: 'org-kaspia' }, error: null }); // référentiel (C7c)

    const res = await postProgrammation({
      ...BODY_PROGRAMMATION,
      traiteur_operationnel_organisation_id: 'org-kaspia',
    });

    // La suite (profil entreprise, mocké vide) répond autre chose que le 403 traiteur.
    const json = (await res.json()) as { error?: string };
    expect(json.error ?? '').not.toMatch(/Traiteur opérationnel non autorisé/);
    expect(admin.__calls.from?.map(([t]) => t).slice(0, 3)).toEqual([
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

    const res = await patchEvent({ pax: 160 });

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

    const res = await patchEvent({ pax: 160 });

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

    const res = await patchEvent({ pax: 160 });

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
    const res = await patchEvent({ pax: 250 });
    expect(res.status).toBe(422);
  });

  it('M1.2 — édition événement commercial non-créateur → 403', async () => {
    setupAuth('traiteur_commercial', 'org-1', 'paul');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-1', created_by: 'marie' },
      error: null,
    });
    const res = await patchEvent({ pax: 250 });
    expect(res.status).toBe(403);
  });

  it('M1.2 — édition événement cloisonnement cross-org (autre org) → 403', async () => {
    setupAuth('agence', 'org-1', 'user-1');
    rls.push({
      data: { id: 'e1', organisation_id: 'org-AUTRE', created_by: 'x' },
      error: null,
    });
    const res = await patchEvent({ pax: 250 });
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
    const res = await patchGestionnaireCollecte({ notes_internes: 'x' });
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
    const res = await patchGestionnaireCollecte({ notes_internes: 'x' });
    expect(res.status).toBe(422);
  });
});

// ── BL-P1-TRAIT-04 — recompute informations_completes sur édition événement ──
describe('M3.1 / cascade édition — recompute informations_completes (BL-P1-TRAIT-04)', () => {
  it('M3.1/recompute_infos_completes_true — contact + client renseignés → collectes.informations_completes=true', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({
      contact_principal_telephone: '+33611111111',
      nom_client_organisateur: 'ACME',
    });
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

  it('M3.1/recompute_infos_completes_false — client final vidé → informations_completes=false', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });
    admin.push({ data: null, error: null }); // recompute update collectes
    const res = await patchEvent({ nom_client_organisateur: '' });
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

  it('M3.1/recompute_absent_si_champs_hors_completude — édition pax seule → pas de recompute', async () => {
    setupAuth('traiteur_manager', 'org-1', 'user-1');
    queueEventOk({ organisation_id: 'org-1' });
    const res = await patchEvent({ pax: 250 });
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
