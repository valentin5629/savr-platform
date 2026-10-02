/**
 * R-UI-4a (D6) — liste Collectes admin : les filtres vivent dans l'URL.
 * Ouvrir / fermer une fiche (`?collecte=`) ne doit pas effacer un filtre posé,
 * et « Réinitialiser les filtres » en drill-down retire aussi le chip et le
 * périmètre d'organisations (revue principale #478).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// `useSearchParams` lit l'URL du document : miroir du comportement de Next qui
// resynchronise ses hooks après un `history.replaceState(null, …)`.
const replace = vi.fn((url: string) => {
  window.history.replaceState(null, '', url);
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace,
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import CollectesPage from './page';

const collecte = {
  id: 'zd-1',
  type: 'zero_dechet',
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
    nom_evenement: 'Cocktail ZD',
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
    // Fiche ouverte en pop-up : détail indisponible (l'état d'erreur de la
    // modale suffit, seule l'URL est vérifiée ici).
    if (/\/admin\/collectes\/[^?]+/.test(url))
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    return Promise.resolve({
      ok: true,
      json: async () => ({ data: [collecte], total: 1 }),
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

describe('R-UI-4a — Collectes admin : filtres dans l’URL', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    'un filtre Type posé survit à l’ouverture puis la fermeture d’une fiche (?collecte=)',
    async () => {
      window.history.replaceState(null, '', '/admin/collectes');
      const fetchMock = mockFetch();
      render(<CollectesPage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );
      await table.findAllByText('Traiteur Beta', undefined, ATTENTE_UI);

      // Filtre Type → Zéro Déchet (segmenté de la FilterBar, R-UI-4b D1).
      fireEvent.click(screen.getByRole('radio', { name: 'Zéro Déchet' }));
      await waitFor(
        () => expect(window.location.search).toContain('type=zero_dechet'),
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(derniereListe(fetchMock).get('types')).toBe('zero_dechet'),
        ATTENTE_UI,
      );

      // Ouvrir la fiche : `collecte` s'ajoute, le filtre reste dans l'URL.
      fireEvent.click(
        within(
          await screen.findByRole('table', undefined, ATTENTE_UI),
        ).getAllByRole('row')[1]!,
      );
      await waitFor(
        () => expect(window.location.search).toContain('collecte=zd-1'),
        ATTENTE_UI,
      );
      expect(window.location.search).toContain('type=zero_dechet');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'drill-down (?lieu=…&perimetre=…) : « Réinitialiser les filtres » retire le chip et le périmètre',
    async () => {
      window.history.replaceState(
        null,
        '',
        '/admin/collectes?lieu=lieu-1&statut=cloturee&perimetre=org-1',
      );
      const fetchMock = mockFetch();
      render(<CollectesPage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);
      await waitFor(
        () =>
          expect(
            derniereListe(fetchMock).getAll('perimetre_org_ids[]'),
          ).toEqual(['org-1']),
        ATTENTE_UI,
      );
      expect(screen.getByText(/Lieu sélectionné/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('collectes-filtres-reset'));
      await waitFor(
        () => expect(screen.queryByText(/Lieu sélectionné/)).toBeNull(),
        ATTENTE_UI,
      );
      await waitFor(() => {
        const q = derniereListe(fetchMock);
        expect(q.getAll('perimetre_org_ids[]')).toEqual([]);
        expect(q.get('lieu_ids')).toBeNull();
      }, ATTENTE_UI);
      expect(window.location.search).not.toContain('perimetre');
      expect(window.location.search).not.toContain('lieu=');
    },
    ATTENTE_CAS_MS,
  );
});
