/**
 * Paramètres → Utilisateurs Savr : réinitialisation du code de vérification
 * (téléphone perdu ou changé).
 *
 * Garanties : colonne montrée au seul admin_savr ; jamais de bouton sur sa
 * propre ligne ; confirmation avant l'appel ; message selon ce que la route a
 * retiré ; refus de la route affiché dans la fenêtre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const etat = { role: 'admin_savr' as string | undefined, moi: 'admin-1' };
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => etat.role,
  useUserId: () => etat.moi,
}));

const MEMBRES = [
  {
    id: 'admin-1',
    prenom: 'Val',
    nom: 'Admin',
    email: 'val@gosavr.io',
    role: 'admin_savr',
    actif: true,
    derniere_connexion: null,
  },
  {
    id: 'ops-1',
    prenom: 'Camille',
    nom: 'Ops',
    email: 'camille@gosavr.io',
    role: 'ops_savr',
    actif: true,
    derniere_connexion: null,
  },
];
vi.mock('@/lib/hooks/use-liste-paginee', () => ({
  useListePaginee: () => ({
    data: MEMBRES,
    total: MEMBRES.length,
    loading: false,
    erreur: null,
    recharger: vi.fn(),
  }),
}));

import SettingsUsersPage from '@/app/(admin)/admin/settings/users/page.js';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  etat.role = 'admin_savr';
  etat.moi = 'admin-1';
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

function reponse(status: number, corps: unknown) {
  return { ok: status < 300, status, json: async () => corps };
}
// La table se rend deux fois (ordinateur et téléphone) : on compte toutes les
// occurrences et on clique la première.
const boutonsDe = (nom: string) =>
  screen.queryAllByRole('button', {
    name: `Réinitialiser le code de vérification de ${nom}`,
  });
const boutonDe = (nom: string) => boutonsDe(nom)[0];

describe('Utilisateurs Savr — réinitialisation du code de vérification', () => {
  it('admin : bouton sur les autres membres, jamais sur sa propre ligne', () => {
    renderAvecToasts(<SettingsUsersPage />);
    expect(screen.getAllByText('Code de vérification').length).toBeGreaterThan(
      0,
    );
    expect(boutonsDe('Camille Ops').length).toBeGreaterThan(0);
    expect(boutonsDe('Val Admin')).toHaveLength(0);
  });

  it('ops_savr : pas de colonne', () => {
    etat.role = 'ops_savr';
    renderAvecToasts(<SettingsUsersPage />);
    expect(screen.queryAllByText('Code de vérification')).toHaveLength(0);
    expect(boutonsDe('Camille Ops')).toHaveLength(0);
  });

  it(
    'confirmation puis appel de la route, message de réussite',
    async () => {
      fetchMock.mockResolvedValue(reponse(200, { facteurs_retires: 1 }));
      renderAvecToasts(<SettingsUsersPage />);
      fireEvent.click(boutonDe('Camille Ops')!);
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
      expect(
        await screen.findByText(
          'Code de vérification de Camille Ops réinitialisé.',
          {},
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/users/ops-1/code-verification',
        { method: 'DELETE' },
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'membre sans code : message dédié, pas de « réinitialisé »',
    async () => {
      fetchMock.mockResolvedValue(reponse(200, { facteurs_retires: 0 }));
      renderAvecToasts(<SettingsUsersPage />);
      fireEvent.click(boutonDe('Camille Ops')!);
      fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
      expect(
        await screen.findByText(
          /Camille Ops n’avait pas encore de code/,
          {},
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/réinitialisé\./)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus de la route : message dans la fenêtre',
    async () => {
      fetchMock.mockResolvedValue(
        reponse(422, {
          error: 'Ce compte n’utilise pas de code de vérification.',
        }),
      );
      renderAvecToasts(<SettingsUsersPage />);
      fireEvent.click(boutonDe('Camille Ops')!);
      fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
      expect(
        await screen.findByText(
          'Ce compte n’utilise pas de code de vérification.',
          {},
          ATTENTE_UI,
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});
