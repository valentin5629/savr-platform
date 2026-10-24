/**
 * M1.2 — « Ajouter une collecte » : deux collectes du même type au même moment
 * (§06.01 « Ajouter une collecte à un événement existant », décision Val
 * 2026-10-22, C4). Si la nouvelle collecte a le même type, la même date et la
 * même heure qu'une collecte non annulée de l'événement, la carte affiche un
 * avertissement non bloquant ; aucun avertissement si l'heure diffère.
 *
 * Remplace l'avertissement « Cet événement a déjà une collecte Anti-Gaspi.
 * Confirmer l'ajout d'une seconde ? » et son second clic de confirmation.
 * La route GET de l'événement rend le type tel que la base le stocke
 * (`anti_gaspi`), jamais l'alias du formulaire (`ag`).
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
  "Pour un gros volume, une seule collecte suffit : l'équipe Savr fixe le nombre de camions.";
const ANCIEN_AVERTISSEMENT = /déjà une collecte Anti-Gaspi/;

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

// Le 20 du mois suivant : toujours dans le futur, jamais à moins de 24 h.
const CIBLE = (() => {
  const auj = new Date();
  return new Date(auj.getFullYear(), auj.getMonth() + 1, 20);
})();
const CIBLE_ISO = `${CIBLE.getFullYear()}-${String(CIBLE.getMonth() + 1).padStart(2, '0')}-20`;

// Collecte existante de l'événement : pax, type d'événement et contacts
// connus, pour que la carte n'attende que la date et l'heure.
function collecte(
  type: 'zero_dechet' | 'anti_gaspi',
  heure: string,
  statut = 'programmee',
) {
  return {
    id: `col-${type}-${heure}-${statut}`,
    type,
    statut,
    date_collecte: CIBLE_ISO,
    heure_collecte: `${heure}:00`,
    pax: 650,
    type_evenement_id: 'te-1',
    contacts: {
      contact_principal_nom: 'Paul Arnaud',
      contact_principal_telephone: '06 12 34 56 78',
      contact_secours_nom: null,
      contact_secours_telephone: null,
    },
    created_at: '2026-10-01T08:00:00Z',
  };
}

function installFetch(collectes: object[]) {
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
    if (url.endsWith('/programmation/types-evenements')) {
      return json([{ id: 'te-1', libelle: 'Repas assis' }]);
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

// Attend la carte pré-remplie (événement lu), choisit le type, puis la date
// (le 20 du mois suivant) et l'heure.
async function remplir(type: 'zd' | 'ag', heure: string) {
  await screen.findByDisplayValue('650', undefined, ATTENTE_UI);
  if (type === 'ag') {
    fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
  }
  const mois = `${MOIS[CIBLE.getMonth()]} ${CIBLE.getFullYear()}`;
  fireEvent.click(screen.getByTestId(`date-${type}-1`));
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
  fireEvent.click(screen.getByTestId(`heure-${type}-1`));
  fireEvent.click(screen.getByRole('option', { name: heure }));
}

const ajouter = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la collecte' }));

afterEach(() => {
  vi.unstubAllGlobals();
  back.mockReset();
});

describe('M1.2 — ajouter une collecte : deux collectes du même type au même moment (C4)', () => {
  it(
    'même type, même date et même heure qu’une collecte non annulée : avertissement non bloquant, créée au premier clic',
    async () => {
      const fetchMock = installFetch([collecte('anti_gaspi', '22:00')]);
      render(<AjouterCollectePage />);

      await remplir('ag', '22:00');

      // Affiché dès la saisie, avant tout envoi.
      expect(screen.getByText(AVERTISSEMENT)).toBeInTheDocument();
      expect(creations(fetchMock)).toEqual([]);

      ajouter();

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'ag' }),
      ]);
      expect(screen.queryByText(ANCIEN_AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'même type et même date, heure différente : aucun avertissement',
    async () => {
      const fetchMock = installFetch([collecte('anti_gaspi', '22:00')]);
      render(<AjouterCollectePage />);

      await remplir('ag', '21:00');
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();

      ajouter();

      // Plus de second clic « Confirmer quand même » : une AG s'ajoute
      // directement à un événement qui en a déjà une.
      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'ag' }),
      ]);
      expect(screen.queryByText(ANCIEN_AVERTISSEMENT)).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Confirmer quand même' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'autre type à la même date et à la même heure : aucun avertissement',
    async () => {
      const fetchMock = installFetch([collecte('anti_gaspi', '22:00')]);
      render(<AjouterCollectePage />);

      await remplir('zd', '22:00');
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();

      ajouter();

      await waitFor(() => expect(back).toHaveBeenCalledTimes(1), ATTENTE_UI);
      expect(creations(fetchMock)).toEqual([
        expect.objectContaining({ type: 'zd', pax: 650 }),
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte du même type au même moment mais annulée : aucun avertissement',
    async () => {
      installFetch([
        collecte('zero_dechet', '20:00'),
        collecte('anti_gaspi', '22:00', 'annulee'),
      ]);
      render(<AjouterCollectePage />);

      await remplir('ag', '22:00');
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'l’avertissement suit la saisie : il disparaît quand l’heure change',
    async () => {
      installFetch([collecte('zero_dechet', '22:00')]);
      render(<AjouterCollectePage />);

      await remplir('zd', '22:00');
      expect(screen.getByText(AVERTISSEMENT)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('heure-zd-1'));
      fireEvent.click(screen.getByRole('option', { name: '23:00' }));
      expect(screen.queryByText(AVERTISSEMENT)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
