/**
 * R-UI-5 F9 — « Changer mon mot de passe » rejoue `validatePasswordStrength`
 * (la fonction même de POST /api/auth/update-password) AVANT le réseau. Le
 * contrôle de confirmation garde la priorité, comme avant ; un mot de passe
 * conforme part toujours au serveur.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { ChangerMotDePassePanel } from './changer-mot-de-passe-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function saisir(motDePasse: string, confirmation: string) {
  renderAvecToasts(<ChangerMotDePassePanel />);
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
    target: { value: motDePasse },
  });
  fireEvent.change(screen.getByLabelText('Confirmation'), {
    target: { value: confirmation },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
}

describe('R-UI-5 — Changer mon mot de passe : politique vérifiée côté client', () => {
  it(
    'mot de passe faible → message du helper serveur, aucun appel réseau',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      saisir('court', 'court');
      expect(
        await screen.findByText(
          'Le mot de passe doit contenir au moins 10 caractères.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'confirmation différente → message de confirmation en premier (inchangé)',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      saisir('court', 'autre');
      expect(
        await screen.findByText(
          'Les deux mots de passe ne correspondent pas.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'mot de passe conforme → POST /api/auth/update-password',
    async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      saisir('Motdepasse1!', 'Motdepasse1!');
      expect(
        await screen.findByText(
          'Mot de passe mis à jour.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/update-password',
        expect.objectContaining({ method: 'POST' }),
      );
    },
    ATTENTE_CAS_MS,
  );
});
