/**
 * R-perf (perf/ssr-dashboard-traiteur) — loaders serveur des dashboards.
 *
 * Verrouille (1) les transformations pures d'agrégation §11 extraites des routes
 * (top lieux / acteurs / associations / kg-pax par flux) et (2) le contrat des
 * loaders qui font l'I/O (fenêtre N-1 kpi, strip marge agence, garde traiteur_ids
 * benchmark, marge en attente) via un faux client Supabase (chaînage + rpc).
 */
import { describe, it, expect } from 'vitest';
import {
  topLieuxFrom,
  aggregateActeurs,
  topAssociationsFrom,
  kgParPaxParFluxFrom,
  loadKpiTraiteur,
  loadMargeAttente,
  loadBenchmark,
  loadBenchmarkFiltres,
  loadTraiteurDashboard,
  LoaderError,
  type DbClient,
  type LoaderCtx,
} from './loaders.js';

// ── Faux client Supabase : chaînage .select/.eq/.gte/... thenable + .rpc ─────────
interface FakeConfig {
  tables?: Record<string, unknown[]>;
  rpc?: Record<string, unknown[]>;
}
function makeSupabase(config: FakeConfig): DbClient {
  const rows = (t: string) => config.tables?.[t] ?? [];
  const makeQuery = (table: string) => {
    const list = Promise.resolve({ data: rows(table), error: null });
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      lte: () => q,
      in: () => q,
      order: () => q,
      maybeSingle: () =>
        Promise.resolve({ data: rows(table)[0] ?? null, error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        list.then(onF, onR),
    };
    return q;
  };
  return {
    from: (table: string) => makeQuery(table),
    rpc: (name: string) =>
      Promise.resolve({ data: config.rpc?.[name] ?? [], error: null }),
  } as unknown as DbClient;
}

const CTX_TRAITEUR: LoaderCtx = {
  userId: 'u1',
  role: 'traiteur_manager',
  organisationId: 'org-1',
};
const CTX_AGENCE: LoaderCtx = { ...CTX_TRAITEUR, role: 'agence' };
const CTX_GEST: LoaderCtx = { ...CTX_TRAITEUR, role: 'gestionnaire_lieux' };

// Ligne « collecte historique » minimale pour les transforms (evenements + flux).
function coll(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'zero_dechet',
    taux_recyclage: 80,
    date_collecte: '2026-06-01',
    evenements: {
      id: 'e1',
      lieu_id: 'L1',
      pax: 100,
      organisation_id: 'org-1',
      type_evenement_id: null,
      traiteur_operationnel_organisation_id: 't1',
      created_by: 'com1',
      lieux: { id: 'L1', nom: 'Lieu A' },
    },
    collecte_flux: [{ poids_reel_kg: 200 }],
    attributions_antgaspi: null,
    ...over,
  };
}

describe('loaders — transforms pures §11', () => {
  it('topLieuxFrom (ZD) agrège tonnage + taux pondéré et trie par tonnage', () => {
    const rows = [
      coll(),
      coll({
        id: 'c2',
        taux_recyclage: 60,
        collecte_flux: [{ poids_reel_kg: 100 }],
      }),
      coll({
        id: 'c3',
        evenements: {
          id: 'e2',
          lieu_id: 'L2',
          pax: 50,
          organisation_id: 'org-1',
          type_evenement_id: null,
          traiteur_operationnel_organisation_id: 't1',
          created_by: 'com1',
          lieux: { id: 'L2', nom: 'Lieu B' },
        },
        collecte_flux: [{ poids_reel_kg: 50 }],
      }),
    ];
    const out = topLieuxFrom(rows as never, 'zero_dechet');
    expect(out.map((l) => l.lieu_nom)).toEqual(['Lieu A', 'Lieu B']); // 300 kg > 50 kg
    const a = out[0]!;
    expect(a.nb_collectes).toBe(2);
    expect(a.tonnage_kg).toBe(300);
    // Taux pondéré tonnage = (80*200 + 60*100) / 300 = 73.33…
    expect(a.taux_recyclage).toBeCloseTo((80 * 200 + 60 * 100) / 300, 5);
  });

  it('aggregateActeurs trie par nombre de collectes (Bloc 7)', () => {
    const rows = [
      coll(),
      coll({ id: 'c2' }),
      coll({
        id: 'c3',
        evenements: {
          id: 'e9',
          lieu_id: 'L1',
          pax: 10,
          organisation_id: 'org-1',
          type_evenement_id: null,
          traiteur_operationnel_organisation_id: 't1',
          created_by: 'com2',
          lieux: { id: 'L1', nom: 'Lieu A' },
        },
      }),
    ];
    const out = aggregateActeurs(
      rows as never,
      'zero_dechet',
      (e) => e.created_by,
    );
    expect(out[0]!.id).toBe('com1'); // 2 collectes
    expect(out[0]!.nb_collectes).toBe(2);
    expect(out[1]!.id).toBe('com2'); // 1 collecte
  });

  it('topAssociationsFrom (AG) agrège repas reçus + collectes distinctes', () => {
    const rows = [
      coll({
        type: 'anti_gaspi',
        collecte_flux: null,
        attributions_antgaspi: [
          {
            volume_repas_realise: 40,
            association_id: 'a1',
            associations: { id: 'a1', nom: 'Asso Un', ville: 'Paris' },
          },
        ],
      }),
      coll({
        id: 'c2',
        type: 'anti_gaspi',
        collecte_flux: null,
        attributions_antgaspi: [
          {
            volume_repas_realise: 30,
            association_id: 'a1',
            associations: { id: 'a1', nom: 'Asso Un', ville: 'Paris' },
          },
        ],
      }),
    ];
    const out = topAssociationsFrom(rows as never);
    expect(out).toHaveLength(1);
    expect(out[0]!.repas_recus).toBe(70);
    expect(out[0]!.nb_collectes).toBe(2);
    expect(out[0]!.ville).toBe('Paris');
  });

  it('kgParPaxParFluxFrom divise le poids du flux par le pax distinct', () => {
    const rows = [
      coll({
        collecte_flux: [
          { poids_reel_kg: 200, flux_dechets: { code: 'biodechet' } },
        ],
      }),
    ];
    const out = kgParPaxParFluxFrom(rows as never);
    expect(out.biodechet).toBeCloseTo(200 / 100, 5); // pax = 100
  });
});

describe('loaders — I/O (faux Supabase)', () => {
  it('loadKpiTraiteur découpe la fenêtre N-1 (courante vs précédente)', async () => {
    const supabase = makeSupabase({
      tables: {
        v_kpi_traiteur: [
          { mois: '2026-03-01', type_collecte: 'zero_dechet', marge_zd_ht: 10 },
          { mois: '2026-05-01', type_collecte: 'zero_dechet', marge_zd_ht: 20 },
          { mois: '2025-09-01', type_collecte: 'zero_dechet', marge_zd_ht: 5 },
        ],
        organisations: [{ tarif_refacture_pax_zd: 12 }],
      },
    });
    const res = await loadKpiTraiteur(supabase, CTX_TRAITEUR, {
      from: '2026-01-01',
      to: '2026-06-30',
      type: 'zero_dechet',
      compare: 'n1',
    });
    expect(res.data).toHaveLength(2); // 2026-03 + 2026-05
    expect(res.previous).toHaveLength(1); // 2025-09 (fenêtre N-1)
    expect(res.tarif_refacture_pax_zd).toBe(12);
    // marge conservée pour le traiteur.
    expect((res.data[0] as { marge_zd_ht?: number }).marge_zd_ht).toBeDefined();
  });

  it('loadKpiTraiteur retire marge_zd_ht pour l’agence (§06.11 diff #7)', async () => {
    const supabase = makeSupabase({
      tables: {
        v_kpi_traiteur: [
          { mois: '2026-03-01', type_collecte: 'zero_dechet', marge_zd_ht: 10 },
        ],
      },
    });
    const res = await loadKpiTraiteur(supabase, CTX_AGENCE, {
      from: '2026-01-01',
      to: '2026-06-30',
      type: 'zero_dechet',
      compare: 'n1',
    });
    expect('marge_zd_ht' in (res.data[0] as object)).toBe(false);
    // L'agence n'obtient pas le tarif de refacturation (pas de carte Marge).
    expect(res.tarif_refacture_pax_zd).toBeNull();
  });

  it('loadMargeAttente ne compte que les collectes sans facture emise/payee', async () => {
    const supabase = makeSupabase({
      tables: {
        collectes: [
          {
            id: 'c1',
            date_collecte: '2026-06-01',
            factures_collectes: [
              { facture_id: 'f1', factures: { statut: 'emise' } },
            ],
          },
          {
            id: 'c2',
            date_collecte: '2026-06-02',
            factures_collectes: [
              { facture_id: 'f2', factures: { statut: 'brouillon' } },
            ],
          },
          { id: 'c3', date_collecte: '2026-06-03', factures_collectes: [] },
        ],
      },
    });
    const res = await loadMargeAttente(supabase, {
      from: '2026-01-01',
      to: '2026-06-30',
    });
    expect(res.nb_en_attente).toBe(2); // c2 (brouillon) + c3 (aucune)
  });

  it('loadBenchmark rejette traiteur_ids pour le traiteur (403 §04 compétitif)', async () => {
    const supabase = makeSupabase({ rpc: { f_benchmark_kg_pax_zd: [] } });
    await expect(
      loadBenchmark(supabase, CTX_TRAITEUR, { traiteurIds: ['x'] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('loadBenchmark autorise traiteur_ids pour le gestionnaire + passe la RPC', async () => {
    const supabase = makeSupabase({
      rpc: {
        f_benchmark_kg_pax_zd: [{ flux_code: 'biodechet', moyenne: 1.2 }],
      },
    });
    const out = await loadBenchmark(supabase, CTX_GEST, { traiteurIds: ['x'] });
    expect(out).toEqual([{ flux_code: 'biodechet', moyenne: 1.2 }]);
  });

  it('loadBenchmarkFiltres n’expose PAS la liste traiteurs au traiteur', async () => {
    const supabase = makeSupabase({
      rpc: {
        f_benchmark_lieux_parc: [{ id: 'L1', nom: 'Lieu A' }],
        f_benchmark_traiteurs_parc: [{ id: 't1', nom: 'Traiteur' }],
      },
      tables: { types_evenements: [{ id: 'ty1', libelle: 'Gala' }] },
    });
    const res = await loadBenchmarkFiltres(supabase, CTX_TRAITEUR);
    expect(res.lieux).toHaveLength(1);
    expect(res.traiteurs).toEqual([]); // masqué (compétitif)
    expect(res.types).toHaveLength(1);
  });

  it('LoaderError porte le status HTTP', () => {
    expect(new LoaderError('x', 403).status).toBe(403);
    expect(new LoaderError('y').status).toBe(500);
  });

  it('loadTraiteurDashboard (ZD) renvoie marge + pack null en UN payload', async () => {
    const supabase = makeSupabase({
      tables: {
        v_kpi_traiteur: [
          { mois: '2026-03-01', type_collecte: 'zero_dechet', marge_zd_ht: 10 },
        ],
        organisations: [{ tarif_refacture_pax_zd: 12 }],
        collectes: [], // évolution/blocs vides — I/O uniquement, transforms testés à part
      },
    });
    const res = await loadTraiteurDashboard(supabase, CTX_TRAITEUR, {
      from: '2026-01-01',
      to: '2026-06-30',
      type: 'zero_dechet',
    });
    expect(res.kpi.data).toHaveLength(1);
    expect(res.evolution.series).toEqual([]);
    expect(res.marge).toEqual({ nb_en_attente: 0 });
    expect(res.pack).toBeNull(); // pack = AG only (aucun appel service_role en ZD)
  });
});
