/**
 * M3.2 — Liste Collectes gestionnaire de lieux (§06.05 nav 4, liste plate).
 *
 * Revue d'écran E2E 2026-09-22 : l'écran rendait un `<table>` écrit à la main,
 * « Chargement… » en texte et « Aucune collecte sur vos lieux » en `<p>` — et
 * SURTOUT aucun état d'erreur. La réponse était lue sans regarder le code HTTP
 * (`j.data ?? []`), donc une route en 500 affichait le message de liste vide :
 * une panne serveur se lisait comme un parc sans collecte.
 *
 * La sonde `erreur_perimee` couvre une régression trouvée par reviewer-principal
 * sur ce lot : l'échec d'une requête PÉRIMÉE épinglait l'écran sur l'erreur alors
 * que la requête fraîche avait réussi (la branche `erreur` l'emporte sur le
 * contenu). Elle couvre du même coup la course de réponses préexistante.
 *
 * Les sondes `pagination_*` (décision Val 2026-09-22) couvrent la troncature
 * silencieuse : la route coupait à 100 lignes et ne renvoyait aucun total, donc
 * un parc de plus de 100 collectes affichait une liste d'apparence complète qui
 * ne l'était pas. Le §06.05 l.209 veut cette liste LARGE (« tous statuts, type
 * ZD/AG non figé »), donc le plafond mordait d'autant plus vite. Ces sondes
 * mesurent ce que l'écran DEMANDE au serveur, pas seulement ce qu'il affiche :
 * c'est la demande qui portait le défaut.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  within,
  waitFor,
} from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';

const { push, replace, urlParams } = vi.hoisted(() => ({
  push: vi.fn(),
  // `clearFiltre` passe par router.REPLACE (on ne veut pas empiler le retrait du
  // filtre dans l'historique). Sans capture stable de `replace`, toute sonde qui
  // le mesure lit une liste d'appels vide et passe quoi qu'il arrive.
  replace: vi.fn(),
  urlParams: { current: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlParams.current),
  usePathname: () => '/gestionnaire/collectes',
}));

import CollectesPage from '@/app/(gestionnaire)/gestionnaire/collectes/page.js';
import { colonnesCollectesTraiteur } from '@/components/collecte/collectes-traiteur-table';
import { setCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';
import { ficheClient } from '@/test-utils/fiche-collecte-client';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const LIGNES = [
  {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-11-30',
    evenement_nom: 'Kaspia — 2026-11-30',
    lieu_nom: 'Paris Expo Porte de Versailles',
    lieu_adresse: '1 Place de la Porte de Versailles 75015 Paris',
    client_nom: 'Maison Lenôtre',
    traiteur_nom: 'Kaspia Réceptions',
    pax: 335,
  },
  {
    id: 'c2',
    type: 'anti_gaspi',
    statut: 'programmee',
    date_collecte: '2026-11-10',
    evenement_nom: 'Fleurdemets — 2026-11-10',
    lieu_nom: 'Palais des Congrès de Paris',
    lieu_adresse: null,
    client_nom: null,
    traiteur_nom: 'Fleurdemets',
    pax: 120,
  },
  // La route rend le lieu, le client, le traiteur et le pax nullables, et
  // `date_collecte` l'est aussi : ces 5 cellules doivent tomber sur « — ».
  {
    id: 'c3',
    type: 'zero_dechet',
    statut: 'cloturee',
    date_collecte: null,
    evenement_nom: null,
    lieu_nom: null,
    lieu_adresse: null,
    client_nom: null,
    traiteur_nom: null,
    pax: null,
  },
];

// En-têtes de la liste traiteur, lus dans ses colonnes réelles : la liste
// gestionnaire doit les reprendre (décision Val 2026-10-01).
const ENTETES_TRAITEUR = colonnesCollectesTraiteur({
  onModifier: () => {},
  onAnnuler: () => {},
  onDupliquer: () => {},
  onTelecharger: () => {},
}).map((c) =>
  typeof c.header === 'string' ? c.header : (c.meta?.label ?? c.id),
);

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const API_LISTE = '/api/v1/gestionnaire/collectes';
/** Options de la barre de filtres (route `/gestionnaire/filtres`). */
const OPTIONS_FILTRES = {
  lieux: [
    { id: 'L1', nom: 'Paris Expo Porte de Versailles' },
    { id: 'L2', nom: 'Palais des Congrès de Paris' },
    // Un 3e lieu : cocher TOUTES les options revient à « Tous » (FiltreCoches).
    { id: 'L3', nom: 'Pavillon Dauphine' },
  ],
  traiteurs: [{ id: 'T1', nom: 'Kaspia Réceptions' }],
  types: [
    { id: 'ty-gala', libelle: 'Gala' },
    { id: 'ty-cocktail', libelle: 'Cocktail' },
    { id: 'ty-seminaire', libelle: 'Séminaire' },
  ],
};
/** Réponse par défaut d'un `fetch` : la liste, ou les options de la barre. */
function repondre(url: string, liste: unknown): Promise<Response> {
  return Promise.resolve(
    String(url).startsWith('/api/v1/gestionnaire/filtres')
      ? reponse(200, { data: OPTIONS_FILTRES })
      : reponse(200, liste),
  );
}
/** Appels de la LISTE seulement (la barre charge ses options à part). */
function appelsListe(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith(API_LISTE) && !u.startsWith(`${API_LISTE}/`));
}

afterEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
  urlParams.current = '';
  vi.unstubAllGlobals();
  // `useFiltresUrl` recopie les filtres dans l'URL jsdom, qui survit d'un test
  // à l'autre : on la remet à plat.
  window.history.replaceState(null, '', '/gestionnaire/collectes');
  // Libellé de drill-down mémorisé par le dashboard (chip « Filtre actif »).
  sessionStorage.clear();
});

describe('M3.2 / liste Collectes gestionnaire', () => {
  it(
    'M3.2/collectes_liste_rendue_au_design_system',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: LIGNES }))),
      );
      render(<CollectesPage />);

      // PageHero (§10 §5.6 + levier #2) : le titre de l'écran est le <h1>.
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: 'Collectes' },
          ATTENTE_UI,
        ),
      ).toBeTruthy();

      // DataGrid (Data Table shadcn, §10 §6) : tableau, en-têtes, lignes rendues.
      // Le PageHero s'affiche dès le squelette de chargement : le tableau, lui,
      // n'arrive qu'avec les données → attente explicite.
      expect(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      ).toBeTruthy();
      // Colonnes (revue écran 2026-10-01) : celles de la liste traiteur, plus
      // « Traiteur » ; « Type » gardé, « Événement » retiré, pas d'actions.
      const entetes = screen
        .getAllByRole('columnheader')
        .map((th) => th.textContent?.trim());
      expect(entetes).toEqual([
        'Date',
        'Lieu',
        'Client',
        'Traiteur',
        'Pax',
        'Résultats',
        'Type',
        'Statut',
      ]);
      // Tri serveur : seules les colonnes de la liste blanche de la route sont
      // triables (DataGrid ne pose `aria-sort` que sur une colonne triable).
      // Une colonne triable hors liste blanche afficherait une flèche de tri
      // sur un ordre resté par date.
      expect(
        screen
          .getAllByRole('columnheader')
          .filter((th) => th.hasAttribute('aria-sort'))
          .map((th) => th.textContent?.trim()),
      ).toEqual(['Date', 'Type', 'Statut']);
      expect(screen.getAllByText('Maison Lenôtre').length).toBeGreaterThan(0);
      // Client non renseigné (c2) : « — ».
      const ligneSansClient = within(screen.getByRole('table'))
        .getByText('Palais des Congrès de Paris')
        .closest('tr');
      expect(
        within(ligneSansClient!).getAllByRole('cell')[entetes.indexOf('Client')]
          ?.textContent,
      ).toBe('—');
      expect(
        screen.getAllByText('Paris Expo Porte de Versailles').length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText('ZD').length).toBeGreaterThan(0);
      expect(screen.getAllByText('AG').length).toBeGreaterThan(0);

      // Ligne aux champs nuls (c3, 3e ligne — ordre de la route, tri serveur) :
      // date, lieu, client, traiteur et pax tombent chacun sur « — ».
      const cellulesC3 = within(
        within(screen.getByRole('table')).getAllByRole('row')[3]!,
      ).getAllByRole('cell');
      for (const entete of ['Date', 'Lieu', 'Client', 'Traiteur', 'Pax'])
        expect(cellulesC3[entetes.indexOf(entete)]?.textContent, entete).toBe(
          '—',
        );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_colonnes_identiques_liste_traiteur — mêmes colonnes que le traiteur, plus Traiteur et Type, sans actions',
    async () => {
      const ouvrir = vi.fn();
      vi.stubGlobal('open', ouvrir);
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/rapport-rse/download')
            ? reponse(200, { url: 'https://r2.example/rapport.pdf' })
            : String(url).startsWith('/api/v1/gestionnaire/collectes/c1')
              ? reponse(200, { data: ficheClient() })
              : reponse(200, {
                  data: [
                    LIGNES[0],
                    {
                      id: 'zd/1',
                      type: 'zero_dechet',
                      statut: 'cloturee',
                      date_collecte: '2026-10-11',
                      heure_collecte: '22:00:00',
                      evenement_nom: null,
                      lieu_nom: 'Musée des Arts Forains',
                      lieu_adresse:
                        '53 Avenue des Terroirs de France 75012 Paris',
                      client_nom: null,
                      traiteur_nom: 'Fleurdemets',
                      pax: 500,
                      poids_total_kg: 412.5,
                      taux_recyclage: 87,
                      co2_evite_kg: 96,
                      nb_repas_donnes: null,
                    },
                    {
                      id: 'ag-1',
                      type: 'anti_gaspi',
                      statut: 'cloturee',
                      date_collecte: '2026-10-04',
                      heure_collecte: '23:00:00',
                      evenement_nom: null,
                      lieu_nom: 'Paris Nord Villepinte',
                      lieu_adresse: null,
                      client_nom: null,
                      traiteur_nom: 'Kaspia Réceptions',
                      pax: 238,
                      poids_total_kg: 0,
                      taux_recyclage: null,
                      co2_evite_kg: 450,
                      nb_repas_donnes: 180,
                    },
                  ],
                }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<CollectesPage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );

      // Parité : les colonnes de la liste traiteur, dans le même ordre, sans
      // « Actions », avec « Traiteur » après « Client » et « Type » avant
      // « Statut ». Une colonne ajoutée côté traiteur fait échouer ce test tant
      // que la liste gestionnaire ne la reprend pas.
      const attendu = ENTETES_TRAITEUR.filter((e) => e !== 'Actions');
      attendu.splice(attendu.indexOf('Client') + 1, 0, 'Traiteur');
      attendu.splice(attendu.indexOf('Statut'), 0, 'Type');
      expect(
        table.getAllByRole('columnheader').map((th) => th.textContent?.trim()),
      ).toEqual(attendu);

      // Lieu = nom + adresse, traiteur nommé, pax.
      expect(
        table.getByText('1 Place de la Porte de Versailles 75015 Paris'),
      ).toBeTruthy();
      const ligneZd = table.getByText('Musée des Arts Forains').closest('tr')!;
      expect(within(ligneZd).getByText('Fleurdemets')).toBeTruthy();
      expect(within(ligneZd).getByText('500 pax')).toBeTruthy();

      // Résultats de la collecte réalisée : ZD = poids · taux · CO₂ ; AG =
      // repas · CO₂ (mêmes cellules que la liste traiteur).
      expect(within(ligneZd).getByText(/412,5\s*kg/)).toBeTruthy();
      expect(within(ligneZd).getByText(/87\s*%/)).toBeTruthy();
      expect(within(ligneZd).getByText(/96\s*kg CO₂e/)).toBeTruthy();
      const ligneAg = table.getByText('Paris Nord Villepinte').closest('tr')!;
      expect(within(ligneAg).getByText('180 repas')).toBeTruthy();
      expect(within(ligneAg).getByText(/450\s*kg CO₂e/)).toBeTruthy();

      // Téléchargement du rapport : route gestionnaire, id encodé, sans ouvrir
      // la fiche (cellule interactive).
      fireEvent.click(
        within(ligneZd).getByRole('button', {
          name: 'Télécharger le rapport de la collecte',
        }),
      );
      await vi.waitFor(() =>
        expect(ouvrir).toHaveBeenCalledWith(
          'https://r2.example/rapport.pdf',
          '_blank',
        ),
      );
      expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain(
        '/api/v1/gestionnaire/collectes/zd%2F1/rapport-rse/download',
      );
      expect(replace).not.toHaveBeenCalled();

      // Collecte non réalisée : pas de résultats ; aucun picto d'action
      // (Modifier / Annuler / Dupliquer) sur aucune ligne.
      const ligneValidee = table
        .getByText('Paris Expo Porte de Versailles')
        .closest('tr')!;
      expect(within(ligneValidee).queryByRole('button')).toBeNull();
      expect(
        table.queryByRole('button', { name: /Modifier|Annuler|Dupliquer/ }),
      ).toBeNull();
      // La cellule Résultats n'est pas une zone morte : cliquer son « — » ouvre
      // la fiche, comme le reste de la ligne.
      fireEvent.click(
        within(ligneValidee).getAllByRole('cell')[
          attendu.indexOf('Résultats')
        ]!,
      );
      expect(replace).toHaveBeenCalledWith(
        '/gestionnaire/collectes?collecte=c1',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_ligne_ouvre_la_fiche',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            String(url).startsWith('/api/v1/gestionnaire/collectes/c1')
              ? reponse(200, { data: ficheClient() })
              : reponse(200, { data: LIGNES }),
          ),
        ),
      );
      render(<CollectesPage />);

      // §06.05 l.70 : « liste des collectes … → détail collecte ». Depuis la
      // refonte Val 2026-09-29, la fiche s'ouvre en pop-up sur la liste
      // (?collecte=<id>) — plus de navigation vers une page pleine.
      const cellule = (
        await screen.findAllByText(
          'Paris Expo Porte de Versailles',
          {},
          ATTENTE_UI,
        )
      )[0];
      fireEvent.click(cellule!);
      expect(replace).toHaveBeenCalledWith(
        '/gestionnaire/collectes?collecte=c1',
      );
      expect(push).not.toHaveBeenCalled();
      await screen.findByRole('dialog', {}, ATTENTE_UI);
      await screen.findByTestId('frise-statut-client', {}, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_erreur_chargement_message_et_reessayer',
    async () => {
      // 1er appel en panne, 2e (après « Réessayer ») nominal.
      // Une Response NEUVE par appel : son corps ne se lit qu'une fois, et la
      // barre de filtres charge ses options par un appel distinct.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reponse(500, { error: 'boom' }))
        .mockImplementation((url: string) => repondre(url, { data: LIGNES }));
      vi.stubGlobal('fetch', fetchMock);
      render(<CollectesPage />);

      expect(
        await screen.findByTestId('collectes-erreur', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('Le chargement des collectes a échoué.'),
      ).toBeTruthy();

      // L'oracle de la régression : une panne ne se lit JAMAIS comme une liste
      // vide. Avant ce lot, l'écran affichait « Aucune collecte sur vos lieux ».
      expect(screen.queryByText(/Aucune collecte/)).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();

      // « Réessayer » relance réellement la requête et rend les lignes.
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        (
          await screen.findAllByText(
            'Palais des Congrès de Paris',
            {},
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
      expect(appelsListe(fetchMock)).toHaveLength(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_erreur_perimee_ninvalide_pas_la_reponse_fraiche',
    async () => {
      // Scénario réel : une requête filtrée est en vol, l'utilisateur retire le
      // filtre (« Réinitialiser les filtres ») → 2e requête. La 1re, PÉRIMÉE,
      // échoue APRÈS que la 2e a réussi. Sans garde de péremption, son
      // `setErreur` écrase le succès et épingle l'écran sur l'erreur, données
      // fraîches invisibles.
      let echouerLaPerimee: (() => void) | null = null;
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((_, rej) => {
              echouerLaPerimee = () => rej(new Error('réseau'));
            }),
        )
        .mockImplementation((url: string) => repondre(url, { data: LIGNES }));
      vi.stubGlobal('fetch', fetchMock);

      urlParams.current = 'lieu=L1';
      render(<CollectesPage />);
      await screen.findByTestId('collectes-skeleton', {}, ATTENTE_UI);

      // Le filtre tombe → 2e requête, qui aboutit.
      fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
      expect(
        (
          await screen.findAllByText(
            'Palais des Congrès de Paris',
            {},
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(appelsListe(fetchMock)).toHaveLength(2);

      // Seulement MAINTENANT, la requête périmée échoue.
      await act(async () => {
        echouerLaPerimee?.();
      });

      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
      expect(
        screen.queryByText('Le chargement des collectes a échoué.'),
      ).toBeNull();
      expect(screen.getByRole('table')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_etat_chargement_skeleton',
    async () => {
      // Requête jamais résolue : l'écran reste dans son état Loading.
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => {})),
      );
      render(<CollectesPage />);

      // §10 §7 : « Skeleton screens […] jamais spinner seul ». Le texte
      // « Chargement… » que rendait l'écran d'avant ne doit plus apparaître
      // visiblement : `LoadingState bloc` ne le garde que pour les lecteurs
      // d'écran (sr-only), à côté des squelettes.
      const squelette = await screen.findByTestId(
        'collectes-skeleton',
        {},
        ATTENTE_UI,
      );
      expect(squelette.querySelectorAll('[aria-hidden]').length).toBe(5);
      const libelle = screen.queryByText('Chargement…');
      expect(libelle === null || libelle.classList.contains('sr-only')).toBe(
        true,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_liste_vide_empty_state',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: [] }))),
      );
      render(<CollectesPage />);

      expect(
        await screen.findByText('Aucune collecte', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('Aucune collecte sur vos lieux pour ce périmètre.'),
      ).toBeTruthy();
      // Liste vide ≠ panne : pas de message d'erreur.
      expect(screen.queryByTestId('collectes-erreur')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
  // ── Pagination serveur (décision Val 2026-09-22) ─────────────────────────
  // 120 collectes, 50 par page : le serveur renvoie la 1re page ET le total.
  const PAGE = Array.from({ length: 50 }, (_, i) => ({
    id: `p${i}`,
    type: 'zero_dechet',
    statut: 'cloturee',
    date_collecte: '2026-11-30',
    evenement_nom: `Événement ${i}`,
    lieu_nom: 'Paris Expo Porte de Versailles',
  }));

  /**
   * Mock fetch qui ENREGISTRE les URL de la LISTE demandées (copie, pas de
   * référence) ; la barre de filtres reçoit ses options à part.
   */
  function fetchEspion(body: unknown) {
    const urls: string[] = [];
    const f = vi.fn((url: string) => {
      const u = String(url);
      if (u.startsWith(API_LISTE)) urls.push(u);
      return repondre(u, body);
    });
    vi.stubGlobal('fetch', f);
    return urls;
  }

  it(
    'M3.2/collectes_pagination_total_affiche_au_dela_dune_page',
    async () => {
      fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);

      // Le total EXACT est affiché — dans le pied de la barre de filtres, seul
      // emplacement du compteur (R-UI-4b, D5) : au-delà d'une page, lui seul
      // dit combien de collectes existent dans le périmètre demandé.
      // Le compteur existe dès le rendu (0 avant la réponse) : attendre la
      // VALEUR, pas l'élément (course observée en CI, #481).
      await waitFor(
        () =>
          expect(
            screen.getByTestId('collectes-resultats-count'),
          ).toHaveTextContent('120 collectes correspondent à votre sélection'),
        ATTENTE_UI,
      );

      // 120 / 50 = 3 pages.
      const nav = screen.getByRole('navigation', { name: 'Pagination' });
      expect(nav).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Page 3' })).toBeTruthy();

      // Le défaut d'origine : 50 lignes affichées sur 120 sans que RIEN ne le
      // dise. Le total doit être strictement supérieur au nombre de lignes.
      expect(PAGE.length).toBeLessThan(120);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_pagination_demande_la_page_suivante_au_serveur',
    async () => {
      const urls = fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // 1er appel : pas de `page` (page 1 implicite).
      expect(urls[0]).not.toContain('page=');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      });

      // La page suivante est demandée AU SERVEUR : sans cet aller-retour, la
      // pagination ne ferait que redécouper les 50 lignes déjà reçues.
      expect(urls.length).toBeGreaterThan(1);
      expect(urls[urls.length - 1]).toContain('page=2');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_tri_envoye_au_serveur_et_retour_page_1',
    async () => {
      const urls = fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // Tri par défaut = celui de la route (date décroissante).
      expect(urls[0]).toContain('tri=date&ordre=desc');

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      });
      expect(urls[urls.length - 1]).toContain('page=2');

      // Clic sur l'en-tête « Statut » : trié AU SERVEUR (liste paginée) et
      // retour en page 1 — la page 2 d'un autre ordre n'a aucun rapport.
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole('table')).getByRole('button', {
            name: /Statut/,
          }),
        );
      });
      const derniere = urls[urls.length - 1]!;
      expect(derniere).toMatch(/tri=statut&ordre=/);
      expect(derniere).not.toContain('page=');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_pagination_absente_sous_le_seuil',
    async () => {
      fetchEspion({ data: LIGNES, total: LIGNES.length });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // Une seule page : pas de nav, sinon l'écran s'encombre d'une pagination
      // qui ne mène nulle part. Le compteur, lui, vit dans la barre (D5) et
      // s'affiche toujours.
      expect(screen.getByTestId('collectes-resultats-count').textContent).toBe(
        '3 collectes correspondent à votre sélection',
      );
      expect(
        screen.queryByRole('navigation', { name: 'Pagination' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_changement_de_filtre_revient_page_1',
    async () => {
      const urls = fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      });
      expect(urls[urls.length - 1]).toContain('page=2');

      // Un lieu posé dans la barre ALORS QU'ON EST EN PAGE 2. La page
      // courante appartient au périmètre précédent : la conserver demanderait
      // la page 2 d'un filtre qui n'a peut-être qu'une page, et l'écran
      // afficherait une liste vide sur un parc qui ne l'est pas.
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-lieu'));
      });
      await act(async () => {
        fireEvent.click(
          await screen.findByRole(
            'checkbox',
            { name: 'Paris Expo Porte de Versailles' },
            ATTENTE_UI,
          ),
        );
      });

      const derniere = urls[urls.length - 1]!;
      expect(derniere).toContain('lieu_ids=L1');
      expect(derniere).not.toContain('page=');
    },
    ATTENTE_CAS_MS,
  );
  it(
    'M3.2/collectes_page_devenue_hors_bornes_revient_sur_la_derniere_valide',
    async () => {
      // 120 collectes (3 pages) au premier chargement.
      const urls = fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // L'utilisateur va en page 3. Entre-temps la liste a rétréci à 60 (2
      // pages) : des collectes annulées ailleurs, un parc réduit. Le serveur
      // répond une page vide AVEC le vrai total — puis, sur la page 2 qu'il
      // redemande, les 10 lignes qu'elle contient réellement. Servir du vide
      // aux deux appels ferait rougir cette sonde pour la mauvaise raison.
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          const u = String(url);
          if (u.startsWith(API_LISTE)) urls.push(u);
          return repondre(
            u,
            u.includes('page=2')
              ? { data: PAGE.slice(0, 10), total: 60 }
              : { data: [], total: 60 },
          );
        }),
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
      });

      // L'écran redemande la DERNIÈRE page valide (60 / 50 → 2), au lieu de
      // rester sur une page vide.
      expect(urls[urls.length - 1]).toContain('page=2');

      // Et surtout : il n'affiche JAMAIS « Aucune collecte », qui est le message
      // d'un parc réellement vide — et qui serait ici un cul-de-sac, le bloc de
      // pagination vivant dans la branche non-vide du rendu.
      expect(screen.queryByText('Aucune collecte')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
  it(
    'M3.2/collectes_derniere_page_vide_ne_bloque_pas_lecran',
    async () => {
      // Garde-fou de la comparaison STRICTE du rattrapage ci-dessus.
      //
      // Ici la page demandée EST la dernière valide (60 / 50 → 2) et revient
      // pourtant vide : réponse serveur incohérente, mais l'écran doit s'en
      // sortir. Avec un `>=` au lieu d'un `>`, il se redirigerait vers la page
      // où il se trouve déjà : aucun nouvel appel ne partirait, le drapeau de
      // redirection retiendrait l'état de chargement, et l'écran resterait en
      // squelette pour toujours.
      fetchEspion({ data: PAGE, total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: [], total: 60 }))),
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      });

      // L'écran conclut : état vide, pas un squelette qui ne finit jamais.
      expect(screen.queryByTestId('collectes-skeleton')).toBeNull();
      expect(screen.getByText('Aucune collecte')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  // ── Filtres d'événement propagés par le drill-down (§06.05 l.209) ──────────
  // Ce maillon manquait : le dashboard peut bien poser `type_evenement_ids[]` et
  // `taille_evenements[]` dans l'URL, et la route peut bien les accepter — si
  // l'écran ne les RELAIE pas, la chaîne est coupée au milieu et la liste ignore
  // en silence des filtres que l'utilisateur voit appliqués au dashboard.
  it(
    'M3.2/collectes_relaie_type_et_taille_devenement — les filtres du drill-down partent vers la route',
    async () => {
      urlParams.current =
        'lieu=L1&from=2026-01-01&to=2026-06-30&type_evenement_ids[]=ty-gala&type_evenement_ids[]=ty-cocktail&taille_evenements[]=M&taille_evenements[]=XL';
      const urls = fetchEspion({ data: PAGE, total: 50 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      const demande = new URLSearchParams(
        urls[urls.length - 1]!.split('?')[1] ?? '',
      );
      expect(demande.get('lieu_ids')).toBe('L1');
      expect(demande.getAll('type_evenement_ids[]')).toEqual([
        'ty-gala',
        'ty-cocktail',
      ]);
      expect(demande.getAll('taille_evenements[]')).toEqual(['M', 'XL']);
      // Et toujours pas de statut/type figés côté gestionnaire.
      expect(demande.get('statut')).toBeNull();
      expect(demande.get('type')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_barre_affiche_les_filtres_devenement — un filtre appliqué est un filtre visible',
    async () => {
      urlParams.current =
        'lieu=L1&from=2026-01-01&to=2026-06-30&type_evenement_ids[]=ty-gala&type_evenement_ids[]=ty-cocktail&taille_evenements[]=M';
      fetchEspion({ data: PAGE, total: 50 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      // Type/Taille viennent des filtres globaux du dashboard : la barre de
      // filtres (R-UI-4b, D10) les porte comme ses propres contrôles. Sans
      // cela, la liste serait restreinte par des critères que rien n'affiche,
      // et le gestionnaire chercherait des collectes qu'il voit au dashboard
      // et que la liste écarte.
      expect(screen.getByTestId('filtre-type-evenement').textContent).toContain(
        '2 sélectionnés',
      );
      expect(screen.getByTestId('filtre-taille-evenement').textContent).toMatch(
        /Taille d'événement\s*M$/,
      );
      // Le lieu du drill-down est nommé dès que les options sont chargées.
      await waitFor(
        () =>
          expect(screen.getByTestId('filtre-lieu').textContent).toContain(
            'Paris Expo Porte de Versailles',
          ),
        ATTENTE_UI,
      );
      expect(screen.getByTestId('collecte-filtres-bar-reset')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_changement_type_taille_revient_page_1 — la page appartient au périmètre qui l’a produite',
    async () => {
      urlParams.current = 'lieu=L1';
      // 3 lignes suffisent : c'est `total` qui fait apparaître la pagination, pas
      // la taille du tableau. Rendre les 50 lignes de PAGE deux fois (avant et
      // après le rerender) alourdit le cas sans rien prouver de plus — et ce
      // fichier est déjà le plus lent de la suite.
      const urls = fetchEspion({ data: PAGE.slice(0, 3), total: 120 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      });
      expect(urls[urls.length - 1]).toContain('page=2');

      // Le périmètre change (Type d'événement coché dans la barre) : rester en
      // page 2 demanderait la 2e page d'un filtre qui n'en a peut-être qu'une,
      // et l'écran afficherait une liste vide sur un parc qui ne l'est pas.
      await act(async () => {
        fireEvent.click(screen.getByTestId('filtre-type-evenement'));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('checkbox', { name: 'Gala' }));
      });

      const derniere = urls[urls.length - 1]!;
      expect(derniere).toContain('type_evenement_ids%5B%5D=ty-gala');
      expect(derniere).toContain('lieu_ids=L1');
      expect(derniere).not.toContain('page=');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_reinitialiser_retire_aussi_type_et_taille — pas de filtre invisible résiduel',
    async () => {
      urlParams.current =
        'lieu=L1&type_evenement_ids[]=ty-gala&taille_evenements[]=M';
      // L'URL de la page porte réellement le lien du dashboard : sans cela les
      // assertions finales sur `window.location` seraient vraies d'avance.
      window.history.replaceState(
        null,
        '',
        `/gestionnaire/collectes?${urlParams.current}`,
      );
      const urls = fetchEspion({ data: PAGE, total: 50 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      const avant = urls.length;
      expect(urls[avant - 1]).toContain('lieu_ids=L1');
      expect(decodeURIComponent(window.location.search)).toContain(
        'type_evenement_ids[]=ty-gala',
      );
      expect(window.location.search).toContain('lieu=L1');

      await act(async () => {
        fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
      });

      // Sans ce nettoyage, la liste resterait restreinte à « Gala / M » alors
      // que la barre ne montre plus rien : un filtre actif que plus rien
      // n'affiche ni ne retire. Assertion d'abord : sans nouvel appel, les
      // `not.toContain` ci-dessous seraient vrais par construction.
      expect(urls.length).toBe(avant + 1);
      const apres = urls[urls.length - 1]!;
      expect(apres).not.toContain('type_evenement_ids');
      expect(apres).not.toContain('taille_evenements');
      expect(apres).not.toContain('lieu_id');
      // L'URL de la page (miroir des filtres, D6) est nettoyée aussi, y compris
      // les anciennes clés `x[]`.
      expect(window.location.search).not.toContain('type_evenement_ids');
      expect(window.location.search).not.toContain('lieu=');
    },
    ATTENTE_CAS_MS,
  );

  // ── Chip « Filtre actif » du drill-down (§06.05 l.215, arbitrage Val
  // 2026-10-04 : le chip est remis, à côté de la barre de filtres) ──────────
  const chip = () => screen.queryByTestId('filtre-actif');
  const TROIS_LIGNES = { data: PAGE.slice(0, 3), total: 3 };
  /**
   * Comme Next : `useSearchParams` suit l'URL que `useFiltresUrl` vient
   * d'écrire. Le mock, lui, est figé — sans ce re-rendu, une cible relue à
   * chaque rendu (au lieu d'être figée au montage) passerait inaperçue.
   */
  function resynchroniserUrl(rerender: (ui: React.ReactElement) => void) {
    urlParams.current = window.location.search.slice(1);
    rerender(<CollectesPage />);
  }
  /** Ouvre la liste d'un contrôle et attend une de ses cases : les options sont chargées. */
  async function attendreOptions(
    controle: 'Lieu' | 'Traiteur',
    option: string,
  ) {
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          controle === 'Lieu' ? 'filtre-lieu' : 'filtre-traiteur',
        ),
      );
    });
    await screen.findByRole('checkbox', { name: option }, ATTENTE_UI);
  }
  /** Coche ou décoche une case de la liste ouverte. */
  async function basculer(option: string) {
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: option }));
    });
  }

  it(
    'M3.2/collectes_chip_filtre_actif_nomme_la_cible_du_drilldown — le libellé du clic prime sur celui des options',
    async () => {
      // Clic sur « Top 5 lieux » : le dashboard mémorise le nom en
      // sessionStorage (jamais dans l'URL) et pousse l'identifiant seul.
      setCollecteFiltreLabel({
        kind: 'lieu',
        id: 'L1',
        label: 'Pavillon Royal',
      });
      urlParams.current = 'lieu=L1&from=2026-01-01&to=2026-06-30';
      fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Traiteur', 'Kaspia Réceptions');

      // Les options nomment ce lieu « Paris Expo… » : lire « Pavillon Royal »
      // prouve que le chip affiche ce que le dashboard a écrit.
      expect(chip()?.textContent).toContain('Filtre actif');
      expect(chip()?.textContent).toContain('Lieu : Pavillon Royal');
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    ['lieu', 'lieu=L2', 'Lieu : Palais des Congrès de Paris'],
    ['traiteur', 'traiteur=T1', 'Traiteur : Kaspia Réceptions'],
  ])(
    'M3.2/collectes_chip_sans_libelle_prend_le_nom_des_options — %s',
    async (_cle, url, attendu) => {
      // Lien partagé ou ouvert dans un autre onglet : rien en sessionStorage.
      urlParams.current = url;
      fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await waitFor(
        () => expect(chip()?.textContent).toContain(attendu),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_chip_retirer_le_filtre_sort_du_drilldown — un clic retire tout ce que le dashboard a transmis',
    async () => {
      setCollecteFiltreLabel({
        kind: 'lieu',
        id: 'L1',
        label: 'Pavillon Royal',
      });
      urlParams.current =
        'lieu=L1&from=2026-01-01&to=2026-06-30&type_evenement_ids[]=ty-gala&taille_evenements[]=M';
      const urls = fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      expect(urls[urls.length - 1]).toContain('lieu_ids=L1');
      const avant = urls.length;

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Retirer le filtre' }),
        );
      });

      // Un nouvel appel part, sans le lieu NI les filtres propagés : retirer le
      // lieu seul laisserait la liste restreinte à « Gala / M / 1er semestre ».
      expect(urls.length).toBe(avant + 1);
      const apres = urls[urls.length - 1]!;
      expect(apres).not.toContain('lieu_id');
      expect(apres).not.toContain('type_evenement_ids');
      expect(apres).not.toContain('taille_evenements');
      expect(apres).not.toContain('from=');
      expect(chip()).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_chip_suit_la_barre — une autre cible choisie dans la barre sort du drill-down',
    async () => {
      setCollecteFiltreLabel({
        kind: 'lieu',
        id: 'L1',
        label: 'Pavillon Royal',
      });
      urlParams.current = 'lieu=L1';
      const urls = fetchEspion(TROIS_LIGNES);
      const { rerender } = render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      expect(chip()).not.toBeNull();

      // Le gestionnaire passe sur un AUTRE lieu (il décoche le sien, en coche
      // un autre) : il n'est plus sur la ligne cliquée au dashboard, le chip
      // ne doit ni l'annoncer encore, ni se reporter sur le nouveau lieu
      // (c'est un filtre ordinaire de la barre).
      await attendreOptions('Lieu', 'Palais des Congrès de Paris');
      await basculer('Paris Expo Porte de Versailles');
      await basculer('Palais des Congrès de Paris');
      resynchroniserUrl(rerender);
      expect(urls[urls.length - 1]).toContain('lieu_ids=L2');
      expect(chip()).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_chip_disparait_au_deuxieme_lieu_coche — la liste ne porte plus sur la seule ligne cliquée',
    async () => {
      urlParams.current = 'lieu=L1';
      const urls = fetchEspion(TROIS_LIGNES);
      const { rerender } = render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Lieu', 'Palais des Congrès de Paris');
      expect(chip()).not.toBeNull();

      // Un 2e lieu coché EN PLUS : deux lieux filtrés, le chip « Lieu : … »
      // n'en nommerait qu'un. Les deux restent lisibles dans la barre.
      await basculer('Palais des Congrès de Paris');
      resynchroniserUrl(rerender);
      expect(decodeURIComponent(urls[urls.length - 1]!)).toContain(
        'lieu_ids=L1,L2',
      );
      expect(chip()).toBeNull();
      expect(screen.getByTestId('filtre-lieu').textContent).toBe(
        'Lieu2 sélectionnés',
      );

      // Revenu au seul lieu du drill-down : le chip l'annonce de nouveau (il
      // suit ce que la barre filtre, comme avant ce lot).
      await basculer('Palais des Congrès de Paris');
      resynchroniserUrl(rerender);
      expect(urls[urls.length - 1]).toContain('lieu_ids=L1');
      expect(chip()?.textContent).toContain(
        'Lieu : Paris Expo Porte de Versailles',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_valeur_hors_options_cochee_avec_les_autres — tout cocher ne retire pas le filtre',
    async () => {
      // Drill-down sur un traiteur sorti de la fenêtre de 24 mois : les options
      // n'en proposent qu'un autre. Le cocher en plus = DEUX traiteurs filtrés.
      // Sans la marque « hors liste », FiltreCoches lirait « toutes les options
      // cochées = Tous » et effacerait le filtre reçu du dashboard.
      setCollecteFiltreLabel({
        kind: 'traiteur',
        id: 'T9',
        label: 'Ancien Traiteur',
      });
      urlParams.current = 'traiteur=T9';
      const urls = fetchEspion(TROIS_LIGNES);
      const { rerender } = render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Traiteur', 'Kaspia Réceptions');
      expect(
        screen.getByRole('checkbox', { name: 'Ancien Traiteur' }),
      ).toBeChecked();

      await basculer('Kaspia Réceptions');
      resynchroniserUrl(rerender);
      expect(decodeURIComponent(urls[urls.length - 1]!)).toContain(
        'traiteur_ids=T9,T1',
      );
      expect(screen.getByTestId('filtre-traiteur').textContent).toBe(
        'Traiteur2 sélectionnés',
      );
      // Deux traiteurs filtrés : plus de cible unique, plus de chip.
      expect(chip()).toBeNull();

      // Décochée, la valeur hors options quitte la liste : elle n'y était que
      // parce qu'elle filtrait.
      await basculer('Ancien Traiteur');
      resynchroniserUrl(rerender);
      expect(urls[urls.length - 1]).toContain('traiteur_ids=T1');
      expect(
        screen.queryByRole('checkbox', { name: 'Ancien Traiteur' }),
      ).toBeNull();
      expect(
        screen.queryByRole('checkbox', { name: 'Sélectionné' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    ['plusieurs lieux', 'lieu=L1,L2'],
    ['plusieurs traiteurs', 'traiteur=T1,T9'],
    // Le lieu prime sur le traiteur : plusieurs lieux = pas de cible, même si
    // l'URL porte aussi un seul traiteur.
    ['plusieurs lieux et un traiteur', 'lieu=L1,L2&traiteur=T1'],
  ])(
    'M3.2/collectes_lien_a_plusieurs_valeurs_sans_chip — %s',
    async (_cas, url) => {
      // Un drill-down vise UNE ligne de Top liste. Plusieurs valeurs dans
      // l'URL à l'arrivée (rechargement après des cases cochées, lien
      // partagé) = filtres ordinaires : la barre les montre, pas de chip.
      urlParams.current = url;
      const urls = fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Lieu', 'Palais des Congrès de Paris');

      const appel = new URLSearchParams(urls[urls.length - 1]!.split('?')[1]);
      const page = new URLSearchParams(url);
      expect(appel.get('lieu_ids')).toBe(page.get('lieu'));
      expect(appel.get('traiteur_ids')).toBe(page.get('traiteur'));
      expect(chip()).toBeNull();
      // Jamais « Tous » sur un filtre appliqué.
      for (const cle of ['lieu', 'traiteur'] as const)
        if (page.get(cle))
          expect(screen.getByTestId(`filtre-${cle}`).textContent).not.toContain(
            'Tous',
          );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_lien_a_plusieurs_valeurs_reduit_a_une_sans_chip — la cible se lit à l’arrivée, pas en cours de route',
    async () => {
      // Arrivée sur deux lieux : pas de drill-down. En décocher un laisse un
      // seul lieu filtré, mais c'est un filtre composé dans la barre — pas la
      // ligne d'une Top liste. Le chip ne doit pas surgir sur le lieu restant.
      urlParams.current = 'lieu=L1,L2';
      const urls = fetchEspion(TROIS_LIGNES);
      const { rerender } = render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Lieu', 'Palais des Congrès de Paris');

      await basculer('Palais des Congrès de Paris');
      resynchroniserUrl(rerender);
      expect(urls[urls.length - 1]).toContain('lieu_ids=L1');
      expect(urls[urls.length - 1]).not.toContain('L2');
      expect(chip()).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_filtre_pose_dans_la_barre_sans_chip — un lieu choisi sans drill-down est un filtre ordinaire',
    async () => {
      const urls = fetchEspion(TROIS_LIGNES);
      const { rerender } = render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);

      await attendreOptions('Lieu', 'Paris Expo Porte de Versailles');
      await basculer('Paris Expo Porte de Versailles');
      resynchroniserUrl(rerender);

      // Le lieu est déjà visible dans son contrôle : pas de chip pour lui.
      expect(urls[urls.length - 1]).toContain('lieu_ids=L1');
      expect(window.location.search).toContain('lieu=L1');
      expect(chip()).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    // [contrôle de la cible, id, URL, libellé du clic, AUTRE contrôle, une de ses options]
    ['lieu', 'L9', 'lieu=L9', 'Ancien Lieu', 'Traiteur', 'Kaspia Réceptions'],
    [
      'traiteur',
      'T9',
      'traiteur=T9&from=2023-01-01&to=2024-06-30',
      'Ancien Traiteur',
      'Lieu',
      'Palais des Congrès de Paris',
    ],
  ] as const)(
    'M3.2/collectes_cible_hors_options_reste_nommee — %s',
    async (cle, id, url, libelle, autreControle, optionTemoin) => {
      // « L9 » / « T9 » ne sont pas dans les options de la barre (elles ne
      // listent que les traiteurs intervenus sur 24 mois ; une période plus
      // ancienne en sort).
      setCollecteFiltreLabel({ kind: cle, id, label: libelle });
      urlParams.current = url;
      fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      // La cible doit rester nommée APRÈS l'arrivée des options.
      await attendreOptions(autreControle, optionTemoin);

      const titre = cle === 'lieu' ? 'Lieu' : 'Traiteur';
      expect(chip()?.textContent).toContain(`${titre} : ${libelle}`);
      const controle = screen.getByTestId(`filtre-${cle}`).textContent;
      expect(controle).toContain(libelle);
      expect(controle).not.toContain('Tous');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_valeur_filtree_inconnue_reste_annoncee — jamais « Tous » sur une liste filtrée',
    async () => {
      // Lien partagé sur un traiteur hors options : aucun nom disponible. Le
      // filtre reste annoncé, par le chip et par le contrôle.
      urlParams.current = 'traiteur=T9';
      const urls = fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await attendreOptions('Lieu', 'Palais des Congrès de Paris');

      expect(urls[urls.length - 1]).toContain('traiteur_ids=T9');
      expect(chip()?.textContent).toContain('Traiteur : traiteur sélectionné');
      const controle = screen.getByTestId('filtre-traiteur').textContent;
      expect(controle).toContain('Sélectionné');
      expect(controle).not.toContain('Tous');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_lieu_et_traiteur_dans_l_url — le chip annonce le lieu, le traiteur reste visible dans la barre',
    async () => {
      // Drill-down sur un traiteur hors options, puis un lieu ajouté dans la
      // barre, puis rechargement : l'URL porte les deux.
      urlParams.current = 'traiteur=T9&lieu=L1';
      const urls = fetchEspion(TROIS_LIGNES);
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      await waitFor(
        () =>
          expect(chip()?.textContent).toContain(
            'Lieu : Paris Expo Porte de Versailles',
          ),
        ATTENTE_UI,
      );

      // Les DEUX filtres sont appliqués : le second ne doit pas disparaître de
      // l'écran sous prétexte que le chip annonce le premier.
      const appel = urls[urls.length - 1]!;
      expect(appel).toContain('lieu_ids=L1');
      expect(appel).toContain('traiteur_ids=T9');
      const controle = screen.getByTestId('filtre-traiteur').textContent;
      expect(controle).toContain('Sélectionné');
      expect(controle).not.toContain('Tous');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_chip_rechargement_sans_ecart_d_hydratation — le HTML servi et le premier rendu client concordent',
    async () => {
      urlParams.current = 'lieu=L1';
      fetchEspion(TROIS_LIGNES);
      // Serveur : pas de sessionStorage, donc pas de libellé.
      const conteneur = document.createElement('div');
      conteneur.innerHTML = renderToString(<CollectesPage />);
      document.body.appendChild(conteneur);
      const chipDe = () =>
        conteneur.querySelector('[data-testid="filtre-actif"]')?.textContent;
      expect(chipDe()).toContain('Lieu : lieu sélectionné');

      // Client, même onglet après un clic sur le dashboard : le libellé est là.
      // Le lire pendant l'hydratation rendrait un texte différent du HTML servi
      // — React jette alors le rendu serveur et signale l'écart, à CHAQUE
      // rechargement.
      setCollecteFiltreLabel({
        kind: 'lieu',
        id: 'L1',
        label: 'Pavillon Royal',
      });
      const ecarts: string[] = [];
      const erreursConsole = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      let racine: Root | undefined;
      try {
        await act(async () => {
          racine = hydrateRoot(conteneur, <CollectesPage />, {
            onRecoverableError: (e) => ecarts.push(String(e)),
          });
        });
        // Une fois hydraté, le chip prend le libellé du clic.
        await waitFor(
          () => expect(chipDe()).toContain('Lieu : Pavillon Royal'),
          ATTENTE_UI,
        );
        expect(ecarts).toEqual([]);
      } finally {
        await act(async () => racine?.unmount());
        conteneur.remove();
        erreursConsole.mockRestore();
      }
    },
    ATTENTE_CAS_MS,
  );
});
