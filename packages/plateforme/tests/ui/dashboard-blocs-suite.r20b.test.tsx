/**
 * R20b — Blocs §11 restants montés sur les 3 rôles (traiteur M3.1, agence M3.3,
 * gestionnaire M3.2). Vérifie que les SECTIONS Bloc 5 (prochaines) / Bloc 6 (top
 * lieux) / Bloc 7 (top acteurs) / Bloc 3 AG (associations) sont montées au bon
 * endroit, conditionnées par rôle (Bloc 7 retiré agence) et par onglet, et que le
 * Bloc 3 ZD traiteur/agence est le VRAI benchmark (encart « Filtres benchmark »),
 * plus le stub. Les fetch et les graphes lazy sont mockés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('@/components/dashboards/charts/lazy.js', () => ({
  EvolutionFluxChart: () => <div data-testid="stub-flux" />,
  EvolutionRepasChart: () => <div data-testid="stub-repas" />,
  TonnagesDonut: () => <div data-testid="stub-donut" />,
}));

import TraiteurDashboardPage from '@/app/(traiteur)/traiteur/page.js';
import AgenceDashboardPage from '@/app/(agence)/agence/page.js';
import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const KPI_ROW = {
  mois: '2026-06-01',
  type_collecte: 'zero_dechet',
  nb_collectes: 3,
  tonnage_kg: 500,
  taux_recyclage_pondere: 80,
  nb_repas_donnes: 12,
  marge_zd_ht: 100,
  pax_total: 200,
};

function blocsZd(overrides: Record<string, unknown> = {}) {
  return {
    prochaines: [
      {
        id: 'p1',
        evenement_id: 'e1',
        date_collecte: '2026-07-10',
        heure_collecte: '14:30:00',
        statut: 'programmee',
        evenement_nom: 'Gala',
        lieu_nom: 'Lieu Z',
        traiteur_id: 't1',
        traiteur_nom: 'Traiteur Un',
      },
    ],
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
    topActeurs: [
      {
        id: 'com1',
        label: 'Alice Martin',
        nb_collectes: 2,
        tonnage_kg: 400,
        taux_recyclage: 75,
        repas_donnes: null,
        repas_par_pax: null,
      },
    ],
    acteurLabel: 'Commercial',
    topAssociations: null,
    kgParPaxParFlux: { biodechet: 1.5 },
    ...overrides,
  };
}

function blocsAg(overrides: Record<string, unknown> = {}) {
  return {
    prochaines: [],
    topLieux: [
      {
        lieu_id: 'A',
        lieu_nom: 'Lieu A',
        nb_collectes: 2,
        tonnage_kg: null,
        taux_recyclage: null,
        repas_donnes: 130,
        repas_par_pax: 0.65,
      },
    ],
    topActeurs: [
      {
        id: 'com1',
        label: 'Alice Martin',
        nb_collectes: 2,
        tonnage_kg: null,
        taux_recyclage: null,
        repas_donnes: 130,
        repas_par_pax: 0.65,
      },
    ],
    acteurLabel: 'Commercial',
    topAssociations: [
      {
        association_id: 'a1',
        nom: 'Asso Un',
        ville: 'Paris',
        nb_collectes: 2,
        repas_recus: 70,
      },
    ],
    kgParPaxParFlux: {},
    ...overrides,
  };
}

function buildFetch(blocsPayload: unknown) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/dashboards/blocs'))
      return jsonResponse({ data: blocsPayload });
    if (url.includes('/dashboards/benchmark/filtres'))
      return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
    if (url.includes('/dashboards/benchmark'))
      return jsonResponse({ data: [] });
    if (url.includes('/dashboards/kpi-traiteur'))
      return jsonResponse({ data: [KPI_ROW] });
    if (url.includes('/gestionnaire/dashboard'))
      return jsonResponse({
        data: {
          kpis: {
            nb_collectes: 3,
            tonnage_kg: 500,
            taux_recyclage_pondere: 80,
            kg_par_pax: 2.5,
            nb_repas_donnes: 12,
            pax_total: 200,
            repas_par_pax: 0.06,
          },
          pack: null,
          kg_par_pax_par_flux: { biodechet: 1.5 },
        },
      });
    if (url.includes('/gestionnaire/filtres'))
      return jsonResponse({ data: { lieux: [], traiteurs: [], types: [] } });
    if (url.includes('/dashboards/evolution'))
      return jsonResponse({ data: { granularite: 'mois', series: [] } });
    if (url.includes('/marge-attente-facturation'))
      return jsonResponse({ data: { nb_en_attente: 0 } });
    if (url.includes('/programmation/pack-ag'))
      return jsonResponse({ pack_actif: false });
    return jsonResponse({});
  });
}

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

function useFetch(payload: unknown) {
  vi.stubGlobal('fetch', buildFetch(payload));
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeLocalStorage());
});

describe('M3.1 / traiteur — blocs §11 restants', () => {
  it('M3.1/blocs_traiteur_zd_montes_et_benchmark_reel', async () => {
    useFetch(blocsZd());
    render(<TraiteurDashboardPage />);
    expect(await screen.findByTestId('bloc-5-prochaines')).toBeInTheDocument();
    expect(screen.getByTestId('bloc-6-top-lieux')).toBeInTheDocument();
    expect(screen.getByTestId('bloc-7-top-acteurs')).toBeInTheDocument();
    // Bloc 3 ZD = VRAI benchmark (encart « Filtres benchmark »), pas le stub R20a.
    expect(screen.getByText('Filtres benchmark')).toBeInTheDocument();
    // Variante 4 dimensions : pas de filtre « Traiteurs » (compétitif §06.04 l.143).
    expect(screen.queryByText(/Traiteurs? benchmark/i)).toBeNull();
    // Prochaines : événement rendu + lien vers la fiche collecte.
    const lien = screen.getByRole('link', { name: 'Gala' });
    expect(lien).toHaveAttribute('href', '/traiteur/collectes/p1');
    // Colonnes CDC §06.04 Bloc 6 (Nb collectes + Taux de recyclage) préservées
    // dans le libellé secondaire Cockpit (R24 — pas seulement le tonnage).
    expect(
      screen.getByText(/3 collectes · 80,0 % recyclage/),
    ).toBeInTheDocument();
  });

  it('M3.1/blocs_traiteur_ag_associations_et_top7', async () => {
    useFetch(blocsAg());
    render(<TraiteurDashboardPage />);
    await screen.findByTestId('bloc-5-prochaines');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    // Bloc 3 AG = top associations ; Bloc 7 commerciaux présent.
    expect(
      await screen.findByTestId('bloc-3ag-top-associations'),
    ).toBeInTheDocument();
    expect(screen.getByText('Asso Un')).toBeInTheDocument();
    // Colonnes CDC §06.04 Bloc 3 AG (Ville + Nb collectes) préservées (secondary).
    expect(screen.getByText(/Paris · 2 collectes/)).toBeInTheDocument();
    expect(screen.getByTestId('bloc-7-top-acteurs')).toBeInTheDocument();
  });

  it('M3.1/blocs_traiteur_kpi_cartes_non_cliquables', async () => {
    useFetch(blocsZd());
    render(<TraiteurDashboardPage />);
    await screen.findByTestId('bloc-6-top-lieux');
    // R24 Cockpit — décision Val GO-VISUAL 2026-07-10 : les cartes KPI ne sont
    // PLUS cliquables (revient sur BL-P2-11/BL-P2-43). Aucun lien vers la liste
    // Collectes filtrée ne doit être rendu par les cartes KPI.
    const liensCollectes = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('href')?.includes('/traiteur/collectes?'));
    expect(liensCollectes).toHaveLength(0);
  });
});

describe('M3.3 / agence — Bloc 7 retiré', () => {
  it('M3.3/blocs_agence_zd_sans_bloc7', async () => {
    useFetch(blocsZd());
    render(<AgenceDashboardPage />);
    expect(await screen.findByTestId('bloc-5-prochaines')).toBeInTheDocument();
    expect(screen.getByTestId('bloc-6-top-lieux')).toBeInTheDocument();
    // Bloc 7 « Top 5 commerciaux » RETIRÉ côté agence (§06.11 diff #8).
    expect(screen.queryByTestId('bloc-7-top-acteurs')).toBeNull();
    // Bloc 3 ZD benchmark réel présent (parité §06.04).
    expect(screen.getByText('Filtres benchmark')).toBeInTheDocument();
  });

  it('M3.3/blocs_agence_ag_associations', async () => {
    useFetch(blocsAg());
    render(<AgenceDashboardPage />);
    await screen.findByTestId('bloc-5-prochaines');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    expect(
      await screen.findByTestId('bloc-3ag-top-associations'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('bloc-7-top-acteurs')).toBeNull();
  });
});

describe('M3.2 / gestionnaire — top traiteurs + colonne Traiteur', () => {
  it('M3.2/blocs_gestionnaire_zd_prochaines_colonne_traiteur', async () => {
    useFetch(blocsZd());
    render(<GestionnaireDashboardPage />);
    expect(await screen.findByTestId('bloc-5-prochaines')).toBeInTheDocument();
    // Bloc 5 gestionnaire : colonne « Traiteur » (§06.05 l.194) + valeur résolue.
    expect(
      screen.getByRole('columnheader', { name: 'Traiteur' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Traiteur Un')).toBeInTheDocument();
    // Bloc 7 = top traiteurs.
    expect(screen.getByTestId('bloc-7-top-acteurs')).toBeInTheDocument();
    // Colonnes §06.05 Bloc 6 (Nb collectes + Taux) préservées dans le libellé
    // secondaire Cockpit côté gestionnaire (parité avec le traiteur).
    expect(
      screen.getByText(/3 collectes · 80,0 % recyclage/),
    ).toBeInTheDocument();
  });

  it('M3.2/blocs_gestionnaire_ag_associations', async () => {
    useFetch(blocsAg());
    render(<GestionnaireDashboardPage />);
    await screen.findByTestId('bloc-5-prochaines');
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    expect(
      await screen.findByTestId('bloc-3ag-top-associations'),
    ).toBeInTheDocument();
  });
});
