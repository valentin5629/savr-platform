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
import { decalerJour, jourParis } from '@savr/shared/src/temps/index.js';

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

// Vues « Collectes à venir / passées » (décision Val 2026-10-19). La route
// sert un ordre mélangé : l'ordre affiché prouve le tri de la page.
const JOURS_VUES = ['2026-07-14', '2026-07-08', '2026-06-30', '2026-07-20'];
const LIGNES_VUES = JOURS_VUES.map((jour) => ({
  ...LIGNES[0]!,
  id: `c-${jour}`,
  date_collecte: jour,
  evenements: { ...LIGNES[0]!.evenements, nom_evenement: `EVT-${jour}` },
}));
/** Dates des lignes, dans l'ordre du <table> (DataGrid double en cartes). */
function ordreAffiche(): string[] {
  return Array.from(
    (document.querySelector('table')?.textContent ?? '').matchAll(
      /EVT-(\d{4}-\d{2}-\d{2})/g,
    ),
    (m) => m[1] as string,
  );
}

describe('R-UI-4b / liste Collectes organisateur — barre de filtres', () => {
  it(
    'M3.4/collectes_vues_a_venir_passees_par_date — « à venir » par défaut (aujourd’hui et après, date croissante), « passées » (avant aujourd’hui, date décroissante)',
    async () => {
      // Horloge seule figée (minuteries réelles) : 8 juillet 2026, 10 h à Paris.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-08T08:00:00Z'));
      try {
        const urls: string[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn((url: string) => {
            urls.push(String(url));
            return Promise.resolve(
              new Response(JSON.stringify({ data: LIGNES_VUES }), {
                status: 200,
              }),
            );
          }),
        );
        render(<CollectesPage />);
        await screen.findByRole('table', {}, ATTENTE_UI);

        expect(
          screen.getByRole('tab', { name: 'Collectes à venir' }),
        ).toHaveAttribute('aria-selected', 'true');
        const aVenir = demande(urls[urls.length - 1]!);
        expect(aVenir.get('from')).toBe('2026-07-08');
        expect(aVenir.get('to')).toBeNull();
        expect(ordreAffiche()).toEqual([...JOURS_VUES].sort());

        await act(async () => {
          fireEvent.mouseDown(
            screen.getByRole('tab', { name: 'Collectes passées' }),
          );
        });
        const passees = demande(urls[urls.length - 1]!);
        expect(passees.get('to')).toBe('2026-07-07');
        expect(passees.get('from')).toBeNull();
        expect(new URLSearchParams(window.location.search).get('onglet')).toBe(
          'passees',
        );
        expect(ordreAffiche()).toEqual([...JOURS_VUES].sort().reverse());
      } finally {
        vi.useRealTimers();
      }
    },
    ATTENTE_CAS_MS,
  );

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
      // « Toutes » par défaut (Val 2026-10-31) : la route reçoit les deux
      // types, la colonne Type et la colonne « Résultats » apparaissent.
      expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(demande(urls[0]!).has('type')).toBe(false);
      expect(screen.getByRole('columnheader', { name: /Type/ })).toBeTruthy();
      expect(
        screen.getByRole('columnheader', { name: /Résultats/ }),
      ).toBeTruthy();

      // Passer en AG : la route reçoit le type, l'URL le reflète.
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      });
      expect(demande(urls[urls.length - 1]!).get('type')).toBe('anti_gaspi');
      expect(window.location.search).toBe('?type=anti_gaspi');
      // Un seul type : plus de colonne Type, la colonne résultat est « Repas ».
      expect(screen.queryByRole('columnheader', { name: /^Type/ })).toBeNull();
      expect(screen.getByRole('columnheader', { name: /Repas/ })).toBeTruthy();

      // Retour à « Toutes » : le type quitte la requête et l'URL.
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }));
      });
      expect(demande(urls[urls.length - 1]!).has('type')).toBe(false);
      expect(window.location.search).not.toContain('type=');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'période lue dans l’URL et transmise ; « Réinitialiser les filtres » la retire sans toucher au type',
    async () => {
      // Vue « passées » : la période choisie (révolue) part telle quelle.
      urlParams.current =
        'onglet=passees&type=anti_gaspi&from=2026-01-01&to=2026-06-30';
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
      // La vue « passées » reste (navigation) et borne la liste à hier.
      expect(apres.get('to')).toBe(decalerJour(jourParis(), -1));
      // Le type est un axe de vue, pas un filtre : il survit au reset.
      expect(apres.get('type')).toBe('anti_gaspi');
      expect(window.location.search).toBe('?onglet=passees&type=anti_gaspi');
      expect(screen.queryByTestId('collecte-filtres-bar-reset')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
