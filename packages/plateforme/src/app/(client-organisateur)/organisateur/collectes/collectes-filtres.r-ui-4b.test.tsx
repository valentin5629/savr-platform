/**
 * R-UI-4b (D10) — liste Collectes client organisateur : barre de filtres DS
 * (`CollecteFiltresBar` : Période + compteur + « Réinitialiser les filtres »),
 * type ZD / AG dans son en-tête, état dans l'URL (D6). La route n'accepte que
 * `type` + période : aucun autre filtre n'est proposé.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from '@testing-library/react';

const { urlParams } = vi.hoisted(() => ({ urlParams: { current: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlParams.current),
  usePathname: () => '/organisateur/collectes',
}));

import CollectesPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const LIGNES = [
  {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'cloturee',
    date_collecte: '2026-05-10',
    heure_collecte: '22:00:00',
    taux_recyclage: 80,
    co2_evite_kg: 10,
    traiteur_nom: 'Kaspia Réceptions',
    repas_donnes: null,
    evenements: {
      nom_evenement: 'Gala',
      pax: 300,
      lieux: { nom: 'Pavillon Gabriel', code_postal: '75008', ville: 'Paris' },
    },
  },
  {
    id: 'c2',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-06-10',
    heure_collecte: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    traiteur_nom: null,
    repas_donnes: null,
    evenements: null,
  },
];

function fetchEspion() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ data: LIGNES }), { status: 200 }),
      );
    }),
  );
  return urls;
}
const demande = (u: string) => new URLSearchParams(u.split('?')[1] ?? '');

afterEach(() => {
  cleanup();
  urlParams.current = '';
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/organisateur/collectes');
});

describe('R-UI-4b / liste Collectes organisateur — barre de filtres', () => {
  it(
    'barre rendue : Période seule, type ZD / AG en en-tête, compteur en pied ; rien que ce que la route accepte',
    async () => {
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      expect(screen.getByTestId('collecte-filtres-bar')).toBeTruthy();
      expect(screen.getByTestId('filtre-periode')).toBeTruthy();
      for (const t of [
        'filtre-statut',
        'filtre-lieu',
        'filtre-client',
        'filtre-info-incomplete',
      ])
        expect(screen.queryByTestId(t)).toBeNull();
      expect(screen.getByTestId('collectes-resultats-count').textContent).toBe(
        '2 collectes correspondent à votre sélection',
      );
      // Type ZD par défaut, sans « Toutes » (les colonnes dépendent du type).
      expect(screen.queryByRole('radio', { name: 'Toutes' })).toBeNull();
      expect(
        screen.getByRole('radio', { name: 'Zéro Déchet' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(demande(urls[0]!).get('type')).toBe('zero_dechet');

      // Passer en AG : la route reçoit le type, l'URL le reflète.
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      });
      expect(demande(urls[urls.length - 1]!).get('type')).toBe('anti_gaspi');
      expect(window.location.search).toBe('?type=anti_gaspi');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'période lue dans l’URL et transmise ; « Réinitialiser les filtres » la retire sans toucher au type',
    async () => {
      urlParams.current = 'type=anti_gaspi&from=2026-01-01&to=2026-06-30';
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      const avant = demande(urls[0]!);
      expect(avant.get('type')).toBe('anti_gaspi');
      expect(avant.get('from')).toBe('2026-01-01');
      expect(avant.get('to')).toBe('2026-06-30');
      expect(
        screen.getByTestId('filtre-periode').getAttribute('data-from'),
      ).toBe('2026-01-01');

      await act(async () => {
        fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
      });
      const apres = demande(urls[urls.length - 1]!);
      expect(apres.get('from')).toBeNull();
      expect(apres.get('to')).toBeNull();
      // Le type est un axe de vue, pas un filtre : il survit au reset.
      expect(apres.get('type')).toBe('anti_gaspi');
      expect(window.location.search).toBe('?type=anti_gaspi');
      expect(screen.queryByTestId('collecte-filtres-bar-reset')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
