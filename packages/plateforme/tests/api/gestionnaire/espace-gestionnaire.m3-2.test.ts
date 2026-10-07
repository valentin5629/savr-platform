/**
 * M3.2 — Tests Vitest API : Espace gestionnaire de lieux.
 * Couvre : dashboard KPIs (ZD/AG), statut consolidé F2, exclusion brouillons tiers F3,
 * colonnes masquées v_collectes_gestionnaire_lieux, liste lieux (périmètre org),
 * fiche lieu, traiteurs (fenêtre 24m), pack AG (barre progression),
 * mon-organisation (profil GET/PATCH champs protégés, invitation F5, désactivation,
 * auto-désactivation interdite), factures lecture seule F6.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jourParis } from '@savr/shared/src/temps/index.js';

// ── Mock chain ───────────────────────────────────────────────────────────────
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
    'neq',
    'in',
    'gte',
    'lte',
    'order',
    'limit',
    'not',
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
let adminClient = makeChain();
const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockCreateUser = vi.fn();
const mockGenerateLink = vi.fn();
const mockDeleteUser = vi.fn();
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
    from: (...a: unknown[]) => (rls.from as (...x: unknown[]) => unknown)(...a),
    rpc: (...a: unknown[]) => (rls.rpc as (...x: unknown[]) => unknown)(...a),
  }),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (...a: unknown[]) =>
      (adminClient.from as (...x: unknown[]) => unknown)(...a),
    auth: {
      admin: {
        createUser: mockCreateUser,
        generateLink: mockGenerateLink,
        deleteUser: mockDeleteUser,
      },
    },
  }),
}));
vi.mock('@savr/shared/src/email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
const mockUploadObject = vi.fn();
const mockGetObject = vi.fn();
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: (...a: unknown[]) => mockUploadObject(...a),
  getObject: (...a: unknown[]) => mockGetObject(...a),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}
function setupAuth(
  role: string,
  organisationId = 'org-viparis',
  userId = 'user-gl',
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
function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Bucket de l'environnement : les clés de logo y sont bornées (lib/logo-key.ts).
  // Obligatoire depuis le 2026-10-07 — ces cas passaient sur le repli `savr-dev`.
  vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
  rls = makeChain();
  adminClient = makeChain();
  mockCreateUser.mockResolvedValue({
    data: { user: { id: 'new-user-id' } },
    error: null,
  });
  mockGenerateLink.mockResolvedValue({
    data: {
      properties: { action_link: 'https://app.gosavr.io/activation#token' },
    },
    error: null,
  });
  mockDeleteUser.mockResolvedValue({ data: null, error: null });
});

// ── Auth guard ───────────────────────────────────────────────────────────────
describe('M3.2 / auth guard', () => {
  it('M3.2/auth_guard_non_gestionnaire_401 — traiteur_manager bloqué', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/dashboard'));
    expect([401, 403]).toContain(res.status);
  });

  it('M3.2/auth_guard_non_authentifie_401 — pas de session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const { GET } = await import('@/app/api/v1/gestionnaire/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/lieux'));
    expect([401, 403]).toContain(res.status);
  });
});

// ── Dashboard KPIs ───────────────────────────────────────────────────────────
describe('M3.2 / dashboard', () => {
  it('M3.2/dashboard_kpi_zd_4_indicateurs — nb_collectes tonnage taux kg_pax', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({
      data: [{ lieu_id: 'lieu-1' }, { lieu_id: 'lieu-2' }],
      error: null,
    });
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          taux_recyclage: 0.85,
          evenements: { lieu_id: 'lieu-1' },
          pax: 300,
          collecte_flux: [{ poids_reel_kg: 200 }, { poids_reel_kg: 100 }],
        },
        {
          id: 'c2',
          type: 'zero_dechet',
          statut: 'cloturee',
          taux_recyclage: 0.9,
          evenements: { lieu_id: 'lieu-2' },
          pax: 200,
          collecte_flux: [{ poids_reel_kg: 150 }],
        },
      ],
      error: null,
    });
    rls.push({ data: null, error: null }); // pack AG
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/dashboard?type=zero_dechet'),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { kpis: { nb_collectes: number; tonnage_kg: number } };
    };
    expect(json.data.kpis.nb_collectes).toBe(2);
    expect(json.data.kpis.tonnage_kg).toBe(450);
  });

  it('M3.2/GEST04_dashboard_kg_pax_par_flux — kg/pax PAR FLUX pour la jauge (§06.05 Bloc 3)', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          taux_recyclage: 0.8,
          evenements: { id: 'e1', lieu_id: 'lieu-1', pax: 100 },
          collecte_flux: [
            { poids_reel_kg: 50, flux_dechets: { code: 'biodechet' } },
            { poids_reel_kg: 20, flux_dechets: { code: 'verre' } },
          ],
        },
      ],
      error: null,
    });
    rls.push({ data: null, error: null }); // pack AG
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/dashboard?type=zero_dechet'),
    );
    const json = (await res.json()) as {
      data: { kg_par_pax_par_flux: Record<string, number> };
    };
    // Chaque flux comparé à SON benchmark : biodechet 50/100=0.5, verre 20/100=0.2
    // (≠ kg/pax global 0.7 → plus de ratio « Vous » inflaté vs benchmark par-flux).
    expect(json.data.kg_par_pax_par_flux.biodechet).toBeCloseTo(0.5);
    expect(json.data.kg_par_pax_par_flux.verre).toBeCloseTo(0.2);
  });

  it('M3.2/dashboard_kpi_ag_repas_donnes — nb repas aggregés', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'anti_gaspi',
          statut: 'cloturee',
          evenements: { lieu_id: 'lieu-1' },
          pax: 400,
          collecte_flux: [],
          attributions_antgaspi: [
            { volume_repas_realise: 80 },
            { volume_repas_realise: 40 },
          ],
        },
      ],
      error: null,
    });
    rls.push({
      data: {
        id: 'p1',
        credits_initiaux: 10,
        credits_restants: 3,
        statut: 'actif',
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/dashboard?type=anti_gaspi'),
    );
    const json = (await res.json()) as {
      data: { kpis: { nb_repas_donnes: number } };
    };
    expect(json.data.kpis.nb_repas_donnes).toBe(120);
  });

  it('M3.2/dashboard_kpi_ag_repas_objet — embed to-one (OBJET PostgREST) compté, pas 0', async () => {
    // Régression : PostgREST renvoie attributions_antgaspi en OBJET (relation
    // to-one, collecte_id UNIQUE), pas en tableau. Avant le fix, `: []` jetait
    // l'objet → nb_repas_donnes = 0 silencieusement. Le mock tableau du test
    // précédent masquait ce bug.
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'anti_gaspi',
          statut: 'cloturee',
          evenements: { lieu_id: 'lieu-1' },
          pax: 400,
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 120 },
        },
      ],
      error: null,
    });
    rls.push({
      data: {
        id: 'p1',
        credits_initiaux: 10,
        credits_restants: 3,
        statut: 'actif',
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/dashboard?type=anti_gaspi'),
    );
    const json = (await res.json()) as {
      data: { kpis: { nb_repas_donnes: number } };
    };
    expect(json.data.kpis.nb_repas_donnes).toBe(120);
  });

  it('M3.2/dashboard_filtre_periode_date_collecte — from/to ciblent date_collecte (pas realisee_at)', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({ data: [], error: null }); // collectes
    rls.push({ data: null, error: null }); // pack AG
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/gestionnaire/dashboard?type=zero_dechet&from=2025-06-01&to=2026-04-30',
      ),
    );
    expect(res.status).toBe(200);
    // Parité avec les vues KPI M3.5 + règle revenus §06.06 §1 : la période se
    // filtre sur date_collecte (NOT NULL), jamais sur realisee_at (nullable).
    const gteCalls = rls.__calls.gte ?? [];
    const lteCalls = rls.__calls.lte ?? [];
    expect(gteCalls.map((c) => c[0])).toContain('date_collecte');
    expect(lteCalls.map((c) => c[0])).toContain('date_collecte');
    expect(gteCalls.map((c) => c[0])).not.toContain('realisee_at');
    expect(lteCalls.map((c) => c[0])).not.toContain('realisee_at');
    expect(gteCalls).toContainEqual(['date_collecte', '2025-06-01']);
    expect(lteCalls).toContainEqual(['date_collecte', '2026-04-30']);
  });

  it('M3.2/dashboard_pack_ag_inclus_dans_reponse — champ pack présent', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({ data: [], error: null }); // collectes
    rls.push({
      data: {
        id: 'p1',
        credits_initiaux: 20,
        credits_restants: 2,
        statut: 'actif',
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/dashboard/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/dashboard?type=anti_gaspi'),
    );
    const json = (await res.json()) as {
      data: { pack: { credits_restants: number } | null };
    };
    expect(json.data.pack?.credits_restants).toBe(2);
  });
});

// ── Statut consolidé F2 ──────────────────────────────────────────────────────
describe('M3.2 / statut consolidé F2', () => {
  it('M3.2/F2_tous_annulee_consolide_annule — statut_consolide=Annulé', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Gala',
          date_evenement: '2026-07-01',
          pax: 300,
          lieu_id: 'lieu-1',
          traiteur_operationnel_organisation_id: 'org-kaspia',
          lieux: { nom: 'Viparis', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: { libelle: 'Conférence' },
          collectes: [
            {
              type: 'zero_dechet',
              statut: 'annulee',
              date_collecte: '2026-07-01',
              collecte_flux: [],
              attributions_antgaspi: [],
            },
            {
              type: 'anti_gaspi',
              statut: 'annulee',
              date_collecte: '2026-07-01',
              collecte_flux: [],
              attributions_antgaspi: [],
            },
          ],
        },
      ],
      error: null,
    });
    rls.push({ data: null, error: null }); // dechets_labo_kg rpc (1 event)
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{ statut_consolide: string }>;
    };
    expect(json.data[0]?.statut_consolide).toBe('Annulé');
  });

  it('M3.2/F2_au_moins_une_realisee_consolide_termine — statut_consolide=Terminé', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Salon',
          date_evenement: '2026-07-15',
          pax: 500,
          lieu_id: 'lieu-1',
          traiteur_operationnel_organisation_id: 'org-kaspia',
          lieux: { nom: 'Viparis', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: null,
          collectes: [
            {
              type: 'zero_dechet',
              statut: 'cloturee',
              date_collecte: '2026-07-15',
              collecte_flux: [],
              attributions_antgaspi: [],
            },
            {
              type: 'anti_gaspi',
              statut: 'annulee',
              date_collecte: '2026-07-15',
              collecte_flux: [],
              attributions_antgaspi: [],
            },
          ],
        },
      ],
      error: null,
    });
    rls.push({ data: null, error: null }); // dechets_labo_kg rpc (1 event)
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{ statut_consolide: string }>;
    };
    expect(json.data[0]?.statut_consolide).toBe('Terminé');
  });

  it('M3.2/F2_au_moins_une_en_cours_consolide_en_cours — statut_consolide=En cours', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        {
          id: 'e1',
          nom_evenement: 'Forum',
          date_evenement: '2026-08-01',
          pax: 200,
          lieu_id: 'lieu-1',
          traiteur_operationnel_organisation_id: 'org-kaspia',
          lieux: { nom: 'Viparis', ville: 'Paris' },
          organisations: { nom: 'Kaspia' },
          types_evenements: null,
          collectes: [
            {
              type: 'zero_dechet',
              statut: 'programmee',
              date_collecte: '2026-08-01',
              collecte_flux: [],
              attributions_antgaspi: [],
            },
          ],
        },
      ],
      error: null,
    });
    rls.push({ data: null, error: null }); // dechets_labo_kg rpc (1 event)
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{ statut_consolide: string }>;
    };
    expect(json.data[0]?.statut_consolide).toBe('En cours');
  });
});

// ── Déchets labo estimés : événements à collecte ZD seulement ────────────────
// Arbitrage Val 2026-10-07 (« la notion ne tient pas pour les collectes AG »,
// puis option B sur les écrans Événements) : un événement qui n'a que des
// collectes anti-gaspi n'a pas d'estimation, et la fonction n'est pas appelée
// pour lui. Même règle que la liste Collectes, où seule une ligne ZD la porte.
describe('M3.2 / événements — déchets labo estimés, ZD seulement', () => {
  const collecte = (type: string) => ({
    id: `c-${type}`,
    type,
    statut: 'cloturee',
    date_collecte: '2026-07-01',
    collecte_flux: [],
    attributions_antgaspi: null,
    bordereaux_savr: null,
  });
  /** Appels à la fonction, sous la forme `fonction(evenement)`. */
  const appelsEstimation = () =>
    (rls.__calls.rpc ?? []).map(
      (a) => `${a[0]}(${(a[1] as { p_evenement_id: string }).p_evenement_id})`,
    );

  it('M3.2/evenements_dechets_labo_zd_seulement — liste : aucune estimation, ni appel, pour un événement aux seules collectes AG', async () => {
    setupAuth('gestionnaire_lieux');
    const evt = (id: string, types: string[]) => ({
      id,
      nom_evenement: id,
      date_evenement: '2026-07-01',
      pax: 300,
      lieu_id: 'lieu-1',
      traiteur_operationnel_organisation_id: 'org-kaspia',
      lieux: { nom: 'Viparis', ville: 'Paris' },
      organisations: { nom: 'Kaspia' },
      types_evenements: { libelle: 'Gala' },
      collectes: types.map(collecte),
    });
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        evt('e-zd', ['zero_dechet']),
        evt('e-mixte', ['anti_gaspi', 'zero_dechet']),
        evt('e-ag', ['anti_gaspi']),
      ],
      error: null,
    });
    // Une réponse par appel attendu, dans l'ordre. La troisième ne doit JAMAIS
    // être lue : si la fonction était appelée pour `e-ag`, il la recevrait.
    rls.push({ data: 54, error: null });
    rls.push({ data: 36, error: null });
    rls.push({ data: 999, error: null });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/evenements'));
    const json = (await res.json()) as {
      data: Array<{ id: string; dechets_labo_kg: number | null }>;
    };

    expect(appelsEstimation()).toEqual([
      'f_dechets_labo_estimes(e-zd)',
      'f_dechets_labo_estimes(e-mixte)',
    ]);
    expect(json.data.map((e) => [e.id, e.dechets_labo_kg])).toEqual([
      ['e-zd', 54],
      ['e-mixte', 36],
      ['e-ag', null],
    ]);
  });

  it('M3.2/detail_evenement_dechets_labo_zd_seulement — fiche : estimation dès une collecte ZD, aucune ni appel sinon', async () => {
    setupAuth('gestionnaire_lieux');
    const fiche = async (types: string[]) => {
      rls = makeChain();
      rls.push({
        data: {
          id: 'e1',
          pax: 200,
          lieux: null,
          collectes: types.map(collecte),
        },
        error: null,
      });
      // Ce que la fonction rendrait si on l'appelait.
      rls.push({ data: 42, error: null });
      const { GET } =
        await import('@/app/api/v1/gestionnaire/evenements/[id]/route.js');
      const res = await GET(
        makeReq('GET', '/api/v1/gestionnaire/evenements/e1'),
        { params: Promise.resolve({ id: 'e1' }) },
      );
      const json = (await res.json()) as {
        data: { dechets_labo_kg: number | null };
      };
      return { kg: json.data.dechets_labo_kg, appels: appelsEstimation() };
    };

    // Seules collectes anti-gaspi : pas d'estimation, fonction non appelée —
    // alors même qu'elle rendrait 42.
    expect(await fiche(['anti_gaspi'])).toEqual({ kg: null, appels: [] });
    // Sans aucune collecte lisible : même réponse.
    expect(await fiche([])).toEqual({ kg: null, appels: [] });
    // Dès qu'une collecte ZD existe (ici avec une AG) : l'estimation revient.
    expect(await fiche(['anti_gaspi', 'zero_dechet'])).toEqual({
      kg: 42,
      appels: ['f_dechets_labo_estimes(e1)'],
    });
  });
});

// ── Type de collecte : partition à cocher (arbitrage Val F1 2026-10-01) ──────
describe('M3.2 / événements — Type de collecte à choix multiple', () => {
  // 3 événements : ZD seul, AG seul, ZD et AG — chacun dans UNE catégorie.
  const evt = (id: string, types: string[]) => ({
    id,
    nom_evenement: id,
    date_evenement: '2026-07-01',
    pax: 300,
    lieu_id: 'lieu-1',
    traiteur_operationnel_organisation_id: 'org-kaspia',
    lieux: { nom: 'Viparis', ville: 'Paris' },
    organisations: { nom: 'Kaspia' },
    types_evenements: { libelle: 'Conférence' },
    collectes: types.map((type) => ({
      type,
      statut: 'programmee',
      date_collecte: '2026-07-01',
      collecte_flux: [],
      attributions_antgaspi: [],
    })),
  });
  const ids = async (qs: string) => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null });
    rls.push({
      data: [
        evt('zd', ['zero_dechet']),
        evt('ag', ['anti_gaspi']),
        evt('mixte', ['zero_dechet', 'anti_gaspi']),
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/evenements/route.js');
    const res = await GET(
      makeReq('GET', `/api/v1/gestionnaire/evenements${qs}`),
    );
    const json = (await res.json()) as { data: Array<{ id: string }> };
    return json.data.map((e) => e.id);
  };

  it('M3.2/evenements_types_collecte_partition — ZD seul + AG seul cochés → sans les événements ZD et AG', async () => {
    expect(
      await ids('?types_collecte[]=zd_seul&types_collecte[]=ag_seul'),
    ).toEqual(['zd', 'ag']);
    expect(await ids('?types_collecte[]=zd_et_ag')).toEqual(['mixte']);
  });

  it('M3.2/evenements_type_collecte_ancien_lien — ?type_collecte=avec_zd = ZD seul + ZD et AG', async () => {
    expect(await ids('?type_collecte=avec_zd')).toEqual(['zd', 'mixte']);
    expect(await ids('?type_collecte=avec_ag')).toEqual(['ag', 'mixte']);
  });

  it('M3.2/evenements_types_collecte_hors_liste_ecartes — valeur inconnue ignorée (= Tous)', async () => {
    expect(await ids('?types_collecte[]=bidon')).toEqual(['zd', 'ag', 'mixte']);
    expect(await ids('?type_collecte=constructor')).toEqual([
      'zd',
      'ag',
      'mixte',
    ]);
  });

  it('M3.2/evenements_types_collecte_prioritaire_sur_ancien — types_collecte[] ET type_collecte : la liste gagne', async () => {
    expect(
      await ids('?types_collecte[]=ag_seul&type_collecte=avec_zd'),
    ).toEqual(['ag']);
  });
});

// ── Lieux ────────────────────────────────────────────────────────────────────
describe('M3.2 / lieux', () => {
  it("M3.2/lieux_liste_perimetre_org — uniquement lieux de l'organisation", async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({
      data: [
        {
          id: 'lieu-1',
          nom: 'Viparis Porte de Versailles',
          adresse_acces: '1 pl. de la Porte de Versailles',
          code_postal: '75015',
          ville: 'Paris',
          region: 'IDF',
          type_vehicule_max: 'camion',
          actif: true,
        },
        {
          id: 'lieu-2',
          nom: 'Viparis Le Bourget',
          adresse_acces: '93 av. du Bourget',
          code_postal: '93350',
          ville: 'Le Bourget',
          region: 'IDF',
          type_vehicule_max: 'camion',
          actif: true,
        },
      ],
      error: null,
    });
    rls.push({ data: [], error: null }); // collectes 12m
    const { GET } = await import('@/app/api/v1/gestionnaire/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/lieux'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ nom: string; nb_collectes_12m: number }>;
    };
    expect(json.data).toHaveLength(2);
    expect(json.data[0]?.nb_collectes_12m).toBe(0);
  });

  it('M3.2/lieux_liste_vide_si_aucun_perimetre — retour tableau vide', async () => {
    setupAuth('gestionnaire_lieux', 'org-sans-lieux');
    rls.push({ data: [], error: null }); // organisations_lieux vide
    const { GET } = await import('@/app/api/v1/gestionnaire/lieux/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/lieux'));
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);
  });

  it('M3.2/lieux_detail_404_inconnu — not found', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: null, error: null }); // v_lieux_clients maybeSingle → null
    const inconnu = '99999999-9999-4999-8999-999999999999';
    const { GET } =
      await import('@/app/api/v1/gestionnaire/lieux/[id]/route.js');
    const res = await GET(
      makeReq('GET', `/api/v1/gestionnaire/lieux/${inconnu}`),
      {
        params: Promise.resolve({ id: inconnu }),
      },
    );
    expect(res.status).toBe(404);
  });
});

// ── Traiteurs ─────────────────────────────────────────────────────────────────
describe('M3.2 / traiteurs', () => {
  it('M3.2/traiteurs_fenetre_24m_exclusive — tonnage agréger sur collectes 24m', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'zero_dechet',
          statut: 'cloturee',
          date_collecte: jourParis(
            new Date(Date.now() - 6 * 30 * 24 * 3600 * 1000),
          ),
          taux_recyclage: 0.88,
          evenements: {
            lieu_id: 'lieu-1',
            traiteur_operationnel_organisation_id: 'org-kaspia',
            organisations: { id: 'org-kaspia', nom: 'Kaspia', logo_url: null },
          },
          collecte_flux: [{ poids_reel_kg: 300 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/traiteurs'));
    const json = (await res.json()) as {
      data: Array<{ nom: string; tonnage_12m_kg: number }>;
    };
    expect(json.data[0]?.nom).toBe('Kaspia');
    expect(json.data[0]?.tonnage_12m_kg).toBe(300);
  });

  it('M3.2/traiteur_fiche_nom_logo_uniquement — pas email ni siret', async () => {
    setupAuth('gestionnaire_lieux');
    // Route order: orgLieux (then) → orga (maybeSingle) → collectes (then)
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // orgLieux
    rls.push({
      data: {
        id: 'org-kaspia',
        nom: 'Kaspia',
        logo_url: null,
      },
      error: null,
    }); // orga (maybeSingle — before collectes in the route)
    rls.push({ data: [], error: null }); // collectes
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/traiteurs/org-kaspia'),
      { params: Promise.resolve({ id: 'org-kaspia' }) },
    );
    const json = (await res.json()) as {
      data: Record<string, unknown>;
    };
    expect(res.status).toBe(200);
    expect(json.data.nom).toBe('Kaspia');
    expect(json.data).not.toHaveProperty('email');
    expect(json.data).not.toHaveProperty('siret');
    expect(json.data).not.toHaveProperty('telephone');
    // Oracle sur la requête, pas sur la fixture : la fixture ci-dessus est posée
    // à la main, seule la liste du select prouve ce qui est lu en base.
    // Source = vue restreinte v_traiteurs_gestionnaire (20260921090000 : la table
    // organisations n'ouvre plus les traiteurs tiers au gestionnaire), jamais la
    // table ; colonnes réelles de la vue (une colonne inexistante = 42703 → 500).
    const fromCalls = rls.__calls.from ?? [];
    expect(fromCalls.some((a) => a[0] === 'organisations')).toBe(false);
    const idx = fromCalls.findIndex((a) => a[0] === 'v_traiteurs_gestionnaire');
    expect(idx).toBeGreaterThanOrEqual(0);
    const selectArg = String(rls.__calls.select?.[idx]?.[0] ?? '');
    const colonnes = selectArg.split(',').map((c) => c.trim());
    expect(colonnes).toEqual(['id', 'nom', 'logo_url']);
  });

  it('M3.2/traiteur_fiche_erreur_collectes_500 — une erreur DB ne se déguise pas en stats à zéro', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // orgLieux
    rls.push({
      data: { id: 'org-kaspia', nom: 'Kaspia', logo_url: null },
      error: null,
    }); // orga
    rls.push({
      data: null,
      error: { code: '42703', message: 'column does not exist' },
    }); // collectes
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/traiteurs/org-kaspia'),
      { params: Promise.resolve({ id: 'org-kaspia' }) },
    );
    expect(res.status).toBe(500);
  });

  it('M3.2/traiteurs_repas_objet — repas 12 mois : embed to-one (OBJET) compté, pas 0', async () => {
    // Régression : attributions_antgaspi en OBJET (to-one) → `: []` jetait la
    // valeur → repas_donnes_12m = 0 silencieusement.
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // organisations_lieux
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'anti_gaspi',
          statut: 'cloturee',
          date_collecte: jourParis(
            new Date(Date.now() - 30 * 24 * 3600 * 1000),
          ),
          evenements: {
            lieu_id: 'lieu-1',
            traiteur_operationnel_organisation_id: 'org-kaspia',
            organisations: { id: 'org-kaspia', nom: 'Kaspia', logo_url: null },
          },
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 70 },
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/traiteurs'));
    const json = (await res.json()) as {
      data: Array<{ nom: string; repas_donnes_12m: number }>;
    };
    expect(json.data[0]?.nom).toBe('Kaspia');
    expect(json.data[0]?.repas_donnes_12m).toBe(70);
  });

  it('M3.2/traiteur_fiche_repas_objet — fiche : repas embed to-one (OBJET) compté, pas 0', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: [{ lieu_id: 'lieu-1' }], error: null }); // orgLieux
    rls.push({
      data: {
        id: 'org-kaspia',
        nom: 'Kaspia',
        logo_url: null,
      },
      error: null,
    }); // orga (maybeSingle)
    rls.push({
      data: [
        {
          id: 'c1',
          type: 'anti_gaspi',
          statut: 'cloturee',
          date_collecte: jourParis(
            new Date(Date.now() - 30 * 24 * 3600 * 1000),
          ),
          collecte_flux: [],
          attributions_antgaspi: { volume_repas_realise: 33 },
        },
      ],
      error: null,
    }); // collectes
    const { GET } =
      await import('@/app/api/v1/gestionnaire/traiteurs/[id]/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/traiteurs/org-kaspia'),
      { params: Promise.resolve({ id: 'org-kaspia' }) },
    );
    const json = (await res.json()) as {
      data: { stats_12m: { repas_donnes: number } };
    };
    expect(json.data.stats_12m.repas_donnes).toBe(33);
  });
});

// ── Pack AG ──────────────────────────────────────────────────────────────────
describe('M3.2 / pack AG', () => {
  it('M3.2/pack_ag_actif_retourne_restants — colonnes réelles mappées (pas de colonne phantom)', async () => {
    setupAuth('gestionnaire_lieux');
    // Le mock fournit les colonnes RÉELLES de packs_antgaspi (convergées M2.1).
    // Si la route sélectionnait des colonnes inexistantes (reference/date_debut/
    // prix_ht…), les champs mappés seraient undefined → ce test échouerait.
    rls.push({
      data: {
        id: 'p1',
        type_pack: 'pack_30',
        credits_initiaux: 20,
        credits_consommes: 8,
        credits_restants: 12,
        date_achat: '2026-01-15',
        date_expiration: null,
        statut: 'actif',
      },
      error: null,
    });
    rls.push({ data: [], error: null }); // consommation
    const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/pack-ag'));
    const json = (await res.json()) as {
      data: {
        pack_actif: {
          nb_collectes_total: number;
          nb_collectes_restantes: number;
          reference: string | null;
          date_debut: string | null;
          date_fin: string | null;
          // financier (prix/montant/devise) NON exposé côté gestionnaire (§06.05)
          prix_ht?: unknown;
          montant_total_ht?: unknown;
        } | null;
      };
    };
    const pack = json.data.pack_actif;
    expect(pack?.nb_collectes_restantes).toBe(12);
    expect(pack?.nb_collectes_total).toBe(20);
    expect(pack?.reference).toBe('pack_30');
    expect(pack?.date_debut).toBe('2026-01-15');
    expect(pack?.date_fin).toBeNull();
    // masquage financier
    expect(pack?.prix_ht).toBeUndefined();
    expect(pack?.montant_total_ht).toBeUndefined();
  });

  it('M3.2/pack_ag_aucun_actif_null — retour pack_actif null', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: null, error: null }); // pas de pack actif
    rls.push({ data: [], error: null }); // consommation
    const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/pack-ag'));
    const json = (await res.json()) as {
      data: { pack_actif: null };
    };
    expect(json.data.pack_actif).toBeNull();
  });

  it('M3.2/pack_ag_consommation_repas_objet — historique conso : embed to-one (OBJET) compté', async () => {
    // Régression : la ligne d'historique de consommation pack AG lit
    // attributions_antgaspi en OBJET (to-one) → `: []` mettait repas_donnes = 0.
    setupAuth('gestionnaire_lieux');
    rls.push({ data: null, error: null }); // pas de pack actif
    rls.push({
      data: [
        {
          id: 'c-ag',
          date_collecte: '2026-06-01',
          statut: 'cloturee',
          evenements: {
            nom_evenement: 'Gala',
            date_evenement: '2026-06-01',
            lieux: { nom: 'Palais' },
          },
          // ⚠ OBJET, pas tableau — forme réelle PostgREST, sur la vue
          // v_attributions_gestionnaire (nom de l'association à plat).
          attributions_antgaspi: {
            volume_repas_realise: 55,
            association_nom: 'Les Restos',
          },
        },
      ],
      error: null,
    }); // consommation
    const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/pack-ag'));
    const json = (await res.json()) as {
      data: {
        historique_consommation: Array<{
          repas_donnes: number;
          associations: Array<{ nom: string | null }>;
        }>;
      };
    };
    const ligne = json.data.historique_consommation[0]!;
    expect(ligne.repas_donnes).toBe(55);
    expect(ligne.associations[0]?.nom).toBe('Les Restos');
  });
});

// ── Mon organisation / profil ────────────────────────────────────────────────
describe('M3.2 / mon-organisation / profil', () => {
  it('M3.2/profil_get_retourne_organisation — sa propre organisation, colonnes réelles', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({
      data: {
        id: 'org-viparis',
        nom: 'Viparis',
        raison_sociale: 'Viparis SAS',
        siret: '12345678900011',
        adresse: '2 place de la Porte Maillot, 75017 Paris',
        email_principal: null,
        telephone: null,
        logo_url: null,
      },
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/mon-organisation/profil'),
    );
    const json = (await res.json()) as { data: { nom: string } };
    expect(json.data.nom).toBe('Viparis');
    // Filtre explicite sur SA propre orga (défense en profondeur : la RLS ne rend
    // plus que sa ligne depuis 20260921090000, traiteurs tiers via la vue).
    expect(rls.__calls.eq).toContainEqual(['id', 'org-viparis']);
    // Colonnes réelles de plateforme.organisations uniquement.
    const cols = String(rls.__calls.select?.[0]?.[0])
      .split(',')
      .map((c) => c.trim());
    expect(cols).toEqual([
      'id',
      'nom',
      'raison_sociale',
      'siret',
      'adresse',
      'email_principal',
      'telephone',
      'logo_url',
    ]);
  });

  it('M3.2/profil_patch_champ_protege_ignore — nom ignoré, siret accepté et audité', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    // 1re lecture = anciennes valeurs légales (audit), 2e = résultat de l'UPDATE.
    rls.push({
      data: {
        raison_sociale: 'Viparis SAS',
        siret: '11100000000011',
        adresse: null,
      },
      error: null,
    });
    rls.push({
      data: { id: 'org-viparis', nom: 'Viparis', adresse: '1 rue Neuve' },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', {
        siret: '99900000000011',
        nom: 'Autre nom',
        adresse: '1 rue Neuve',
      }),
    );
    expect(res.status).toBe(200);
    // Nom en lecture seule (§06.05 §6) ; raison sociale / SIRET / adresse
    // modifiables (décision Val 2026-09-28).
    const updateCalls = rls.__calls.update ?? [];
    expect(updateCalls.length).toBeGreaterThan(0);
    const updateArg = updateCalls[0]?.[0] as Record<string, unknown>;
    expect(updateArg).toEqual({
      siret: '99900000000011',
      adresse: '1 rue Neuve',
    });
    // Audit : une ligne par champ légal réellement modifié (siret, adresse).
    const audits = (adminClient.__calls.insert ?? []).map(
      (c) => c[0] as Record<string, unknown>,
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: 'organisation_infos_legales_update',
      record_id: 'org-viparis',
      old_values: { siret: '11100000000011' },
      new_values: { siret: '99900000000011' },
    });
    // UPDATE borné à SA propre orga (jamais un UPDATE sans WHERE).
    expect(rls.__calls.eq).toContainEqual(['id', 'org-viparis']);
  });

  it('M3.2/profil_get_404_organisation_absente', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: null, error: null });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/mon-organisation/profil'),
    );
    expect(res.status).toBe(404);
  });

  it('M3.2/profil_patch_404_organisation_absente', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: null, error: null });
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', {
        logo_url: LOGO_KEY,
      }),
    );
    expect(res.status).toBe(404);
  });

  it('M3.2/profil_patch_aucun_champ_editable_400 — rejet si aucun champ autorisé', async () => {
    setupAuth('gestionnaire_lieux');
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', {
        siren: '999',
        nom: 'Autre nom',
        email_principal: 'x@y.test',
      }),
    );
    expect(res.status).toBe(400);
  });
});

const LOGO_KEY = 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png';

describe('M3.2 / mon-organisation / profil — édition (§06.05 §6)', () => {
  async function patch(body: unknown) {
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    return PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', body),
    );
  }

  it('M3.2/profil_patch_logo_cle_upload_acceptee', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    // Logo seul : aucune lecture des valeurs légales (rien à auditer).
    rls.push({ data: { id: 'org-viparis', logo_url: LOGO_KEY }, error: null });
    const res = await patch({ logo_url: LOGO_KEY });
    expect(res.status).toBe(200);
    expect(rls.__calls.update?.[0]?.[0]).toEqual({ logo_url: LOGO_KEY });
    expect(rls.__calls.eq).toContainEqual(['id', 'org-viparis']);
    // Le seul SELECT est le retour de l'UPDATE.
    expect(rls.__calls.select ?? []).toHaveLength(1);
  });

  it.each([
    [
      'autre bucket',
      'autre-bucket/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png',
    ],
    ['URL externe', 'https://exemple.fr/logo.png'],
    [
      'objet R2 hors logos/',
      'savr-dev/bordereaux/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png',
    ],
    ['traversée', 'savr-dev/logos/../bordereaux/x.png'],
    ['null', null],
  ])('M3.2/profil_patch_logo_invalide_422 — %s', async (_cas, logo_url) => {
    setupAuth('gestionnaire_lieux');
    const res = await patch({ logo_url });
    expect(res.status).toBe(422);
    expect(rls.__calls.update).toBeUndefined();
  });

  it('M3.2/profil_patch_adresse_trim_et_vide_null', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: null, error: null });
    rls.push({ data: { id: 'org-viparis' }, error: null });
    await patch({ adresse: '  3 rue Neuve  ' });
    expect(rls.__calls.update?.[0]?.[0]).toEqual({ adresse: '3 rue Neuve' });

    rls = makeChain();
    rls.push({ data: null, error: null });
    rls.push({ data: { id: 'org-viparis' }, error: null });
    await patch({ adresse: '   ' });
    expect(rls.__calls.update?.[0]?.[0]).toEqual({ adresse: null });
  });

  it.each([
    ['non textuelle', 42],
    ['trop longue', 'x'.repeat(501)],
  ])('M3.2/profil_patch_adresse_invalide_422 — %s', async (_cas, adresse) => {
    setupAuth('gestionnaire_lieux');
    const res = await patch({ adresse });
    expect(res.status).toBe(422);
    expect(rls.__calls.update).toBeUndefined();
  });
});

describe('M3.2 / mon-organisation / logo', () => {
  function uploadReq(file: File): NextRequest {
    const form = new FormData();
    form.append('file', file);
    return new NextRequest(
      'http://localhost/api/v1/gestionnaire/mon-organisation/logo',
      { method: 'POST', body: form },
    );
  }
  const png = () =>
    new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });

  it('M3.2/logo_upload_201 — clé logos/<uuid>.png', async () => {
    setupAuth('gestionnaire_lieux');
    mockUploadObject.mockImplementation((key: string) =>
      Promise.resolve({
        bucket: 'savr-dev',
        key,
        storageKey: `savr-dev/${key}`,
      }),
    );
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    const res = await POST(uploadReq(png()));
    expect(res.status).toBe(201);
    const { logo_url } = (await res.json()) as { logo_url: string };
    // La clé rendue doit passer la validation du PATCH /profil.
    expect(logo_url).toMatch(/^[a-z0-9.-]+\/logos\/[0-9a-f-]{36}\.png$/);
  });

  it('M3.2/logo_upload_format_refuse_422', async () => {
    setupAuth('gestionnaire_lieux');
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    const res = await POST(
      uploadReq(new File(['x'], 'logo.gif', { type: 'image/gif' })),
    );
    expect(res.status).toBe(422);
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  it('M3.2/logo_upload_trop_lourd_422', async () => {
    setupAuth('gestionnaire_lieux');
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    const gros = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'l.png', {
      type: 'image/png',
    });
    const res = await POST(uploadReq(gros));
    expect(res.status).toBe(422);
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  it('M3.2/logo_upload_role_traiteur_403', async () => {
    setupAuth('traiteur_manager');
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    const res = await POST(uploadReq(png()));
    expect(res.status).toBe(403);
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  it('M3.2/logo_get_sert_le_logo_de_sa_propre_organisation', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: { logo_url: LOGO_KEY }, error: null });
    mockGetObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    // Un paramètre key fourni par le client est ignoré.
    const res = await GET(
      makeReq(
        'GET',
        '/api/v1/gestionnaire/mon-organisation/logo?key=savr-dev/logos/autre.png',
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(rls.__calls.eq).toContainEqual(['id', 'org-viparis']);
    expect(mockGetObject).toHaveBeenCalledWith(
      LOGO_KEY.slice('savr-dev/'.length),
    );
  });

  it.each([
    ['aucun logo', null],
    ['valeur hors logos/', 'savr-dev/bordereaux/x.pdf'],
  ])('M3.2/logo_get_404 — %s', async (_cas, logo_url) => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: { logo_url }, error: null });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/logo/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/mon-organisation/logo'),
    );
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});

// ── Logo d'un traiteur tiers (§06.05 §5 : nom + logo) ────────────────────────
// `organisations.logo_url` porte une CLÉ R2 (20260919100000) : la clé doit être
// résolue par la route DEPUIS v_traiteurs_gestionnaire, jamais reçue du client.
describe('M3.2 / traiteurs / logo (proxy scopé)', () => {
  const TRAITEUR_ID = 'tr-kaspia';
  const logoReq = (qs = '') =>
    makeReq('GET', `/api/v1/gestionnaire/traiteurs/${TRAITEUR_ID}/logo${qs}`);
  const importGet = async () =>
    (await import('@/app/api/v1/gestionnaire/traiteurs/[id]/logo/route.js'))
      .GET;
  const params = Promise.resolve({ id: TRAITEUR_ID });

  it('M3.2/traiteur_logo_200 — clé résolue depuis la vue restreinte, pas du client', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: { logo_url: LOGO_KEY }, error: null });
    mockGetObject.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    const GET = await importGet();
    // Une clé hostile passée en paramètre ne doit changer NI la table lue,
    // NI l'objet R2 servi.
    const res = await GET(
      logoReq('?key=savr-dev/bordereaux/autre-org/b1.pdf'),
      { params },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // Oracle de requête : la VUE restreinte, jamais la table organisations.
    expect(rls.__calls.from).toEqual([['v_traiteurs_gestionnaire']]);
    expect(rls.__calls.select).toEqual([['logo_url']]);
    expect(rls.__calls.eq).toEqual([['id', TRAITEUR_ID]]);
    // Jamais le client service-role : il contournerait le périmètre de la vue.
    expect(adminClient.__calls.from).toBeUndefined();
    // Oracle de consommation : l'objet servi est celui de la BASE (capture par
    // valeur : getObject reçoit la clé, une chaîne — le bucket est celui de
    // l'environnement).
    expect(mockGetObject).toHaveBeenCalledWith(
      LOGO_KEY.slice('savr-dev/'.length),
    );
    expect(mockGetObject).toHaveBeenCalledTimes(1);
  });

  it('M3.2/traiteur_logo_hors_perimetre_404 — la vue ne rend aucune ligne', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: null, error: null });
    const GET = await importGet();
    const res = await GET(logoReq(), { params });
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it.each([
    ['aucun logo', null],
    ['valeur héritée hors logos/', 'savr-dev/bordereaux/x.pdf'],
  ])('M3.2/traiteur_logo_404 — %s', async (_cas, logo_url) => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: { logo_url }, error: null });
    const GET = await importGet();
    const res = await GET(logoReq(), { params });
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('M3.2/traiteur_logo_role_403 — rôle hors gestionnaire_lieux', async () => {
    setupAuth('traiteur_manager');
    const GET = await importGet();
    const res = await GET(logoReq(), { params });
    expect(res.status).toBe(403);
    // Aucune lecture, aucun téléchargement sous un rôle non autorisé.
    expect(rls.__calls.from).toBeUndefined();
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});

// ── Mon organisation / users — F5 ────────────────────────────────────────────
describe('M3.2 / mon-organisation / users (F5)', () => {
  it('M3.2/F5_invitation_utilisateur_201_email_envoye — flux complet', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: null, error: null }); // pas de doublon email (maybeSingle via rls)
    adminClient.push({ data: { nom: 'Viparis SA' }, error: null }); // org name (maybeSingle via admin)
    adminClient.push({ data: null, error: null }); // insert profil users (await)
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/gestionnaire/mon-organisation/users', {
        email: 'nouveau@viparis.fr',
        prenom: 'Camille',
        nom: 'Dupont',
      }),
    );
    expect(res.status).toBe(201);
    // Compte Auth créé sans email natif Supabase (pas d'inviteUserByEmail).
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'nouveau@viparis.fr',
        email_confirm: true,
      }),
    );
    // Le collaborateur devient gestionnaire_lieux de la même organisation.
    const insertArgs = adminClient.__calls.insert?.[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArgs).toMatchObject({
      organisation_id: 'org-viparis',
      role: 'gestionnaire_lieux',
      email: 'nouveau@viparis.fr',
    });
    // Email brandé template §06.02 n°17 avec la variable REQUISE lien_invitation.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'invitation_utilisateur',
      'nouveau@viparis.fr',
      expect.objectContaining({ lien_invitation: expect.any(String) }),
      expect.any(Object),
    );
    const emailVars = mockSendEmail.mock.calls[0]?.[2] as {
      lien_invitation?: string;
    };
    expect(emailVars.lien_invitation).toBeTruthy();
    // `redirectTo` doit viser la route d'échange PKCE (`/api/auth/reset-password
    // /confirm`) — `/auth/new-password` n'existe pas (404), régression mesurée
    // 2026-09-28.
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recovery',
        options: expect.objectContaining({
          redirectTo: expect.stringContaining(
            '/api/auth/reset-password/confirm',
          ),
        }),
      }),
    );
  });

  it('M3.2/F5_invitation_rollback_auth_si_insert_echoue — deleteUser + 422 (pas de user orphelin)', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({ data: null, error: null }); // pas de doublon (rls)
    adminClient.push({ data: { nom: 'Viparis SA' }, error: null }); // org
    adminClient.push({ data: null, error: { message: 'insert boom' } }); // INSERT users échoue
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/gestionnaire/mon-organisation/users', {
        email: 'nouveau@viparis.fr',
        prenom: 'Camille',
        nom: 'Dupont',
      }),
    );
    expect(res.status).toBe(422);
    expect(mockDeleteUser).toHaveBeenCalledWith('new-user-id');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('M3.2/F5_invitation_email_doublon_409 — 409 si email existant', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({ data: { id: 'u-existing' }, error: null }); // doublon
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/gestionnaire/mon-organisation/users', {
        email: 'deja@viparis.fr',
        prenom: 'Jean',
        nom: 'Truc',
      }),
    );
    expect(res.status).toBe(409);
  });

  it('M3.2/F5_invitation_role_escalade_interdit — 403 si role != gestionnaire_lieux', async () => {
    setupAuth('gestionnaire_lieux');
    const { POST } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/route.js');
    const res = await POST(
      makeReq('POST', '/api/v1/gestionnaire/mon-organisation/users', {
        email: 'pirate@viparis.fr',
        prenom: 'Pirate',
        nom: 'Privilège',
        role: 'admin_savr',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('M3.2/F5_desactivation_membre_actif — retour actif=false', async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis', 'user-gl-1');
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-gl-1' } },
      error: null,
    });
    // Route: auth.getUser() → no chain pop; only update.maybeSingle() uses chain
    rls.push({
      data: { id: 'user-gl-2', email: 'autre@viparis.fr', actif: false },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/[id]/route.js');
    const res = await PATCH(
      makeReq(
        'PATCH',
        '/api/v1/gestionnaire/mon-organisation/users/user-gl-2',
        {
          actif: false,
        },
      ),
      { params: Promise.resolve({ id: 'user-gl-2' }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { actif: boolean } };
    expect(json.data.actif).toBe(false);
  });

  it('M3.2/F5_auto_desactivation_interdite — 403 si userId === targetId', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-gl-self' } },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: makeJwt({
            role: 'gestionnaire_lieux',
            organisation_id: 'org-viparis',
          }),
        },
      },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/users/[id]/route.js');
    const res = await PATCH(
      makeReq(
        'PATCH',
        '/api/v1/gestionnaire/mon-organisation/users/user-gl-self',
        { actif: false },
      ),
      { params: Promise.resolve({ id: 'user-gl-self' }) },
    );
    expect(res.status).toBe(403);
  });
});

// ── Mon organisation / factures — F6 ─────────────────────────────────────────
describe('M3.2 / mon-organisation / factures (F6)', () => {
  it("M3.2/F6_factures_self_uniquement — RLS filtre l'organisation", async () => {
    setupAuth('gestionnaire_lieux', 'org-viparis');
    rls.push({
      data: [
        {
          id: 'f1',
          numero_facture: 'VIP-001',
          statut: 'emise',
          montant_ttc: 1200,
          date_emission: '2026-06-01',
          pdf_url_savr: null,
          pdf_url_pennylane: null,
        },
      ],
      error: null,
    });
    const { GET } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/factures/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/mon-organisation/factures'),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ id: string; montant_ttc: number }>;
    };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe('f1');
    // Colonnes réelles de plateforme.factures (ex-pdf_url / avoir_facture_id
    // inexistants → 500 → onglet vide).
    const select = String(rls.__calls.select?.[0]?.[0]);
    for (const col of [
      'pdf_url_savr',
      'pdf_url_pennylane',
      'facture_origine_id',
    ])
      expect(select).toContain(col);
    expect(select).not.toMatch(/\bpdf_url\b|avoir_facture_id/);
    // Brouillons jamais visibles côté client (§06.04 l.100/l.913).
    expect(rls.__calls.neq).toContainEqual(['statut', 'brouillon']);
  });
});
