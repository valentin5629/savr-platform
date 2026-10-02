/**
 * Registre réglementaire (§06.03 « Lieu (multi-select) », « Traiteur
 * (multi-select) ») — filtres à choix multiple avec case « Tous » (décision Val
 * 2026-09-30). Les options Lieu / Traiteur viennent de tout le registre du
 * périmètre (arbitrage Val F2 2026-10-01), pas des lignes de la page : cocher
 * un lieu ne fait plus disparaître les autres de la liste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import RegistrePage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// La page affichée ne contient que le lieu « Palais » ; le périmètre en a trois.
const ROWS = [
  {
    collecte_id: 'c1',
    date_evenement: '2026-06-01',
    lieu_id: 'l1',
    lieu_nom: 'Palais',
    traiteur_operationnel_organisation_id: 't1',
    traiteur_raison_sociale: 'Kaspia',
    poids_total_kg: 12.5,
    flux_codes: ['biodechet'],
    bordereau_statut: 'emis',
    historique_partiel: false,
  },
];
const OPTIONS = {
  lieux: [
    { id: 'l1', nom: 'Palais' },
    { id: 'l2', nom: 'Salle Wagram' },
    { id: 'l3', nom: 'Pavillon Dauphine' },
  ],
  traiteurs: [{ id: 't1', nom: 'Kaspia' }],
};

const fetchParDefaut = (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  const body = url.startsWith('/api/v1/registre/options')
    ? OPTIONS
    : { rows: ROWS, total: 1 };
  return Promise.resolve({ ok: true, json: async () => body } as Response);
};
const fetchMock = vi.fn(fetchParDefaut);

const dernierAppelListe = () =>
  new URL(
    String(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.startsWith('/api/v1/registre?'))
        .at(-1),
    ),
    'http://localhost',
  ).searchParams;

describe('M4.2 — Registre : filtres à choix multiple', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(fetchParDefaut);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it(
    'M4.2 — options en échec : repli sur les lieux des lignes affichées, jamais une liste vide muette',
    async () => {
      fetchMock.mockImplementation((input: RequestInfo | URL) =>
        String(input).startsWith('/api/v1/registre/options')
          ? Promise.resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: 'boom' }),
            } as Response)
          : fetchParDefaut(input),
      );
      render(<RegistrePage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByTestId('registre-lieu'));
      const lieux = within(
        await screen.findByRole('list', { name: 'Lieu' }, ATTENTE_UI),
      );
      // « Palais » vient des lignes affichées ; « Salle Wagram » (hors page)
      // n'est pas proposé sans la route des options.
      expect(
        lieux.getByRole('checkbox', { name: 'Palais' }),
      ).toBeInTheDocument();
      expect(
        lieux.queryByRole('checkbox', { name: 'Salle Wagram' }),
      ).toBeNull();
      fireEvent.click(lieux.getByRole('checkbox', { name: 'Palais' }));
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBe('l1'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M4.2 — Lieu : options du périmètre entier, 2 lieux cochés → lieu=… ; « Tous » efface ; Période reste en premier',
    async () => {
      render(<RegistrePage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      // (a) Période déjà en premier dans la barre.
      const barre = screen.getByTestId('registre-filtres');
      expect(
        within(barre)
          .getByTestId('registre-periode')
          .compareDocumentPosition(within(barre).getByTestId('registre-lieu')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      fireEvent.click(screen.getByTestId('registre-lieu'));
      const lieux = within(
        await screen.findByRole('list', { name: 'Lieu' }, ATTENTE_UI),
      );
      // « Salle Wagram » n'est pas sur la page affichée : proposé quand même.
      await waitFor(
        () => lieux.getByRole('checkbox', { name: 'Salle Wagram' }),
        ATTENTE_UI,
      );
      fireEvent.click(lieux.getByRole('checkbox', { name: 'Palais' }));
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBe('l1'),
        ATTENTE_UI,
      );
      // (b) La liste rechargée (lieu l1 seul) ne retire pas « Salle Wagram » :
      // 2 lieux cochés → CSV.
      fireEvent.click(lieux.getByRole('checkbox', { name: 'Salle Wagram' }));
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBe('l1,l2'),
        ATTENTE_UI,
      );
      // (d) Tous les lieux du périmètre cochés = « Tous » = aucun paramètre.
      fireEvent.click(
        lieux.getByRole('checkbox', { name: 'Pavillon Dauphine' }),
      );
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBeNull(),
        ATTENTE_UI,
      );
      expect(lieux.getByRole('checkbox', { name: 'Tous' })).toBeChecked();

      fireEvent.click(lieux.getByRole('checkbox', { name: 'Palais' }));
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBe('l1'),
        ATTENTE_UI,
      );
      // (c) « Tous » efface.
      fireEvent.click(lieux.getByRole('checkbox', { name: 'Tous' }));
      await waitFor(
        () => expect(dernierAppelListe().get('lieu')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M4.2 — Bordereau : Disponible → bordereau=dispo ; Disponible + Manquant = aucun paramètre',
    async () => {
      render(<RegistrePage />);
      await screen.findByRole('table', undefined, ATTENTE_UI);

      fireEvent.click(screen.getByTestId('registre-bordereau'));
      const liste = within(
        await screen.findByRole('list', { name: 'Bordereau' }, ATTENTE_UI),
      );
      fireEvent.click(liste.getByRole('checkbox', { name: 'Disponible' }));
      await waitFor(
        () => expect(dernierAppelListe().get('bordereau')).toBe('dispo'),
        ATTENTE_UI,
      );
      fireEvent.click(liste.getByRole('checkbox', { name: 'Manquant' }));
      await waitFor(
        () => expect(dernierAppelListe().has('bordereau')).toBe(false),
        ATTENTE_UI,
      );
      expect(liste.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );
});
