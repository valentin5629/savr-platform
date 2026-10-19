/**
 * M3.2 — écrans Événements du gestionnaire de lieux (§06.05 §2), remis par Val
 * le 2026-10-18 : liste des événements de ses lieux, et fiche événement au
 * bilan CONSOLIDÉ sur toutes ses collectes — en pop-up sur la liste depuis le
 * 2026-10-19 (« en modale comme les pages collectes »).
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

import EvenementsPage from '@/app/(gestionnaire)/gestionnaire/evenements/page.js';
import { FicheEvenementModal } from '@/components/gestionnaire/fiche-evenement-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const EVT_ID = '22222222-2222-4222-8222-222222222222';

const fermerEvenement = vi.fn();
const changerCollecte = vi.fn();
/** Monte la fiche événement en pop-up, comme la liste le fait au clic. */
const monterFiche = (
  props: Partial<Parameters<typeof FicheEvenementModal>[0]> = {},
) =>
  render(
    <FicheEvenementModal
      evenementId={EVT_ID}
      onClose={fermerEvenement}
      onCollecteChange={changerCollecte}
      {...props}
    />,
  );
/** Onglet de la fiche (Radix s'active au `mousedown`). */
const onglet = (nom: RegExp | string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name: nom }));

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
      flux_kg: { ...FLUX_VIDES, biodechet: 600, carton: 300, verre: 100 },
      taux_recyclage: 74,
      co2_net_zd_kg: 65,
      co2_evite_zd_kg: 100,
      repas_donnes: 230,
      co2_evite_ag_kg: 575,
      associations: [
        { id: 'a1', nom: 'Restos du Cœur', ville: 'Paris', repas: 150 },
        { id: 'a2', nom: 'Linkee', ville: null, repas: 80 },
      ],
      premiere_collecte: '2026-09-10',
      derniere_collecte: '2026-09-12',
      statut_consolide: 'Terminé',
    },
    collectes: [
      {
        id: 'c1',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-10',
        heure_collecte: '23:00:00',
        poids_total_kg: 900,
        taux_recyclage: 80,
        co2_evite_kg: 90,
        nb_repas_donnes: null,
      },
      {
        id: 'c2',
        type: 'zero_dechet',
        statut: 'cloturee',
        date_collecte: '2026-09-11',
        heure_collecte: null,
        poids_total_kg: 100,
        taux_recyclage: 20,
        co2_evite_kg: 10,
        nb_repas_donnes: null,
      },
      {
        id: 'c3',
        type: 'anti_gaspi',
        statut: 'cloturee',
        date_collecte: '2026-09-12',
        heure_collecte: null,
        poids_total_kg: null,
        taux_recyclage: null,
        co2_evite_kg: 575,
        nb_repas_donnes: 230,
      },
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
        url.includes('/gestionnaire/filtres')
          ? { body: OPTIONS }
          : url.includes(`/gestionnaire/evenements/${EVT_ID}`)
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
        'bilan-consolide',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.getByTestId('evenements-table')).toBeInTheDocument();
      expect(window.location.search).toContain(`evenement=${EVT_ID}`);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenements_liste_type_collecte_transmis — le segmenté ZD / AG filtre la route',
    async () => {
      const fetchMock = stubFetch((url) =>
        url.includes('/gestionnaire/filtres')
          ? { body: OPTIONS }
          : { body: { data: [LIGNE], total: 1 } },
      );
      render(<EvenementsPage />);
      await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
      fireEvent.click(screen.getByRole('radio', { name: /anti-gaspi/i }));
      await screen.findByTestId('evenements-table', undefined, ATTENTE_UI);
      const appels = fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes('/gestionnaire/evenements?'));
      expect(appels.at(-1)).toContain('type=anti_gaspi');
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
        url.includes('/gestionnaire/filtres')
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
        url.includes('/gestionnaire/filtres')
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
        .filter((u) => u.includes('/gestionnaire/evenements?'));
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
        url.includes('/gestionnaire/filtres')
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
        url.includes('/gestionnaire/filtres')
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
      const bilan = await screen.findByTestId(
        'bilan-consolide',
        undefined,
        ATTENTE_UI,
      );
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Cumul des 3 collectes réalisées, sur 3 collectes de l’événement.',
      );
      const zd = within(bilan).getByTestId('bilan-consolide-zd');
      expect(zd).toHaveTextContent('2 réalisées sur 2');
      expect(zd).toHaveTextContent(/Poids total collecté\s*1\s000\s*kg/);
      expect(zd).toHaveTextContent(/Taux de recyclage.*74,0\s*%/);
      // 1 000 kg pour 800 pax.
      expect(zd).toHaveTextContent(/Pesée par pax\s*1\s250\s*g/);
      expect(zd).toHaveTextContent(/CO₂ évité \(net\)\s*65/);
      // Donut de répartition des flux, sur le cumul de l'événement.
      expect(zd).toHaveTextContent('Répartition des tonnages');
      expect(zd).toHaveTextContent(/Biodéchets\s*600\s*kg/);
      expect(zd).toHaveTextContent(/Verre\s*100\s*kg/);
      const ag = within(bilan).getByTestId('bilan-consolide-ag');
      expect(ag).toHaveTextContent(/Repas donnés\s*230\s*repas/);
      expect(ag).toHaveTextContent(/Repas par pax\s*0,29/);
      expect(ag).toHaveTextContent(/CO₂ évité\s*575/);
      const assos = within(ag).getByTestId('associations-beneficiaires');
      expect(assos).toHaveTextContent('Restos du Cœur · Paris150 repas');
      expect(assos).toHaveTextContent('Linkee80 repas');

      // En-tête : statut consolidé, client, estimation labo, période.
      expect(screen.getByTestId('statut-consolide')).toHaveTextContent(
        'Terminé',
      );
      // En-tête de la pop-up : nom, date, lieu, traiteur, pax.
      expect(screen.getByTestId('fiche-evenement-infos')).toHaveTextContent(
        /Paris Expo.*Kaspia.*800\s*pax/,
      );
      onglet('Informations');
      const entete = await screen.findByTestId(
        'evenement-entete',
        undefined,
        ATTENTE_UI,
      );
      expect(entete).toHaveTextContent('Maison Lenôtre');
      expect(entete).toHaveTextContent('Cocktail repas complet');
      expect(entete).toHaveTextContent(/Déchets labo estimés\s*42\s*kg/);
      expect(entete).toHaveTextContent('→');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_collectes_ouvrent_la_fiche_collecte — clic ligne, picto rapport ZD sur « Bilan »',
    async () => {
      stubFetch(() => ({ body: { data: detail() } }));
      monterFiche();
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
      onglet('Collectes (3)');
      const table = await screen.findByTestId(
        'evenement-collectes',
        undefined,
        ATTENTE_UI,
      );
      const lignes = within(table).getAllByRole('row').slice(1);
      expect(lignes).toHaveLength(3);

      fireEvent.click(lignes[2]!);
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c3',
      );
      expect(changerCollecte).toHaveBeenLastCalledWith('c3');

      fireEvent.click(
        within(lignes[0]!).getByRole('button', {
          name: 'Télécharger le rapport de la collecte',
        }),
      );
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c1:bilan',
      );
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
              co2_net_zd_kg: null,
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
      await screen.findByTestId('bandeau-bilan-attente', undefined, ATTENTE_UI);
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Aucun résultat n’est encore disponible sur les 3 collectes de l’événement.',
      );
      expect(screen.getByTestId('bilan-consolide-zd')).toHaveTextContent(
        /Poids total collecté\s*—/,
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
            collectes: [],
          },
        },
      }));
      monterFiche();
      expect(
        await screen.findByTestId(
          'bilan-consolide-couverture',
          undefined,
          ATTENTE_UI,
        ),
      ).toHaveTextContent('Aucune collecte n’est rattachée à cet événement.');
      expect(screen.queryByTestId('bandeau-bilan-attente')).toBeNull();
      onglet('Informations');
      expect(
        await screen.findByTestId('evenement-entete', undefined, ATTENTE_UI),
      ).toHaveTextContent(/Déchets labo estimés\s*—/);
      onglet('Collectes');
      expect(
        await screen.findByText(
          'Aucune collecte rattachée à cet événement.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
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
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_rouverte_et_rechargee — fiche collecte rouverte par-dessus ; sa fermeture recharge l’événement',
    async () => {
      const fetchMock = stubFetch(() => ({ body: { data: detail() } }));
      monterFiche({ collecteInitiale: 'c2' });
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2',
      );
      const avant = fetchMock.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      expect(screen.queryByTestId('fiche-collecte-ouverte')).toBeNull();
      expect(changerCollecte).toHaveBeenLastCalledWith(null);
      // Rechargement sans retour au squelette : le bilan reste à l'écran.
      expect(screen.getByTestId('bilan-consolide')).toBeInTheDocument();
      await waitFor(
        () => expect(fetchMock.mock.calls.length).toBeGreaterThan(avant),
        ATTENTE_UI,
      );
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
        `/api/v1/gestionnaire/evenements/${EVT_ID}`,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/evenement_fiche_pax_absent_et_singulier — ratios par pax « — » sans pax ; phrases au singulier',
    async () => {
      const d = detail();
      stubFetch(() => ({
        body: {
          data: {
            ...d,
            pax: null,
            bilan: {
              ...d.bilan,
              nb_collectes_zd: 1,
              nb_collectes_ag: 0,
              nb_realisees_zd: 1,
              nb_realisees_ag: 0,
            },
            collectes: [d.collectes[0]],
          },
        },
      }));
      monterFiche();
      const zd = await screen.findByTestId(
        'bilan-consolide-zd',
        undefined,
        ATTENTE_UI,
      );
      expect(zd).toHaveTextContent(/Pesée par pax\s*—/);
      expect(
        screen.getByTestId('bilan-consolide-couverture'),
      ).toHaveTextContent(
        'Cumul de 1 collecte réalisée, sur 1 collecte de l’événement.',
      );
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
            collectes: [{ ...d.collectes[0], statut: 'validee' }],
          },
        },
      }));
      monterFiche();
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
    'M3.2/evenement_fiche_echap_ferme_d_abord_la_fiche_collecte — la fiche événement reste ouverte tant que la fiche collecte l’est',
    async () => {
      stubFetch(() => ({ body: { data: detail() } }));
      monterFiche({ collecteInitiale: 'c1' });
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
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
        url.includes('/gestionnaire/filtres')
          ? { body: OPTIONS }
          : url.includes(`/gestionnaire/evenements/${EVT_ID}`)
            ? { body: { data: detail() } }
            : { body: { data: [LIGNE], total: 1 } },
      );
      render(<EvenementsPage />);
      await screen.findByTestId('bilan-consolide', undefined, ATTENTE_UI);
      expect(screen.getByTestId('fiche-collecte-ouverte')).toHaveTextContent(
        'c2',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
      expect(window.location.search).not.toContain('collecte=');
      expect(window.location.search).toContain(`evenement=${EVT_ID}`);

      const listes = () =>
        fetchMock.mock.calls.filter(([u]) =>
          String(u).includes('/gestionnaire/evenements?'),
        ).length;
      const avant = listes();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('bilan-consolide')).toBeNull();
      expect(window.location.search).not.toContain('evenement=');
      await waitFor(() => expect(listes()).toBeGreaterThan(avant), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});
