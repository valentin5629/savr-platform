/**
 * Cartes KPI : variation N-1 (sauf kg/pax), sans courbe de tendance, sur les
 * dashboards gestionnaire (§06.05), agence (§11 §4 = traiteur à l'identique) et
 * Dashboard Client Admin (§11 §1.2 = reprise exacte du gestionnaire). La courbe
 * des cartes est retirée de tous les dashboards (Val 2026-10-30).
 *
 * Gestionnaire / Admin n'ont pas de lignes KPI mensuelles : la variation vient
 * d'un second appel du même endpoint sur `previousWindow`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';
import AgenceDashboardPage from '@/app/(agence)/agence/page.js';
import { DashboardClientView } from '@/app/(admin)/admin/dashboard-client/DashboardClientView.js';
import {
  buildEvolutionSeries,
  type EvoCollecteRow,
} from '@/lib/dashboards/loaders.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

function makeStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
});

/** Carte KPI (enfant direct de la grille) portant ce libellé. */
function carte(label: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(label);
  while (el?.parentElement && !el.parentElement.className.includes('grid'))
    el = el.parentElement;
  if (!el) throw new Error(`carte ${label} introuvable`);
  return el;
}

const SERIE_ZD = [
  {
    periode: '2026-04',
    tonnage_total: 400,
    taux_recyclage: 60,
    nb_collectes: 3,
    pax: 400,
    kg_par_pax: 1,
    co2_evite_kg: 100,
  },
  {
    periode: '2026-05',
    tonnage_total: 500,
    taux_recyclage: 70,
    nb_collectes: 4,
    pax: 500,
    kg_par_pax: 1,
    co2_evite_kg: 150,
  },
  {
    periode: '2026-06',
    tonnage_total: 300,
    taux_recyclage: 75,
    nb_collectes: 5,
    pax: 300,
    kg_par_pax: 1,
    co2_evite_kg: 120,
  },
];

// ── Fonctions pures ──────────────────────────────────────────────────────────
describe('Série d’évolution enrichie par bucket', () => {
  const evt = (id: string, pax: number) => ({
    id,
    lieu_id: 'l',
    pax,
    organisation_id: 'o',
    type_evenement_id: null,
    traiteur_operationnel_organisation_id: null,
  });

  it('M3.2/kpi_sparkline_serie_zd_nb_collectes_pax_co2_par_bucket', () => {
    const rows: EvoCollecteRow[] = [
      {
        id: 'c1',
        type: 'zero_dechet',
        taux_recyclage: 50,
        date_collecte: '2026-05-03',
        co2_evite_kg: 10,
        pax: 70,
        evenements: evt('e1', 100),
        collecte_flux: [
          { poids_reel_kg: 40, flux_dechets: { code: 'biodechet' } },
        ],
        attributions_antgaspi: null,
      },
      // Même événement (100 convives), même mois : chaque collecte compte ses
      // propres convives (lot 3, décisions Val Q1 et Q2 du 2026-10-25).
      {
        id: 'c2',
        type: 'zero_dechet',
        taux_recyclage: 50,
        date_collecte: '2026-05-20',
        co2_evite_kg: '5',
        pax: 50,
        evenements: evt('e1', 100),
        collecte_flux: [
          { poids_reel_kg: 60, flux_dechets: { code: 'carton' } },
        ],
        attributions_antgaspi: null,
      },
      {
        id: 'c3',
        type: 'zero_dechet',
        taux_recyclage: null,
        date_collecte: '2026-06-01',
        pax: 0, // reprise Bubble sans convives (l'événement en annonce 30)
        evenements: evt('e2', 30),
        collecte_flux: [],
        attributions_antgaspi: null,
      },
    ];
    const s = buildEvolutionSeries(rows, 'zero_dechet', 'mois');
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({
      tonnage_total: 100,
      nb_collectes: 2,
      pax: 120,
      co2_evite_kg: 15,
    });
    expect(s[0]!.kg_par_pax as number).toBeCloseTo(100 / 120, 6);
    // Collecte sans convives (c3) : aucun kg/pax, jamais une division par 0.
    expect(s[1]!.kg_par_pax).toBeNull();
    // Sans co2 sélectionné (loader gestionnaire) : 0, pas NaN.
    expect(s[1]).toMatchObject({ nb_collectes: 1, pax: 0, co2_evite_kg: 0 });
  });

  it('M3.2/kpi_sparkline_serie_ag_nb_collectes_par_bucket', () => {
    const rows: EvoCollecteRow[] = [
      {
        id: 'a1',
        type: 'anti_gaspi',
        taux_recyclage: null,
        date_collecte: '2026-05-03',
        co2_evite_kg: 25,
        pax: 80,
        evenements: evt('e1', 100),
        collecte_flux: null,
        attributions_antgaspi: [{ volume_repas_realise: 40 }],
      },
      {
        id: 'a2',
        type: 'anti_gaspi',
        taux_recyclage: null,
        date_collecte: '2026-05-09',
        pax: 50,
        evenements: evt('e2', 50),
        collecte_flux: null,
        attributions_antgaspi: { volume_repas_realise: 10 },
      },
    ];
    const [b] = buildEvolutionSeries(rows, 'anti_gaspi', 'mois');
    expect(b).toMatchObject({
      repas_donnes: 50,
      pax: 130,
      nb_collectes: 2,
      co2_evite_kg: 25,
    });
    expect(b!.ratio as number).toBeCloseTo(50 / 130, 6);
  });
});

// ── Gestionnaire (§06.05 l.136) ──────────────────────────────────────────────
function gestionnaireFetch() {
  let appelsDashboard = 0;
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/gestionnaire/filtres'))
      return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
    if (url.includes('/gestionnaire/dashboard')) {
      // Promise.all : 1er appel = période courante, 2e = N-1.
      const courant = appelsDashboard++ % 2 === 0;
      return jsonResponse({
        data: {
          kpis: {
            nb_collectes: courant ? 12 : 6,
            tonnage_kg: courant ? 1200 : 1000,
            taux_recyclage_pondere: 70,
            kg_par_pax: 1.2,
            nb_repas_donnes: null,
            pax_total: null,
            repas_par_pax: null,
          },
          pack: null,
          kg_par_pax_par_flux: {},
        },
      });
    }
    if (url.includes('/dashboards/evolution'))
      return jsonResponse({ data: { granularite: 'mois', series: SERIE_ZD } });
    if (url.includes('/dashboards/benchmark/filtres'))
      return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
    if (url.includes('/dashboards/benchmark'))
      return jsonResponse({ data: [] });
    if (url.includes('/dashboards/blocs'))
      return jsonResponse({
        data: {
          topLieux: [],
          topActeurs: [],
          acteurLabel: 'Traiteur',
          topAssociations: null,
          kgParPaxParFlux: {},
        },
      });
    return jsonResponse({});
  });
}

describe('M3.2 / gestionnaire — variation N-1, sans courbe', () => {
  it(
    'M3.2/kpi_cartes_variation_n1_sans_courbe',
    async () => {
      const fetchMock = gestionnaireFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(<GestionnaireDashboardPage />);
      await screen.findByText('Nombre de collectes', undefined, ATTENTE_UI);

      // 12 vs 6 → +100 % ; tonnage 1200 vs 1000 → +20 %.
      expect(carte('Nombre de collectes')).toHaveTextContent('▲ 100,0 %');
      expect(carte('Tonnage collecté')).toHaveTextContent('▲ 20,0 %');
      expect(carte('Nombre de collectes').querySelector('polyline')).toBeNull();
      // kg/pax : jamais de variation, ni courbe.
      expect(carte('kg/pax moyen').querySelector('polyline')).toBeNull();
      expect(carte('kg/pax moyen').textContent).not.toMatch(/[▲▼]/);

      // Le 2e appel porte bien la période précédente équivalente, accolée.
      const urls = fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes('/gestionnaire/dashboard'));
      const [cur, prev] = urls.slice(0, 2).map((u) => new URL(u, 'http://t'));
      const jour = 86_400_000;
      expect(
        Date.parse(cur!.searchParams.get('from')!) -
          Date.parse(prev!.searchParams.get('to')!),
      ).toBe(jour);
    },
    ATTENTE_CAS_MS,
  );
});

// ── Agence (§11 §4 : traiteur à l'identique) ─────────────────────────────────
describe('M3.3 / agence — variation N-1, sans courbe', () => {
  it(
    'M3.3/kpi_cartes_variation_n1_sans_courbe',
    async () => {
      const ligne = (mois: string, nb: number) => ({
        mois,
        type_collecte: 'zero_dechet',
        nb_collectes: nb,
        tonnage_kg: 100 * nb,
        taux_recyclage_pondere: 70,
        nb_repas_donnes: 0,
        marge_zd_ht: null,
        pax_total: 50 * nb,
      });
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboards/kpi-traiteur'))
          return jsonResponse({
            data: [ligne('2026-05-01', 4), ligne('2026-06-01', 6)],
            previous: [ligne('2025-06-01', 5)],
          });
        if (url.includes('/dashboards/blocs'))
          return jsonResponse({
            data: {
              topLieux: [],
              topActeurs: null,
              acteurLabel: null,
              topAssociations: null,
              kgParPaxParFlux: {},
            },
          });
        if (url.includes('/dashboards/benchmark/filtres'))
          return jsonResponse({
            data: { lieux: [], traiteurs: [], types: [] },
          });
        if (url.includes('/dashboards/benchmark'))
          return jsonResponse({ data: [] });
        if (url.includes('/dashboards/evolution'))
          return jsonResponse({ data: { granularite: 'mois', series: [] } });
        return jsonResponse({});
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<AgenceDashboardPage />);
      await screen.findByText('Nombre de collectes', undefined, ATTENTE_UI);

      // 10 vs 5 → +100 %, et la N-1 est bien demandée (compare=n1).
      expect(carte('Nombre de collectes')).toHaveTextContent('▲ 100,0 %');
      expect(carte('Nombre de collectes').querySelector('polyline')).toBeNull();
      expect(carte('kg/pax moyen').textContent).not.toMatch(/[▲▼]/);
      expect(
        fetchMock.mock.calls.some(
          ([u]) =>
            String(u).includes('/dashboards/kpi-traiteur') &&
            String(u).includes('compare=n1'),
        ),
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );
});

// ── Dashboard Client Admin (§11 §1.2 : reprise exacte du gestionnaire) ───────
describe('M3.6 / dashboard-client Admin — variation N-1, sans courbe', () => {
  it(
    'M3.6/kpi_cartes_variation_n1_co2_compris_sans_courbe',
    async () => {
      let appels = 0;
      const payload = (courant: boolean) => ({
        kpi: {
          nb_collectes: courant ? 12 : 8,
          tonnage_kg: 1200,
          taux_recyclage_pondere: 70,
          kg_par_pax: 1.2,
        },
        kgParPaxParFlux: {},
        evolution: { granularite: 'mois', series: SERIE_ZD },
        co2: {
          eviteKg: courant ? 370 : 185,
          induitKg: 0,
          netKg: 0,
          energieKwh: 0,
        },
        facteursCo2: { km_voiture: 0.218, repas_boeuf: 7, foyer_kwh: 4500 },
        blocs: {
          topLieux: [],
          topActeurs: [],
          acteurLabel: 'Traiteur',
          topAssociations: null,
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/dashboard-client/organisations'))
            return jsonResponse({ data: [] });
          if (url.includes('/dashboard-client/benchmark/filtres'))
            return jsonResponse({
              data: { lieux: [], traiteurs: [], types: [] },
            });
          if (url.includes('/dashboard-client/benchmark'))
            return jsonResponse({
              data: {
                kgParPaxParFlux: {},
                nbCollectes: 0,
                periode: { debut: '2024-10-02', fin: '2026-10-02' },
              },
            });
          if (url.includes('/dashboard-client'))
            return jsonResponse({ data: payload(appels++ % 2 === 0) });
          return jsonResponse({});
        }),
      );
      render(<DashboardClientView />);
      await screen.findByText('Nombre de collectes', undefined, ATTENTE_UI);

      expect(carte('Nombre de collectes')).toHaveTextContent('▲ 50,0 %');
      expect(carte('CO₂ évité')).toHaveTextContent('▲ 100,0 %');
      expect(carte('CO₂ évité').querySelector('polyline')).toBeNull();
      expect(carte('Tonnage collecté').querySelector('polyline')).toBeNull();
      expect(carte('kg/pax moyen').textContent).not.toMatch(/[▲▼]/);
    },
    ATTENTE_CAS_MS,
  );
});

// Lot 3 du pax porté par la collecte (décisions Val Q1, Q2 et Q5 du 2026-10-25) :
// les cartes agence (lignes de v_kpi_traiteur) divisent le poids et les repas des
// seules collectes à convives connus par les pax des collectes.
describe('Lot 3 / agence — ratios par pax des collectes à convives', () => {
  it(
    'Lot3/agence_carte_kg_par_pax_collectes_a_convives — kg/pax 600 / 300 (et non 1 000 / 300)',
    async () => {
      const ligneZd = {
        mois: '2026-06-01',
        type_collecte: 'zero_dechet',
        nb_collectes: 3,
        tonnage_kg: 1000,
        tonnage_kg_pax_connu: 600,
        taux_recyclage_pondere: 70,
        nb_repas_donnes: null,
        nb_repas_pax_connu: null,
        marge_zd_ht: null,
        pax_total: 300,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/dashboards/kpi-traiteur'))
            return jsonResponse({
              data: [ligneZd],
              previous: [],
            });
          if (url.includes('/dashboards/blocs'))
            return jsonResponse({
              data: {
                topLieux: [],
                topActeurs: null,
                acteurLabel: null,
                topAssociations: [],
                kgParPaxParFlux: {},
              },
            });
          if (url.includes('/dashboards/benchmark/filtres'))
            return jsonResponse({
              data: { lieux: [], traiteurs: [], types: [] },
            });
          if (url.includes('/dashboards/benchmark'))
            return jsonResponse({ data: [] });
          if (url.includes('/dashboards/evolution'))
            return jsonResponse({ data: { granularite: 'mois', series: [] } });
          return jsonResponse({});
        }),
      );
      render(<AgenceDashboardPage />);
      await screen.findByText('kg/pax moyen', undefined, ATTENTE_UI);
      expect(carte('kg/pax moyen')).toHaveTextContent('2,00');
    },
    ATTENTE_CAS_MS,
  );
});
