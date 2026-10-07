/**
 * R-UI-4b (D10) — factures gestionnaire et agence : mêmes filtres que le
 * traiteur (`FacturesFiltresBar` : Période · Statut · Type, compteur,
 * « Réinitialiser les filtres »), appliqués côté client aux factures chargées
 * (les routes n'acceptent pas encore ces filtres en liste — reliquat).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from '@testing-library/react';

import { filtrerFactures, type FiltresFactures } from './factures-filtres-bar';
import { FacturesAgenceTable } from '@/app/(agence)/agence/mon-organisation/factures-table';
import MonOrganisationGestionnairePage from '@/app/(gestionnaire)/gestionnaire/mon-organisation/page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const VIDES: FiltresFactures = {
  statuts: [],
  types: [],
  date_debut: '',
  date_fin: '',
};
const FACTURES = [
  {
    id: 'a',
    numero_facture: 'F-A',
    type: 'zero_dechet',
    statut: 'payee',
    montant_ttc: 10,
    date_emission: '2026-03-01',
    date_echeance: null,
  },
  {
    id: 'b',
    numero_facture: 'F-B',
    type: 'avoir',
    statut: 'emise',
    montant_ttc: 20,
    date_emission: '2026-05-01',
    date_echeance: null,
  },
  {
    id: 'c',
    numero_facture: 'F-C',
    type: 'zero_dechet',
    statut: 'emise',
    montant_ttc: 30,
    date_emission: null,
    date_echeance: null,
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('R-UI-4b / filtrerFactures — mêmes critères que la route traiteur', () => {
  it('statut, type, période (date d’émission) ; sans date = écartée dès qu’une borne est posée', () => {
    const ids = (f: Partial<FiltresFactures>) =>
      filtrerFactures(FACTURES, { ...VIDES, ...f }).map((x) => x.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ statuts: ['emise'] })).toEqual(['b', 'c']);
    expect(ids({ types: ['avoir'] })).toEqual(['b']);
    expect(ids({ date_debut: '2026-04-01' })).toEqual(['b']);
    expect(ids({ date_fin: '2026-04-01' })).toEqual(['a']);
    expect(ids({ statuts: ['emise'], types: ['zero_dechet'] })).toEqual(['c']);
  });

  it('type absent des lignes (route gestionnaire) : le critère Type est ignoré', () => {
    const sansType = FACTURES.map(({ type: _t, ...f }) => f);
    expect(
      filtrerFactures(sansType, { ...VIDES, types: ['avoir'] }).map(
        (x) => x.id,
      ),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('R-UI-4b / factures agence — barre de filtres + filtrage client', () => {
  it(
    'liste chargée par la route, compteur D5, un statut coché filtre et s’écrit dans l’URL, reset vide tout',
    async () => {
      const fetchMock = vi.fn((_url: string) =>
        Promise.resolve(
          new Response(JSON.stringify({ data: FACTURES }), { status: 200 }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<FacturesAgenceTable />);

      await waitFor(
        () =>
          expect(
            screen.getByTestId('factures-filtres-count'),
          ).toHaveTextContent('3 factures'),
        ATTENTE_UI,
      );
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        '/api/v1/agence/factures',
      );
      // Mêmes filtres que le traiteur : Période · Statut · Type.
      expect(screen.getByTestId('factures-periode')).toBeTruthy();
      expect(screen.getByTestId('factures-statut')).toBeTruthy();
      expect(screen.getByTestId('factures-type')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByTestId('factures-statut'));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Payée' }));
      });
      expect(screen.getByTestId('factures-filtres-count')).toHaveTextContent(
        '1 facture',
      );
      expect(window.location.search).toBe('?statuts=payee');
      // Filtrage côté client : aucun nouvel appel.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.click(screen.getByTestId('factures-filtres-reset'));
      });
      expect(screen.getByTestId('factures-filtres-count')).toHaveTextContent(
        '3 factures',
      );
      expect(window.location.search).toBe('');
    },
    ATTENTE_CAS_MS,
  );
});

describe('R-UI-4b / factures gestionnaire — onglet Factures', () => {
  it(
    'barre de filtres Période + Statut (Type masqué : la route ne renvoie pas le type), compteur D5',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                data: String(url).endsWith('/factures')
                  ? FACTURES.map(({ type: _t, ...f }) => ({
                      ...f,
                      pdf_url_savr: null,
                      pdf_url_pennylane: null,
                    }))
                  : { id: 'org', nom: 'Viparis' },
              }),
              { status: 200 },
            ),
          ),
        ),
      );
      render(<MonOrganisationGestionnairePage />);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Factures' }));
      await screen.findByRole('table', {}, ATTENTE_UI);

      expect(screen.getByTestId('factures-filtres-count')).toHaveTextContent(
        '3 factures',
      );
      expect(screen.getByTestId('factures-periode')).toBeTruthy();
      expect(screen.getByTestId('factures-statut')).toBeTruthy();
      expect(screen.queryByTestId('factures-type')).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByTestId('factures-statut'));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Émise' }));
      });
      expect(screen.getByTestId('factures-filtres-count')).toHaveTextContent(
        '2 factures',
      );
      expect(window.location.search).toBe('?statuts=emise');
    },
    ATTENTE_CAS_MS,
  );
});
