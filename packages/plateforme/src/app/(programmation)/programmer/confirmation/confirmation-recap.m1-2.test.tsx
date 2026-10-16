/**
 * M1.2 / formulaire_simplifie — écran « Votre collecte est programmée ».
 *
 * Décision Val 2026-10-16 : le récapitulatif quitte l'étape 3 du formulaire et
 * s'affiche ici — client, lieu, convives, date et heure, contact principal et
 * contact de secours (nom + téléphone) — avec un bouton « Modifier la collecte »
 * qui ouvre la fiche de la collecte en édition dans l'espace du rôle.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const etat = vi.hoisted(() => ({ role: 'traiteur_manager' as string }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=evt-1'),
}));
vi.mock('@/lib/use-user-role', () => ({ useUserRole: () => etat.role }));

import ConfirmationProgrammationPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ZD = {
  id: 'col-zd',
  type: 'zero_dechet',
  statut: 'programmee',
  date_collecte: '2030-01-15',
  heure_collecte: '08:30:00',
};
const AG = {
  id: 'col-ag',
  type: 'anti_gaspi',
  statut: 'programmee',
  date_collecte: '2030-01-16',
  heure_collecte: '23:00:00',
};

const EVENEMENT = {
  id: 'evt-1',
  nom_evenement: 'Gala',
  nom_client_organisateur: 'Maison Dupont',
  pax: 1000,
  contact_principal_nom: 'Paul Arnaud',
  contact_principal_telephone: '06 12 34 56 78',
  contact_secours_nom: 'Léa Martin',
  contact_secours_telephone: '07 98 76 54 32',
  lieux: {
    nom: 'Salle A',
    adresse_acces: '1 rue Test',
    code_postal: '75012',
    ville: 'Paris',
  },
  collectes: [ZD],
  email_recap: 'envoye',
};

function repondre(corps: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(corps),
      } as Response),
    ),
  );
}

async function afficher(corps: unknown, role = 'traiteur_manager') {
  etat.role = role;
  repondre(corps);
  render(<ConfirmationProgrammationPage />);
  await screen.findByText(
    /sont programmées|est programmée/,
    undefined,
    ATTENTE_UI,
  );
}

/** Valeur affichée sous un libellé du récapitulatif (`<dt>` → `<dd>`). */
function valeur(libelle: string): HTMLElement {
  const dt = screen.getByText(libelle, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

afterEach(() => vi.unstubAllGlobals());

describe('M1.2 / formulaire_simplifie — récapitulatif de l’écran de confirmation', () => {
  it(
    'affiche client, lieu, convives, date et heure, contacts principal et de secours avec leur téléphone',
    async () => {
      await afficher(EVENEMENT);

      expect(valeur('Client')).toHaveTextContent('Maison Dupont');
      expect(valeur('Lieu')).toHaveTextContent(
        'Salle A — 1 rue Test, 75012 Paris',
      );
      expect(valeur('Convives')).toHaveTextContent('1000');
      expect(valeur('Date et heure')).toHaveTextContent(
        '15 janvier 2030 à 08:30',
      );
      const principal = valeur('Contact principal');
      expect(principal).toHaveTextContent('Paul Arnaud');
      expect(
        within(principal).getByRole('link', { name: '06 12 34 56 78' }),
      ).toHaveAttribute('href', 'tel:0612345678');
      const secours = valeur('Contact de secours');
      expect(secours).toHaveTextContent('Léa Martin');
      expect(
        within(secours).getByRole('link', { name: '07 98 76 54 32' }),
      ).toHaveAttribute('href', 'tel:0798765432');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sans contact de secours : « Non renseigné », jamais un nom vide',
    async () => {
      await afficher({
        ...EVENEMENT,
        contact_secours_nom: null,
        contact_secours_telephone: null,
      });

      expect(valeur('Contact de secours')).toHaveTextContent('Non renseigné');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes : une date et heure par type de collecte',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      const dates = valeur('Date et heure');
      expect(dates).toHaveTextContent('Zéro Déchet : 15 janvier 2030 à 08:30');
      expect(dates).toHaveTextContent('Anti-Gaspi : 16 janvier 2030 à 23:00');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.2 / formulaire_simplifie — bouton « Modifier la collecte »', () => {
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

      expect(
        screen.getByRole('link', { name: 'Modifier la collecte' }),
      ).toHaveAttribute('href', href);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux collectes : un bouton par collecte',
    async () => {
      await afficher({ ...EVENEMENT, collectes: [ZD, AG] });

      const liens = screen.getAllByRole('link', {
        name: 'Modifier la collecte',
      });
      expect(liens.map((l) => l.getAttribute('href'))).toEqual([
        '/traiteur/collectes?collecte=col-zd&edit=1',
        '/traiteur/collectes?collecte=col-ag&edit=1',
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rôle inconnu (session illisible) : pas de bouton plutôt qu’un lien cassé',
    async () => {
      await afficher(EVENEMENT, '');

      expect(
        screen.queryByRole('link', { name: 'Modifier la collecte' }),
      ).toBeNull();
      // Le reste de l'écran est rendu.
      expect(valeur('Client')).toHaveTextContent('Maison Dupont');
    },
    ATTENTE_CAS_MS,
  );
});
