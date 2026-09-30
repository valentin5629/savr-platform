/**
 * Mon organisation > Facturation (§06.04 §6 l.690) — filtres statut / type /
 * période au format en ligne (décision Val 2026-09-30). La sémantique ne
 * change pas : chaque filtre part en paramètre de `/api/v1/traiteur/factures`,
 * « Réinitialiser » les retire tous.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
    'statut choisi → paramètre statut ; Réinitialiser → plus aucun paramètre',
    async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, json: async () => ({ data: [] }) }),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<MonOrganisationClient isManager userId="u1" />);

      fireEvent.click(screen.getByRole('button', { name: 'Facturation' }));
      // Filtre en ligne « Statut  Tous ▾ », sans libellé au-dessus.
      const statut = await screen.findByRole(
        'combobox',
        { name: 'Statut' },
        ATTENTE_UI,
      );
      expect(statut).toHaveTextContent('Tous');
      expect(screen.queryByTestId('factures-filtres-reset')).toBeNull();

      fireEvent.click(statut);
      fireEvent.click(screen.getByRole('option', { name: 'Payée' }));
      await waitFor(
        () =>
          expect(urlsFactures(fetchMock)).toContain(
            '/api/v1/traiteur/factures?statut=payee',
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
});
