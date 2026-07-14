/**
 * M3.6 — Test UI Dashboard Client Admin (§06.06 §2).
 * Couvre le scénario Gherkin dashboard_client_toutes_organisations_lecture_seule :
 *  - « Toutes les organisations » (défaut) → KPI agrégés sans filtre organisation_id
 *  - aucune action d'écriture disponible
 *  - sélection d'organisations restaurée depuis localStorage à la réouverture
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { DashboardClientView } from '@/app/(admin)/admin/dashboard-client/DashboardClientView.js';

// KpiCard utilise useRouter — pas de contexte router en jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const STORAGE_KEY = 'savr.dashboard-client.organisations';

const ORGS = [
  {
    id: 'o1',
    nom: 'Traiteur Alpha',
    raison_sociale: 'Traiteur Alpha',
    type: 'traiteur',
  },
  {
    id: 'o2',
    nom: 'Lieux Beta',
    raison_sociale: 'Lieux Beta',
    type: 'gestionnaire_lieux',
  },
  { id: 'o3', nom: 'Agence Gamma', raison_sociale: null, type: 'agence' },
];

// KPI agrégés sur la totalité des collectes Savr (3 organisations).
const KPI_AGREGE = {
  nb_collectes: 12,
  tonnage_kg: 3400,
  taux_recyclage_pondere: 72.5,
  kg_par_pax: 1.1,
  nb_repas_donnes: null,
  pax_total: null,
  repas_par_pax: null,
};

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/dashboard-client/organisations'))
    return jsonResponse({ data: ORGS });
  if (url.includes('/dashboard-client/benchmark'))
    return jsonResponse({ data: [] });
  if (url.includes('/dashboard-client'))
    return jsonResponse({ data: { kpi: KPI_AGREGE } });
  return jsonResponse({});
});

function kpiCalls(): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => /\/admin\/dashboard-client\?/.test(u));
}

// localStorage en mémoire (le localStorage jsdom de vitest n'expose pas clear()).
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

describe('M3.6 / Dashboard Client / UI', () => {
  it('M3.6/dashboard_client_toutes_organisations_lecture_seule — agrégation totale, lecture seule, persistance localStorage', async () => {
    // Quand l'admin ouvre le Dashboard Client (sélecteur « Toutes les organisations » par défaut)
    render(<DashboardClientView />);

    // Alors les KPI agrégés (totalité des collectes) s'affichent — cartes Cockpit
    // (R24c) : valeur et unité rendues séparément, format fr (« 72,5 » + « % »).
    expect(await screen.findByText('72,5')).toBeInTheDocument();
    expect(screen.getByText('Taux de recyclage')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    // Et le sélecteur est sur « Toutes les organisations »
    expect(screen.getByTestId('org-selection-toutes')).toBeInTheDocument();

    // Et la requête KPI n'applique AUCUN filtre organisation_id (agrégation totale)
    const calls = kpiCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => !u.includes('organisation_ids'))).toBe(true);

    // Et aucune action d'écriture n'est disponible (vue lecture seule)
    expect(screen.getByTestId('lecture-seule-badge')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /programmer|créer|nouveau|nouvelle|ajouter|modifier|supprimer|enregistrer|valider|éditer|envoyer/i,
      }),
    ).toBeNull();

    // L'admin sélectionne une organisation précise → persistée en localStorage
    fireEvent.click(await screen.findByTestId('org-option-o1'));
    await waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['o1'])),
    );

    // Réouverture : on démonte puis remonte un composant neuf
    cleanup();
    fetchMock.mockClear();
    render(<DashboardClientView />);

    // Et la sélection est restaurée depuis localStorage (case cochée + filtre appliqué)
    await waitFor(() => {
      const cb = screen.getByTestId('org-option-o1') as HTMLInputElement;
      expect(cb.checked).toBe(true);
    });
    expect(screen.queryByTestId('org-selection-toutes')).toBeNull();
    await waitFor(() =>
      expect(kpiCalls().some((u) => u.includes('organisation_ids'))).toBe(true),
    );
  });

  it('M3.6/org_selecteur_cellules_par_type — cellules repliables groupées par type d’organisation (retour Val R24c)', async () => {
    render(<DashboardClientView />);

    // Une cellule (liste déroulante) par type présent : traiteur / gestionnaire / agence.
    expect(
      await screen.findByTestId('org-section-traiteur'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('org-section-agence')).toBeInTheDocument();
    expect(
      screen.getByTestId('org-section-gestionnaire_lieux'),
    ).toBeInTheDocument();

    // Dépliées par défaut → les organisations de chaque type sont visibles.
    expect(screen.getByTestId('org-option-o1')).toBeInTheDocument(); // traiteur Alpha
    expect(screen.getByTestId('org-option-o3')).toBeInTheDocument(); // agence Gamma

    // Replier la cellule « Traiteurs » masque ses organisations.
    fireEvent.click(screen.getByTestId('org-section-traiteur'));
    await waitFor(() =>
      expect(screen.queryByTestId('org-option-o1')).toBeNull(),
    );
    // Les autres cellules restent intactes.
    expect(screen.getByTestId('org-option-o3')).toBeInTheDocument();
  });
});
