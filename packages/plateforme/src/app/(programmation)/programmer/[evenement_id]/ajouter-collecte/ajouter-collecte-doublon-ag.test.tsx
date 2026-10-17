/**
 * M1.2 — « Ajouter une collecte » à un événement qui a déjà une collecte AG :
 * l'écran avertit, puis crée la seconde après confirmation (§06.01 « Ajouter une
 * collecte à un événement existant », scénario
 * `ajout_seconde_collecte_ag_avertissement`).
 *
 * La route GET de l'événement rend le type tel que la base le stocke
 * (`anti_gaspi`), jamais l'alias du formulaire (`ag`) : comparé à l'alias,
 * l'avertissement ne s'affichait jamais (depuis le 2026-06-14).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const back = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ evenement_id: 'evt-1' }),
  useRouter: () => ({ push: vi.fn(), back, refresh: vi.fn() }),
}));

import AjouterCollectePage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const AVERTISSEMENT =
  "Cet événement a déjà une collecte Anti-Gaspi. Confirmer l'ajout d'une seconde ?";

function installFetch(collectes: { type: string; statut: string }[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const json = (corps: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(corps),
      } as Response);
    if (url.includes('/programmation/pack-ag')) {
      return json({
        pack_actif: true,
        credits_initiaux: 10,
        credits_restants: 4,
      });
    }
    if (url.endsWith('/programmation/evenements/evt-1')) {
      return json({ id: 'evt-1', organisation_id: 'org-1', collectes });
    }
    if (url.endsWith('/programmation/evenements/evt-1/collectes')) {
      return json({ collecte_id: 'col-nouvelle' });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const creations = (fetchMock: ReturnType<typeof installFetch>) =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).endsWith('/evenements/evt-1/collectes'))
    .map(([, init]) => JSON.parse(String(init?.body)) as { type: string });

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

// Le 20 du mois suivant à 22:00 : toujours dans le futur, jamais à moins de
// 48 h. Le calendrier s'ouvre sur le mois courant.
function remplirEtAjouter(type: 'zd' | 'ag') {
  if (type === 'ag') {
    fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
  }
  const auj = new Date();
  const cible = new Date(auj.getFullYear(), auj.getMonth() + 1, 20);
  const mois = `${MOIS[cible.getMonth()]} ${cible.getFullYear()}`;
  fireEvent.click(screen.getByTestId(`date-${type}`));
  for (let i = 0; i < 3; i++) {
    const affiche = screen.getByRole('grid').getAttribute('aria-label') ?? '';
    if (affiche.toLowerCase() === mois) break;
    fireEvent.click(
      screen.getByRole('button', { name: 'Aller au mois suivant' }),
    );
  }
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(` 20 ${mois}$`) }),
  );
  fireEvent.click(screen.getByTestId(`heure-${type}`));
  fireEvent.click(screen.getByRole('option', { name: '22:00' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la collecte' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  back.mockReset();
});

describe('M1.2 — ajouter une collecte : seconde collecte Anti-Gaspi', () => {
  it(
    'événement avec une collecte anti_gaspi : avertissement, rien n’est créé',
    async () => {
      const fetchMock = installFetch([
        { type: 'anti_gaspi', statut: 'programmee' },
      ]);
      render(<AjouterCollectePage />);

      remplirEtAjouter('ag');

      expect(
        await screen.findByText(AVERTISSEMENT, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(creations(fetchMock)).toEqual([]);
      expect(back).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    '« Confirmer quand même » crée la seconde collecte AG',
    async () => {
      const fetchMock = installFetch([
        { type: 'anti_gaspi', statut: 'programmee' },
      ]);
      render(<AjouterCollectePage />);

      remplirEtAjouter('ag');
      await screen.findByText(AVERTISSEMENT, undefined, ATTENTE_UI);
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer quand même' }),
      );

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'ag' }),
      ]);
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'événement sans collecte AG : la collecte AG est créée sans avertissement',
    async () => {
      const fetchMock = installFetch([
        { type: 'zero_dechet', statut: 'programmee' },
      ]);
      render(<AjouterCollectePage />);

      remplirEtAjouter('ag');

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'ag' }),
      ]);
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ajout d’une collecte ZD à un événement qui a une collecte AG : aucun avertissement',
    async () => {
      const fetchMock = installFetch([
        { type: 'anti_gaspi', statut: 'programmee' },
      ]);
      render(<AjouterCollectePage />);

      remplirEtAjouter('zd');

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'zd' }),
      ]);
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
