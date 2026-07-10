/**
 * M3.1 — Dashboard traiteur « Cockpit » (R24) : Bloc 2 (évolution) + Bloc 4 (donut)
 * montés (§06.04 Bloc 2/4). Les charts Cockpit sont du SVG pur (pas recharts) → ils
 * rendent en jsdom : on vérifie que les SECTIONS §11 sont montées au bon endroit et
 * conditionnées à l'onglet (Bloc 4 donut = ZD only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur',
}));

vi.mock('@/components/dashboards/charts/lazy.js', () => ({
  EvolutionFluxChart: () => <div data-testid="stub-flux" />,
  EvolutionRepasChart: () => <div data-testid="stub-repas" />,
  TonnagesDonut: () => <div data-testid="stub-donut" />,
}));

import TraiteurDashboardPage from '@/app/(traiteur)/traiteur/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/dashboards/kpi-traiteur'))
    return jsonResponse({
      data: [
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
      ],
    });
  if (url.includes('/dashboards/evolution'))
    return jsonResponse({
      data: {
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
    });
  if (url.includes('/marge-attente-facturation'))
    return jsonResponse({ data: { nb_en_attente: 0 } });
  if (url.includes('/programmation/pack-ag')) return jsonResponse({});
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

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeLocalStorage());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('M3.1 / dashboard traiteur — Bloc 2/4 §11 (BL-P1-PARITE-01)', () => {
  it('M3.1/dash_bloc2_bloc4_zd_montes — Évolution + donut sur l’onglet ZD', async () => {
    render(<TraiteurDashboardPage />);
    expect(await screen.findByTestId('bloc-2-traiteur')).toBeInTheDocument();
    expect(screen.getByTestId('bloc-4-traiteur')).toBeInTheDocument();
    // Le graphe ZD Cockpit (barres empilées flux) est monté dans le Bloc 2.
    expect(
      screen.getByText(/Évolution mensuelle Zéro Déchet/),
    ).toBeInTheDocument();
  });

  it('M3.1/dash_bloc4_zd_only — pas de donut sur l’onglet AG (un seul flux)', async () => {
    render(<TraiteurDashboardPage />);
    await screen.findByTestId('bloc-2-traiteur');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    // Bloc 2 AG toujours présent (courbe repas), Bloc 4 donut retiré.
    expect(await screen.findByTestId('bloc-2-traiteur')).toBeInTheDocument();
    expect(screen.queryByTestId('bloc-4-traiteur')).toBeNull();
    expect(screen.getByText(/Évolution Anti-Gaspi/)).toBeInTheDocument();
  });
});
