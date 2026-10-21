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

function installFetch(
  collectes: {
    type: string;
    statut: string;
    pax?: number;
    date_collecte?: string;
    heure_collecte?: string;
  }[],
) {
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
  // Pax de la collecte, saisi avec sa date (décision Val 2026-10-20).
  fireEvent.change(screen.getByTestId(`pax-${type}`), {
    target: { value: '650' },
  });
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
        expect.objectContaining({ type: 'zd', pax: 650 }),
      ]);
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2/pax_par_collecte — ajouter une collecte : le pax', () => {
  it(
    'pré-rempli avec le pax de la dernière collecte de l’événement (par date puis heure), modifiable',
    async () => {
      installFetch([
        // Dans le désordre : la dernière (par date puis heure) est l'AG du
        // 11/01 à 22:00, ni la première ni la dernière du tableau.
        {
          type: 'zero_dechet',
          statut: 'cloturee',
          pax: 300,
          date_collecte: '2030-01-11',
          heure_collecte: '08:00:00',
        },
        {
          type: 'anti_gaspi',
          statut: 'programmee',
          pax: 1200,
          date_collecte: '2030-01-11',
          heure_collecte: '22:00:00',
        },
        {
          type: 'zero_dechet',
          statut: 'cloturee',
          pax: 900,
          date_collecte: '2030-01-10',
          heure_collecte: '22:00:00',
        },
      ]);
      render(<AjouterCollectePage />);
      const champ = await screen.findByDisplayValue(
        '1200',
        undefined,
        ATTENTE_UI,
      );
      expect(champ).toBe(screen.getByTestId('pax-zd'));
    },
    ATTENTE_CAS_MS,
  );

  it(
    'jamais le pax d’une collecte annulée ni un pax inconnu (0) : la dernière collecte non annulée au pax connu',
    async () => {
      installFetch([
        {
          type: 'zero_dechet',
          statut: 'cloturee',
          pax: 900,
          date_collecte: '2030-01-10',
          heure_collecte: '22:00:00',
        },
        // Plus tardives, mais annulée ou au pax inconnu (reprise Bubble).
        {
          type: 'anti_gaspi',
          statut: 'annulee',
          pax: 1200,
          date_collecte: '2030-01-11',
          heure_collecte: '22:00:00',
        },
        {
          type: 'zero_dechet',
          statut: 'programmee',
          pax: 0,
          date_collecte: '2030-01-11',
          heure_collecte: '23:00:00',
        },
      ]);
      render(<AjouterCollectePage />);
      const champ = await screen.findByDisplayValue(
        '900',
        undefined,
        ATTENTE_UI,
      );
      expect(champ).toBe(screen.getByTestId('pax-zd'));
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sans pax saisi, la collecte ne peut pas être ajoutée',
    async () => {
      const fetchMock = installFetch([]);
      render(<AjouterCollectePage />);
      fireEvent.change(screen.getByTestId('pax-zd'), {
        target: { value: '' },
      });
      expect(
        screen.getByRole('button', { name: 'Ajouter la collecte' }),
      ).toBeDisabled();
      expect(creations(fetchMock)).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );
});
