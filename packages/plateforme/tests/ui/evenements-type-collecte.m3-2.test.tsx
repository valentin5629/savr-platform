/**
 * Liste Événements gestionnaire (§06.05 §2) — « Type de collecte » à choix
 * multiple sur une partition « ZD seul / AG seul / ZD et AG » (arbitrage Val
 * F1 2026-10-01, divergence M0.8_20260930_filtres-choix-multiple-tous) : les
 * anciennes options « Avec ZD / Avec AG / ZD et AG » se recouvraient. Un ancien
 * lien `?type_collecte=avec_zd` pré-coche « ZD seul » + « ZD et AG ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

let recherche = new URLSearchParams();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  useSearchParams: () => recherche,
}));

import EvenementsPage from '@/app/(gestionnaire)/gestionnaire/evenements/page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  // Options de la barre (Lieux / Traiteurs / Type d'événement) vs liste.
  const data = String(input).startsWith('/api/v1/gestionnaire/filtres')
    ? { lieux: [], traiteurs: [], types: [] }
    : [];
  return Promise.resolve({
    ok: true,
    json: async () => ({ data }),
  } as Response);
});

const dernierAppelListe = () =>
  new URL(
    String(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.startsWith('/api/v1/gestionnaire/evenements?'))
        .at(-1),
    ),
    'http://localhost',
  ).searchParams;

describe('M3.2 — Événements : Type de collecte à choix multiple (partition)', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    routerReplace.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it(
    'M3.2 — ancien lien ?type_collecte=avec_zd → « ZD seul » + « ZD et AG » cochés ; tout cocher = « Toutes », aucun paramètre',
    async () => {
      recherche = new URLSearchParams('type_collecte=avec_zd');
      render(<EvenementsPage />);
      await waitFor(
        () =>
          expect(dernierAppelListe().getAll('types_collecte[]')).toEqual([
            'zd_seul',
            'zd_et_ag',
          ]),
        ATTENTE_UI,
      );
      // L'URL est réécrite au nouveau format (plus d'ancien paramètre).
      expect(String(routerReplace.mock.calls.at(-1)?.[0])).not.toContain(
        'type_collecte=',
      );

      fireEvent.click(screen.getByTestId('evenements-filter-type-collecte'));
      const liste = within(
        await screen.findByRole(
          'list',
          { name: 'Type de collecte' },
          ATTENTE_UI,
        ),
      );
      expect(liste.getByRole('checkbox', { name: 'ZD seul' })).toBeChecked();
      expect(liste.getByRole('checkbox', { name: 'ZD et AG' })).toBeChecked();
      expect(
        liste.getByRole('checkbox', { name: 'AG seul' }),
      ).not.toBeChecked();

      fireEvent.click(liste.getByRole('checkbox', { name: 'AG seul' }));
      await waitFor(
        () =>
          expect(dernierAppelListe().getAll('types_collecte[]')).toEqual([]),
        ATTENTE_UI,
      );
      expect(liste.getByRole('checkbox', { name: 'Toutes' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2 — « AG seul » coché → types_collecte[]=ag_seul ; « Toutes » efface ; Période reste en premier',
    async () => {
      recherche = new URLSearchParams();
      render(<EvenementsPage />);
      await waitFor(() => dernierAppelListe(), ATTENTE_UI);

      const barre = screen.getByTestId('evenements-filter-bar');
      expect(
        within(barre)
          .getByTestId('evenements-filter-periode')
          .compareDocumentPosition(
            within(barre).getByTestId('evenements-filter-type-collecte'),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      fireEvent.click(screen.getByTestId('evenements-filter-type-collecte'));
      const liste = within(
        await screen.findByRole(
          'list',
          { name: 'Type de collecte' },
          ATTENTE_UI,
        ),
      );
      fireEvent.click(liste.getByRole('checkbox', { name: 'AG seul' }));
      fireEvent.click(liste.getByRole('checkbox', { name: 'ZD et AG' }));
      await waitFor(
        () =>
          expect(dernierAppelListe().getAll('types_collecte[]')).toEqual([
            'ag_seul',
            'zd_et_ag',
          ]),
        ATTENTE_UI,
      );
      expect(dernierAppelListe().get('type_collecte')).toBeNull();

      fireEvent.click(liste.getByRole('checkbox', { name: 'Toutes' }));
      await waitFor(
        () =>
          expect(dernierAppelListe().getAll('types_collecte[]')).toEqual([]),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
