/**
 * M1.2 — page de confirmation de la programmation (§06.01, actions
 * post-confirmation, point 13).
 *
 * Décision Val 2026-10-16 : le récapitulatif quitte l'étape 3 du formulaire et
 * s'affiche ici, avec un bouton « Modifier » qui ouvre la fiche de la collecte
 * en édition dans l'espace du rôle.
 *
 * Refonte du formulaire, lot B2 (décisions Val 2026-10-22, C6–C7) : en-tête
 * « Votre événement « … » est programmé », récapitulatif de l'événement (client
 * final et référence interne s'ils sont renseignés, lieu, contrôle d'accès,
 * collectes par type non annulées), « Nous réaliserons N collectes » avec une
 * carte par collecte (date et heure, convives, type d'événement, contacts,
 * informations supplémentaires, statut, « Modifier », « Annuler la collecte »),
 * puis « Ajouter une collecte », « Programmer un autre événement », « Accueil ».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const etat = vi.hoisted(() => ({ role: 'traiteur_manager' as string }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=evt-1'),
}));
vi.mock('@/lib/use-user-role', () => ({ useUserRole: () => etat.role }));

import ConfirmationProgrammationPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const CONTACTS_ZD = {
  contact_principal_nom: 'Paul Arnaud',
  contact_principal_telephone: '06 12 34 56 78',
  contact_secours_nom: 'Léa Martin',
  contact_secours_telephone: '07 98 76 54 32',
};

const ZD = {
  id: 'col-zd',
  type: 'zero_dechet',
  statut: 'programmee',
  date_collecte: '2030-01-15',
  heure_collecte: '08:30:00',
  // Pax de la collecte (décision Val 2026-10-20) : c'est lui qu'affiche la
  // carte, jamais celui de l'événement.
  pax: 1000,
  type_evenement: 'Cocktail apéritif',
  contacts: CONTACTS_ZD,
  informations_supplementaires: 'Sonner interphone B au RDC',
  created_at: '2029-12-01T10:00:00Z',
};
const AG = {
  id: 'col-ag',
  type: 'anti_gaspi',
  statut: 'programmee',
  date_collecte: '2030-01-16',
  heure_collecte: '23:00:00',
  pax: 400,
  type_evenement: 'Repas assis',
  contacts: {
    contact_principal_nom: 'Nina Roux',
    contact_principal_telephone: '06 00 00 00 01',
    contact_secours_nom: null,
    contact_secours_telephone: null,
  },
  informations_supplementaires: null,
  created_at: '2029-12-01T10:00:00Z',
};

const EVENEMENT = {
  id: 'evt-1',
  nom_evenement: 'Gala',
  nom_client_organisateur: 'Maison Dupont',
  reference_affaire: 'AFF-42',
  controle_acces_requis: true,
  pax: 1000,
  lieux: {
    nom: 'Salle A',
    adresse_acces: '1 rue Test',
    code_postal: '75012',
    ville: 'Paris',
  },
  collectes: [ZD],
  email_recap: 'envoye',
};

const ROUTE_EVENEMENT = '/api/v1/programmation/evenements/evt-1';

/**
 * Serveur simulé : chaque lecture de l'événement rend la réponse suivante de
 * `lectures` (la dernière se répète) ; un POST rend `annulation`.
 */
function serveur(
  lectures: unknown[],
  annulation: { ok: boolean; corps: unknown } = {
    ok: true,
    corps: { data: { statut: 'annulee' } },
  },
) {
  let n = 0;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve({
        ok: annulation.ok,
        json: () => Promise.resolve(annulation.corps),
      } as Response);
    const corps = lectures[Math.min(n++, lectures.length - 1)];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(corps),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function afficher(corps: unknown, role = 'traiteur_manager') {
  etat.role = role;
  const fetchMock = serveur([corps]);
  render(<ConfirmationProgrammationPage />);
  await screen.findByRole(
    'heading',
    { level: 1, name: /est programmé/ },
    ATTENTE_UI,
  );
  return fetchMock;
}

/** Valeur affichée sous un libellé (`<dt>` → `<dd>`), dans un conteneur. */
function valeurDans(conteneur: HTMLElement, libelle: string): HTMLElement {
  const dt = within(conteneur).getByText(libelle, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

/** Valeur du récapitulatif de l'événement. */
function valeur(libelle: string): HTMLElement {
  return valeurDans(document.body, libelle);
}

/** Carte d'une collecte, par son libellé (« Collecte Zéro Déchet #1 »). */
const carte = (libelle: string) =>
  screen.getByRole('region', { name: libelle });

afterEach(() => vi.unstubAllGlobals());

describe('M1.2 / formulaire_simplifie — récapitulatif de l’écran de confirmation', () => {
  it(
    'affiche client, lieu, convives, date et heure, contacts principal et de secours avec leur téléphone',
    async () => {
      await afficher(EVENEMENT);

      expect(valeur('Client final')).toHaveTextContent('Maison Dupont');
      expect(valeur('Lieu')).toHaveTextContent(
        'Salle A — 1 rue Test, 75012 Paris',
      );
      const zd = carte('Collecte Zéro Déchet #1');
      expect(valeurDans(zd, 'Convives')).toHaveTextContent('1000');
      expect(valeurDans(zd, 'Date et heure')).toHaveTextContent(
        '15 janvier 2030 à 08:30',
      );
      const principal = valeurDans(zd, 'Contact principal');
      expect(principal).toHaveTextContent('Paul Arnaud');
      expect(
        within(principal).getByRole('link', { name: '06 12 34 56 78' }),
      ).toHaveAttribute('href', 'tel:0612345678');
      const secours = valeurDans(zd, 'Contact de secours');
      expect(secours).toHaveTextContent('Léa Martin');
      expect(
        within(secours).getByRole('link', { name: '07 98 76 54 32' }),
      ).toHaveAttribute('href', 'tel:0798765432');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sans contact de secours : la ligne est omise, jamais un nom vide',
    async () => {
      await afficher({
        ...EVENEMENT,
        collectes: [
          {
            ...ZD,
            contacts: {
              ...CONTACTS_ZD,
              contact_secours_nom: null,
              contact_secours_telephone: '  ',
            },
          },
        ],
      });

      const zd = carte('Collecte Zéro Déchet #1');
      expect(
        within(zd).queryByText('Contact de secours', { selector: 'dt' }),
      ).toBeNull();
      // Le contact principal reste affiché.
      expect(valeurDans(zd, 'Contact principal')).toHaveTextContent(
        'Paul Arnaud',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes : une date et heure par type de collecte',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      expect(
        valeurDans(carte('Collecte Zéro Déchet #1'), 'Date et heure'),
      ).toHaveTextContent('15 janvier 2030 à 08:30');
      expect(
        valeurDans(carte('Collecte Anti-Gaspi #1'), 'Date et heure'),
      ).toHaveTextContent('16 janvier 2030 à 23:00');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / refonte_formulaire — page de confirmation : en-tête et récapitulatif de l’événement', () => {
  it(
    'en-tête « Votre événement « Gala » est programmé »',
    async () => {
      await afficher(EVENEMENT);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Votre événement « Gala » est programmé',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'récapitulatif : client final, référence interne, lieu, contrôle d’accès, collectes par type',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      expect(valeur('Client final')).toHaveTextContent('Maison Dupont');
      expect(valeur('Référence interne')).toHaveTextContent('AFF-42');
      expect(valeur('Lieu')).toHaveTextContent(
        'Salle A — 1 rue Test, 75012 Paris',
      );
      expect(valeur('Contrôle d’accès')).toHaveTextContent(
        'Plaque et nom du chauffeur requis',
      );
      const parType = valeur('Collectes');
      expect(parType).toHaveTextContent('Zéro Déchet : 1');
      expect(parType).toHaveTextContent('Anti-Gaspi : 1');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'client final et référence interne non renseignés : omis du récapitulatif',
    async () => {
      await afficher({
        ...EVENEMENT,
        nom_client_organisateur: null,
        reference_affaire: '   ',
      });

      expect(screen.queryByText('Client final', { selector: 'dt' })).toBeNull();
      expect(
        screen.queryByText('Référence interne', { selector: 'dt' }),
      ).toBeNull();
      // Le reste du récapitulatif est rendu.
      expect(valeur('Lieu')).toHaveTextContent('Salle A');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'contrôle d’accès non exigé : « Non requis »',
    async () => {
      await afficher({ ...EVENEMENT, controle_acces_requis: false });

      expect(valeur('Contrôle d’accès')).toHaveTextContent('Non requis');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte annulée : ni comptée par type, ni dans « Nous réaliserons », mais sa carte reste avec son numéro',
    async () => {
      await afficher({
        ...EVENEMENT,
        collectes: [
          ZD,
          {
            ...ZD,
            id: 'col-zd-2',
            date_collecte: '2030-01-16',
            statut: 'annulee',
          },
          AG,
        ],
      });

      const parType = valeur('Collectes');
      expect(parType).toHaveTextContent('Zéro Déchet : 1');
      expect(parType).toHaveTextContent('Anti-Gaspi : 1');
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Nous réaliserons 2 collectes',
        }),
      ).toBeInTheDocument();
      expect(
        within(carte('Collecte Zéro Déchet #2')).getByText('Annulée'),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

// Pax porté par la collecte (décision Val 2026-10-20) : l'écran de fin montre
// celui de chaque collecte, pas celui de l'événement (calculé).
describe('M1.2/pax_par_collecte — écran de confirmation : convives', () => {
  it(
    'une collecte : son pax, pas celui de l’événement',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [{ ...ZD, pax: 650 }] });
      const convives = valeurDans(carte('Collecte Zéro Déchet #1'), 'Convives');
      expect(convives).toHaveTextContent('650');
      expect(convives).not.toHaveTextContent('1000');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes : un pax par type de collecte',
    async () => {
      await afficher({
        ...EVENEMENT,
        collectes: [
          { ...ZD, pax: 700 },
          { ...AG, pax: 400 },
        ],
      });
      expect(
        valeurDans(carte('Collecte Zéro Déchet #1'), 'Convives'),
      ).toHaveTextContent('700');
      expect(
        valeurDans(carte('Collecte Anti-Gaspi #1'), 'Convives'),
      ).toHaveTextContent('400');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes du même type : chacune sa carte numérotée, avec sa date et son pax',
    async () => {
      await afficher({
        ...EVENEMENT,
        collectes: [
          // Créée en second mais plus tôt : la numérotation suit la date.
          {
            ...ZD,
            id: 'col-zd-2',
            date_collecte: '2030-01-16',
            heure_collecte: '22:00:00',
            pax: 500,
          },
          { ...ZD, pax: 700 },
        ],
      });
      const premiere = carte('Collecte Zéro Déchet #1');
      expect(valeurDans(premiere, 'Date et heure')).toHaveTextContent(
        '15 janvier 2030 à 08:30',
      );
      expect(valeurDans(premiere, 'Convives')).toHaveTextContent('700');
      const seconde = carte('Collecte Zéro Déchet #2');
      expect(valeurDans(seconde, 'Date et heure')).toHaveTextContent(
        '16 janvier 2030 à 22:00',
      );
      expect(valeurDans(seconde, 'Convives')).toHaveTextContent('500');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / refonte_formulaire — page de confirmation : une carte par collecte', () => {
  it(
    'une collecte : « Nous réaliserons 1 collecte », au singulier',
    async () => {
      await afficher(EVENEMENT);

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Nous réaliserons 1 collecte',
        }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'trois collectes : « Nous réaliserons 3 collectes », une carte chacune, Zéro Déchet puis Anti-Gaspi',
    async () => {
      await afficher({
        ...EVENEMENT,
        collectes: [
          AG,
          ZD,
          { ...ZD, id: 'col-zd-2', date_collecte: '2030-01-17' },
        ],
      });

      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Nous réaliserons 3 collectes',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
      ).toEqual([
        'Collecte Zéro Déchet #1',
        'Collecte Zéro Déchet #2',
        'Collecte Anti-Gaspi #1',
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'carte : date et heure, convives, type d’événement, contacts avec téléphone, informations supplémentaires, statut',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      const zd = carte('Collecte Zéro Déchet #1');
      expect(valeurDans(zd, 'Date et heure')).toHaveTextContent(
        '15 janvier 2030 à 08:30',
      );
      expect(valeurDans(zd, 'Convives')).toHaveTextContent('1000');
      expect(valeurDans(zd, 'Type d’événement')).toHaveTextContent(
        'Cocktail apéritif',
      );
      expect(valeurDans(zd, 'Contact principal')).toHaveTextContent(
        'Paul Arnaud',
      );
      expect(valeurDans(zd, 'Contact de secours')).toHaveTextContent(
        'Léa Martin',
      );
      expect(valeurDans(zd, 'Informations supplémentaires')).toHaveTextContent(
        'Sonner interphone B au RDC',
      );
      // Badge client d'une collecte `programmee`.
      expect(within(zd).getByText('Créée')).toBeInTheDocument();

      // Chaque carte porte SES contacts et SON type d'événement.
      const ag = carte('Collecte Anti-Gaspi #1');
      expect(valeurDans(ag, 'Type d’événement')).toHaveTextContent(
        'Repas assis',
      );
      const principalAg = valeurDans(ag, 'Contact principal');
      expect(principalAg).toHaveTextContent('Nina Roux');
      expect(
        within(principalAg).getByRole('link', { name: '06 00 00 00 01' }),
      ).toHaveAttribute('href', 'tel:0600000001');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'informations supplémentaires non renseignées : omises',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      expect(
        within(carte('Collecte Anti-Gaspi #1')).queryByText(
          'Informations supplémentaires',
          { selector: 'dt' },
        ),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / formulaire_simplifie — bouton « Modifier »', () => {
  it.each([
    ['traiteur_manager', '/traiteur/collectes?collecte=col-zd&edit=1'],
    ['traiteur_commercial', '/traiteur/collectes?collecte=col-zd&edit=1'],
    ['agence', '/agence/collectes?collecte=col-zd&edit=1'],
    ['gestionnaire_lieux', '/gestionnaire/collectes?collecte=col-zd&edit=1'],
    ['admin_savr', '/admin/collectes/col-zd'],
    ['ops_savr', '/admin/collectes/col-zd'],
  ])(
    '%s → ouvre la fiche de la collecte en édition (%s)',
    async (role, href) => {
      await afficher(EVENEMENT, role);

      expect(screen.getByRole('link', { name: 'Modifier' })).toHaveAttribute(
        'href',
        href,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes : un bouton par collecte',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      expect(
        within(carte('Collecte Zéro Déchet #1')).getByRole('link', {
          name: 'Modifier',
        }),
      ).toHaveAttribute('href', '/traiteur/collectes?collecte=col-zd&edit=1');
      expect(
        within(carte('Collecte Anti-Gaspi #1')).getByRole('link', {
          name: 'Modifier',
        }),
      ).toHaveAttribute('href', '/traiteur/collectes?collecte=col-ag&edit=1');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rôle inconnu (session illisible) : pas de bouton plutôt qu’un lien cassé',
    async () => {
      await afficher(EVENEMENT, '');

      expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Annuler la collecte' }),
      ).toBeNull();
      // Le reste de l'écran est rendu.
      expect(valeur('Client final')).toHaveTextContent('Maison Dupont');
    },
    ATTENTE_CAS_MS,
  );

  it.each(['annulee', 'annulation_demandee', 'en_cours', 'cloturee'])(
    'collecte au statut %s : pas de bouton « Modifier » (comme la fiche collecte)',
    async (statut) => {
      await afficher({ ...EVENEMENT, collectes: [{ ...ZD, statut }] });

      expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / refonte_formulaire — page de confirmation : « Annuler la collecte »', () => {
  it.each([
    ['traiteur_manager', '/api/v1/traiteur/collectes/col-zd/annulation'],
    ['traiteur_commercial', '/api/v1/traiteur/collectes/col-zd/annulation'],
    ['agence', '/api/v1/agence/collectes/col-zd/annulation'],
  ])(
    '%s : la boîte d’annulation s’ouvre, l’annulation part sur %s, puis la carte et le compte sont relus',
    async (role, route) => {
      etat.role = role;
      const fetchMock = serveur([
        { ...EVENEMENT, collectes: [ZD, AG] },
        { ...EVENEMENT, collectes: [{ ...ZD, statut: 'annulee' }, AG] },
      ]);
      render(<ConfirmationProgrammationPage />);
      await screen.findByRole(
        'heading',
        { level: 2, name: 'Nous réaliserons 2 collectes' },
        ATTENTE_UI,
      );

      fireEvent.click(
        within(carte('Collecte Zéro Déchet #1')).getByRole('button', {
          name: 'Annuler la collecte',
        }),
      );
      const boite = screen.getByRole('dialog', {
        name: 'Annuler la collecte',
      });
      fireEvent.change(within(boite).getByLabelText('Motif (facultatif)'), {
        target: { value: 'Événement reporté' },
      });
      fireEvent.click(
        within(boite).getByRole('button', { name: 'Confirmer l’annulation' }),
      );

      // Carte relue : statut « Annulée », plus de bouton, compte mis à jour.
      await waitFor(
        () =>
          expect(
            within(carte('Collecte Zéro Déchet #1')).getByText('Annulée'),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'POST',
      );
      expect(post?.[0]).toBe(route);
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        motif: 'Événement reporté',
      });
      expect(
        fetchMock.mock.calls.filter(([url]) => url === ROUTE_EVENEMENT),
      ).toHaveLength(2);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(
        within(carte('Collecte Zéro Déchet #1')).queryByRole('button', {
          name: 'Annuler la collecte',
        }),
      ).toBeNull();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Nous réaliserons 1 collecte',
        }),
      ).toBeInTheDocument();
      expect(valeur('Collectes')).not.toHaveTextContent('Zéro Déchet');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte validée : demande d’annulation, transmise à l’équipe Savr',
    async () => {
      const fetchMock = await afficher({
        ...EVENEMENT,
        collectes: [{ ...ZD, statut: 'validee' }],
      });

      fireEvent.click(
        screen.getByRole('button', { name: 'Demander l’annulation' }),
      );
      const boite = screen.getByRole('dialog', {
        name: 'Demander l’annulation',
      });
      expect(
        within(boite).getByText(
          'Votre demande d’annulation sera transmise à l’équipe Savr pour validation.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(
        within(boite).getByRole('button', { name: 'Confirmer la demande' }),
      );

      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.find(
              ([, init]) => init?.method === 'POST',
            )?.[0],
          ).toBe('/api/v1/traiteur/collectes/col-zd/annulation'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte Anti-Gaspi : la boîte rappelle que le crédit est préservé',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [AG] });

      fireEvent.click(
        screen.getByRole('button', { name: 'Annuler la collecte' }),
      );
      expect(screen.getByTestId('mention-credit-ag')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus du serveur : le message s’affiche dans la boîte, la carte ne change pas',
    async () => {
      etat.role = 'traiteur_commercial';
      const fetchMock = serveur([EVENEMENT], {
        ok: false,
        corps: { error: 'Annulation non autorisée' },
      });
      render(<ConfirmationProgrammationPage />);
      await screen.findByRole(
        'heading',
        { level: 1, name: /est programmé/ },
        ATTENTE_UI,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Annuler la collecte' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer l’annulation' }),
      );

      expect(
        await within(screen.getByRole('dialog')).findByText(
          'Annulation non autorisée',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        within(carte('Collecte Zéro Déchet #1')).getByText('Créée'),
      ).toBeInTheDocument();
      // Aucune relecture de l'événement après un refus.
      expect(
        fetchMock.mock.calls.filter(([url]) => url === ROUTE_EVENEMENT),
      ).toHaveLength(1);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'gestionnaire de lieux : aucun bouton, il n’annule pas (§06.05)',
    async () => {
      await afficher(EVENEMENT, 'gestionnaire_lieux');

      expect(
        screen.queryByRole('button', { name: 'Annuler la collecte' }),
      ).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Annuler la collecte' }),
      ).toBeNull();
      // « Modifier » reste proposé.
      expect(
        screen.getByRole('link', { name: 'Modifier' }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it.each(['admin_savr', 'ops_savr'])(
    '%s : lien vers la fiche collecte Admin, aucune boîte',
    async (role) => {
      await afficher(EVENEMENT, role);

      expect(
        screen.getByRole('link', { name: 'Annuler la collecte' }),
      ).toHaveAttribute('href', '/admin/collectes/col-zd');
      expect(
        screen.queryByRole('button', { name: 'Annuler la collecte' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    'annulee',
    'annulation_demandee',
    'en_cours',
    'realisee',
    'cloturee',
  ])(
    'collecte au statut %s : aucun bouton d’annulation',
    async (statut) => {
      await afficher({ ...EVENEMENT, collectes: [{ ...ZD, statut }] });

      expect(
        screen.queryByRole('button', { name: /annulation|Annuler/ }),
      ).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Annuler la collecte' }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / formulaire_simplifie — le reste de l’écran est conservé', () => {
  it(
    'badge de statut, rappel de l’email et les trois actions restent affichés',
    async () => {
      await afficher(EVENEMENT);

      // Badge client d'une collecte `programmee` (statut affiché « Créée »).
      expect(screen.getByText('Créée')).toBeInTheDocument();
      expect(
        screen.getByText('Un email récapitulatif vient de vous être envoyé.'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Ajouter une collecte' }),
      ).toHaveAttribute('href', '/programmer/evt-1/ajouter-collecte');
      expect(
        screen.getByRole('link', { name: 'Programmer un autre événement' }),
      ).toHaveAttribute('href', '/programmer/nouveau');
      expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute(
        'href',
        '/',
      );
    },
    ATTENTE_CAS_MS,
  );
});
