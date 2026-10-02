/**
 * R-UI-4b (D1, D2, D5) — liste Collectes admin : UN seul contrôle de type (le
 * segmenté `ToggleTypeCollecte` dans l'en-tête de la FilterBar), onglets DS,
 * compteur de résultats au seul pied de la FilterBar.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import CollectesPage from './page';

const collecte = {
  id: 'ag-1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: null,
  tms_reference: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  controle_acces_requis: false,
  informations_completes: true,
  taux_recyclage: null,
  attributions_antgaspi: null,
  collecte_flux: [],
  rapports_rse: [],
  transporteur_nom: 'Marathon',
  factures_collectes: [],
  packs_antgaspi: null,
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    nom_client_organisateur: 'Fondation X',
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: null,
    lieux: {
      nom: 'Pavillon',
      adresse_acces: null,
      code_postal: '75008',
      ville: 'Paris',
    },
  },
};

function mockFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/collectes/chip-counts'))
      return Promise.resolve({ ok: true, json: async () => ({}) });
    if (url.includes('/admin/organisations') || url.includes('/admin/lieux'))
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [], total: 0, limit: 50 }),
      });
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: [collecte, collecte], total: 2 }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function derniereListe(
  fetchMock: ReturnType<typeof mockFetch>,
): URLSearchParams {
  const urls = fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => /\/admin\/collectes\?/.test(u));
  return new URL(urls[urls.length - 1]!, 'http://x').searchParams;
}

describe('R-UI-4b — Collectes admin : un seul contrôle de type, FilterBar complet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    '(a) le segmenté est l’unique contrôle de type : « Anti-Gaspi » écrit ?type=anti_gaspi et l’API reçoit types=anti_gaspi',
    async () => {
      window.history.replaceState(null, '', '/admin/collectes');
      const fetchMock = mockFetch();
      render(<CollectesPage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      // Le segmenté vit dans l'en-tête de la FilterBar, à côté des onglets DS.
      const barre = screen.getByTestId('collectes-filtres');
      const segmente = within(barre).getByRole('radiogroup', {
        name: 'Type de collecte',
      });
      expect(
        within(barre).getByRole('tablist', { name: 'Vue collectes' }),
      ).toBeInTheDocument();
      // Aucun autre contrôle de type : ni pilules « Filtrer par type », ni
      // liste à cocher « Type », ni pastilles Anti-Gaspi / Zéro Déchet.
      expect(
        screen.queryByRole('group', { name: 'Filtrer par type' }),
      ).toBeNull();
      expect(screen.queryByRole('checkbox', { name: 'Anti-Gaspi' })).toBeNull();
      expect(
        screen.queryByRole('checkbox', { name: 'Zéro Déchet' }),
      ).toBeNull();
      expect(screen.queryByRole('list', { name: 'Type' })).toBeNull();
      expect(screen.getAllByRole('radio', { name: 'Anti-Gaspi' })).toHaveLength(
        1,
      );
      expect(screen.queryByRole('button', { name: 'Anti-Gaspi' })).toBeNull();

      // Sans type choisi : « Toutes » actif, ni `type` dans l'URL ni `types` à l'API.
      expect(
        within(segmente).getByRole('radio', { name: 'Toutes' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(derniereListe(fetchMock).get('types')).toBeNull();

      fireEvent.click(
        within(segmente).getByRole('radio', { name: 'Anti-Gaspi' }),
      );
      await waitFor(
        () => expect(window.location.search).toContain('type=anti_gaspi'),
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(derniereListe(fetchMock).get('types')).toBe('anti_gaspi'),
        ATTENTE_UI,
      );
      // Le type posé compte comme filtre : « Réinitialiser les filtres » apparaît.
      expect(screen.getByTestId('collectes-filtres-reset')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    '(b) le compteur de résultats est dans le pied de la FilterBar, et nulle part ailleurs',
    async () => {
      window.history.replaceState(null, '', '/admin/collectes');
      mockFetch();
      render(<CollectesPage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      const compteur = await screen.findByTestId(
        'collectes-filtres-count',
        undefined,
        ATTENTE_UI,
      );
      await waitFor(
        () =>
          expect(compteur).toHaveTextContent(
            '2 collectes correspondent à votre sélection',
          ),
        ATTENTE_UI,
      );
      expect(screen.getByTestId('collectes-filtres')).toContainElement(
        compteur,
      );
      // Un seul emplacement (D5) : ni toolbar de grille, ni pied de liste.
      expect(
        screen.getAllByText(/correspondent à votre sélection/),
      ).toHaveLength(1);
      expect(screen.getByTestId('collectes-table')).not.toHaveTextContent(
        /collectes? correspond/,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    '(c) « Toutes » retire `type` de l’URL et le paramètre `types` de l’API',
    async () => {
      window.history.replaceState(
        null,
        '',
        '/admin/collectes?type=zero_dechet',
      );
      const fetchMock = mockFetch();
      render(<CollectesPage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      // Lecture d'URL compatible : le segmenté reflète ?type=zero_dechet.
      expect(
        screen.getByRole('radio', { name: 'Zéro Déchet' }),
      ).toHaveAttribute('aria-checked', 'true');
      await waitFor(
        () => expect(derniereListe(fetchMock).get('types')).toBe('zero_dechet'),
        ATTENTE_UI,
      );

      fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }));
      await waitFor(
        () => expect(window.location.search).not.toContain('type='),
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(derniereListe(fetchMock).get('types')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
  it(
    '(d) drill-down avec périmètre : décocher le lieu ne laisse pas un périmètre invisible — le chip reste, son reset retire `perimetre_org_ids[]`',
    async () => {
      window.history.replaceState(
        null,
        '',
        '/admin/collectes?lieu=lieu-1&perimetre=org-1&perimetre=org-2',
      );
      const fetchMock = mockFetch();
      render(<CollectesPage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);
      await waitFor(
        () =>
          expect(
            derniereListe(fetchMock).getAll('perimetre_org_ids[]'),
          ).toEqual(['org-1', 'org-2']),
        ATTENTE_UI,
      );
      expect(screen.getByText(/Lieu sélectionné/)).toBeInTheDocument();

      // Le lieu du drill quitte la barre (liste d'options vide dans ce mock :
      // on passe par « Réinitialiser les filtres », qui n'est PAS clearDrill
      // tant que le chip est éteint) — ici le chip doit rester allumé car le
      // périmètre borne encore la liste.
      fireEvent.click(screen.getByTestId('collectes-filtres-reset'));
      await waitFor(
        () => expect(screen.queryByText(/Lieu sélectionné/)).toBeNull(),
        ATTENTE_UI,
      );
      await waitFor(
        () =>
          expect(
            derniereListe(fetchMock).getAll('perimetre_org_ids[]'),
          ).toEqual([]),
        ATTENTE_UI,
      );
      expect(window.location.search).not.toContain('perimetre');
    },
    ATTENTE_CAS_MS,
  );
});
