/**
 * M3.6 — Tests API Dashboard Client Admin (§06.06 §2).
 * Vue LECTURE SEULE répliquant le dashboard gestionnaire, agrégée par organisation.
 * Couverture : gardes de rôle, agrégation « Toutes les organisations » (sans
 * filtre org) vs périmètre sélectionné (filtre evenements.organisation_id),
 * exactitude KPI ZD/AG, liste organisations, benchmark staff (service-role).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { periodeBenchmark } from '@/lib/dashboards/periode-benchmark.js';
import { PAGE_REFERENCE } from '@/lib/dashboards/admin-dashboard-client.js';

// ─── Mock client admin (service-role) : builder awaitable + rpc ────────────────
let queryResult: { data: unknown; error: unknown } = { data: [], error: null };
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };

const adminClient: Record<string, unknown> = {
  from: vi.fn(() => adminClient),
  select: vi.fn(() => adminClient),
  eq: vi.fn(() => adminClient),
  in: vi.fn(() => adminClient),
  or: vi.fn(() => adminClient),
  gte: vi.fn(() => adminClient),
  lte: vi.fn(() => adminClient),
  neq: vi.fn(() => adminClient),
  order: vi.fn(() => adminClient),
  range: vi.fn(() => adminClient),
  limit: vi.fn(() => adminClient),
  maybeSingle: vi.fn(() => Promise.resolve(queryResult)),
  rpc: vi.fn(() => Promise.resolve(rpcResult)),
  // Rend le builder awaitable (la route KPI fait `await q` sans méthode terminale).
  then: (resolve: (v: unknown) => void) => resolve(queryResult),
};

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => adminClient,
}));

// ─── Mock auth (requireStaff) ──────────────────────────────────────────────────
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

function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

function setupNoAuth(): void {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
}

function makeReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

function inCalls(): unknown[][] {
  return (adminClient.in as ReturnType<typeof vi.fn>).mock.calls;
}

function orCalls(): unknown[][] {
  return (adminClient.or as ReturnType<typeof vi.fn>).mock.calls;
}

function gteCalls(): unknown[][] {
  return (adminClient.gte as ReturnType<typeof vi.fn>).mock.calls;
}

function lteCalls(): unknown[][] {
  return (adminClient.lte as ReturnType<typeof vi.fn>).mock.calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryResult = { data: [], error: null };
  rpcResult = { data: [], error: null };
});

// ─── Gardes de rôle ────────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / gardes', () => {
  it('M3.6/auth_guard_non_authentifie_401 — 401 sans session', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client'));
    expect(res.status).toBe(401);
  });

  it('M3.6/auth_guard_non_staff_403 — 403 pour un rôle client', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client'));
    expect(res.status).toBe(403);
  });

  it('M3.6/auth_guard_non_staff_403 — ops_savr autorisé (200)', async () => {
    setupAuth('ops_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?from=2026-01-01&to=2026-12-31'),
    );
    expect(res.status).toBe(200);
  });
});

// ─── Agrégation par périmètre ───────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / périmètre', () => {
  it('M3.6/kpi_toutes_organisations_sans_filtre_org — aucun filtre organisation_id', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=zero_dechet'),
    );
    expect(res.status).toBe(200);
    // « Toutes les organisations » : aucun filtre de périmètre org (ni .in ni .or).
    const orgIn = inCalls().find((c) => c[0] === 'evenements.organisation_id');
    expect(orgIn).toBeUndefined();
    const orgOr = orCalls().find((c) =>
      String(c[0]).includes('organisation_id.in.'),
    );
    expect(orgOr).toBeUndefined();
  });

  it('M3.6/kpi_organisations_selectionnees_filtre_in — périmètre opérateur-inclusif (programmateur OU traiteur opérationnel)', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    // Ids d'org = UUID valides (le loader filtre en UUID par défense en profondeur).
    const org1 = '11111111-1111-1111-1111-111111111111';
    const org2 = '22222222-2222-2222-2222-222222222222';
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard-client?type=zero_dechet&organisation_ids[]=${org1}&organisation_ids[]=${org2}`,
      ),
    );
    expect(res.status).toBe(200);
    // DÉCISION VAL R24c : un traiteur sélectionné = son activité d'OPÉRATEUR →
    // filtre .or(organisation_id IN … OU traiteur_operationnel_organisation_id IN …)
    // sur la table référencée evenements, appliqué à la requête d'historique.
    const orgOr = orCalls().find((c) =>
      String(c[0]).includes(`organisation_id.in.(${org1},${org2})`),
    );
    expect(orgOr).toBeDefined();
    expect(String(orgOr?.[0])).toContain(
      `traiteur_operationnel_organisation_id.in.(${org1},${org2})`,
    );
    expect(orgOr?.[1]).toEqual({ referencedTable: 'evenements' });
  });
});

// ─── Filtre de période ─────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / filtre période', () => {
  it('M3.6/kpi_filtre_periode_date_collecte — from/to ciblent date_collecte (pas realisee_at)', async () => {
    setupAuth('admin_savr');
    queryResult = { data: [], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq(
        '/api/v1/admin/dashboard-client?type=zero_dechet&from=2025-06-01&to=2026-04-30',
      ),
    );
    expect(res.status).toBe(200);
    // Parité avec les vues KPI M3.5 + règle revenus §06.06 §1 : la période se
    // filtre sur date_collecte (NOT NULL), jamais sur realisee_at (nullable).
    const gteCol = gteCalls().map((c) => c[0]);
    const lteCol = lteCalls().map((c) => c[0]);
    expect(gteCol).toContain('date_collecte');
    expect(lteCol).toContain('date_collecte');
    expect(gteCol).not.toContain('realisee_at');
    expect(lteCol).not.toContain('realisee_at');
    expect(gteCalls()).toContainEqual(['date_collecte', '2025-06-01']);
    expect(lteCalls()).toContainEqual(['date_collecte', '2026-04-30']);
  });
});

// ─── Exactitude KPI ──────────────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / KPI', () => {
  it('M3.6/kpi_zd_4_indicateurs_pondere — tonnage, taux pondéré (NULL exclus), kg/pax', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          taux_recyclage: 80,
          co2_evite_kg: 40,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 50 }],
          attributions_antgaspi: [],
        },
        {
          taux_recyclage: 60,
          co2_evite_kg: 60,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 150 }],
          attributions_antgaspi: [],
        },
        {
          taux_recyclage: null,
          co2_evite_kg: 20,
          evenements: [{ pax: 100 }],
          collecte_flux: [{ poids_reel_kg: 100 }],
          attributions_antgaspi: [],
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=zero_dechet'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        kpi: Record<string, number>;
        co2: { eviteKg: number };
        blocs: Record<string, unknown>;
      };
    };
    // Bloc 5 « Prochaines collectes » retiré (décision Val 2026-10-01) : le
    // loader Admin ne sert plus la liste.
    expect(body.data.blocs).not.toHaveProperty('prochaines');
    // Plomberie CO₂ Admin bout-en-bout : SELECT co2_evite_kg → co2Totals → payload.
    expect(body.data.co2.eviteKg).toBeCloseTo(120, 5);
    const kpi = body.data.kpi;
    expect(kpi.nb_collectes).toBe(3);
    expect(kpi.tonnage_kg).toBe(300);
    // Pondéré par tonnage, 3e collecte (taux NULL) exclue : (80*50 + 60*150)/200 = 65.
    expect(kpi.taux_recyclage_pondere).toBeCloseTo(65, 5);
    expect(kpi.kg_par_pax).toBeCloseTo(1, 5);
  });

  it('M3.6/kpi_ag_repas_donnes — repas donnés et repas/pax', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          taux_recyclage: null,
          evenements: [{ pax: 100 }],
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 40 }],
        },
        {
          taux_recyclage: null,
          evenements: [{ pax: 100 }],
          collecte_flux: [],
          attributions_antgaspi: [{ volume_repas_realise: 60 }],
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client?type=anti_gaspi'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { kpi: Record<string, number> };
    };
    const kpi = body.data.kpi;
    expect(kpi.nb_collectes).toBe(2);
    expect(kpi.nb_repas_donnes).toBe(100);
    expect(kpi.pax_total).toBe(200);
    expect(kpi.repas_par_pax).toBeCloseTo(0.5, 5);
  });
});

// ─── Organisations (sélecteur) ─────────────────────────────────────────────────

describe('M3.6 / Dashboard Client / organisations', () => {
  it('M3.6/organisations_liste_pour_selecteur — liste id/raison_sociale/type', async () => {
    setupAuth('admin_savr');
    queryResult = {
      data: [
        {
          id: 'o1',
          nom: 'Alpha',
          raison_sociale: 'Alpha SAS',
          type: 'traiteur',
        },
        {
          id: 'o2',
          nom: 'Beta',
          raison_sociale: null,
          type: 'gestionnaire_lieux',
        },
      ],
      error: null,
    };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/organisations'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { nom: string; raison_sociale: string | null }[];
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.nom).toBe('Alpha');
    // Types client uniquement (traiteur, agence, gestionnaire_lieux).
    const typeFilter = inCalls().find((c) => c[0] === 'type');
    expect(typeFilter?.[1]).toEqual([
      'traiteur',
      'agence',
      'gestionnaire_lieux',
    ]);
  });

  it('M3.6/organisations_liste_pour_selecteur — 403 rôle client', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/organisations/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/organisations'),
    );
    expect(res.status).toBe(403);
  });
});

// ─── Benchmark staff (service-role) ────────────────────────────────────────────

// Ligne de référence du radar (décision Val 2026-10-02) : calculée en service_role
// par loadAdminBenchmarkComparaison (Σ kg flux / Σ pax, période fixe 24 mois),
// SANS k-anonymat — plus d'appel à f_benchmark_kg_pax_zd côté Admin.
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const LIEU1 = '33333333-3333-4333-8333-333333333333';

// Deux collectes du MÊME traiteur (k-anonymat clients : segment masqué), pax
// INÉGAUX pour distinguer la formule parc (Σ kg / Σ pax) d'une moyenne des
// ratios : biodéchets 20 + 10 kg sur 100 + 300 pax → 30/400 = 0,075 kg/pax
// (moyenne des ratios = (0,20 + 0,033)/2 = 0,117 ≠) ; cartons 5/400 = 0,0125.
const COLLECTES_REFERENCE = [
  {
    id: 'c1',
    type: 'zero_dechet',
    taux_recyclage: 80,
    date_collecte: '2026-06-01',
    evenements: {
      id: 'e1',
      lieu_id: LIEU1,
      pax: 100,
      organisation_id: T1,
      type_evenement_id: 'ty1',
      traiteur_operationnel_organisation_id: T1,
    },
    collecte_flux: [
      { poids_reel_kg: 20, flux_dechets: { code: 'biodechet' } },
      { poids_reel_kg: 5, flux_dechets: { code: 'cartons' } },
    ],
    attributions_antgaspi: null,
  },
  {
    id: 'c2',
    type: 'zero_dechet',
    taux_recyclage: 70,
    date_collecte: '2026-07-01',
    evenements: {
      id: 'e2',
      lieu_id: LIEU1,
      pax: 300,
      organisation_id: T1,
      type_evenement_id: 'ty1',
      traiteur_operationnel_organisation_id: T1,
    },
    collecte_flux: [{ poids_reel_kg: 10, flux_dechets: { code: 'biodechet' } }],
    attributions_antgaspi: null,
  },
];

describe('M3.6 / Dashboard Client / benchmark', () => {
  it('M3.6/benchmark_staff_service_role — admin accède à la ligne de référence (parc entier, période fixe 24 mois)', async () => {
    setupAuth('admin_savr');
    queryResult = { data: COLLECTES_REFERENCE, error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client/benchmark'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        kgParPaxParFlux: Record<string, number>;
        nbCollectes: number;
        periode: { debut: string; fin: string };
      };
    };
    expect(body.data.kgParPaxParFlux.biodechet).toBeCloseTo(0.075, 6);
    expect(body.data.kgParPaxParFlux.cartons).toBeCloseTo(0.0125, 6);
    expect(body.data.nbCollectes).toBe(2);
    // Période fixe 24 mois glissants, imposée côté serveur (§06.05 l.172).
    expect(body.data.periode).toEqual(periodeBenchmark());
    expect(gteCalls()).toContainEqual([
      'date_collecte',
      periodeBenchmark().debut,
    ]);
    expect(lteCalls()).toContainEqual([
      'date_collecte',
      periodeBenchmark().fin,
    ]);
    // Collectes clôturées Zéro Déchet seules.
    const eqCalls = (adminClient.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(['statut', 'cloturee']);
    expect(eqCalls).toContainEqual(['type', 'zero_dechet']);
    // Sans filtre : aucune restriction de traiteur/lieu/type.
    expect(inCalls()).toHaveLength(0);
    // Plus de passage par la fonction k-anonyme côté Admin.
    expect(adminClient.rpc).not.toHaveBeenCalled();
    // `evenements!inner` : sans lui, les filtres `.in('evenements.…')` ne
    // retireraient aucune collecte (embed vidé, ligne conservée).
    const selectArg = String(
      (adminClient.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    );
    expect(selectArg).toContain('evenements!inner(');
    // Pagination explicite (plafond PostgREST max_rows = 1 000) : tri stable + page.
    expect(adminClient.order).toHaveBeenCalledWith('id');
    expect(adminClient.range).toHaveBeenCalledWith(0, PAGE_REFERENCE - 1);
  });

  it('M3.6/benchmark_admin_reference_filtres_sans_k_anonymat — pagination : au-delà de 1 000 collectes, la référence n’est pas tronquée', async () => {
    // Faux client : page 1 pleine (1 000 lignes), page 2 = 1 ligne → 1 001.
    const ligne = (i: number) => ({
      ...COLLECTES_REFERENCE[0]!,
      id: `c${i}`,
      evenements: { ...COLLECTES_REFERENCE[0]!.evenements, id: `e${i}` },
    });
    const pages: unknown[][] = [
      Array.from({ length: PAGE_REFERENCE }, (_, i) => ligne(i)),
      [ligne(PAGE_REFERENCE)],
    ];
    const ranges: [number, number][] = [];
    const faux: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'eq', 'in', 'gte', 'lte', 'order'])
      faux[m] = () => faux;
    faux.range = (a: number, b: number) => {
      ranges.push([a, b]);
      return Promise.resolve({
        data: pages[ranges.length - 1] ?? [],
        error: null,
      });
    };
    const { loadAdminBenchmarkComparaison } =
      await import('@/lib/dashboards/admin-dashboard-client.js');
    const res = await loadAdminBenchmarkComparaison(faux as never, {
      traiteurIds: [],
      lieuIds: [],
      typeEvtIds: [],
      tailleEvts: [],
    });
    expect(ranges).toEqual([
      [0, PAGE_REFERENCE - 1],
      [PAGE_REFERENCE, 2 * PAGE_REFERENCE - 1],
    ]);
    expect(res.nbCollectes).toBe(PAGE_REFERENCE + 1);
    // 1 001 événements de 100 pax, 20 kg de biodéchets chacun → 0,20 kg/pax.
    expect(res.kgParPaxParFlux.biodechet).toBeCloseTo(0.2, 6);
  });

  it('M3.6/benchmark_admin_reference_filtres_sans_k_anonymat — un seul traiteur ciblé est publié (pas de seuil k≥5 / ≥3 acteurs côté Admin)', async () => {
    setupAuth('admin_savr');
    queryResult = { data: COLLECTES_REFERENCE, error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(
      makeReq(
        `/api/v1/admin/dashboard-client/benchmark?traiteur_ids=${T1},${T2}&lieu_ids=${LIEU1}&type_evenement_ids=pas-un-uuid&taille_evenement_codes=M,L`,
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { kgParPaxParFlux: Record<string, number>; nbCollectes: number };
    };
    // Filtres transmis à la requête (traiteur OPÉRATIONNEL, même clé que le
    // périmètre et le Top 5) ; un id non-UUID est écarté (défense en profondeur).
    expect(inCalls()).toContainEqual([
      'evenements.traiteur_operationnel_organisation_id',
      [T1, T2],
    ]);
    expect(inCalls()).toContainEqual(['evenements.lieu_id', [LIEU1]]);
    expect(
      inCalls().find((c) => c[0] === 'evenements.type_evenement_id'),
    ).toBeUndefined();
    // Taille en JS (parité §06.05) : 100 pax = XS et 300 pax = S → hors M/L →
    // référence vide, mais la réponse reste 200 (axes « n/d »), pas une erreur.
    expect(body.data.nbCollectes).toBe(0);
    expect(body.data.kgParPaxParFlux).toEqual({});
    expect(adminClient.rpc).not.toHaveBeenCalled();

    // Même traiteur, taille XS : la seule collecte de 100 pax (20 kg) d'UN SEUL
    // acteur → publiée (0,20 kg/pax), là où le client aurait un segment masqué.
    const res2 = await GET(
      makeReq(
        `/api/v1/admin/dashboard-client/benchmark?traiteur_ids=${T1}&taille_evenement_codes=XS`,
      ),
    );
    const body2 = (await res2.json()) as {
      data: { kgParPaxParFlux: Record<string, number>; nbCollectes: number };
    };
    expect(body2.data.nbCollectes).toBe(1);
    expect(body2.data.kgParPaxParFlux.biodechet).toBeCloseTo(0.2, 6);
  });

  it('M3.6/benchmark_staff_service_role — 401 sans session', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(makeReq('/api/v1/admin/dashboard-client/benchmark'));
    expect(res.status).toBe(401);
  });

  it('M3.6/benchmark_admin_reference_filtres_sans_k_anonymat — 403 pour un rôle client', async () => {
    setupAuth('traiteur_manager');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/route.js');
    const res = await GET(
      makeReq(`/api/v1/admin/dashboard-client/benchmark?traiteur_ids=${T1}`),
    );
    expect(res.status).toBe(403);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
});

describe('M3.6 / Dashboard Client / benchmark filtres', () => {
  it('M3.6/benchmark_admin_filtres_options — lieux, traiteurs (non fantômes) et types pour l’encart « Comparer avec »', async () => {
    setupAuth('ops_savr');
    queryResult = { data: [{ id: 'x', nom: 'X', libelle: 'X' }], error: null };
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/filtres/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/benchmark/filtres'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { lieux: unknown[]; traiteurs: unknown[]; types: unknown[] };
    };
    expect(body.data.lieux).toHaveLength(1);
    expect(body.data.traiteurs).toHaveLength(1);
    expect(body.data.types).toHaveLength(1);
    const froms = (adminClient.from as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(froms).toEqual(
      expect.arrayContaining(['lieux', 'organisations', 'types_evenements']),
    );
    // Mêmes critères que f_benchmark_traiteurs_parc : traiteurs actifs, non shadow.
    const eqCalls = (adminClient.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqCalls).toContainEqual(['type', 'traiteur']);
    const neqCalls = (adminClient.neq as ReturnType<typeof vi.fn>).mock.calls;
    expect(neqCalls).toContainEqual(['est_shadow', true]);
  });

  it('M3.6/benchmark_admin_filtres_options — 403 pour un rôle client', async () => {
    setupAuth('gestionnaire_lieux');
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/filtres/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/benchmark/filtres'),
    );
    expect(res.status).toBe(403);
  });

  it('M3.6/benchmark_admin_filtres_options — 401 sans session', async () => {
    setupNoAuth();
    const { GET } =
      await import('@/app/api/v1/admin/dashboard-client/benchmark/filtres/route.js');
    const res = await GET(
      makeReq('/api/v1/admin/dashboard-client/benchmark/filtres'),
    );
    expect(res.status).toBe(401);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
});
