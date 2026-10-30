/**
 * M3.2 — écrans Événements du gestionnaire de lieux (§06.05 §2), remis par Val
 * le 2026-10-18 : liste des événements de ses lieux, et fiche événement au
 * bilan CONSOLIDÉ sur toutes ses collectes — en pop-up sur la liste depuis le
 * 2026-10-19 (« en modale comme les pages collectes »), en trois onglets depuis
 * le 2026-10-26 (Informations générales, Informations collectes, Bilan &
 * documents) ; avancement en pastille à la place de la frise Créé → Réalisé
 * depuis le 2026-10-27 (grand format variante B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

// Adresse lue par les écrans au montage (filtres, page, fiche ouverte).
let adresse = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => adresse,
  usePathname: () => '/gestionnaire/evenements',
}));

// La fiche collecte (pop-up client commun) est testée ailleurs : ici, seul
// compte QUELLE collecte la fiche événement lui demande d'ouvrir.
vi.mock('@/components/collecte/fiche-collecte-client-modal', () => ({
  FicheCollecteClientModal: ({
    collecteId,
    initialOnglet,
    onClose,
  }: {
    collecteId: string | null;
    initialOnglet?: string;
    onClose: () => void;
  }) =>
    collecteId ? (
      <div data-testid="fiche-collecte-ouverte">
        {collecteId}
        {initialOnglet ? `:${initialOnglet}` : ''}
        <button type="button" onClick={onClose}>
          Fermer la fiche
        </button>
      </div>
    ) : null,
}));

// Fiche collecte Admin : seule compte la collecte qu'on lui demande d'ouvrir.
vi.mock('@/components/admin/collecte-detail-modal', () => ({
  CollecteDetailModal: ({ collecteId }: { collecteId: string | null }) =>
    collecteId ? (
      <div data-testid="fiche-collecte-admin-ouverte">{collecteId}</div>
    ) : null,
}));

import EvenementsPage from '@/app/(gestionnaire)/gestionnaire/evenements/page.js';
import { FicheEvenementModal } from '@/components/evenements/fiche-evenement-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const EVT_ID = '22222222-2222-4222-8222-222222222222';

const fermerEvenement = vi.fn();
const changerCollecte = vi.fn();
/** Monte la fiche événement en pop-up, comme la liste le fait au clic. */
const monterFiche = (
  props: Partial<Parameters<typeof FicheEvenementModal>[0]> = {},
) =>
  render(
    <FicheEvenementModal
      espace="gestionnaire"
      evenementId={EVT_ID}
      onClose={fermerEvenement}
      onCollecteChange={changerCollecte}
      {...props}
    />,
  );
/** Onglet de la fiche (Radix s'active au `mousedown`). */
const onglet = (nom: RegExp | string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: nom }));
/** Fiche chargée : sa pastille d'avancement est à l'écran. */
const ficheChargee = () =>
  screen.findByTestId('statut-evenement', undefined, ATTENTE_UI);
/** Pastille d'avancement de l'événement (étape courante de l'ex-frise). */
const etapeCourante = () => screen.getByTestId('statut-evenement');

const LIGNE = {
  id: EVT_ID,
  nom_evenement: 'Salon Équip’Hôtel',
  date_evenement: '2026-09-10',
  pax: 800,
  client_nom: 'Maison Lenôtre',
  lieu_nom: 'Paris Expo',
  lieu_adresse: '1 place de la Porte de Versailles 75015 Paris',
  traiteur_nom: 'Kaspia',
  nb_collectes_zd: 2,
  nb_collectes_ag: 1,
  nb_realisees: 2,
  nb_sans_excedent: 0,
  tonnage_zd_kg: 1000,
  taux_recyclage: 74,
  repas_donnes: null,
  co2_evite_kg: 100,
  dechets_labo_kg: 42,
  statut_consolide: 'En cours',
};

const FLUX_VIDES = {
  biodechet: 0,
  emballage: 0,
  carton: 0,
  verre: 0,
  dechet_residuel: 0,
};

/** Fiche d'une collecte, telle que la route de la fiche collecte la sert. */
function ficheCollecte(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'cloturee',
    statut_tms: 'termine',
    tms_reference: null,
    date_collecte: '2026-09-10',
    heure_collecte: '23:00:00',
    pax: 400,
    controle_acces_requis: false,
    informations_completes: true,
    informations_supplementaires: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    realisee_at: null,
    aucun_repas_motif: null,
    type_evenement_id: null,
    type_evenement: null,
    contacts_visibles: true,
    contact_principal_nom: 'Léa Martin',
    contact_principal_telephone: '06 12 34 56 78',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    taille_bracket: null,
    evenement: {
      id: EVT_ID,
      nom_evenement: 'Salon Équip’Hôtel',
      pax: 800,
      nom_client_organisateur: 'Maison Lenôtre',
      reference_affaire: 'AFF-2026-12',
      lieu: {
        id: 'L1',
        nom: 'Paris Expo',
        adresse_acces: '1 place de la Porte de Versailles',
        code_postal: '75015',
        ville: 'Paris',
        acces_details: 'Quai de livraison n°3',
      },
    },
    tournees: [],
    coordonnees_urgence_demandee: false,
    bilan_flux: null,
    repas_donnes: null,
    association: null,
    rapport_rse_disponible: true,
    rapport_mis_a_jour_at: null,
    rapport_reserve_donneur_ordre: false,
    rapport_etat: 'disponible',
    actions: { modifier: 'absent', annuler: 'absent', annulation: null },
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: EVT_ID,
    nom_evenement: 'Salon Équip’Hôtel',
    date_evenement: '2026-09-10',
    pax: 800,
    taille_bracket: 'L',
    type_evenement: 'Cocktail repas complet',
    client_nom: 'Maison Lenôtre',
    lieu_nom: 'Paris Expo',
    lieu_adresse: '1 place de la Porte de Versailles 75015 Paris',
    traiteur: { id: 'T1', nom: 'Kaspia', a_logo: false },
    dechets_labo_kg: 42,
    bilan: {
      nb_collectes_zd: 2,
      nb_collectes_ag: 1,
      nb_realisees_zd: 2,
      nb_realisees_ag: 1,
      nb_sans_excedent: 0,
      tonnage_zd_kg: 1000,
      // Ratios par convive calculés par la route sur les convives des seules
      // collectes réalisées (décision Val 2026-10-27), jamais evenements.pax.
      convives_zd: 500,
      pesee_par_pax_kg: 2,
      flux_kg: { ...FLUX_VIDES, biodechet: 600, carton: 300, verre: 100 },
      taux_recyclage: 74,
      co2_evite_zd_kg: 100,
      repas_donnes: 230,
      convives_ag: 200,
      repas_par_pax: 1.15,
      co2_evite_ag_kg: 575,
      associations: [
        { id: 'a1', nom: 'Restos du Cœur', ville: 'Paris', repas: 150 },
        { id: 'a2', nom: 'Linkee', ville: null, repas: 80 },
      ],
      premiere_collecte: '2026-09-10',
      derniere_collecte: '2026-09-12',
      statut_consolide: 'Terminé',
    },
    ajouter_collecte: false,
    lieu_acces_details: 'Quai de livraison n°3',
    fiches: [
      ficheCollecte({ id: 'c1' }),
      ficheCollecte({
        id: 'c2',
        date_collecte: '2026-09-11',
        heure_collecte: null,
        controle_acces_requis: true,
      }),
      ficheCollecte({
        id: 'c3',
        type: 'anti_gaspi',
        date_collecte: '2026-09-12',
        heure_collecte: null,
      }),
    ],
    ...over,
  };
}

type Reponse = { status?: number; body: unknown };
function stubFetch(routes: (url: string) => Reponse) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const { status = 200, body } = routes(String(input));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const OPTIONS = { data: { lieux: [], traiteurs: [], types: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  adresse = new URLSearchParams();
  window.history.replaceState(null, '', '/gestionnaire/evenements');
});

describe('M3.2 / liste Événements gestionnaire — écran', () => {
  it(
    'M3.2/evenements_liste_une_ligne_par_evenement — collectes par type, résultats cumulés, statut consolidé',
    async () => {
      stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : url.includes(`/api/v1/evenements/${EVT_ID}`)
            ? { body: { data: detail() } }
            : { body: { data: [LIGNE], total: 1 } },
      );
      render(<EvenementsPage />);
      const table = await screen.findByTestId(
        'evenements-table',
        undefined,
        ATTENTE_UI,
      );
      // La grille rend aussi une carte par ligne en mobile : la ligne du
      // tableau se prend par son libellé d'accès.
      const ligne = within(table).getByRole('row', {
        name: "Ouvrir l'événement Salon Équip’Hôtel",
      });
      expect(ligne).toHaveTextContent('Maison Lenôtre');
      expect(ligne).toHaveTextContent('Paris Expo');
      expect(ligne).toHaveTextContent('Kaspia');
      expect(ligne).toHaveTextContent('2 ZD · 1 AG');
      expect(ligne).toHaveTextContent(/1\s000\skg/);
      expect(ligne).toHaveTextContent(/74\s%/);
      expect(ligne).toHaveTextContent(/42\skg/);
      expect(ligne).toHaveTextContent('En cours');
      expect(
        screen.getByTestId('evenements-resultats-count'),
      ).toHaveTextContent('1 événement correspond à votre sélection');

      // Le clic ouvre la fiche en pop-up, sur la liste, et l'adresse la porte.
      fireEvent.click(ligne);
      const fiche = await screen.findByRole('dialog', undefined, ATTENTE_UI);
      await within(fiche).findByTestId(
        'statut-evenement',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.getByTestId('evenements-table')).toBeInTheDocument();
      expect(window.location.search).toContain(`evenement=${EVT_ID}`);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_vues_a_venir_passes_par_date — « Événements à venir » par défaut (aujourd’hui et après, date croissante), « passés » (avant aujourd’hui, date décroissante)',
    async () => {
      // Horloge seule figée (minuteries réelles) : 8 juillet 2026, 10 h à Paris.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-08T08:00:00Z'));
      try {
        const fetchMock = stubFetch((url) =>
          url.includes('/evenements/filtres')
            ? { body: OPTIONS }
            : { body: { data: [LIGNE], total: 1 } },
        );
        const derniereListe = () =>
          new URLSearchParams(
            fetchMock.mock.calls
              .map(([u]) => String(u))
              .filter((u) => u.includes('/api/v1/evenements?'))
              .at(-1)
              ?.split('?')[1],
          );
        render(<EvenementsPage />);
        await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);

        const vues = screen.getByRole('tablist', {
          name: 'Événements à venir ou passés',
        });
        expect(
          within(vues).getByRole('tab', { name: 'Événements à venir' }),
        ).toHaveAttribute('aria-selected', 'true');
        // Liste paginée : la borne ET le sens du tri partent au serveur.
        let q = derniereListe();
        expect(q.get('from')).toBe('2026-07-08');
        expect(q.get('to')).toBeNull();
        expect(q.get('ordre')).toBe('asc');

        fireEvent.mouseDown(
          within(vues).getByRole('tab', { name: 'Événements passés' }),
        );
        await waitFor(() => {
          q = derniereListe();
          expect(q.get('to')).toBe('2026-07-07');
        }, ATTENTE_UI);
        expect(q.get('from')).toBeNull();
        expect(q.get('ordre')).toBe('desc');
        expect(new URLSearchParams(window.location.search).get('onglet')).toBe(
          'passees',
        );
      } finally {
        vi.useRealTimers();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_changer_de_vue_reprend_son_tri — un tri choisi dans une vue ne passe pas à l’autre',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : { body: { data: [LIGNE], total: 1 } },
      );
      const ordreDemande = () =>
        new URLSearchParams(
          fetchMock.mock.calls
            .map(([u]) => String(u))
            .filter((u) => u.includes('/api/v1/evenements?'))
            .at(-1)
            ?.split('?')[1],
        ).get('ordre');
      const cliquerDate = async () =>
        fireEvent.click(
          within(
            await screen.findByTestId(
              'evenements-table',
              undefined,
              ATTENTE_UI,
            ),
          ).getByRole('button', { name: /Date/ }),
        );
      render(<EvenementsPage />);
      expect(
        await screen.findByTestId('evenements-table', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(ordreDemande()).toBe('asc');

      // Deux clics sur « Date » : décroissant, puis croissant posé explicitement.
      await cliquerDate();
      await waitFor(() => expect(ordreDemande()).toBe('desc'), ATTENTE_UI);
      await cliquerDate();
      await waitFor(() => expect(ordreDemande()).toBe('asc'), ATTENTE_UI);

      // « Passés » s'ouvre sur SON tri (décroissant), pas sur celui choisi.
      fireEvent.mouseDown(
        screen.getByRole('tab', { name: 'Événements passés' }),
      );
      await waitFor(() => expect(ordreDemande()).toBe('desc'), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_type_collecte_transmis — le segmenté ZD / AG filtre la route',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : { body: { data: [LIGNE], total: 1 } },
      );
      render(<EvenementsPage />);
      await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
      fireEvent.click(screen.getByRole('radio', { name: /anti-gaspi/i }));
      await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
      const appels = fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes('/api/v1/evenements?'));
      expect(appels.at(-1)).toContain('type=anti_gaspi');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_repere_jour_chevron — « Aujourd’hui » / « Demain » à côté de la date, rien sur un événement annulé ; chevron en fin de ligne',
    async () => {
      // Horloge seule figée (minuteries réelles) : 8 juillet 2026, 10 h à Paris.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-08T08:00:00Z'));
      try {
        const lignes = [
          {
            ...LIGNE,
            id: 'e-jour',
            nom_evenement: 'Gala du jour',
            date_evenement: '2026-07-08',
          },
          {
            ...LIGNE,
            id: 'e-demain',
            nom_evenement: 'Gala de demain',
            date_evenement: '2026-07-09',
          },
          {
            ...LIGNE,
            id: 'e-loin',
            nom_evenement: 'Gala lointain',
            date_evenement: '2026-07-20',
          },
          {
            ...LIGNE,
            id: 'e-annule',
            nom_evenement: 'Gala annulé',
            date_evenement: '2026-07-08',
            statut_consolide: 'Annulé',
          },
        ];
        stubFetch((url) =>
          url.includes('/evenements/filtres')
            ? { body: OPTIONS }
            : { body: { data: lignes, total: lignes.length } },
        );
        render(<EvenementsPage />);
        const table = await screen.findByTestId(
          'evenements-table',
          undefined,
          ATTENTE_UI,
        );
        const ligne = (nom: string) =>
          within(table).getByRole('row', { name: `Ouvrir l'événement ${nom}` });
        expect(ligne('Gala du jour')).toHaveTextContent('Aujourd’hui');
        expect(ligne('Gala de demain')).toHaveTextContent('Demain');
        expect(ligne('Gala lointain')).not.toHaveTextContent(
          /Aujourd’hui|Demain/,
        );
        expect(ligne('Gala annulé')).not.toHaveTextContent('Aujourd’hui');
        expect(
          within(ligne('Gala du jour')).getByTestId('chevron-ligne'),
        ).toBeTruthy();
        // La consigne « cliquez une ligne » a quitté le sous-titre.
        expect(screen.queryByText(/cliquez une ligne/)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_resultats_sans_excedent — seules collectes réalisées sans excédent : « Sans excédent », jamais une cellule vide',
    async () => {
      const vide = {
        ...LIGNE,
        id: 'e-sans',
        nom_evenement: 'Gala sans excédent',
        nb_collectes_zd: 0,
        nb_collectes_ag: 1,
        nb_realisees: 1,
        nb_sans_excedent: 1,
        tonnage_zd_kg: null,
        taux_recyclage: null,
        repas_donnes: 0,
        co2_evite_kg: 0,
        dechets_labo_kg: null,
        statut_consolide: 'Terminé',
      };
      const muet = {
        ...vide,
        id: 'e-muet',
        nom_evenement: 'Gala sans pesée',
        nb_sans_excedent: 0,
      };
      const mixte = {
        ...vide,
        id: 'e-mixte',
        nom_evenement: 'Gala mixte',
        nb_collectes_zd: 1,
        nb_realisees: 2,
        nb_sans_excedent: 1,
      };
      stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : { body: { data: [vide, muet, mixte], total: 3 } },
      );
      render(<EvenementsPage />);
      const table = await screen.findByTestId(
        'evenements-table',
        undefined,
        ATTENTE_UI,
      );
      const cellule = (nom: string) => {
        const ligne = within(table).getByRole('row', {
          name: `Ouvrir l'événement ${nom}`,
        });
        const i = within(table)
          .getAllByRole('columnheader')
          .findIndex((h) => h.textContent === 'Résultats');
        return within(ligne).getAllByRole('cell')[i]!;
      };
      expect(cellule('Gala sans excédent')).toHaveTextContent('Sans excédent');
      // AG sans excédent ET une ZD réalisée sans pesée : pas « Sans excédent ».
      expect(cellule('Gala mixte')).toHaveTextContent('—');
      expect(cellule('Gala mixte')).not.toHaveTextContent('Sans excédent');
      // Réalisée sans aucune valeur à montrer : « — », pas une cellule vide.
      expect(cellule('Gala sans pesée')).toHaveTextContent('—');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_page_hors_bornes_ramenee — page vide avec un total : retour sur la dernière page valide',
    async () => {
      adresse = new URLSearchParams('page=9');
      window.history.replaceState(null, '', '/gestionnaire/evenements?page=9');
      const fetchMock = stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : url.includes('page=9')
            ? { body: { data: [], total: 1 } }
            : { body: { data: [LIGNE], total: 1 } },
      );
      // L'état vide ne doit jamais passer à l'écran, même un instant.
      let vuVide = false;
      const guet = new MutationObserver(() => {
        if (document.body.textContent?.includes('Aucun événement'))
          vuVide = true;
      });
      guet.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      render(<EvenementsPage />);
      await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
      guet.disconnect();
      const appels = fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes('/api/v1/evenements?'));
      expect(appels[0]).toContain('page=9');
      expect(appels.at(-1)).not.toContain('page=');
      expect(vuVide).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_erreur_distincte_du_vide — une panne ne se lit pas « Aucun événement »',
    async () => {
      stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : { status: 500, body: {} },
      );
      render(<EvenementsPage />);
      await screen.findByTestId('evenements-erreur', undefined, ATTENTE_UI);
      expect(screen.queryByText('Aucun événement')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_vide — état vide illustré',
    async () => {
      stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : { body: { data: [], total: 0 } },
      );
      render(<EvenementsPage />);
      await screen.findByText('Aucun événement', undefined, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche Événement gestionnaire — écran', () => {
  it(
    'M3.2/evenement_fiche_bilan_consolide_affiche — cumul ZD et AG, associations, couverture',
    async () => {
      stubFetch(() => ({ body: { data: detail() } }));
      monterFiche();
      await ficheChargee();
      // En-tête de la pop-up : nom, date, lieu, traiteur, pax.
      expect(screen.getByTestId('fiche-evenement-infos')).toHaveTextContent(
        /Paris Expo.*Kaspia.*800\s*pax/,
      );
      // Onglet ouvert d'emblée : Informations générales.
      const entete = screen.getByTestId('evenement-entete');
      expect(entete).toHaveTextContent('Salon Équip’Hôtel');
      expect(entete).toHaveTextContent('Maison Lenôtre');
      // Le type d'événement se lit sur chaque collecte, plus sur l'événement.
      expect(entete).not.toHaveTextContent('Type d’événement');
      expect(entete).toHaveTextContent(/Déchets labo estimés\s*42\s*kg/);
      // Période de collecte : de la première à la dernière.
      expect(entete).toHaveTextContent(/Période de collecte.*→/);

      onglet('Bilan & documents');
      const bilan = await screen.findByTestId(
        'bilan-consolide',
        undefined,
        ATTENTE_UI,
      );
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Cumul des 2 collectes réalisées, sur 2 collectes Zéro Déchet de l’événement.',
      );
      // Événement ZD + AG : sous-onglets, Zéro Déchet d'abord.
      expect(
        screen.getByRole('radio', { name: 'Zéro Déchet' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByTestId('bilan-consolide-ag')).toBeNull();
      const zd = within(bilan).getByTestId('bilan-consolide-zd');
      expect(zd).toHaveTextContent(/Poids total collecté\s*1\s000\s*kg/);
      expect(zd).toHaveTextContent(/Taux de recyclage.*74,0\s*%/);
      // 1 000 kg pour les 500 convives des collectes ZD réalisées (pas les
      // 800 pax de l'événement).
      expect(zd).toHaveTextContent(/Pesée par pax\s*2\s000\s*g/);
      expect(zd).toHaveTextContent(/CO₂ évité\s*100/);
      // Donut de répartition des flux, sur le cumul de l'événement.
      expect(zd).toHaveTextContent('Répartition des tonnages');
      expect(zd).toHaveTextContent(/Biodéchets\s*600\s*kg/);
      expect(zd).toHaveTextContent(/Verre\s*100\s*kg/);
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      const ag = await screen.findByTestId(
        'bilan-consolide-ag',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('bilan-consolide-zd')).toBeNull();
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Cumul de 1 collecte réalisée, sur 1 collecte Anti-Gaspi de l’événement.',
      );
      expect(ag).toHaveTextContent(/Repas donnés\s*230\s*repas/);
      expect(ag).toHaveTextContent(/Repas par pax\s*1,15/);
      expect(ag).toHaveTextContent(/CO₂ évité\s*575/);
      const assos = within(ag).getByTestId('associations-beneficiaires');
      expect(assos).toHaveTextContent('Restos du Cœur · Paris150 repas');
      expect(assos).toHaveTextContent('Linkee80 repas');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/frise_avancement — l’événement passe à l’étape suivante quand toutes ses collectes l’ont passée',
    async () => {
      stubFetch(() => ({
        body: {
          data: detail({
            fiches: [
              ficheCollecte({ id: 'c1', statut: 'cloturee' }),
              ficheCollecte({ id: 'c2', statut: 'validee' }),
              ficheCollecte({ id: 'c3', statut: 'annulee' }),
            ],
          }),
        },
      }));
      monterFiche();
      await ficheChargee();
      // Pastille, plus de frise (décision Val 2026-10-27) : l'étape seule.
      expect(etapeCourante()).toHaveTextContent(/^Validé$/);
      expect(etapeCourante()).toHaveAttribute(
        'aria-label',
        'Avancement de l’événement : Validé',
      );
      expect(screen.queryByTestId('statut-consolide')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/frise_avancement — toutes les collectes annulées : pastille « Annulé »',
    async () => {
      stubFetch(() => ({
        body: {
          data: detail({
            fiches: [
              ficheCollecte({ id: 'c1', statut: 'annulee' }),
              ficheCollecte({ id: 'c2', statut: 'annulation_demandee' }),
            ],
          }),
        },
      }));
      monterFiche();
      await ficheChargee();
      expect(etapeCourante()).toHaveTextContent(/^Annulé$/);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/informations_generales — événement, lieu et une carte par collecte ; contacts d’une collecte de traiteur tiers masqués',
    async () => {
      stubFetch(() => ({
        body: {
          data: detail({
            ajouter_collecte: true,
            fiches: [
              ficheCollecte({
                id: 'c1',
                type_evenement: { libelle: 'Cocktail apéritif' },
                informations_supplementaires: 'Sonner à l’interphone',
                contact_secours_nom: 'Paul Roux',
                contact_secours_telephone: '07 00 00 00 01',
              }),
              ficheCollecte({
                id: 'c2',
                date_collecte: '2026-09-11',
                statut: 'validee',
                controle_acces_requis: true,
                contacts_visibles: false,
                contact_principal_nom: null,
                contact_principal_telephone: null,
              }),
            ],
          }),
        },
      }));
      monterFiche();
      await ficheChargee();
      const entete = screen.getByTestId('evenement-entete');
      expect(entete).toHaveTextContent(/Référence interne\s*AFF-2026-12/);

      const lieu = screen.getByTestId('bloc-lieu');
      expect(lieu).toHaveTextContent('1 place de la Porte de Versailles');
      expect(lieu).toHaveTextContent(/Contrôle d’accès\s*Oui/);
      expect(lieu).toHaveTextContent('Quai de livraison n°3');
      expect(screen.queryByTestId('carte-collecte')).toBeNull();

      onglet('Informations collectes');
      const cartes = await screen.findAllByTestId(
        'carte-collecte',
        undefined,
        ATTENTE_UI,
      );
      expect(cartes).toHaveLength(2);
      expect(cartes[0]).toHaveTextContent(/Collecte du Jeu 10 Sept · 23h00/i);
      expect(cartes[0]).toHaveTextContent(/Pax\s*400/);
      expect(cartes[0]).toHaveTextContent(
        /Type d’événement\s*Cocktail apéritif/,
      );
      expect(cartes[0]).toHaveTextContent(/Contact principal\s*Léa Martin/);
      expect(
        within(cartes[0]!).getByRole('link', { name: '06 12 34 56 78' }),
      ).toBeInTheDocument();
      expect(cartes[0]).toHaveTextContent(/Contact de secours\s*Paul Roux/);
      expect(cartes[0]).toHaveTextContent('Sonner à l’interphone');
      expect(cartes[0]).toHaveTextContent('Réalisée');
      expect(cartes[1]).toHaveTextContent('Validée');
      expect(cartes[1]).toHaveTextContent(
        'Réservés au traiteur qui a programmé la collecte.',
      );
      expect(cartes[1]).not.toHaveTextContent('Contact principal');

      fireEvent.click(
        within(cartes[1]!).getByRole('button', { name: 'Voir la collecte' }),
      );
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2',
      );
      expect(changerCollecte).toHaveBeenLastCalledWith('c2');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/lieu_surcharge_par_collecte — instructions d’accès saisies pour une collecte : le bloc Lieu renvoie aux cartes, chacune porte les siennes',
    async () => {
      const base = ficheCollecte();
      stubFetch(() => ({
        body: {
          data: detail({
            fiches: [
              ficheCollecte({ id: 'c1' }),
              ficheCollecte({
                id: 'c2',
                date_collecte: '2026-09-11',
                evenement: {
                  ...base.evenement,
                  lieu: {
                    ...base.evenement.lieu,
                    acces_details: 'Hall 7, porte B',
                  },
                },
              }),
            ],
          }),
        },
      }));
      monterFiche();
      await ficheChargee();
      const lieu = screen.getByTestId('bloc-lieu');
      // Adresse commune : dans le bloc Lieu, pas sur les cartes.
      expect(lieu).toHaveTextContent('1 place de la Porte de Versailles');
      expect(lieu).toHaveTextContent(
        /Instructions d’accès\s*Propre à chaque collecte/,
      );
      onglet('Informations collectes');
      const cartes = await screen.findAllByTestId(
        'carte-collecte',
        undefined,
        ATTENTE_UI,
      );
      expect(cartes[0]).toHaveTextContent(
        /Instructions d’accès\s*Quai de livraison n°3/,
      );
      expect(cartes[1]).toHaveTextContent(
        /Instructions d’accès\s*Hall 7, porte B/,
      );
      expect(cartes[0]).not.toHaveTextContent('Adresse');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/telechargement_zd_et_echecs — Rapport RSE fabriqué au clic sans radar ; échec nommé par collecte ; demande urgente refusée : message',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.endsWith('/c1/rapport-rse')
          ? { status: 500, body: {} }
          : url.includes('/coordonnees-urgence')
            ? { status: 409, body: { error: 'Une demande est déjà ouverte.' } }
            : {
                body: {
                  data: detail({
                    fiches: [ficheCollecte({ id: 'c1', statut: 'validee' })],
                  }),
                },
              },
      );
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      const ligne = await screen.findByTestId(
        'document-collecte',
        undefined,
        ATTENTE_UI,
      );
      fireEvent.click(
        within(ligne).getByRole('button', { name: 'Télécharger' }),
      );
      expect(
        await screen.findByText(
          /Collecte du Jeu 10 Sept · 23h00 : La fabrication du rapport a échoué/i,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const appel = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/c1/rapport-rse'),
      ) as unknown[] | undefined;
      expect(appel?.[1]).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ options: { benchmark: false } }),
      });

      onglet('Informations collectes');
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: /Demander les coordonnées en urgence/ },
          ATTENTE_UI,
        ),
      );
      expect(
        await screen.findByText(
          'Une demande est déjà ouverte.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/reference_interne_tiers_absente — événement d’un traiteur tiers : ni référence interne ni contrôle d’accès exigé',
    async () => {
      stubFetch(() => ({
        body: {
          data: detail({
            fiches: [ficheCollecte({ id: 'c1', controle_acces_requis: false })],
          }),
        },
      }));
      monterFiche();
      await ficheChargee();
      expect(screen.getByTestId('evenement-entete')).not.toHaveTextContent(
        'Référence interne',
      );
      expect(screen.getByTestId('bloc-lieu')).toHaveTextContent(
        /Contrôle d’accès\s*Non/,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/informations_chauffeurs — une carte par collecte titrée par sa date ; demande urgente sur la bonne collecte',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.includes('/coordonnees-urgence')
          ? { body: { ok: true } }
          : {
              body: {
                data: detail({
                  fiches: [
                    ficheCollecte({
                      id: 'c1',
                      statut: 'validee',
                      tournees: [
                        {
                          chauffeur_nom: 'Karim B.',
                          plaque_immatriculation: 'AB-123-CD',
                          chauffeur_telephone: '06 98 76 54 32',
                          type_vehicule: 'camion',
                        },
                      ],
                    }),
                    ficheCollecte({
                      id: 'c2',
                      date_collecte: '2026-09-11',
                      heure_collecte: '07:30:00',
                      statut: 'validee',
                    }),
                  ],
                }),
              },
            },
      );
      monterFiche();
      await ficheChargee();
      onglet('Informations collectes');
      // Carte unique par collecte : informations et logistique réunies.
      const cartes = await screen.findAllByTestId(
        'carte-collecte',
        undefined,
        ATTENTE_UI,
      );
      expect(cartes).toHaveLength(2);
      expect(cartes[0]).toHaveTextContent(/Collecte du Jeu 10 Sept · 23h00/i);
      expect(cartes[0]).toHaveTextContent('Karim B.');
      expect(cartes[0]).toHaveTextContent('AB-123-CD');
      // Coordonnées complètes : pas de demande urgente.
      expect(within(cartes[0]!).queryByTestId('zone-urgence')).toBeNull();
      expect(cartes[1]).toHaveTextContent(/Collecte du Ven 11 Sept · 07h30/i);

      fireEvent.click(
        within(cartes[1]!).getByRole('button', {
          name: /Demander les coordonnées en urgence/,
        }),
      );
      expect(
        await within(cartes[1]!).findByText(
          'Demande envoyée à l’équipe Savr.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const post = fetchMock.mock.calls.find(([u]) =>
        String(u).includes('/coordonnees-urgence'),
      );
      expect(String(post?.[0])).toBe(
        '/api/v1/gestionnaire/collectes/c2/coordonnees-urgence',
      );
      expect((post as unknown[] | undefined)?.[1]).toMatchObject({
        method: 'POST',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_collectes_ouvrent_la_fiche_collecte — bilan : un lien par collecte quand un type en compte plusieurs, ouvert sur « Bilan »',
    async () => {
      stubFetch(() => ({ body: { data: detail() } }));
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      const zd = await screen.findByTestId(
        'bilan-consolide-zd',
        undefined,
        ATTENTE_UI,
      );
      const liens = within(zd).getAllByRole('button', {
        name: /Accéder au bilan de la collecte du/,
      });
      expect(liens).toHaveLength(2);
      fireEvent.click(liens[1]!);
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2:bilan',
      );
      expect(changerCollecte).toHaveBeenLastCalledWith('c2');

      // Une seule collecte AG : le cumul est son bilan, pas de lien.
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      expect(
        within(
          await screen.findByTestId(
            'bilan-consolide-ag',
            undefined,
            ATTENTE_UI,
          ),
        ).queryByTestId('liens-bilans'),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'EVT/documents_par_collecte — un rapport par collecte non annulée ; Rapport de don téléchargé par URL pré-signée',
    async () => {
      const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null);
      const fetchMock = stubFetch((url) =>
        url.includes('/rapport-rse/download')
          ? { body: { url: 'https://r2.example/rapport.pdf' } }
          : {
              body: {
                data: detail({
                  fiches: [
                    ficheCollecte({ id: 'c1' }),
                    ficheCollecte({
                      id: 'c2',
                      statut: 'validee',
                      rapport_rse_disponible: false,
                      rapport_etat: 'a_venir',
                    }),
                    ficheCollecte({ id: 'c3', type: 'anti_gaspi' }),
                    ficheCollecte({ id: 'c4', statut: 'annulee' }),
                  ],
                }),
              },
            },
      );
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      const lignes = await screen.findAllByTestId(
        'document-collecte',
        undefined,
        ATTENTE_UI,
      );
      // Sous-onglet Zéro Déchet : les deux rapports ZD, pas l'annulée.
      expect(lignes).toHaveLength(2);
      expect(lignes[0]).toHaveTextContent('Rapport RSE');
      expect(lignes[1]).toHaveTextContent(
        'Document disponible dans les 48h après la collecte',
      );
      expect(
        within(lignes[1]!).getByRole('button', { name: 'Télécharger' }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      const don = await screen.findByText(
        'Rapport de don',
        undefined,
        ATTENTE_UI,
      );
      const ligneDon = don.closest('[data-testid="document-collecte"]');
      expect(screen.getAllByTestId('document-collecte')).toHaveLength(1);

      fireEvent.click(
        within(ligneDon as HTMLElement).getByRole('button', {
          name: 'Télécharger',
        }),
      );
      await waitFor(
        () =>
          expect(ouvrir).toHaveBeenCalledWith(
            'https://r2.example/rapport.pdf',
            '_blank',
          ),
        ATTENTE_UI,
      );
      expect(
        fetchMock.mock.calls.some(
          ([u]) =>
            String(u) ===
            '/api/v1/gestionnaire/collectes/c3/rapport-rse/download',
        ),
      ).toBe(true);
      ouvrir.mockRestore();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_bilan_en_attente — aucune collecte réalisée : bandeau, valeurs « — »',
    async () => {
      const d = detail();
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            bilan: {
              ...d.bilan,
              nb_realisees_zd: 0,
              nb_realisees_ag: 0,
              tonnage_zd_kg: null,
              flux_kg: FLUX_VIDES,
              taux_recyclage: null,
              co2_evite_zd_kg: null,
              repas_donnes: null,
              co2_evite_ag_kg: null,
              associations: [],
              statut_consolide: 'En cours',
            },
          },
        },
      }));
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      await screen.findByTestId('bandeau-bilan-attente', undefined, ATTENTE_UI);
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Aucun résultat n’est encore disponible sur les 2 collectes Zéro Déchet de l’événement.',
      );
      expect(screen.getByTestId('bandeau-bilan-attente')).toHaveTextContent(
        'Votre bilan sera disponible après les collectes',
      );
      expect(screen.getByTestId('bilan-consolide-zd')).toHaveTextContent(
        /Poids total collecté\s*—/,
      );
      // Même rendu que la fiche collecte : chiffres estompés, graphe en attente.
      expect(screen.getAllByTestId('bilan-estompe')).toHaveLength(1);
      expect(screen.getByTestId('bilan-consolide-zd')).toHaveTextContent(
        'Répartition des tonnages',
      );
      expect(screen.queryByTestId('associations-beneficiaires')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_labo_tiret_sans_zd — estimation labo toujours affichée, « — » sans collecte ZD ; événement sans collecte',
    async () => {
      const d = detail();
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            dechets_labo_kg: null,
            bilan: {
              ...d.bilan,
              nb_collectes_zd: 0,
              nb_collectes_ag: 0,
              nb_realisees_zd: 0,
              nb_realisees_ag: 0,
              tonnage_zd_kg: null,
              repas_donnes: null,
              associations: [],
              premiere_collecte: null,
              derniere_collecte: null,
            },
            fiches: [],
          },
        },
      }));
      monterFiche();
      await ficheChargee();
      expect(etapeCourante()).toHaveTextContent('Créé');
      expect(screen.getByTestId('evenement-entete')).toHaveTextContent(
        /Déchets labo estimés\s*—/,
      );
      onglet('Informations collectes');
      expect(
        await screen.findByText(
          'Aucune collecte rattachée à cet événement.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      onglet('Bilan & documents');
      expect(
        await screen.findByTestId(
          'bilan-consolide-couverture',
          undefined,
          ATTENTE_UI,
        ),
      ).toHaveTextContent('Aucune collecte n’est rattachée à cet événement.');
      expect(screen.queryByTestId('bandeau-bilan-attente')).toBeNull();
      // Aucun rapport : le bloc ne garde que la ligne du logo du client
      // (Val 2026-10-30).
      const docs = screen.getByTestId('documents-evenement');
      expect(
        docs.querySelector('[data-testid="logo-client-rapport"]'),
      ).not.toBeNull();
      expect(screen.queryByTestId('document-evenement-cumul')).toBeNull();
      expect(screen.queryByTestId('document-collecte')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_introuvable — 404 : message, pas d’erreur',
    async () => {
      stubFetch(() => ({
        status: 404,
        body: { error: 'Événement non trouvé' },
      }));
      monterFiche();
      await screen.findByText('Événement introuvable', undefined, ATTENTE_UI);
      expect(screen.queryByTestId('evenement-erreur')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_erreur — 500 : état Error avec « Réessayer », qui relance le chargement',
    async () => {
      let appels = 0;
      stubFetch(() => {
        appels += 1;
        return appels === 1
          ? { status: 500, body: {} }
          : { body: { data: detail() } };
      });
      monterFiche();
      await screen.findByTestId('evenement-erreur', undefined, ATTENTE_UI);
      fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
      await ficheChargee();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_rouverte_et_rechargee — fiche collecte rouverte par-dessus ; sa fermeture recharge l’événement',
    async () => {
      const fetchMock = stubFetch(() => ({ body: { data: detail() } }));
      monterFiche({ collecteInitiale: 'c2' });
      await ficheChargee();
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2',
      );
      const avant = fetchMock.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      expect(screen.queryByTestId('fiche-collecte-ouverte')).toBeNull();
      expect(changerCollecte).toHaveBeenLastCalledWith(null);
      // Rechargement sans retour au squelette : la fiche reste à l'écran.
      expect(screen.getByTestId('statut-evenement')).toBeInTheDocument();
      await waitFor(
        () => expect(fetchMock.mock.calls.length).toBeGreaterThan(avant),
        ATTENTE_UI,
      );
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        `/api/v1/evenements/${EVT_ID}`,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_pax_absent_et_singulier — ratios par pax « — » sans convives sur les collectes réalisées, même avec un pax d’événement ; phrases au singulier',
    async () => {
      const d = detail();
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            // Le pax de l'événement n'entre plus dans le ratio (Val 2026-10-27).
            pax: 800,
            bilan: {
              ...d.bilan,
              convives_zd: null,
              pesee_par_pax_kg: null,
              nb_collectes_zd: 1,
              nb_collectes_ag: 0,
              nb_realisees_zd: 1,
              nb_realisees_ag: 0,
            },
            fiches: [d.fiches[0]],
          },
        },
      }));
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      const zd = await screen.findByTestId(
        'bilan-consolide-zd',
        undefined,
        ATTENTE_UI,
      );
      expect(zd).toHaveTextContent(/Pesée par pax\s*—/);
      // Un seul type : pas d'en-tête de type, le bilan se lit comme celui d'une
      // collecte.
      expect(zd).not.toHaveTextContent('réalisée sur');
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Cumul de 1 collecte réalisée, sur 1 collecte de l’événement.',
      );
      // Une seule collecte ZD : aucun lien vers son bilan.
      expect(within(zd).queryByTestId('liens-bilans')).toBeNull();
      cleanup();

      // Une seule collecte, pas encore réalisée : « la collecte ».
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            bilan: {
              ...d.bilan,
              nb_collectes_zd: 1,
              nb_collectes_ag: 0,
              nb_realisees_zd: 0,
              nb_realisees_ag: 0,
              tonnage_zd_kg: null,
            },
            fiches: [ficheCollecte({ statut: 'validee' })],
          },
        },
      }));
      monterFiche();
      await ficheChargee();
      onglet('Bilan & documents');
      expect(
        await screen.findByTestId(
          'bilan-consolide-couverture',
          undefined,
          ATTENTE_UI,
        ),
      ).toHaveTextContent(
        'Aucun résultat n’est encore disponible sur la collecte de l’événement.',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_rechargement_en_echec_garde_le_bilan — après la fiche collecte, une panne ne masque pas la fiche affichée',
    async () => {
      let appels = 0;
      stubFetch(() => {
        appels += 1;
        return appels === 1
          ? { body: { data: detail() } }
          : { status: 500, body: {} };
      });
      // Sous ToastProvider (monté par app/layout.tsx en vrai) : le message
      // doit s'afficher.
      renderAvecToasts(
        <FicheEvenementModal
          espace="gestionnaire"
          evenementId={EVT_ID}
          onClose={fermerEvenement}
          onCollecteChange={changerCollecte}
          collecteInitiale="c2"
        />,
      );
      await ficheChargee();
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      await waitFor(() => expect(appels).toBe(2), ATTENTE_UI);
      expect(
        await screen.findByText('Fiche non actualisée', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('evenement-erreur')).toBeNull();
      expect(screen.getByTestId('evenement-entete')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_echap_ferme_d_abord_la_fiche_collecte — la fiche événement reste ouverte tant que la fiche collecte l’est',
    async () => {
      stubFetch(() => ({ body: { data: detail() } }));
      monterFiche({ collecteInitiale: 'c1' });
      await ficheChargee();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(fermerEvenement).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(fermerEvenement).toHaveBeenCalledTimes(1);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_identifiant_invalide_sans_requete — adresse saisie à la main : « introuvable », aucun appel',
    async () => {
      const fetchMock = stubFetch(() => ({ body: { data: detail() } }));
      monterFiche({ evenementId: 'pas-un-uuid' });
      await screen.findByText('Événement introuvable', undefined, ATTENTE_UI);
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche Événement traiteur et agence — écran', () => {
  it(
    'M3.2/evenement_fiche_traiteur_sans_labo — même fiche, radar compris (Val 2026-10-30), sans déchets labo estimés, rapports de collecte par la route de son espace (Val 2026-10-29)',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.includes(`/api/v1/evenements/${EVT_ID}`) &&
        !url.includes('/benchmark')
          ? { body: { data: detail({ dechets_labo_kg: null }) } }
          : { body: { data: null } },
      );
      monterFiche({ espace: 'traiteur' });
      await ficheChargee();
      expect(screen.getByTestId('evenement-entete')).not.toHaveTextContent(
        'Déchets labo estimés',
      );
      onglet('Bilan & documents');
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      // Radar : la route commune des événements, jamais celle du gestionnaire.
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some(([u]) =>
              String(u).startsWith(`/api/v1/evenements/${EVT_ID}/benchmark`),
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
      expect(urls.some((u) => u.includes('/gestionnaire/'))).toBe(false);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche Événement Admin et client organisateur — écran', () => {
  const legere = (f: Record<string, unknown>) => ({
    ...f,
    contacts_visibles: false,
    contact_principal_nom: null,
    contact_principal_telephone: null,
    tournees: [],
  });
  it(
    'M3.2/evenement_fiche_admin_ouvre_fiche_collecte_admin — cartes sans contacts ni chauffeurs, « Voir la collecte » ouvre la fiche collecte Admin (Val C6)',
    async () => {
      const d = detail({ dechets_labo_kg: null });
      const fiches = (d.fiches as Record<string, unknown>[]).map((f) => ({
        ...legere(f),
        // Contacts visibles dans la donnée : c'est `detail` qui doit les masquer.
        contacts_visibles: true,
        contact_principal_nom: 'Contact Test',
      }));
      const premier = String((fiches[0] as Record<string, unknown>).id);
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            fiches,
            statuts_admin: { [premier]: 'rejetee_par_prestataire' },
          },
        },
      }));
      monterFiche({ espace: 'admin' });
      await ficheChargee();
      onglet('Informations collectes');
      const cartes = await screen.findAllByTestId(
        'carte-collecte',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('bloc-logistique')).toBeNull();
      expect(cartes[0]).not.toHaveTextContent('Contact principal');
      // Statut en vue Admin : « Rejetée », jamais le « Créée » des clients.
      expect(cartes[0]).toHaveTextContent('Rejetée');
      fireEvent.click(
        within(cartes[0]!).getByRole('button', { name: 'Voir la collecte' }),
      );
      expect(
        await screen.findByTestId(
          'fiche-collecte-admin-ouverte',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('fiche-collecte-ouverte')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_organisateur_lecture_seule — cartes sans contacts ni chauffeurs ni « Voir la collecte », pas de documents par collecte ni de rapport de don cumulé (Val C7)',
    async () => {
      const d = detail({ dechets_labo_kg: null });
      stubFetch(() => ({
        body: { data: { ...d, fiches: d.fiches.map(legere) } },
      }));
      monterFiche({ espace: 'organisateur' });
      await ficheChargee();
      onglet('Informations collectes');
      await screen.findAllByTestId('carte-collecte', undefined, ATTENTE_UI);
      expect(
        screen.queryByRole('button', { name: 'Voir la collecte' }),
      ).toBeNull();
      expect(screen.queryByTestId('bloc-logistique')).toBeNull();
      onglet('Bilan & documents');
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
      expect(screen.queryByTestId('document-collecte')).toBeNull();
      expect(screen.queryByTestId('liens-bilans')).toBeNull();
      // Rapport RSE cumulé proposé, rapport de don cumulé non (onglet AG).
      expect(
        screen.getByTestId('document-evenement-cumul'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: 'Anti-Gaspi' }));
      await waitFor(
        () =>
          expect(screen.queryByTestId('document-evenement-cumul')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / liste Événements gestionnaire — fiche en pop-up depuis l’adresse', () => {
  it(
    'M3.2/evenements_liste_fiche_rouverte_depuis_adresse — ?evenement= et ?collecte= rouvrent les deux fiches ; la fermeture nettoie l’adresse et recharge la liste',
    async () => {
      adresse = new URLSearchParams(`evenement=${EVT_ID}&collecte=c2`);
      window.history.replaceState(
        null,
        '',
        `/gestionnaire/evenements?evenement=${EVT_ID}&collecte=c2`,
      );
      const fetchMock = stubFetch((url) =>
        url.includes('/evenements/filtres')
          ? { body: OPTIONS }
          : url.includes(`/api/v1/evenements/${EVT_ID}`)
            ? { body: { data: detail() } }
            : { body: { data: [LIGNE], total: 1 } },
      );
      render(<EvenementsPage />);
      await ficheChargee();
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      expect(window.location.search).not.toContain('collecte=');
      expect(window.location.search).toContain(`evenement=${EVT_ID}`);

      const listes = () =>
        fetchMock.mock.calls.filter(([u]) =>
          String(u).includes('/api/v1/evenements?'),
        ).length;
      const avant = listes();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('statut-evenement')).toBeNull();
      expect(window.location.search).not.toContain('evenement=');
      await waitFor(() => expect(listes()).toBeGreaterThan(avant), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});
