/**
 * R-UI-4b (D10) — liste Collectes gestionnaire : la MÊME barre de filtres que
 * traiteur / agence (`CollecteFiltresBar`), compteur dans son pied (D5), état
 * dans l'URL en CSV (D6) avec lecture des anciens liens `x[]` du dashboard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from '@testing-library/react';

const { urlParams } = vi.hoisted(() => ({ urlParams: { current: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlParams.current),
  usePathname: () => '/gestionnaire/collectes',
}));

import CollectesPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const API_LISTE = '/api/v1/gestionnaire/collectes';
const LIGNES = [
  {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-11-30',
    evenement_nom: 'Kaspia — 2026-11-30',
    lieu_nom: 'Paris Expo Porte de Versailles',
    lieu_adresse: null,
    client_nom: null,
    traiteur_nom: 'Kaspia Réceptions',
    pax: 335,
  },
];
const OPTIONS = {
  lieux: [
    { id: 'L1', nom: 'Paris Expo Porte de Versailles' },
    { id: 'L2', nom: 'Palais des Congrès de Paris' },
    { id: 'L3', nom: 'Pavillon Royal' },
  ],
  traiteurs: [
    { id: 'T1', nom: 'Kaspia Réceptions' },
    { id: 'T2', nom: 'Fleurdemets' },
    { id: 'T3', nom: 'Butard Enescot' },
  ],
  types: [
    { id: 'ty-gala', libelle: 'Gala' },
    { id: 'ty-cocktail', libelle: 'Cocktail' },
    { id: 'ty-seminaire', libelle: 'Séminaire' },
  ],
};

function reponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Enregistre les URL de la liste ; sert les options à la barre. */
function fetchEspion(total = LIGNES.length) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.startsWith(API_LISTE)) urls.push(u);
      return Promise.resolve(
        u.startsWith('/api/v1/gestionnaire/filtres')
          ? reponse({ data: OPTIONS })
          : reponse({ data: LIGNES, total }),
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
  window.history.replaceState(null, '', '/gestionnaire/collectes');
});

describe('R-UI-4b / liste Collectes gestionnaire — barre de filtres', () => {
  it(
    'la barre est rendue avec ses filtres, le type levable et le compteur (D5, seul emplacement)',
    async () => {
      fetchEspion(3);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      const barre = screen.getByTestId('collecte-filtres-bar');
      expect(barre).toBeTruthy();
      expect(screen.getByTestId('filtre-periode')).toBeTruthy();
      // Lieu et Traiteur : listes à cocher comme les autres filtres (DS §5.5
      // règle 7), plus de sélecteur à valeur unique sur cet écran.
      expect(screen.getByTestId('filtre-lieu').textContent).toBe('LieuTous');
      expect(screen.getByTestId('filtre-traiteur').textContent).toBe(
        'TraiteurTous',
      );
      expect(screen.queryByRole('combobox', { name: 'Lieu' })).toBeNull();
      expect(screen.queryByRole('combobox', { name: 'Traiteur' })).toBeNull();
      expect(screen.getByTestId('filtre-type-evenement')).toBeTruthy();
      expect(screen.getByTestId('filtre-taille-evenement')).toBeTruthy();
      // Type ZD / AG : segmenté DS avec « Toutes » (le type n'est pas figé
      // sur cet écran, §06.05 l.209).
      expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      // Compteur = total serveur, dans le pied de la barre, nulle part ailleurs.
      expect(screen.getByTestId('collectes-resultats-count').textContent).toBe(
        '3 collectes correspondent à votre sélection',
      );
      expect(screen.queryByTestId('collectes-total')).toBeNull();
      // Aucun filtre posé : pas de « Réinitialiser les filtres ».
      expect(screen.queryByTestId('collecte-filtres-bar-reset')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'cocher un lieu écrit ?lieu=… dans l’URL, la route reçoit lieu_ids ; le type ZD part en type=',
    async () => {
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-lieu'));
      });
      await act(async () => {
        fireEvent.click(
          await screen.findByRole(
            'checkbox',
            { name: 'Palais des Congrès de Paris' },
            ATTENTE_UI,
          ),
        );
      });

      expect(window.location.search).toBe('?lieu=L2');
      const apresLieu = demande(urls[urls.length - 1]!);
      expect(apresLieu.get('lieu_ids')).toBe('L2');
      // L'ancien paramètre à valeur unique n'est plus émis.
      expect(apresLieu.get('lieu_id')).toBeNull();
      expect(screen.getByTestId('filtre-lieu').textContent).toContain(
        'Palais des Congrès de Paris',
      );
      expect(screen.getByTestId('collecte-filtres-bar-reset')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Zéro Déchet' }));
      });
      const d = demande(urls[urls.length - 1]!);
      expect(d.get('type')).toBe('zero_dechet');
      expect(d.get('lieu_ids')).toBe('L2');
      expect(window.location.search).toBe('?lieu=L2&type=zero_dechet');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_filtres_lieu_traiteur_choix_multiple — plusieurs lieux et plusieurs traiteurs cochés partent en liste',
    async () => {
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      const cocher = async (nom: string) =>
        act(async () => {
          fireEvent.click(
            await screen.findByRole('checkbox', { name: nom }, ATTENTE_UI),
          );
        });

      // Deux lieux sur trois : la liste reste ouverte entre deux cases (choix
      // multiple), et la route reçoit les deux identifiants.
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-lieu'));
      });
      // Case « Tous » en tête, cochée tant qu'aucun lieu n'est choisi.
      expect(screen.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
      await cocher('Paris Expo Porte de Versailles');
      await cocher('Pavillon Royal');
      expect(screen.getByRole('checkbox', { name: 'Tous' })).not.toBeChecked();
      expect(demande(urls[urls.length - 1]!).get('lieu_ids')).toBe('L1,L3');
      expect(new URLSearchParams(window.location.search).get('lieu')).toBe(
        'L1,L3',
      );
      expect(screen.getByTestId('filtre-lieu').textContent).toBe(
        'Lieu2 sélectionnés',
      );

      // Un traiteur en plus : les deux filtres se cumulent.
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-traiteur'));
      });
      await cocher('Fleurdemets');
      const d = demande(urls[urls.length - 1]!);
      expect(d.get('lieu_ids')).toBe('L1,L3');
      expect(d.get('traiteur_ids')).toBe('T2');
      expect(d.get('traiteur_id')).toBeNull();

      // « Tous » décoche tout le filtre Traiteur ; les lieux restent.
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Tous' }));
      });
      const apres = demande(urls[urls.length - 1]!);
      expect(apres.get('traiteur_ids')).toBeNull();
      expect(apres.get('lieu_ids')).toBe('L1,L3');
      expect(screen.getByTestId('filtre-traiteur').textContent).toBe(
        'TraiteurTous',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_filtres_lien_plusieurs_valeurs — un lien ?lieu=a,b&traiteur=c,d est relu case par case',
    async () => {
      urlParams.current = 'lieu=L1,L2&traiteur=T1,T2';
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      const d = demande(urls[0]!);
      expect(d.get('lieu_ids')).toBe('L1,L2');
      expect(d.get('traiteur_ids')).toBe('T1,T2');
      // Ce que la barre annonce = ce que la route reçoit.
      await waitFor(
        () =>
          expect(screen.getByTestId('filtre-traiteur').textContent).toBe(
            'Traiteur2 sélectionnés',
          ),
        ATTENTE_UI,
      );
      expect(screen.getByTestId('filtre-lieu').textContent).toBe(
        'Lieu2 sélectionnés',
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-lieu'));
      });
      await screen.findByRole(
        'checkbox',
        { name: 'Pavillon Royal' },
        ATTENTE_UI,
      );
      expect(
        screen.getByRole('checkbox', {
          name: 'Paris Expo Porte de Versailles',
        }),
      ).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'Palais des Congrès de Paris' }),
      ).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'Pavillon Royal' }),
      ).not.toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'anciens liens x[] du dashboard : lus, relayés en x[] à la route, réécrits en CSV au premier changement',
    async () => {
      urlParams.current =
        'lieu=L1&type_evenement_ids[]=ty-gala&type_evenement_ids[]=ty-cocktail';
      window.history.replaceState(
        null,
        '',
        '/gestionnaire/collectes?lieu=L1&type_evenement_ids[]=ty-gala&type_evenement_ids[]=ty-cocktail',
      );
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // Compatibilité de lecture : la route lit `x[]`, l'appel part en `x[]`.
      expect(demande(urls[0]!).getAll('type_evenement_ids[]')).toEqual([
        'ty-gala',
        'ty-cocktail',
      ]);
      expect(screen.getByTestId('filtre-type-evenement').textContent).toContain(
        '2 sélectionnés',
      );

      // Un filtre de plus (Taille M) : l'URL passe en CSV, les clés `x[]`
      // disparaissent, et l'appel conserve les deux types + la taille.
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-taille-evenement'));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'M (500-749)' }));
      });
      const d = demande(urls[urls.length - 1]!);
      expect(d.getAll('type_evenement_ids[]')).toEqual([
        'ty-gala',
        'ty-cocktail',
      ]);
      expect(d.getAll('taille_evenements[]')).toEqual(['M']);
      expect(d.get('lieu_ids')).toBe('L1');
      const page = new URLSearchParams(window.location.search);
      expect(page.get('type_evenement_ids')).toBe('ty-gala,ty-cocktail');
      expect(page.get('taille_evenements')).toBe('M');
      expect(page.getAll('type_evenement_ids[]')).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    '« Réinitialiser les filtres » vide tout : URL nue, appel sans filtre',
    async () => {
      urlParams.current =
        'lieu=L1&traiteur=T1&type=anti_gaspi&from=2026-01-01&to=2026-06-30&taille_evenements=M,XL';
      const urls = fetchEspion();
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      const avant = demande(urls[0]!);
      expect(avant.get('lieu_ids')).toBe('L1');
      expect(avant.get('traiteur_ids')).toBe('T1');
      expect(avant.get('type')).toBe('anti_gaspi');
      expect(avant.get('from')).toBe('2026-01-01');
      expect(avant.getAll('taille_evenements[]')).toEqual(['M', 'XL']);

      await act(async () => {
        fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
      });

      const apres = demande(urls[urls.length - 1]!);
      for (const k of [
        'lieu_ids',
        'traiteur_ids',
        'type',
        'from',
        'to',
        'taille_evenements[]',
      ])
        expect(apres.get(k)).toBeNull();
      // Le tri par défaut reste envoyé (navigation, pas un filtre).
      expect(apres.get('tri')).toBe('date');
      expect(window.location.search).toBe('');
      expect(screen.getByRole('radio', { name: 'Toutes' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.queryByTestId('collecte-filtres-bar-reset')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
