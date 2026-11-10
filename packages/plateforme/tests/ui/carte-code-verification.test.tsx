/**
 * Fiche client (back-office) → carte « Code de vérification » : case qui exige
 * le code des utilisateurs du client (VIPARIS, décision Val 2026-11-10).
 *
 * Garanties : bouton montré au seul admin_savr ; confirmation avant l'appel ;
 * l'appel envoie la valeur inverse de l'état affiché ; refus de la route
 * affiché dans la fenêtre, sans rechargement de la fiche.
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

import { CarteCodeVerification } from '@/app/(admin)/admin/clients/[id]/carte-code-verification.js';

const fetchMock = vi.fn();
const onChange = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

function reponse(status: number, corps: unknown) {
  return { ok: status < 300, status, json: async () => corps };
}

describe('carte « Code de vérification » de la fiche client', () => {
  it('Ops : état lisible, aucun bouton', () => {
    render(
      <CarteCodeVerification
        organisationId="org-1"
        exige={false}
        peutModifier={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Non exigé')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Exiger' })).toBeNull();
  });

  it(
    'Admin : « Exiger » demande confirmation puis envoie true, recharge la fiche',
    async () => {
      fetchMock.mockResolvedValue(reponse(200, { id: 'org-1' }));
      render(
        <CarteCodeVerification
          organisationId="org-1"
          exige={false}
          peutModifier
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Exiger' }));
      expect(fetchMock).not.toHaveBeenCalled();
      const boutons = await screen.findAllByRole(
        'button',
        { name: 'Exiger' },
        ATTENTE_UI,
      );
      fireEvent.click(boutons[boutons.length - 1]!);
      await waitFor(() => expect(onChange).toHaveBeenCalled(), ATTENTE_UI);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/v1/admin/organisations/org-1');
      expect((init as RequestInit).method).toBe('PATCH');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        code_verification_obligatoire: true,
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Admin : « Ne plus l’exiger » envoie false ; refus de la route affiché, fiche non rechargée',
    async () => {
      fetchMock.mockResolvedValue(
        reponse(403, { error: 'Action réservée admin Savr' }),
      );
      render(
        <CarteCodeVerification
          organisationId="org-1"
          exige
          peutModifier
          onChange={onChange}
        />,
      );
      expect(screen.getByText('Exigé')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Ne plus l’exiger' }));
      const boutons = await screen.findAllByRole(
        'button',
        { name: 'Ne plus l’exiger' },
        ATTENTE_UI,
      );
      fireEvent.click(boutons[boutons.length - 1]!);
      expect(
        await screen.findByText('Action réservée admin Savr', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string),
      ).toEqual({ code_verification_obligatoire: false });
      expect(onChange).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );
});
