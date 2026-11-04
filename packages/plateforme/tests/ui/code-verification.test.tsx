/**
 * Écran du code de vérification de l'équipe Savr — formulaire.
 *
 * Garanties : en activation, le QR code et la clé (en groupes de 4) viennent de
 * la route d'activation et la saisie renvoie l'activation commencée ; en saisie,
 * pas d'appel d'activation ; réussite → page demandée ; refus → message affiché
 * sans quitter l'écran ; « Se déconnecter » ferme la session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

const push = vi.fn();
const refresh = vi.fn();
// Instance stable, comme `useRouter()` de Next : le formulaire la met dans les
// dépendances de son effet d'activation.
const routeur = { push, refresh, replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => routeur }));

import { FormulaireCodeVerification } from '@/app/code-verification/formulaire-code-verification.js';

const fetchMock = vi.fn();

function reponse(status: number, corps: unknown) {
  return { ok: status < 300, status, json: async () => corps };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

function saisir(container: HTMLElement, code: string) {
  fireEvent.change(container.querySelector('#code-verification')!, {
    target: { value: code },
  });
  fireEvent.submit(container.querySelector('form')!);
}

describe('écran du code — activation', () => {
  it(
    'affiche QR code et clé, puis active avec le facteur commencé et rejoint la page demandée',
    async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/activation')
          ? reponse(200, {
              factor_id: 'f-nouveau',
              qr_code: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E',
              secret: 'JBSWY3DPEHPK3PXP',
            })
          : reponse(200, { ok: true }),
      );
      const { container } = render(
        <FormulaireCodeVerification
          mode="activation"
          suite="/admin/collectes"
        />,
      );

      const img = await screen.findByRole(
        'img',
        { name: /QR code/ },
        ATTENTE_UI,
      );
      expect(img.getAttribute('src')).toContain('data:image/svg+xml');
      expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();

      saisir(container, '123456');
      await waitFor(
        () => expect(push).toHaveBeenCalledWith('/admin/collectes'),
        ATTENTE_UI,
      );
      const [, init] = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/verification'),
      )!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        code: '123456',
        factor_id: 'f-nouveau',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'activation impossible → message et bouton « Réessayer »',
    async () => {
      fetchMock.mockResolvedValue(
        reponse(502, { error: 'Activation impossible pour le moment.' }),
      );
      render(<FormulaireCodeVerification mode="activation" suite="/admin" />);
      expect(
        await screen.findByText(
          'Activation impossible pour le moment.',
          {},
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await waitFor(
        () => expect(fetchMock).toHaveBeenCalledTimes(2),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});

describe('écran du code — saisie', () => {
  it(
    'aucune activation demandée ; code refusé → message, on reste sur l’écran',
    async () => {
      fetchMock.mockResolvedValue(reponse(422, { error: 'Code incorrect.' }));
      const { container } = render(
        <FormulaireCodeVerification mode="saisie" suite="/admin" />,
      );
      saisir(container, '000000');
      expect(
        await screen.findByText('Code incorrect.', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(push).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/activation')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    '« Se déconnecter » ferme la session puis renvoie à la connexion',
    async () => {
      fetchMock.mockResolvedValue(reponse(200, { success: true }));
      render(<FormulaireCodeVerification mode="saisie" suite="/admin" />);
      fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
      await waitFor(
        () => expect(push).toHaveBeenCalledWith('/login'),
        ATTENTE_UI,
      );
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
      });
    },
    ATTENTE_CAS_MS,
  );
});
