/**
 * M1.2 / formulaire_simplifie — décisions Val 2026-10-16, pour tous les rôles :
 * l'étape 2 ne propose plus stationnement, accès office, type de véhicule max,
 * contraintes horaires ni flux acceptés ; l'étape 3 s'appelle « Date et heure de
 * collecte » et n'a plus de récapitulatif (il est montré après confirmation).
 *
 * Le formulaire est pré-rempli par « Dupliquer » (?from=) pour franchir les
 * étapes 1 et 2 sans saisie.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const JETON = `${b64url({ alg: 'HS256' })}.${b64url({
  user_role: 'traiteur_manager',
})}.sig`;
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: JETON } } }),
    },
  }),
}));

import NouveauProgrammationPage from './page';

const SOURCE = {
  type: 'zero_dechet',
  heure_collecte: '08:30:00',
  controle_acces_requis: false,
  informations_supplementaires: null,
  evenement: {
    pax: 1000,
    type_evenement_id: 't1',
    nom_client_organisateur: 'Maison Dupont',
    reference_affaire: null,
    contact_principal_nom: 'Paul Arnaud',
    contact_principal_telephone: '06 12 34 56 78',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    lieu: {
      id: 'lieu-1',
      nom: 'Musée des Arts Forains',
      adresse_acces: '53 avenue des Terroirs de France',
      code_postal: '75012',
      ville: 'Paris',
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('M1.2 / formulaire_simplifie — étapes 2 et 3', () => {
  it(
    'étape 2 sans les 5 champs retirés ; étape 3 « Date et heure de collecte » sans récapitulatif',
    async () => {
      window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          const corps = url.startsWith('/api/v1/traiteur/collectes/c-src')
            ? { data: SOURCE }
            : url.includes('/programmation/types-evenements')
              ? [{ id: 't1', code: 'cocktail', libelle: 'Cocktail' }]
              : [];
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(corps),
          } as Response);
        }),
      );

      render(<NouveauProgrammationPage />);

      // Indicateur d'étapes : le nouveau libellé, plus « Collecte(s) ».
      expect(screen.getByText('Date et heure de collecte')).toBeInTheDocument();
      expect(screen.queryByText('Collecte(s)')).toBeNull();

      await screen.findByDisplayValue('Maison Dupont', undefined, ATTENTE_UI);
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

      // Étape 2 : les champs du lieu restants, sans les 5 retirés.
      await screen.findByRole(
        'heading',
        { name: 'Lieu et contacts' },
        ATTENTE_UI,
      );
      expect(screen.getByLabelText("Adresse d'accès livraison")).toHaveValue(
        '53 avenue des Terroirs de France',
      );
      expect(screen.getByLabelText("Détails d'accès")).toBeInTheDocument();
      for (const retire of [
        'Stationnement',
        'Accès office',
        'Type de véhicule max',
        'Contraintes horaires',
        'Flux acceptés',
      ]) {
        expect(screen.queryByText(retire)).toBeNull();
      }
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

      // Étape 3 : titre renommé, pas de récapitulatif.
      const titre = await screen.findByRole(
        'heading',
        { level: 2, name: 'Date et heure de collecte' },
        ATTENTE_UI,
      );
      const carte = titre.parentElement as HTMLElement;
      expect(within(carte).queryByText('Récapitulatif')).toBeNull();
      expect(within(carte).queryByText('Maison Dupont')).toBeNull();
      expect(
        within(carte).getByRole('button', {
          name: /Confirmer la programmation/,
        }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
