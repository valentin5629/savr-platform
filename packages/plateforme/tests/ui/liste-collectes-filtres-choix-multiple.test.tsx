/**
 * Listes Collectes traiteur (M3.1) et agence (M3.3) — filtres à choix multiple,
 * case « Tous », « Période » en premier (décision Val 2026-09-30, divergence
 * M0.8_20260930_filtres-choix-multiple-tous, partie C).
 *
 * Les deux écrans rendent le MÊME composant (§06.11 = §06.04 « à l'identique ») :
 * chaque cas est joué sur les deux pages, contre les routes de son espace.
 *
 * Ce que ces cas épinglent, de la case cochée jusqu'à la requête :
 *  - Lieu et Client organisateur en listes à cocher ; ce qui part à l'API
 *    (`lieu_ids` CSV, `client` répété) et ce qui s'écrit dans l'adresse de la page
 *    (`lieu` CSV, `client` répété) ;
 *  - « Tous » et « tout cocher » = plus aucun paramètre ;
 *  - un lien existant à valeur unique (`?lieu=<id>`, `?client=<nom>`) pré-coche
 *    sa case ;
 *  - une réponse plus ancienne que la dernière demande est ignorée ;
 *  - l'export CSV reprend exactement les paramètres de la liste (§12).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { setCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';

const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => searchParams,
  usePathname: () => '/collectes',
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

import TraiteurCollectesPage from '@/app/(traiteur)/traiteur/collectes/page.js';
import AgenceCollectesPage from '@/app/(agence)/agence/collectes/page.js';

const LIEUX = [
  { id: 'l-gabriel', nom: 'Pavillon Gabriel' },
  { id: 'l-louvre', nom: 'Carrousel du Louvre' },
  { id: 'l-brongniart', nom: 'Palais Brongniart' },
];
// Un nom de client peut porter une virgule : il ne doit jamais être découpé.
const CLIENTS = ['Accor', 'Danone', 'Kering, Paris'];

function collecte(id: string, lieu: string) {
  return {
    id,
    type: 'zero_dechet',
    statut: 'programmee',
    date_collecte: '2026-12-18',
    heure_collecte: '22:00:00',
    programmee_par_tiers: false,
    rapport_reserve_donneur_ordre: false,
    poids_total_kg: 0,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: 0,
    evenements: {
      pax: 120,
      nom_client_organisateur: null,
      lieux: { nom: lieu, adresse_acces: null, code_postal: null, ville: null },
    },
  };
}

/** Laisse se dérouler toute la chaîne de promesses d'une réponse déjà livrée. */
const laisserArriver = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const reponse = (data: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve({ data }) }) as Response;

/** Réponses de liste en attente, résolues à la main (cas « réponse périmée »). */
let enAttente: ((data: unknown) => void)[] | null = null;

const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url.endsWith('/collectes/filtres'))
    return Promise.resolve(
      reponse({ lieux: LIEUX, clients: CLIENTS, programmateurs: [] }),
    );
  if (enAttente) {
    const file = enAttente;
    return new Promise((resolve) => {
      file.push((data) => resolve(reponse(data)));
    });
  }
  return Promise.resolve(reponse([]));
});

const ESPACES = [
  {
    module: 'M3.1',
    espace: 'traiteur',
    api: '/api/v1/traiteur/collectes',
    Page: TraiteurCollectesPage,
  },
  {
    module: 'M3.3',
    espace: 'agence',
    api: '/api/v1/agence/collectes',
    Page: AgenceCollectesPage,
  },
] as const;

for (const { module, espace, api, Page } of ESPACES) {
  /** Paramètres des appels de LISTE (hors options de filtres), dans l'ordre. */
  const appelsListe = (): URLSearchParams[] =>
    fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.startsWith(`${api}?`))
      .map((u) => new URLSearchParams(u.split('?')[1]));
  const derniereListe = (): URLSearchParams => appelsListe().at(-1)!;
  /** Paramètres de la dernière adresse écrite par la page. */
  const derniereUrl = (): URLSearchParams =>
    new URLSearchParams(
      String(replace.mock.calls.at(-1)?.[0] ?? '').split('?')[1] ?? '',
    );

  /** Ouvre la liste d'un filtre et attend que ses options soient chargées. */
  async function ouvrir(testid: string, optionAttendue: string) {
    fireEvent.click(screen.getByTestId(testid));
    await screen.findByRole('checkbox', { name: optionAttendue }, ATTENTE_UI);
  }
  /** Referme la liste ouverte (un seul panneau ouvert à la fois dans un cas). */
  const fermer = (testid: string) =>
    fireEvent.click(screen.getByTestId(testid));
  const cocher = (nom: string) =>
    fireEvent.click(screen.getByRole('checkbox', { name: nom }));

  describe(`${module} / liste Collectes ${espace} — filtres à choix multiple, « Tous », Période en premier`, () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
      fetchMock.mockClear();
      replace.mockClear();
      searchParams = new URLSearchParams();
      enAttente = null;
      sessionStorage.clear();
    });
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it(
      `${module}/liste_${espace}_periode_en_premier — « Période » précède tous les autres filtres`,
      () => {
        render(<Page />);
        const periode = screen.getByTestId('filtre-periode');
        for (const id of [
          'filtre-statut',
          'filtre-lieu',
          'filtre-client',
          'filtre-info-incomplete',
        ])
          expect(
            periode.compareDocumentPosition(screen.getByTestId(id)) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_lieux_coches — deux lieux cochés partent en liste, « tout cocher » et « Tous » retirent le filtre`,
      async () => {
        render(<Page />);
        await ouvrir('filtre-lieu', 'Pavillon Gabriel');
        cocher('Pavillon Gabriel');
        cocher('Carrousel du Louvre');
        await waitFor(
          () =>
            expect(derniereListe().get('lieu_ids')).toBe('l-gabriel,l-louvre'),
          ATTENTE_UI,
        );
        // Plus aucun paramètre à valeur unique, et l'adresse de la page suit.
        expect(derniereListe().has('lieu_id')).toBe(false);
        expect(derniereUrl().get('lieu')).toBe('l-gabriel,l-louvre');

        // Cocher le dernier lieu = tous cochés = aucun filtre.
        cocher('Palais Brongniart');
        await waitFor(
          () => expect(derniereListe().has('lieu_ids')).toBe(false),
          ATTENTE_UI,
        );
        expect(derniereUrl().has('lieu')).toBe(false);
        expect(screen.getByRole('checkbox', { name: 'Tous' })).toBeChecked();

        // Un lieu coché puis « Tous » : la sélection est effacée.
        cocher('Carrousel du Louvre');
        await waitFor(
          () => expect(derniereListe().get('lieu_ids')).toBe('l-louvre'),
          ATTENTE_UI,
        );
        cocher('Tous');
        await waitFor(
          () => expect(derniereListe().has('lieu_ids')).toBe(false),
          ATTENTE_UI,
        );
        expect(derniereUrl().has('lieu')).toBe(false);
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_liens_existants_pre_coches — ?lieu=<id> et ?client=<nom> se lisent comme des listes d’un élément`,
      async () => {
        searchParams = new URLSearchParams(
          'onglet=programmees&lieu=l-gabriel&client=Danone',
        );
        render(<Page />);
        await waitFor(
          () => expect(derniereListe().get('lieu_ids')).toBe('l-gabriel'),
          ATTENTE_UI,
        );
        expect(derniereListe().getAll('client')).toEqual(['Danone']);

        await ouvrir('filtre-lieu', 'Pavillon Gabriel');
        expect(
          screen.getByRole('checkbox', { name: 'Pavillon Gabriel' }),
        ).toBeChecked();
        expect(
          screen.getByRole('checkbox', { name: 'Carrousel du Louvre' }),
        ).not.toBeChecked();
        fermer('filtre-lieu');

        // Un second client s'AJOUTE au premier ; sa virgule n'est pas un séparateur.
        await ouvrir('filtre-client', 'Danone');
        expect(screen.getByRole('checkbox', { name: 'Danone' })).toBeChecked();
        cocher('Kering, Paris');
        await waitFor(
          () =>
            expect(derniereListe().getAll('client')).toEqual([
              'Danone',
              'Kering, Paris',
            ]),
          ATTENTE_UI,
        );
        expect(derniereUrl().getAll('client')).toEqual([
          'Danone',
          'Kering, Paris',
        ]);
        // Le lieu du lien est conservé.
        expect(derniereUrl().get('lieu')).toBe('l-gabriel');
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_info_incomplete_deux_cases — une case filtre, les deux = toutes`,
      async () => {
        render(<Page />);
        await ouvrir('filtre-info-incomplete', 'Oui');
        cocher('Oui');
        await waitFor(
          () => expect(derniereListe().get('info_incomplete')).toBe('oui'),
          ATTENTE_UI,
        );
        expect(derniereUrl().get('info')).toBe('oui');
        cocher('Non');
        await waitFor(
          () => expect(derniereListe().has('info_incomplete')).toBe(false),
          ATTENTE_UI,
        );
        expect(derniereUrl().has('info')).toBe(false);
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_reponse_perimee_ignoree — une réponse plus ancienne n’écrase ni la liste ni l’état de chargement`,
      async () => {
        enAttente = [];
        const { container } = render(<Page />);
        await waitFor(() => expect(enAttente).toHaveLength(1), ATTENTE_UI);
        // Un filtre posé avant le retour de la première demande.
        await ouvrir('filtre-info-incomplete', 'Oui');
        cocher('Oui');
        await waitFor(() => expect(enAttente).toHaveLength(2), ATTENTE_UI);
        const [ancienne, recente] = enAttente;

        // L'ancienne réponse arrive la première : ignorée, on charge toujours.
        ancienne!([collecte('c-ancienne', 'Lieu de la demande périmée')]);
        await laisserArriver();
        expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.queryByText('Lieu de la demande périmée')).toBeNull();

        recente!([collecte('c-recente', 'Lieu de la demande en cours')]);
        const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
        expect(table.getByText('Lieu de la demande en cours')).toBeTruthy();
        expect(table.queryByText('Lieu de la demande périmée')).toBeNull();
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_reponse_perimee_arrivee_apres — l’ancienne réponse arrivée en dernier ne remplace pas la liste`,
      async () => {
        enAttente = [];
        render(<Page />);
        await waitFor(() => expect(enAttente).toHaveLength(1), ATTENTE_UI);
        await ouvrir('filtre-info-incomplete', 'Oui');
        cocher('Oui');
        await waitFor(() => expect(enAttente).toHaveLength(2), ATTENTE_UI);
        const [ancienne, recente] = enAttente;

        recente!([collecte('c-recente', 'Lieu de la demande en cours')]);
        const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
        expect(table.getByText('Lieu de la demande en cours')).toBeTruthy();

        ancienne!([collecte('c-ancienne', 'Lieu de la demande périmée')]);
        await laisserArriver();
        expect(screen.queryByText('Lieu de la demande périmée')).toBeNull();
        expect(
          within(screen.getByRole('table')).getByText(
            'Lieu de la demande en cours',
          ),
        ).toBeTruthy();
      },
      ATTENTE_CAS_MS,
    );

    // Lien RÉEL du drill-down Top lieux du dashboard traiteur : le lieu arrive
    // avec son périmètre miroir (`perimetre=organisation`, sans contrôle dans la
    // barre), le statut `cloturee` et la période.
    const LIEN_TOP_LIEUX =
      'onglet=historique&lieu=l-gabriel&type=zero_dechet&statut=cloturee&perimetre=organisation&from=2026-01-01&to=2026-06-30';

    it(
      `${module}/liste_${espace}_chip_lieu_tant_que_seul_lieu_filtre — cocher un autre lieu sort du drill-down : plus de chip, plus de périmètre caché`,
      async () => {
        searchParams = new URLSearchParams(LIEN_TOP_LIEUX);
        render(<Page />);
        const chip = await screen.findByTestId('filtre-actif', {}, ATTENTE_UI);
        await waitFor(
          () => expect(chip).toHaveTextContent('Lieu : Pavillon Gabriel'),
          ATTENTE_UI,
        );
        expect(derniereListe().get('perimetre')).toBe('organisation');

        // La barre ne filtre plus sur ce seul lieu : le chip n'est plus vrai, et
        // le périmètre qu'il signalait ne doit pas continuer à filtrer en silence.
        await ouvrir('filtre-lieu', 'Carrousel du Louvre');
        cocher('Carrousel du Louvre');
        await waitFor(
          () => expect(screen.queryByTestId('filtre-actif')).toBeNull(),
          ATTENTE_UI,
        );
        await waitFor(
          () =>
            expect(derniereListe().get('lieu_ids')).toBe('l-gabriel,l-louvre'),
          ATTENTE_UI,
        );
        expect(derniereListe().has('perimetre')).toBe(false);
        expect(derniereUrl().has('perimetre')).toBe(false);
        // Statut et période, visibles dans la barre, restent posés.
        expect(derniereListe().get('statut')).toBe('cloturee');
        expect(derniereListe().get('from')).toBe('2026-01-01');
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_reinitialiser_sort_du_drill_down — « Réinitialiser » lâche aussi le périmètre du drill-down`,
      async () => {
        searchParams = new URLSearchParams(LIEN_TOP_LIEUX);
        render(<Page />);
        await screen.findByTestId('filtre-actif', {}, ATTENTE_UI);
        fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
        await waitFor(
          () => expect(derniereListe().has('lieu_ids')).toBe(false),
          ATTENTE_UI,
        );
        // Plus aucun filtre visible : plus aucun filtre appliqué, hors onglet et type.
        expect([...derniereListe().keys()].sort()).toEqual(['statut', 'type']);
        expect(derniereUrl().has('perimetre')).toBe(false);
        expect(screen.queryByTestId('filtre-actif')).toBeNull();
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_plusieurs_lieux_au_rechargement — ?lieu=a,b est un filtre, pas un drill-down : le chip du commercial garde son nom`,
      async () => {
        setCollecteFiltreLabel({
          kind: 'commercial',
          id: 'u-commercial',
          label: 'Jeanne Martin',
        });
        searchParams = new URLSearchParams(
          'onglet=historique&commercial=u-commercial&lieu=l-gabriel,l-louvre',
        );
        render(<Page />);
        const chip = await screen.findByTestId('filtre-actif', {}, ATTENTE_UI);
        await waitFor(
          () => expect(chip).toHaveTextContent('Commercial : Jeanne Martin'),
          ATTENTE_UI,
        );
        expect(derniereListe().get('lieu_ids')).toBe('l-gabriel,l-louvre');
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_changement_de_type_conserve_lieux_et_clients — passer en Anti-Gaspi garde les filtres indépendants du type`,
      async () => {
        searchParams = new URLSearchParams(
          'onglet=programmees&lieu=l-gabriel,l-louvre&client=Danone&client=Kering%2C+Paris&info=oui',
        );
        render(<Page />);
        await waitFor(
          () => expect(derniereListe().get('type')).toBe('zero_dechet'),
          ATTENTE_UI,
        );
        fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
        await waitFor(
          () => expect(derniereListe().get('type')).toBe('anti_gaspi'),
          ATTENTE_UI,
        );
        expect(derniereListe().get('lieu_ids')).toBe('l-gabriel,l-louvre');
        expect(derniereListe().getAll('client')).toEqual([
          'Danone',
          'Kering, Paris',
        ]);
        expect(derniereListe().get('info_incomplete')).toBe('oui');
        expect(derniereUrl().get('lieu')).toBe('l-gabriel,l-louvre');
        expect(derniereUrl().getAll('client')).toEqual([
          'Danone',
          'Kering, Paris',
        ]);
      },
      ATTENTE_CAS_MS,
    );

    it(
      `${module}/liste_${espace}_export_csv_memes_parametres — l’export part avec les paramètres de la liste affichée`,
      async () => {
        searchParams = new URLSearchParams(
          'onglet=programmees&lieu=l-gabriel,l-louvre&client=Danone&client=Kering%2C+Paris&info=non',
        );
        const ouvrirFenetre = vi.fn();
        vi.stubGlobal('open', ouvrirFenetre);
        render(<Page />);
        await waitFor(
          () =>
            expect(derniereListe().get('lieu_ids')).toBe('l-gabriel,l-louvre'),
          ATTENTE_UI,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Exporter CSV' }));
        const exportUrl = String(ouvrirFenetre.mock.calls.at(-1)?.[0] ?? '');
        expect(exportUrl.startsWith('/api/v1/exports/collectes?')).toBe(true);
        const qs = new URLSearchParams(exportUrl.split('?')[1]);
        // Mêmes paramètres, à l'identique, que la dernière demande de liste.
        expect(qs.toString()).toBe(derniereListe().toString());
        expect(qs.get('lieu_ids')).toBe('l-gabriel,l-louvre');
        expect(qs.getAll('client')).toEqual(['Danone', 'Kering, Paris']);
        expect(qs.get('info_incomplete')).toBe('non');
      },
      ATTENTE_CAS_MS,
    );
  });
}
