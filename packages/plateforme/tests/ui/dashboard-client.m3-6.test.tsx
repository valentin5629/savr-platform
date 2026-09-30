/**
 * M3.6 — Test UI Dashboard Client Admin (§06.06 §2).
 * Couvre les scénarios Gherkin :
 *  - dashboard_client_toutes_organisations_lecture_seule : « Toutes les
 *    organisations » (défaut) → KPI agrégés sans filtre organisation_id, aucune
 *    action d'écriture, sélection restaurée depuis localStorage ;
 *  - dashboard_client_filtres_organisations_par_type : 3 filtres en ligne
 *    Traiteur / Agence / Gestionnaire de lieux (décision Val 2026-09-30).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';
import { DashboardClientView } from '@/app/(admin)/admin/dashboard-client/DashboardClientView.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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

// Organisations du périmètre dans la dernière requête KPI.
function orgIdsDerniereRequete(): string[] {
  const derniere = kpiCalls().at(-1) ?? '';
  return new URL(derniere, 'http://savr.test').searchParams.getAll(
    'organisation_ids[]',
  );
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
  it(
    'M3.6/dashboard_client_toutes_organisations_lecture_seule — agrégation totale, lecture seule, persistance localStorage',
    async () => {
      // Quand l'admin ouvre le Dashboard Client (sélecteur « Toutes les organisations » par défaut)
      render(<DashboardClientView />);

      // Alors les KPI agrégés (totalité des collectes) s'affichent — cartes Cockpit
      // (R24c) : valeur et unité rendues séparément, format fr (« 72,5 » + « % »).
      expect(
        await screen.findByText('72,5', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.getByText('Taux de recyclage')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();

      // Et le sélecteur est sur « Toutes les organisations » (3 filtres à « Tous »)
      expect(screen.getByTestId('org-filtre-traiteur')).toHaveTextContent(
        'TraiteurTous',
      );

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

      // L'admin ouvre le filtre « Traiteur » puis coche o1
      fireEvent.click(
        await screen.findByTestId('org-filtre-traiteur', undefined, ATTENTE_UI),
      );
      fireEvent.click(
        await screen.findByRole(
          'checkbox',
          { name: 'Traiteur Alpha' },
          ATTENTE_UI,
        ),
      );
      await waitFor(
        () =>
          expect(localStorage.getItem(STORAGE_KEY)).toBe(
            JSON.stringify(['o1']),
          ),
        ATTENTE_UI,
      );

      // Réouverture : on démonte puis remonte un composant neuf
      cleanup();
      fetchMock.mockClear();
      render(<DashboardClientView />);

      // La sélection est restaurée depuis localStorage : le filtre « Traiteur »
      // affiche o1 + le filtre organisation_ids est appliqué à la requête.
      await waitFor(
        () =>
          expect(kpiCalls().some((u) => u.includes('organisation_ids'))).toBe(
            true,
          ),
        ATTENTE_UI,
      );
      expect(screen.getByTestId('org-filtre-traiteur')).toHaveTextContent(
        'Traiteur Alpha',
      );
      // Et en ouvrant le filtre Traiteur, o1 est bien coché.
      fireEvent.click(screen.getByTestId('org-filtre-traiteur'));
      expect(
        await screen.findByRole(
          'checkbox',
          { name: 'Traiteur Alpha' },
          ATTENTE_UI,
        ),
      ).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.6/dashboard_client_filtres_organisations_par_type — 3 filtres en ligne par type, périmètre = union, Réinitialiser (décision Val 2026-09-30)',
    async () => {
      render(<DashboardClientView />);

      // La barre affiche « Période » et 3 filtres en ligne, chacun à « Tous /
      // Toutes » (= toutes les organisations).
      const traiteur = await screen.findByTestId(
        'org-filtre-traiteur',
        undefined,
        ATTENTE_UI,
      );
      const agence = screen.getByTestId('org-filtre-agence');
      const gestionnaire = screen.getByTestId('org-filtre-gestionnaire_lieux');
      // « Période » en premier dans la barre (décision Val 2026-09-30).
      expect(
        screen
          .getByTestId('dashboard-filter-periode')
          .compareDocumentPosition(traiteur) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(traiteur).toHaveTextContent('TraiteurTous');
      expect(agence).toHaveTextContent('AgenceToutes');
      expect(gestionnaire).toHaveTextContent('Gestionnaire de lieuxTous');
      // Plus de recherche transverse ni de badge « Toutes les organisations ».
      expect(screen.queryByTestId('org-search')).toBeNull();
      await waitFor(
        () => expect(kpiCalls().length).toBeGreaterThan(0),
        ATTENTE_UI,
      );

      // Coche o1 dans « Traiteur » → les autres types passent à « Aucun/Aucune »
      // et le périmètre = o1.
      fireEvent.click(traiteur);
      fireEvent.click(
        await screen.findByRole(
          'checkbox',
          { name: 'Traiteur Alpha' },
          ATTENTE_UI,
        ),
      );
      await waitFor(() => {
        expect(agence).toHaveTextContent('AgenceAucune');
        expect(gestionnaire).toHaveTextContent('Gestionnaire de lieuxAucun');
        expect(orgIdsDerniereRequete()).toEqual(['o1']);
      }, ATTENTE_UI);

      // Coche en plus une agence → périmètre = union des deux organisations.
      fireEvent.click(agence);
      const listeAgences = await screen.findByRole(
        'list',
        { name: 'Agence' },
        ATTENTE_UI,
      );
      // « Toutes » (case de tête) est décochée : une autre sélection existe.
      const toutesAgences = within(listeAgences).getByRole('checkbox', {
        name: 'Toutes',
      });
      expect(toutesAgences).not.toBeChecked();
      fireEvent.click(
        within(listeAgences).getByRole('checkbox', { name: 'Agence Gamma' }),
      );
      await waitFor(
        () => expect(orgIdsDerniereRequete().sort()).toEqual(['o1', 'o3']),
        ATTENTE_UI,
      );
      expect(agence).toHaveTextContent('Agence Gamma');
      expect(toutesAgences).toBeChecked();

      // Décocher « Toutes » (type entièrement coché) retire les agences.
      fireEvent.click(toutesAgences);
      await waitFor(
        () => expect(orgIdsDerniereRequete()).toEqual(['o1']),
        ATTENTE_UI,
      );
      fireEvent.click(toutesAgences);
      await waitFor(
        () => expect(orgIdsDerniereRequete().sort()).toEqual(['o1', 'o3']),
        ATTENTE_UI,
      );

      // « Tous » des gestionnaires ajoute tout le type : toutes les
      // organisations cochées = « Toutes les organisations » (aucun filtre).
      fireEvent.click(gestionnaire);
      fireEvent.click(
        within(
          await screen.findByRole(
            'list',
            { name: 'Gestionnaire de lieux' },
            ATTENTE_UI,
          ),
        ).getByRole('checkbox', { name: 'Tous' }),
      );
      await waitFor(() => {
        expect(orgIdsDerniereRequete()).toEqual([]);
        expect(traiteur).toHaveTextContent('TraiteurTous');
        expect(agence).toHaveTextContent('AgenceToutes');
      }, ATTENTE_UI);

      // Nouvelle sélection avant de tester « Réinitialiser » (le panneau
      // Traiteur s'est refermé à l'ouverture des autres filtres).
      fireEvent.click(traiteur);
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Traiteur' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Traiteur Alpha' }),
      );
      await waitFor(
        () => expect(orgIdsDerniereRequete()).toEqual(['o1']),
        ATTENTE_UI,
      );

      // « Réinitialiser » → période par défaut + les 3 filtres à « Tous/Toutes ».
      fireEvent.click(
        screen.getByRole('button', { name: 'Réinitialiser les filtres' }),
      );
      await waitFor(() => {
        expect(traiteur).toHaveTextContent('TraiteurTous');
        expect(agence).toHaveTextContent('AgenceToutes');
        expect(orgIdsDerniereRequete()).toEqual([]);
      }, ATTENTE_UI);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
      expect(screen.getByTestId('dashboard-filter-periode')).toHaveTextContent(
        '12 derniers mois',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.6 — une organisation mémorisée mais disparue est retirée de la sélection',
    async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['o1', 'disparue']));
      render(<DashboardClientView />);

      await waitFor(
        () =>
          expect(localStorage.getItem(STORAGE_KEY)).toBe(
            JSON.stringify(['o1']),
          ),
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(orgIdsDerniereRequete()).toEqual(['o1']),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
