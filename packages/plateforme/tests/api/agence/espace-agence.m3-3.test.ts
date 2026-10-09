/**
 * M3.3 — Tests Vitest API : Espace client agence.
 * Couvre : auth guard agence, dashboard sans marge (diff #7), liste/fiche collecte
 * (traiteur opérationnel référentiel/shadow, diff #3), édition gate, annulation,
 * complétion SIRET shadow (RPC F2), factures lecture seule, création shadow
 * notification in-app sans email (F3).
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
    'in',
    'gte',
    'lte',
    'neq',
    'order',
    'limit',
    'ilike',
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
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

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
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role: string,
  organisationId = 'org-wpm',
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
function noAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

// Refus : rien n'est lu ni écrit par le client de service, aucun email ne part.
function rienNEstParti() {
  expect(admin.__calls.from ?? []).toEqual([]);
  expect(admin.__calls.rpc ?? []).toEqual([]);
  expect(mockSendEmail).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  rls = makeChain();
  admin = makeChain();
});

// ── Auth guard ──────────────────────────────────────────────────────────────
describe('M3.3 / auth guard', () => {
  it('M3.3/auth_guard_non_agence_403 — traiteur_manager bloqué', async () => {
    setupAuth('traiteur_manager');
    const { GET } = await import('@/app/api/v1/agence/collectes/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/collectes'));
    expect(res.status).toBe(403);
  });

  it('M3.3/auth_guard_non_authentifie_401 — pas de session', async () => {
    noAuth();
    const { GET } = await import('@/app/api/v1/agence/collectes/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/collectes'));
    expect(res.status).toBe(401);
  });
});

// ── Dashboard sans marge (diff #7) ──────────────────────────────────────────
describe('M3.3 / dashboard sans marge', () => {
  it('M3.3/dashboard_agence_4_cartes_zd_sans_marge — marge_zd_ht absent de la réponse', async () => {
    setupAuth('agence');
    rls.push({
      data: [
        {
          organisation_id: 'org-wpm',
          mois: '2026-06-01',
          type_collecte: 'zero_dechet',
          nb_collectes: 3,
          tonnage_kg: 120,
          taux_recyclage_pondere: 80,
          pax_total: 300,
          marge_zd_ht: 450,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/dashboards/kpi-traiteur?from=2026-06-01&to=2026-06-30&type=zero_dechet',
      ),
    );
    const json = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(json.data[0]).not.toHaveProperty('marge_zd_ht');
    expect(json.data[0]?.nb_collectes).toBe(3);
  });

  it('M3.3/dashboard_marge_conservee_pour_traiteur — marge_zd_ht présent (contrôle)', async () => {
    setupAuth('traiteur_manager');
    rls.push({
      data: [{ nb_collectes: 1, marge_zd_ht: 450 }],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/dashboards/kpi-traiteur/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/dashboards/kpi-traiteur?type=zero_dechet'),
    );
    const json = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(json.data[0]).toHaveProperty('marge_zd_ht', 450);
  });
});

// ── Liste / fiche collecte ──────────────────────────────────────────────────
describe('M3.3 / collectes', () => {
  it('M3.3/collectes_liste_perimetre_agence — eq type + retour liste', async () => {
    setupAuth('agence');
    rls.push({
      data: [{ id: 'c1', type: 'zero_dechet', statut: 'cloturee' }],
      error: null,
    });
    const { GET } = await import('@/app/api/v1/agence/collectes/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/agence/collectes?type=zero_dechet'),
    );
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data[0]?.id).toBe('c1');
    const eqCalls = rls.__calls.eq ?? [];
    expect(
      eqCalls.some(([col, val]) => col === 'type' && val === 'zero_dechet'),
    ).toBe(true);
  });

  it('M3.3/fiche_collecte_traiteur_operationnel_referentiel — nom résolu, est_shadow false', async () => {
    setupAuth('agence');
    // 1) collecte ; 2) rapports_rse ; 3) v_referentiel_traiteurs (trouvé)
    rls.push({
      data: {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'validee',
        evenement: { traiteur_operationnel_organisation_id: 'org-kaspia' },
      },
      error: null,
    });
    rls.push({ data: null, error: null }); // rapports_rse (documents lus sous la RLS de l'agence)
    rls.push({
      // v_referentiel_traiteurs rend UN libellé (20260922080000), pas 2 colonnes.
      data: { id: 'org-kaspia', nom: 'Kaspia' },
      error: null,
    });
    const { GET } = await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/collectes/c1'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    const json = (await res.json()) as {
      data: { traiteur_operationnel: { nom: string; est_shadow: boolean } };
    };
    expect(json.data.traiteur_operationnel.nom).toBe('Kaspia');
    expect(json.data.traiteur_operationnel.est_shadow).toBe(false);
  });

  it('M3.3/fiche_collecte_traiteur_shadow_badge — est_shadow true + siret', async () => {
    setupAuth('agence');
    // 1) collecte ; 2) rapports_rse ; 3) v_referentiel_traiteurs (absent) ; 4) organisations shadow
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        evenement: { traiteur_operationnel_organisation_id: 'org-shadow' },
      },
      error: null,
    });
    rls.push({ data: null, error: null }); // rapports_rse (documents lus sous la RLS de l'agence)
    rls.push({ data: null, error: null });
    rls.push({
      data: {
        id: 'org-shadow',
        nom: 'Maison Bertrand',
        raison_sociale: 'Maison Bertrand SARL',
        siret: null,
        est_shadow: true,
      },
      error: null,
    });
    const { GET } = await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/collectes/c1'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    const json = (await res.json()) as {
      data: { traiteur_operationnel: { est_shadow: boolean; siret: null } };
    };
    expect(json.data.traiteur_operationnel.est_shadow).toBe(true);
    expect(json.data.traiteur_operationnel.siret).toBeNull();
  });

  it('M3.3/edition_champs_verrouilles_422 — lieu_id rejeté', async () => {
    setupAuth('agence');
    const { PATCH } =
      await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/collectes/c1', { lieu_id: 'autre' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { champs_verrouilles: string[] };
    expect(json.champs_verrouilles).toContain('lieu_id');
  });

  // ── Édition : gardes de la route PATCH ────────────────────────────────────
  // L'agence (organisation « org-wpm ») envoie un champ réellement éditable.
  // Côté client de service, la file porte ce qu'il faut pour qu'une modification
  // aboutisse (état d'avant, RPC, relecture pour l'email, compte du
  // programmateur) : le témoin « sa propre programmation » va jusqu'à l'appel de
  // la RPC et de l'envoi d'email (faux `sendEmail` : l'appel est contrôlé, pas
  // la livraison) ; les refus ne lisent rien, n'écrivent rien, n'appellent pas
  // l'envoi.
  const LUE = {
    id: 'c1',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    date_collecte: '2030-01-01',
    heure_collecte: '10:00:00',
  };
  async function modifierLaDate(
    collecteLue: unknown,
    corpsEnPlus: Record<string, unknown> = {},
  ) {
    setupAuth('agence');
    rls.push({ data: collecteLue, error: null });
    admin.push({ data: LUE, error: null }); // état d'avant l'écriture
    admin.push({ data: { id: 'c1' }, error: null }); // fn_modifier_collecte
    admin.push({
      data: {
        ...LUE,
        date_collecte: '2030-02-01',
        evenement_id: 'e1',
        tms_reference: null,
        prestataire_logistique_id: null,
        attributions_antgaspi: null,
        evenement: {
          pax: 100,
          created_by: 'user-prog',
          lieu: { nom: 'Pavillon' },
          organisation: { nom: 'WPM' },
        },
      },
      error: null,
    }); // relecture pour l'email
    admin.push({
      data: { prenom: 'Julie', nom: 'Martin', telephone: null },
      error: null,
    }); // programmateur
    const { PATCH } =
      await import('@/app/api/v1/agence/collectes/[id]/route.js');
    return PATCH(
      makeReq('PATCH', '/api/v1/agence/collectes/c1', {
        date_collecte: '2030-02-01',
        ...corpsEnPlus,
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
  }

  const SIEN = { organisation_id: 'org-wpm' };
  it.each([
    ['programmée, événement en objet', { evenement: SIEN }],
    ['programmée, événement en tableau', { evenement: [SIEN] }],
    ['validée', { statut: 'validee', evenement: SIEN }],
  ])(
    'M3.3/edition_propre_programmation_200 — témoin : RPC et email (%s)',
    async (_cas, lue) => {
      const res = await modifierLaDate({ ...LUE, ...lue });
      expect(res.status).toBe(200);
      expect(admin.__calls.rpc).toEqual([
        [
          'fn_modifier_collecte',
          {
            p_id: 'c1',
            p_updates: { date_collecte: '2030-02-01' },
            p_champs_modifies: ['date_collecte'],
          },
        ],
      ]);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        'admin_modification_collecte_traiteur',
        'contact@gosavr.io',
        expect.objectContaining({ organisation_nom: 'WPM' }),
      );
    },
  );

  // Corps fabriqué : seuls les champs éditables atteignent la RPC, qui écrit
  // sous le client de service ce qu'on lui passe.
  it('M3.3/edition_corps_fabrique — seuls les champs éditables atteignent la RPC', async () => {
    const res = await modifierLaDate(
      { ...LUE, evenement: SIEN },
      { statut: 'cloturee', notes_internes: 'x', evenement_id: 'e-autre' },
    );
    expect(res.status).toBe(200);
    expect(admin.__calls.rpc).toEqual([
      [
        'fn_modifier_collecte',
        {
          p_id: 'c1',
          p_updates: { date_collecte: '2030-02-01' },
          p_champs_modifies: ['date_collecte'],
        },
      ],
    ]);
  });

  const AUTRE_ORG = { organisation_id: 'org-autre' };
  it.each([
    ['autre organisation, événement en objet', { evenement: AUTRE_ORG }],
    ['autre organisation, événement en tableau', { evenement: [AUTRE_ORG] }],
    ['événement non rendu par la lecture', { evenement: null }],
    ['événement en tableau vide', { evenement: [] }],
    [
      'collecte validée, autre organisation',
      { statut: 'validee', evenement: AUTRE_ORG },
    ],
  ])(
    'M3.3/edition_autre_organisation_403 — collecte lisible, hors de ses programmations (%s)',
    async (_cas, lue) => {
      const res = await modifierLaDate({ ...LUE, ...lue });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Modification non autorisée' });
      rienNEstParti();
    },
  );

  it('M3.3/edition_collecte_invisible_404 — la lecture sous RLS ne rend rien', async () => {
    const res = await modifierLaDate(null);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Collecte introuvable' });
    rienNEstParti();
  });

  it('M3.3/edition_refusee_hors_fenetre_422 — statut en_cours', async () => {
    const res = await modifierLaDate({
      ...LUE,
      statut: 'en_cours',
      statut_tms: 'acceptee',
      evenement: { organisation_id: 'org-wpm' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'Édition impossible au statut en_cours',
    });
    rienNEstParti();
  });
});

// ── Annulation ──────────────────────────────────────────────────────────────
describe('M3.3 / annulation', () => {
  const SIENNE = { organisation_id: 'org-wpm', organisation: { nom: 'WPM' } };
  it.each([
    ['événement en objet', SIENNE],
    ['événement en tableau', [SIENNE]],
  ])(
    'M3.3/annulation_directe_programmee — statut annulee (%s)',
    async (_cas, evenement) => {
      setupAuth('agence');
      rls.push({
        data: {
          id: 'c1',
          statut: 'programmee',
          statut_tms: 'non_envoye',
          date_collecte: '2030-01-01',
          evenement,
        },
        error: null,
      });
      admin.push({ data: { id: 'c1' }, error: null });
      const { POST } =
        await import('@/app/api/v1/agence/collectes/[id]/annulation/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/agence/collectes/c1/annulation', {
          motif: 'x',
        }),
        { params: Promise.resolve({ id: 'c1' }) },
      );
      const json = (await res.json()) as { data: { statut: string } };
      expect(json.data.statut).toBe('annulee');
      // Témoin des refus plus bas : sur sa propre programmation, l'annulation
      // appelle la RPC et l'envoi d'email (faux `sendEmail` : l'appel est
      // contrôlé, pas la livraison).
      expect(admin.__calls.rpc?.[0]).toEqual([
        'fn_modifier_collecte',
        {
          p_id: 'c1',
          p_updates: { statut: 'annulee', annulee_cote_savr_motif: 'x' },
          p_champs_modifies: ['statut'],
        },
      ]);
      expect(mockSendEmail).toHaveBeenCalledWith(
        'annulation_collecte',
        'contact@gosavr.io',
        expect.objectContaining({ organisation_nom: 'WPM' }),
      );
    },
  );

  it('M3.3/annulation_demande_validee — statut annulation_demandee', async () => {
    setupAuth('agence');
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        statut_tms: 'acceptee',
        date_collecte: '2030-01-01',
        evenement: { organisation_id: 'org-wpm', organisation: { nom: 'WPM' } },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null });
    const { POST } =
      await import('@/app/api/v1/agence/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/agence/collectes/c1/annulation', {}),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulation_demandee');
    expect(admin.__calls.rpc?.[0]).toEqual([
      'fn_modifier_collecte',
      {
        p_id: 'c1',
        p_updates: {
          statut: 'annulation_demandee',
          annulee_cote_savr_motif: '',
        },
        p_champs_modifies: ['statut'],
      },
    ]);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_annulation',
      'contact@gosavr.io',
      expect.objectContaining({ organisation_nom: 'WPM' }),
    );
  });

  const AUTRE = {
    organisation_id: 'org-autre',
    organisation: { nom: 'Autre' },
  };
  it.each([
    ['programmée, autre organisation, événement en objet', 'programmee', AUTRE],
    [
      'programmée, autre organisation, événement en tableau',
      'programmee',
      [AUTRE],
    ],
    ['programmée, événement non rendu par la lecture', 'programmee', null],
    ['programmée, événement en tableau vide', 'programmee', []],
    ['validée, autre organisation', 'validee', AUTRE],
    ['brouillon, autre organisation', 'brouillon', AUTRE],
  ])(
    'M3.3/annulation_autre_organisation_403 — collecte lisible, hors de ses programmations (%s)',
    async (_cas, statut, evenement) => {
      setupAuth('agence');
      rls.push({
        data: {
          id: 'c1',
          statut,
          statut_tms: 'non_envoye',
          date_collecte: '2030-01-01',
          evenement,
        },
        error: null,
      });
      admin.push({ data: { id: 'c1' }, error: null });
      const { POST } =
        await import('@/app/api/v1/agence/collectes/[id]/annulation/route.js');
      const res = await POST(
        makeReq('POST', '/api/v1/agence/collectes/c1/annulation', {
          motif: 'x',
        }),
        { params: Promise.resolve({ id: 'c1' }) },
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Annulation non autorisée' });
      rienNEstParti();
    },
  );
});

// ── Complétion SIRET shadow (F2) ────────────────────────────────────────────
describe('M3.3 / complétion SIRET shadow', () => {
  it('M3.3/siret_completion_appelle_rpc — RPC f_completer_siret_shadow', async () => {
    setupAuth('agence');
    rls.push({ data: null, error: null }); // rpc succès
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-shadow/siret', {
        siret: '83179309400017',
      }),
      { params: Promise.resolve({ id: 'org-shadow' }) },
    );
    expect(res.status).toBe(200);
    const rpcCalls = rls.__calls.rpc ?? [];
    expect(
      rpcCalls.some(
        ([fn, args]) =>
          fn === 'f_completer_siret_shadow' &&
          (args as { p_siret: string }).p_siret === '83179309400017',
      ),
    ).toBe(true);
  });

  it('M3.3/siret_format_invalide_422 — 13 chiffres rejeté avant RPC', async () => {
    setupAuth('agence');
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-shadow/siret', {
        siret: '8317930940001',
      }),
      { params: Promise.resolve({ id: 'org-shadow' }) },
    );
    expect(res.status).toBe(422);
    expect(rls.__calls.rpc ?? []).toHaveLength(0);
  });

  it('M3.3/siret_rpc_erreur_remontee_422 — garde RPC propagée', async () => {
    setupAuth('agence');
    // La RPC lève `RAISE EXCEPTION 'SIRET déjà renseigné' USING ERRCODE = '22023'`
    // (migration 20260617130000) : le code fait partie de l'erreur remontée.
    rls.push({
      data: null,
      error: { code: '22023', message: 'SIRET déjà renseigné' },
    });
    const { PATCH } =
      await import('@/app/api/v1/agence/shadow/[id]/siret/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/shadow/org-shadow/siret', {
        siret: '83179309400017',
      }),
      { params: Promise.resolve({ id: 'org-shadow' }) },
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('SIRET déjà renseigné');
  });
});

// ── Factures lecture seule ──────────────────────────────────────────────────
describe('M3.3 / factures', () => {
  it('M3.3/factures_lecture_seule_agence — exclut brouillons', async () => {
    setupAuth('agence');
    rls.push({ data: [{ id: 'f1', statut: 'emise' }], error: null });
    const { GET } = await import('@/app/api/v1/agence/factures/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/factures'));
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data[0]?.id).toBe('f1');
    const neqCalls = rls.__calls.neq ?? [];
    expect(
      neqCalls.some(([col, val]) => col === 'statut' && val === 'brouillon'),
    ).toBe(true);
  });
});

// ── Création shadow : notification in-app, aucun email (F3) ──────────────────
describe('M3.3 / création shadow F3', () => {
  it('M3.3/shadow_creation_in_app_aucun_email — alerte in-app, sendEmail non appelé', async () => {
    setupAuth('agence');
    admin.push({
      data: {
        id: 'org-shadow',
        nom: 'Maison Bertrand',
        raison_sociale: 'Maison Bertrand SARL',
        siret: null,
        est_shadow: true,
      },
      error: null,
    }); // insert .single()
    admin.push({ data: null, error: null }); // f_upsert_alerte_admin rpc
    const { POST } =
      await import('@/app/api/v1/programmation/organisations/shadow/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/organisations/shadow', {
        raison_sociale: 'Maison Bertrand SARL',
        nom_commercial: 'Maison Bertrand',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendEmail).not.toHaveBeenCalled();
    const rpcCalls = admin.__calls.rpc ?? [];
    expect(rpcCalls.some(([fn]) => fn === 'f_upsert_alerte_admin')).toBe(true);
  });

  it('M3.3/shadow_creation_role_non_agence_403 — gestionnaire bloqué', async () => {
    setupAuth('gestionnaire_lieux');
    const { POST } =
      await import('@/app/api/v1/programmation/organisations/shadow/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/programmation/organisations/shadow', {
        raison_sociale: 'X SARL',
        nom_commercial: 'X',
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── Renouvellement pack AG (BL-P1-AGENCE-01) ────────────────────────────────
// §06.11 l.36/l.44 : onglet AG identique au §06.04 → l'agence doit pouvoir
// demander un renouvellement (endpoint partagé /traiteur/pack-ag/renouvellement).
describe('M3.3 / renouvellement pack AG (BL-P1-AGENCE-01)', () => {
  it('M3.3/AGENCE01_renouvellement_role_agence_201 — agence autorisée + email admin', async () => {
    setupAuth('agence', 'org-wpm');
    admin.push({ data: { nom: 'WPM Agence' }, error: null }); // lookup organisations.nom
    const { POST } =
      await import('@/app/api/v1/traiteur/pack-ag/renouvellement/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/pack-ag/renouvellement', {
        pack_souhaite: 'Pack 20',
      }),
    );
    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'admin_demande_renouvellement_pack',
      expect.any(String),
      expect.objectContaining({ organisation_nom: 'WPM Agence' }),
    );
  });

  it('M3.3/AGENCE01_renouvellement_role_non_autorise_403 — client_organisateur bloqué, aucun email', async () => {
    setupAuth('client_organisateur', 'org-wpm');
    const { POST } =
      await import('@/app/api/v1/traiteur/pack-ag/renouvellement/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/traiteur/pack-ag/renouvellement', {}),
    );
    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
