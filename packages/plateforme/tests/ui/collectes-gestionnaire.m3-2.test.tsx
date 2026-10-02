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
      // « Chargement… » que rendait l'écran d'avant ne doit plus apparaître.
      expect(
        await screen.findByTestId('collectes-skeleton', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText('Chargement…')).toBeNull();
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
      expect(
        await screen.findByTestId('collectes-resultats-count', {}, ATTENTE_UI),
      ).toHaveProperty(
        'textContent',
        '120 collectes correspondent à votre sélection',
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
        fireEvent.click(screen.getByRole('combobox', { name: 'Lieu' }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('option', {
            name: 'Paris Expo Porte de Versailles',
          }),
        );
      });

      const derniere = urls[urls.length - 1]!;
      expect(derniere).toContain('lieu_id=L1');
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
      expect(demande.get('lieu_id')).toBe('L1');
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
      expect(derniere).toContain('lieu_id=L1');
      expect(derniere).not.toContain('page=');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/collectes_reinitialiser_retire_aussi_type_et_taille — pas de filtre invisible résiduel',
    async () => {
      urlParams.current =
        'lieu=L1&type_evenement_ids[]=ty-gala&taille_evenements[]=M';
      const urls = fetchEspion({ data: PAGE, total: 50 });
      render(<CollectesPage />);
      await screen.findByRole('table', {}, ATTENTE_UI);
      const avant = urls.length;

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
      expect(apres).not.toContain('lieu_id=');
      // L'URL de la page (miroir des filtres, D6) est nettoyée aussi, y compris
      // les anciennes clés `x[]`.
      expect(window.location.search).not.toContain('type_evenement_ids');
      expect(window.location.search).not.toContain('lieu=');
    },
    ATTENTE_CAS_MS,
  );
});
