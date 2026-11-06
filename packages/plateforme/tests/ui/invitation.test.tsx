/**
 * Page /invitation — choix du mot de passe depuis l'email d'invitation (lien Savr
 * valable 7 jours, décision Val 2026-10-28).
 *
 * Ce que ces tests garantissent : le formulaire salue la personne, refuse un mot
 * de passe faible ou mal confirmé AVANT tout appel réseau, envoie le jeton avec le
 * mot de passe, puis propose la connexion ; un lien devenu inutilisable pendant la
 * saisie donne un écran qui explique et propose une sortie, jamais une impasse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { FormulaireInvitation } from '@/app/invitation/formulaire-invitation.js';
import { CarteLienInvitation } from '@/app/invitation/carte-lien-invitation.js';

const fetchMock = vi.fn();
const MDP = 'MotDePasse1!x';

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
});

afterEach(cleanup);

function remplir(container: HTMLElement, id: string, valeur: string) {
  fireEvent.change(container.querySelector(`#${id}`)!, {
    target: { value: valeur },
  });
}

function rendre() {
  return render(
    <FormulaireInvitation
      jeton="charge.signature"
      prenom="Jeanne"
      email="jeanne@exemple.fr"
    />,
  );
}

describe('/invitation — formulaire', () => {
  it('salue la personne et rappelle son adresse', () => {
    const { getByText } = rendre();
    expect(getByText('Bienvenue, Jeanne')).toBeTruthy();
    expect(getByText(/jeanne@exemple\.fr/)).toBeTruthy();
  });

  it(
    'refuse un mot de passe faible sans appel réseau',
    async () => {
      const { container, findByRole } = rendre();
      remplir(container, 'mot-de-passe', 'court');
      remplir(container, 'confirmation', 'court');
      fireEvent.submit(container.querySelector('form')!);
      expect((await findByRole('alert', {}, ATTENTE_UI)).textContent).toMatch(
        /caractères/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refuse deux mots de passe différents sans appel réseau',
    async () => {
      const { container, findByText } = rendre();
      remplir(container, 'mot-de-passe', MDP);
      remplir(container, 'confirmation', `${MDP}2`);
      fireEvent.submit(container.querySelector('form')!);
      expect(
        await findByText(/ne sont pas identiques/i, {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'envoie le jeton et le mot de passe, puis propose la connexion',
    async () => {
      const { container, findByText } = rendre();
      remplir(container, 'mot-de-passe', MDP);
      remplir(container, 'confirmation', MDP);
      fireEvent.submit(container.querySelector('form')!);
      expect(
        await findByText('Votre compte est prêt', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/invitation',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            jeton: 'charge.signature',
            mot_de_passe: MDP,
          }),
        }),
      );
      const lien = container.querySelector('a[href="/login"]');
      expect(lien?.textContent).toBe('Se connecter');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'lien expiré pendant la saisie : écran explicatif avec une sortie',
    async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 410,
        json: async () => ({ error: 'x', motif: 'expire' }),
      });
      const { container, findByText } = rendre();
      remplir(container, 'mot-de-passe', MDP);
      remplir(container, 'confirmation', MDP);
      fireEvent.submit(container.querySelector('form')!);
      expect(await findByText('Lien expiré', {}, ATTENTE_UI)).toBeTruthy();
      await waitFor(
        () =>
          expect(
            container.querySelector('a[href="/reset-password"]')?.textContent,
          ).toBe("Recevoir un lien d'accès"),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});

describe('/invitation — lien inutilisable', () => {
  it.each([
    ['expire', 'Lien expiré', '/reset-password'],
    ['utilise', 'Lien déjà utilisé', '/login'],
    ['invalide', 'Lien incomplet', '/login'],
    ['inactif', 'Compte inactif', '/login'],
  ] as const)('%s : titre et sortie', (motif, titre, href) => {
    const { getByText, container } = render(
      <CarteLienInvitation motif={motif} />,
    );
    expect(getByText(titre)).toBeTruthy();
    expect(container.querySelector(`a[href="${href}"]`)).toBeTruthy();
  });
});
