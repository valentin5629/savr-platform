/**
 * M1.2 / §06.01 étape 13 — confirmation_email_recap_issue_reelle (couche écran).
 *
 * Défaut corrigé : l'écran affichait en dur « Un email récapitulatif vient de
 * vous être envoyé. », quel que soit le sort de l'email. Décision Val
 * 2026-10-08 : trois messages selon l'issue réelle, et rien quand elle est
 * inconnue. La programmation, elle, est toujours annoncée enregistrée.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=evt-1'),
}));

import ConfirmationProgrammationPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const EVENEMENT = {
  id: 'evt-1',
  nom_evenement: 'Gala',
  pax: 80,
  contact_principal_nom: 'Jean Martin',
  lieux: {
    nom: 'Salle A',
    adresse_acces: '1 rue Test',
    code_postal: '75001',
    ville: 'Paris',
  },
  collectes: [
    {
      id: 'col-1',
      type: 'zero_dechet',
      statut: 'programmee',
      date_collecte: '2030-01-15',
      heure_collecte: '08:00:00',
    },
  ],
};

function repondre(corps: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok, json: () => Promise.resolve(corps) } as Response),
    ),
  );
}

const ENVOYE = 'Un email récapitulatif vient de vous être envoyé.';
const EN_REPRISE =
  'L’email récapitulatif n’a pas pu partir pour l’instant. Nous le renvoyons automatiquement.';
const NON_ENVOYE =
  'L’email récapitulatif n’a pas pu vous être envoyé. Votre programmation est bien enregistrée : vous la retrouvez dans vos collectes. Pour toute question, écrivez-nous à contact@gosavr.io.';

// Le bandeau de succès prouve que l'écran a fini de charger.
const ecranCharge = () =>
  screen.findByText('Votre collecte est programmée', undefined, ATTENTE_UI);

afterEach(() => vi.unstubAllGlobals());

describe('M1.2/confirmation_email_recap_issue_reelle — écran de confirmation', () => {
  it(
    'email parti → « vient de vous être envoyé »',
    async () => {
      repondre({ ...EVENEMENT, email_recap: 'envoye' });
      render(<ConfirmationProgrammationPage />);
      await ecranCharge();

      expect(screen.getByText(ENVOYE)).toBeInTheDocument();
      expect(screen.queryByText(EN_REPRISE)).toBeNull();
      expect(screen.queryByText(NON_ENVOYE)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'email refusé pour l’instant → nouvelle tentative annoncée, jamais « envoyé »',
    async () => {
      repondre({ ...EVENEMENT, email_recap: 'en_reprise' });
      render(<ConfirmationProgrammationPage />);
      await ecranCharge();

      expect(screen.getByText(EN_REPRISE)).toBeInTheDocument();
      expect(screen.queryByText(ENVOYE)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'email non parti → bandeau visible : programmation enregistrée, adresse de contact, jamais « envoyé »',
    async () => {
      repondre({ ...EVENEMENT, email_recap: 'non_envoye' });
      render(<ConfirmationProgrammationPage />);
      await ecranCharge();

      const message = screen.getByText(NON_ENVOYE);
      expect(message).toBeInTheDocument();
      // Un bandeau annoncé aux lecteurs d'écran, pas une ligne discrète.
      expect(message.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByText(ENVOYE)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    ['état inconnu (null)', { ...EVENEMENT, email_recap: null }],
    ['champ absent de la réponse', EVENEMENT],
  ])(
    '%s → l’écran ne dit rien de l’email',
    async (_cas, corps) => {
      repondre(corps);
      render(<ConfirmationProgrammationPage />);
      await ecranCharge();

      expect(screen.queryByText(/email récapitulatif/i)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'événement illisible → erreur affichée, aucune mention d’un email',
    async () => {
      repondre({ error: 'Événement introuvable ou accès refusé' }, false);
      render(<ConfirmationProgrammationPage />);

      expect(
        await screen.findByText(
          'Événement introuvable ou accès refusé',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/email récapitulatif/i)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
