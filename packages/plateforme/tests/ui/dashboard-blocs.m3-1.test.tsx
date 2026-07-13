/**
 * M3.1 — Dashboard traiteur « Cockpit » (R24) : Bloc 2 (évolution) + Bloc 4 (donut)
 * montés (§06.04 Bloc 2/4). Les charts Cockpit sont du SVG pur (pas recharts) → ils
 * rendent en jsdom : on vérifie que les SECTIONS §11 sont montées au bon endroit et
 * conditionnées à l'onglet (Bloc 4 donut = ZD only).
 *
 * Depuis le passage SSR (perf/ssr-dashboard-traiteur), le premier rendu se fait via
 * `TraiteurDashboardClient` alimenté par `initialData` (payload serveur). Le switch
 * d'onglet re-fetch l'endpoint consolidé `/api/v1/dashboards/traiteur-full`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur',
}));

import { TraiteurDashboardClient } from '@/app/(traiteur)/traiteur/traiteur-dashboard-client';
import { FACTEURS_CO2_DEFAUT } from '@/lib/dashboards/cockpit-derive';
import type { TraiteurDashboardPayload } from '@/lib/dashboards/loaders';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

// Période par défaut identique à la page SSR (12 derniers mois) → aucune divergence
// avec les défauts des barres de filtres, donc aucun re-fetch parasite au montage.
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
const PERIOD = defaultPeriod();

function kpiResult(rows: unknown[]): TraiteurDashboardPayload['kpi'] {
  return {
    data: rows,
    previous: [],
    tarif_refacture_pax_zd: null,
    facteurs_co2: FACTEURS_CO2_DEFAUT,
    co2_methode: {
      forfait: { km: 50, fe_camion: 2.1 },
      flux: [],
      ag: { facteur_par_repas: 2.5, source: null },
    },
  };
}

const EMPTY_BLOCS = {
  prochaines: [],
  topLieux: [],
  topActeurs: [],
  acteurLabel: 'Commercial' as const,
  topAssociations: null,
  kgParPaxParFlux: {},
};

const ZD_PAYLOAD: TraiteurDashboardPayload = {
  kpi: kpiResult([
    {
      mois: '2026-06-01',
      type_collecte: 'zero_dechet',
      nb_collectes: 3,
      tonnage_kg: 500,
      taux_recyclage_pondere: 80,
      nb_repas_donnes: 0,
      marge_zd_ht: 100,
      pax_total: 200,
    },
  ]),
  evolution: {
    granularite: 'mois',
    series: [
      {
        periode: '2026-06-01',
        biodechet: 300,
        emballage: 100,
        carton: 50,
        verre: 25,
        dechet_residuel: 25,
        tonnage_total: 500,
        taux_recyclage: 80,
      },
    ],
  },
  blocs: EMPTY_BLOCS,
  marge: { nb_en_attente: 0 },
  pack: null,
};

const AG_PAYLOAD: TraiteurDashboardPayload = {
  kpi: kpiResult([
    {
      mois: '2026-06-01',
      type_collecte: 'anti_gaspi',
      nb_collectes: 3,
      tonnage_kg: null,
      taux_recyclage_pondere: null,
      nb_repas_donnes: 120,
      marge_zd_ht: null,
      pax_total: 200,
    },
  ]),
  evolution: {
    granularite: 'mois',
    series: [
      { periode: '2026-06-01', repas_donnes: 120, pax: 200, ratio: 0.6 },
    ],
  },
  blocs: { ...EMPTY_BLOCS, topAssociations: [] },
  marge: null,
  pack: { pack_actif: false },
};

const BENCHMARK_PROP = {
  rows: [],
  options: { lieux: [], traiteurs: [], types: [] },
  filters: {
    periode_debut: PERIOD.from,
    periode_fin: PERIOD.to,
    type_evenement_ids: [],
    taille_evenement_codes: [],
    lieu_ids: [],
    traiteur_ids: [],
  },
};

// Le switch d'onglet re-fetch l'endpoint consolidé ; le benchmark reste sur sa route.
const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/dashboards/traiteur-full')) {
    return jsonResponse({
      data: url.includes('type=anti_gaspi') ? AG_PAYLOAD : ZD_PAYLOAD,
    });
  }
  if (url.includes('/dashboards/benchmark')) return jsonResponse({ data: [] });
  return jsonResponse({});
});

function makeLocalStorage(): Storage {
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

function renderClient(initial: TraiteurDashboardPayload) {
  return render(
    <TraiteurDashboardClient
      initialData={initial}
      initialFilters={PERIOD}
      benchmark={BENCHMARK_PROP}
    />,
  );
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeLocalStorage());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('M3.1 / dashboard traiteur — Bloc 2/4 §11 (BL-P1-PARITE-01)', () => {
  it('M3.1/dash_bloc2_bloc4_zd_montes — Évolution + donut sur l’onglet ZD', async () => {
    renderClient(ZD_PAYLOAD);
    expect(await screen.findByTestId('bloc-2-traiteur')).toBeInTheDocument();
    expect(screen.getByTestId('bloc-4-traiteur')).toBeInTheDocument();
    // Le graphe ZD Cockpit (barres empilées flux) est monté dans le Bloc 2.
    expect(
      screen.getByText(/Évolution mensuelle Zéro Déchet/),
    ).toBeInTheDocument();
  });

  it('M3.1/dash_bloc4_zd_only — pas de donut sur l’onglet AG (un seul flux)', async () => {
    renderClient(ZD_PAYLOAD);
    await screen.findByTestId('bloc-2-traiteur');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    // Bloc 2 AG toujours présent (courbe repas), Bloc 4 donut retiré.
    expect(await screen.findByTestId('bloc-2-traiteur')).toBeInTheDocument();
    expect(screen.queryByTestId('bloc-4-traiteur')).toBeNull();
    expect(screen.getByText(/Évolution Anti-Gaspi/)).toBeInTheDocument();
  });
});
