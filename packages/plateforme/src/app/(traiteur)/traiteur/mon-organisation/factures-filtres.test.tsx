/**
 * Mon organisation > Facturation (§06.04 §6 l.690) — filtres statut / type /
 * période au format en ligne (décision Val 2026-09-30), Statut et Type à choix
 * multiple avec case « Tous » et « Période » en premier (divergence
 * M0.8_20260930_filtres-choix-multiple-tous). Chaque filtre part en paramètre de
 * `/api/v1/traiteur/factures`, « Réinitialiser » les retire tous.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

import { MonOrganisationClient } from './mon-organisation-client';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

function urlsFactures(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/api/v1/traiteur/factures'));
}

describe('M3.1 — Mon organisation : filtres Factures en ligne', () => {
  afterEach(() => vi.unstubAllGlobals());

  it(
    'statut choisi → paramètre statuts ; Réinitialiser → plus aucun paramètre',
    async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, json: async () => ({ data: [] }) }),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationClient isManager userId="u1" />);

      fireEvent.click(screen.getByRole('button', { name: 'Facturation' }));
      // Filtre en ligne « Statut  Tous ▾ », sans libellé au-dessus.
      const statut = await screen.findByTestId(
        'factures-statut',
        undefined,
        ATTENTE_UI,
      );
      expect(statut).toHaveTextContent('Tous');
      expect(screen.queryByTestId('factures-filtres-reset')).toBeNull();

      fireEvent.click(statut);
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Statut' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Payée' }),
      );
      await waitFor(
        () =>
          expect(urlsFactures(fetchMock)).toContain(
            '/api/v1/traiteur/factures?statuts=payee',
          ),
        ATTENTE_UI,
      );

      fireEvent.click(screen.getByTestId('factures-filtres-reset'));
      await waitFor(
        () =>
          expect(urlsFactures(fetchMock).at(-1)).toBe(
            '/api/v1/traiteur/factures',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1 — Facturation : Période en premier ; 2 statuts / types → CSV ; « Tous » efface ; tout cocher = aucun paramètre',
    async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, json: async () => ({ data: [] }) }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const dernier = () =>
        new URL(String(urlsFactures(fetchMock).at(-1)), 'http://localhost')
          .searchParams;
      render(<MonOrganisationClient isManager userId="u1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Facturation' }));
      const barre = await screen.findByTestId(
        'factures-filtres',
        undefined,
        ATTENTE_UI,
      );

      // (a) « Période » en premier (décision Val 2026-09-30).
      const periode = within(barre).getByText('Période');
      for (const suivant of ['factures-statut', 'factures-type'])
        expect(
          periode.compareDocumentPosition(within(barre).getByTestId(suivant)) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

      // (b) Deux statuts cochés → statuts CSV.
      fireEvent.click(within(barre).getByTestId('factures-statut'));
      const statuts = within(
        await screen.findByRole('list', { name: 'Statut' }, ATTENTE_UI),
      );
      fireEvent.click(statuts.getByRole('checkbox', { name: 'Émise' }));
      fireEvent.click(statuts.getByRole('checkbox', { name: 'Payée' }));
      await waitFor(
        () => expect(dernier().get('statuts')).toBe('emise,payee'),
        ATTENTE_UI,
      );
      expect(dernier().get('statut')).toBeNull();

      // (c) « Tous » efface la sélection.
      fireEvent.click(statuts.getByRole('checkbox', { name: 'Tous' }));
      await waitFor(
        () => expect(dernier().get('statuts')).toBeNull(),
        ATTENTE_UI,
      );

      // (d) Tous les types cochés = « Tous » = aucun paramètre.
      fireEvent.click(within(barre).getByTestId('factures-type'));
      const types = within(
        await screen.findByRole('list', { name: 'Type' }, ATTENTE_UI),
      );
      fireEvent.click(types.getByRole('checkbox', { name: 'ZD' }));
      fireEvent.click(types.getByRole('checkbox', { name: 'AG' }));
      await waitFor(
        () =>
          expect(dernier().get('types')).toBe('zero_dechet,collecte_antigaspi'),
        ATTENTE_UI,
      );
      fireEvent.click(types.getByRole('checkbox', { name: 'Pack' }));
      fireEvent.click(types.getByRole('checkbox', { name: 'Avoir' }));
      await waitFor(
        () => expect(dernier().get('types')).toBeNull(),
        ATTENTE_UI,
      );
      expect(types.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1 — Facturation : une réponse plus ancienne arrivée en dernier n’écrase pas la liste',
    async () => {
      const facture = (id: string, numero_facture: string) => ({
        id,
        numero_facture,
        type: 'zero_dechet',
        statut: 'emise',
        montant_ttc: 12,
        date_emission: '2026-09-01',
        date_echeance: null,
        pdf_url_pennylane: null,
        pdf_url_savr: null,
      });
      // 1re requête Factures retenue (lignes périmées), les suivantes immédiates.
      let liberer = () => {};
      let premiere = true;
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const reponse = (data: unknown[]) =>
          ({ ok: true, json: async () => ({ data }) }) as Response;
        if (!String(input).startsWith('/api/v1/traiteur/factures'))
          return Promise.resolve(reponse([]));
        if (!premiere)
          return Promise.resolve(reponse([facture('f-new', 'F-RECENTE')]));
        premiere = false;
        return new Promise<Response>((resoudre) => {
          liberer = () => resoudre(reponse([facture('f-old', 'F-PERIMEE')]));
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationClient isManager userId="u1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Facturation' }));

      fireEvent.click(
        await screen.findByTestId('factures-statut', undefined, ATTENTE_UI),
      );
      fireEvent.click(
        within(
          await screen.findByRole('list', { name: 'Statut' }, ATTENTE_UI),
        ).getByRole('checkbox', { name: 'Payée' }),
      );
      await waitFor(
        () =>
          expect(screen.getAllByText('F-RECENTE').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );

      await act(async () => {
        liberer();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(screen.queryByText('F-PERIMEE')).toBeNull();
      expect(screen.getAllByText('F-RECENTE').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );
});
