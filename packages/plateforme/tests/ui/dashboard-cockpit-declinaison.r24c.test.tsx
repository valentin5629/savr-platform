/**
 * R24c — Déclinaison Cockpit des 3 dashboards « client » restants (agence M3.3,
 * client_organisateur M3.4, Dashboard Client Admin M3.6). Vérifie que chaque page
 * monte SANS crash et rend la SIGNATURE Cockpit attendue (KpiCockpitCard ; pour
 * l'agence : TopRankList + BenchmarkBulletGauges + drill-down onItemClick → URL),
 * à parité de sens avec les pilotes traiteur/gestionnaire (R24/R24b), et que les
 * anciens composants (KpiCard, TopLieuxBloc, BenchmarkGauge côté agence) ont bien
 * disparu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import AgenceDashboardPage from '@/app/(agence)/agence/page.js';
import ClientOrganisateurDashboardPage from '@/app/(client-organisateur)/organisateur/page.js';
import { DashboardClientView } from '@/app/(admin)/admin/dashboard-client/DashboardClientView.js';

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
  pushMock.mockClear();
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
});

// ── Agence (M3.3) ────────────────────────────────────────────────────────────
const AGENCE_ZD_BLOCS = {
  prochaines: [],
  topLieux: [
    {
      lieu_id: 'A',
      lieu_nom: 'Lieu A',
      nb_collectes: 3,
      tonnage_kg: 500,
      taux_recyclage: 80,
      repas_donnes: null,
      repas_par_pax: null,
    },
  ],
  topActeurs: null,
  acteurLabel: null,
  topAssociations: null,
  kgParPaxParFlux: { biodechet: 1.5 },
};

function agenceFetch() {
  return vi.fn((input: RequestInfo | URL) => {
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
            pax_total: 200,
          },
        ],
      });
    if (url.includes('/dashboards/blocs'))
      return jsonResponse({ data: AGENCE_ZD_BLOCS });
    if (url.includes('/dashboards/benchmark/filtres'))
      return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
    if (url.includes('/dashboards/benchmark'))
      return jsonResponse({ data: [] });
    if (url.includes('/dashboards/evolution'))
      return jsonResponse({ data: { granularite: 'mois', series: [] } });
    if (url.includes('/programmation/pack-ag'))
      return jsonResponse({ pack_actif: false });
    return jsonResponse({});
  });
}

describe('M3.3 / agence — déclinaison Cockpit', () => {
  it('M3.3/cockpit_declinaison_kpi_toprank_benchmark — KpiCockpitCard + TopRankList + BenchmarkBulletGauges, plus d’ancien BenchmarkGauge', async () => {
    vi.stubGlobal('fetch', agenceFetch());
    render(<AgenceDashboardPage />);

    // KPI Cockpit (rangée KpiCockpitCard).
    expect(await screen.findByText('Nombre de collectes')).toBeInTheDocument();
    // Benchmark Cockpit (BenchmarkBulletGauges — titre propre à la lib figée).
    expect(screen.getByText(/Intensité par flux/)).toBeInTheDocument();
    // Top listes Cockpit (TopRankList).
    expect(screen.getByText('Top 5 lieux')).toBeInTheDocument();
    expect(screen.getByText('Lieu A')).toBeInTheDocument();
    // L'ancien encart BenchmarkGauge (« Performance vs benchmark parc ») a disparu.
    expect(screen.queryByText(/Performance vs benchmark parc/)).toBeNull();
  });

  it('M3.3/cockpit_drilldown_top_lieux_url — clic ligne Top lieux → router.push liste Collectes filtrée', async () => {
    vi.stubGlobal('fetch', agenceFetch());
    render(<AgenceDashboardPage />);
    await screen.findByText('Lieu A');

    const rows = screen.getAllByRole('button', { name: /Voir les collectes/ });
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]!);

    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = String(pushMock.mock.calls[0]![0]);
    expect(url).toContain('/agence/collectes?lieu=A');
    expect(url).toContain('type=zero_dechet');
    expect(url).toContain('statut=cloturee');
  });
});

// ── Client organisateur (M3.4) ───────────────────────────────────────────────
describe('M3.4 / organisateur — déclinaison Cockpit', () => {
  it('M3.4/cockpit_declinaison_kpi_cards — page RSE montée en KpiCockpitCard (bandeau YTD + onglet ZD + détail ABC)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboards/kpi-client-organisateur'))
          return jsonResponse({
            data: [
              {
                mois: '2026-06-01',
                type_collecte: 'zero_dechet',
                nb_collectes: 2,
                nb_evenements: 2,
                tonnage_kg: 400,
                taux_recyclage_pondere: 75,
                nb_repas_donnes: 0,
                co2_induit_kg: 10,
                co2_evite_kg: 1200,
                co2_net_kg: 1190,
                energie_primaire_evitee_kwh: 500,
              },
            ],
          });
        return jsonResponse({});
      }),
    );
    render(<ClientOrganisateurDashboardPage />);

    // En-tête + bandeau YTD (cartes Cockpit).
    expect(screen.getByText('Mon impact RSE')).toBeInTheDocument();
    expect(screen.getByText('Événements collectés')).toBeInTheDocument();
    // Onglet ZD : cadrans Cockpit (dont CO₂ évité en headline, §11 §7).
    expect(await screen.findByText('Événements ZD')).toBeInTheDocument();
    expect(screen.getByText('CO₂ évité')).toBeInTheDocument();
    expect(screen.getByText('Taux de recyclage')).toBeInTheDocument();
  });
});

// ── Dashboard Client Admin (M3.6) ────────────────────────────────────────────
describe('M3.6 / dashboard-client — déclinaison Cockpit', () => {
  it('M3.6/cockpit_declinaison_kpi_cards — KpiCockpitCard (lecture seule) + jauges BenchmarkGauge conservées', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard-client/organisations'))
          return jsonResponse({ data: [] });
        if (url.includes('/dashboard-client/benchmark'))
          return jsonResponse({ data: [] });
        if (url.includes('/dashboard-client'))
          return jsonResponse({
            data: {
              kpi: {
                nb_collectes: 12,
                tonnage_kg: 3400,
                taux_recyclage_pondere: 72.5,
                kg_par_pax: 1.1,
                nb_repas_donnes: null,
                pax_total: null,
                repas_par_pax: null,
              },
            },
          });
        return jsonResponse({});
      }),
    );
    render(<DashboardClientView />);

    // KPI Cockpit read-only (valeur/unité séparées : « 72,5 » + « % »).
    expect(await screen.findByText('Nombre de collectes')).toBeInTheDocument();
    expect(screen.getByText('72,5')).toBeInTheDocument();
    // Benchmark conservé (BenchmarkGauge, décision Val R24c option A).
    expect(
      screen.getByText(/Performance vs benchmark parc/),
    ).toBeInTheDocument();
    // Lecture seule — aucun bouton d'action.
    expect(screen.getByTestId('lecture-seule-badge')).toBeInTheDocument();
  });
});
