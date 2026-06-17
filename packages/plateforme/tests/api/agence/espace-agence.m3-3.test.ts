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
        access_token: makeJwt({ role, organisation_id: organisationId }),
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
    // 1) collecte ; 2) v_referentiel_traiteurs (trouvé)
    rls.push({
      data: {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'validee',
        evenement: { traiteur_operationnel_organisation_id: 'org-kaspia' },
      },
      error: null,
    });
    rls.push({
      data: { id: 'org-kaspia', nom: 'Kaspia', raison_sociale: 'Kaspia SARL' },
      error: null,
    });
    const { GET } = await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await GET(makeReq('GET', '/api/v1/agence/collectes/c1'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    const json = (await res.json()) as {
      data: { traiteur_operationnel: { nom: string; est_shadow: boolean } };
    };
    expect(json.data.traiteur_operationnel.nom).toBe('Kaspia SARL');
    expect(json.data.traiteur_operationnel.est_shadow).toBe(false);
  });

  it('M3.3/fiche_collecte_traiteur_shadow_badge — est_shadow true + siret', async () => {
    setupAuth('agence');
    // 1) collecte ; 2) v_referentiel_traiteurs (absent) ; 3) organisations shadow
    rls.push({
      data: {
        id: 'c1',
        statut: 'validee',
        evenement: { traiteur_operationnel_organisation_id: 'org-shadow' },
      },
      error: null,
    });
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

  it('M3.3/edition_refusee_hors_fenetre_422 — statut en_cours', async () => {
    setupAuth('agence');
    rls.push({
      data: {
        id: 'c1',
        statut: 'en_cours',
        statut_tms: 'acceptee',
        date_collecte: '2030-01-01',
        heure_collecte: '10:00:00',
        evenement: { organisation_id: 'org-wpm' },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/agence/collectes/[id]/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/agence/collectes/c1', { notes_internes: 'x' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(422);
  });
});

// ── Annulation ──────────────────────────────────────────────────────────────
describe('M3.3 / annulation', () => {
  it('M3.3/annulation_directe_programmee — statut annulee', async () => {
    setupAuth('agence');
    rls.push({
      data: {
        id: 'c1',
        statut: 'programmee',
        statut_tms: 'non_envoye',
        date_collecte: '2030-01-01',
        evenement: { organisation_id: 'org-wpm', organisation: { nom: 'WPM' } },
      },
      error: null,
    });
    admin.push({ data: { id: 'c1' }, error: null });
    const { POST } =
      await import('@/app/api/v1/agence/collectes/[id]/annulation/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/agence/collectes/c1/annulation', { motif: 'x' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const json = (await res.json()) as { data: { statut: string } };
    expect(json.data.statut).toBe('annulee');
  });

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
  });
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
    rls.push({ data: null, error: { message: 'SIRET déjà renseigné' } });
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
