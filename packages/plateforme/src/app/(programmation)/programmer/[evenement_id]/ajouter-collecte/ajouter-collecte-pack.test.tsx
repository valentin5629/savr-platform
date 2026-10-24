/**
 * M1.2 — « Ajouter une collecte » à un événement existant : une collecte AG sans
 * pack actif se programme et sera facturée à l'unité, et l'écran le dit
 * (décision Val 2026-10-16). Avant, la route refusait (422) et l'écran affichait
 * l'erreur ; sans cette information, l'AG passerait désormais en silence.
 * L'information est portée par la carte de la collecte (refonte du formulaire,
 * lot B2), sur le pack de l'organisation de l'événement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ evenement_id: 'evt-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import AjouterCollectePage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const INFO =
  "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";

function installFetch(pack: object) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (corps: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(corps),
      } as Response);
    if (url.includes('/programmation/pack-ag')) return json(pack);
    if (url.endsWith('/programmation/types-evenements')) return json([]);
    if (url.endsWith('/programmation/evenements/evt-1')) {
      return json({ id: 'evt-1', organisation_id: 'org-1', collectes: [] });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const lecturesPack = (fetchMock: ReturnType<typeof installFetch>) =>
  fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.includes('/programmation/pack-ag'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M1.2 — ajouter une collecte : information « facturée à l’unité »', () => {
  it(
    'AG sans pack actif : information exacte, lue sur le pack de l’organisation de l’événement',
    async () => {
      const fetchMock = installFetch({ pack_actif: false });
      render(<AjouterCollectePage />);

      // Zéro Déchet par défaut : aucun pack lu.
      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/programmation/evenements/evt-1',
          ),
        ATTENTE_UI,
      );
      expect(lecturesPack(fetchMock)).toEqual([]);

      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));

      expect(
        await screen.findByText(INFO, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      // Dans la carte Anti-Gaspi, en information, jamais en erreur.
      expect(
        within(screen.getByTestId('carte-ag-1')).getByRole('status'),
      ).toHaveTextContent(INFO);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(lecturesPack(fetchMock)).toEqual([
        '/api/v1/programmation/pack-ag?organisation_id=org-1',
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'AG avec un pack actif et des crédits : jauge des crédits, aucune information',
    async () => {
      installFetch({
        pack_actif: true,
        credits_initiaux: 10,
        credits_restants: 4,
      });
      render(<AjouterCollectePage />);

      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));

      expect(
        await screen.findByRole('progressbar', {}, ATTENTE_UI),
      ).toHaveAttribute('aria-valuenow', '4');
      expect(screen.queryByText(INFO)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
