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
    const { GET } =
      await import('@/app/api/v1/gestionnaire/lieux/[id]/route.js');
    const res = await GET(
      makeReq('GET', '/api/v1/gestionnaire/lieux/inconnu'),
      {
        params: Promise.resolve({ id: 'inconnu' }),
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
          date_collecte: new Date(Date.now() - 6 * 30 * 24 * 3600 * 1000)
            .toISOString()
            .slice(0, 10),
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
        ville: 'Paris',
        description_activite: null,
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
    expect(json.data.nom).toBe('Kaspia');
    expect(json.data).not.toHaveProperty('email');
    expect(json.data).not.toHaveProperty('siret');
    expect(json.data).not.toHaveProperty('telephone');
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
    rls.push({ data: [], error: null }); // historique packs
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
    rls.push({ data: [], error: null }); // historique
    rls.push({ data: [], error: null }); // consommation
    const { GET } = await import('@/app/api/v1/gestionnaire/pack-ag/route.js');
    const res = await GET(makeReq('GET', '/api/v1/gestionnaire/pack-ag'));
    const json = (await res.json()) as {
      data: { pack_actif: null };
    };
    expect(json.data.pack_actif).toBeNull();
  });
});

// ── Mon organisation / profil ────────────────────────────────────────────────
describe('M3.2 / mon-organisation / profil', () => {
  it('M3.2/profil_get_retourne_organisation — nom et statut siret', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({
      data: {
        id: 'org-viparis',
        nom: 'Viparis',
        nom_affichage: 'Viparis SAS',
        siret_verification: 'verifie',
        actif: true,
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
  });

  it('M3.2/profil_patch_champ_protege_ignore — siren rejeté silencieusement', async () => {
    setupAuth('gestionnaire_lieux');
    rls.push({
      data: { id: 'org-viparis', nom: 'Viparis', nom_affichage: 'Viparis' },
      error: null,
    });
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', {
        siren: '123456789',
        nom_affichage: 'Viparis Pro',
      }),
    );
    expect(res.status).toBe(200);
    // Vérifier que le update ne contenait pas siren
    const updateCalls = rls.__calls.update ?? [];
    expect(updateCalls.length).toBeGreaterThan(0);
    const updateArg = updateCalls[0]?.[0] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty('siren');
    expect(updateArg).toHaveProperty('nom_affichage', 'Viparis Pro');
  });

  it('M3.2/profil_patch_aucun_champ_editable_400 — rejet si aucun champ autorisé', async () => {
    setupAuth('gestionnaire_lieux');
    const { PATCH } =
      await import('@/app/api/v1/gestionnaire/mon-organisation/profil/route.js');
    const res = await PATCH(
      makeReq('PATCH', '/api/v1/gestionnaire/mon-organisation/profil', {
        siren: '999',
        siret: '99900000000011',
      }),
    );
    expect(res.status).toBe(400);
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
          pdf_url: null,
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
  });
});
