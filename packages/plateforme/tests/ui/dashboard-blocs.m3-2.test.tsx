/**
 * M3.2 — Dashboard gestionnaire : Bloc 2 (évolution) + Bloc 4 (donut) montés
 * (§06.05 Bloc 2/4, BL-P1-PARITE-01). Bloc 4 ZD only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire',
}));

vi.mock('@/components/dashboards/charts/lazy.js', () => ({
  EvolutionFluxChart: () => <div data-testid="stub-flux" />,
  EvolutionRepasChart: () => <div data-testid="stub-repas" />,
  TonnagesDonut: () => <div data-testid="stub-donut" />,
}));

import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const kpis = {
  nb_collectes: 2,
  tonnage_kg: 400,
  taux_recyclage_pondere: 75,
  kg_par_pax: 2.5,
  nb_repas_donnes: 120,
  pax_total: 160,
  repas_par_pax: 0.75,
};

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  // parcOptions absent → DashboardFilterBar en mode période seule (pas de parc
  // selects à monter dans ce test ciblé Bloc 2/4).
  if (url.includes('/gestionnaire/filtres')) return jsonResponse({});
  if (url.includes('/gestionnaire/dashboard'))
    return jsonResponse({
      data: { kpis, kg_par_pax_par_flux: { biodechet: 1.2 }, pack: null },
    });
  if (url.includes('/dashboards/evolution'))
    return jsonResponse({
      data: {
        granularite: 'mois',
        series: [
          {
            periode: '2026-06-01',
            biodechet: 200,
            emballage: 100,
            carton: 50,
            verre: 30,
            dechet_residuel: 20,
            tonnage_total: 400,
            taux_recyclage: 75,
          },
        ],
      },
    });
  return jsonResponse({ data: [] });
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

describe('M3.2 / dashboard gestionnaire — Bloc 2/4 §11 (BL-P1-PARITE-01)', () => {
  it('M3.2/dash_bloc2_bloc4_zd_montes — Évolution + donut sur l’onglet ZD', async () => {
    render(<GestionnaireDashboardPage />);
    expect(
      await screen.findByTestId('bloc-2-gestionnaire'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bloc-4-gestionnaire')).toBeInTheDocument();
    expect(screen.getByTestId('stub-flux')).toBeInTheDocument();
  });

  it('M3.2/dash_bloc4_zd_only — pas de donut sur l’onglet AG', async () => {
    render(<GestionnaireDashboardPage />);
    await screen.findByTestId('bloc-2-gestionnaire');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    expect(
      await screen.findByTestId('bloc-2-gestionnaire'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('bloc-4-gestionnaire')).toBeNull();
    expect(screen.getByTestId('stub-repas')).toBeInTheDocument();
  });
});
