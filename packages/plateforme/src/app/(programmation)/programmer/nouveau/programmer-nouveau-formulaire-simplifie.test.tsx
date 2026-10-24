/**
 * M1.2 / formulaire_simplifie — décisions Val 2026-10-16, pour tous les rôles :
 * les champs du lieu ne proposent plus stationnement, accès office, type de
 * véhicule max, contraintes horaires ni flux acceptés ; l'écran des collectes
 * n'a pas de récapitulatif (il est montré après confirmation).
 *
 * Refonte du formulaire (lot B2, décisions Val 2026-10-22) : deux écrans,
 * « Informations sur l'événement » (dont le lieu et ses champs) puis
 * « Informations sur les collectes » (une carte par collecte). Les anciennes
 * étapes « Lieu & contacts » et « Date et heure de collecte » n'existent plus.
 *
 * Le formulaire est pré-rempli par « Dupliquer » (?from=) pour franchir
 * l'écran 1 sans saisie.
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
  // Type d'événement et contacts de LA collecte dupliquée (lot B1, décision
  // Val 2026-10-23) : la fiche collecte les sert au niveau de la collecte.
  type_evenement_id: 't1',
  contact_principal_nom: 'Paul Arnaud',
  contact_principal_telephone: '06 12 34 56 78',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  controle_acces_requis: false,
  informations_supplementaires: null,
  evenement: {
    pax: 1000,
    nom_evenement: 'Gala de printemps',
    nom_client_organisateur: 'Maison Dupont',
    reference_affaire: null,
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

const RETIRES = [
  'Stationnement',
  'Accès office',
  'Type de véhicule max',
  'Contraintes horaires',
  'Flux acceptés',
];

describe('M1.2 / formulaire_simplifie — écrans 1 et 2', () => {
  it(
    'écran 1 : champs du lieu sans les 5 retirés ; écran 2 « Informations sur les collectes » sans récapitulatif',
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

      // Indicateur d'étapes : les deux écrans, plus les trois anciennes étapes.
      const etapes = screen.getByRole('navigation', {
        name: 'Étapes du formulaire',
      });
      expect(
        within(etapes).getByText("Informations sur l'événement"),
      ).toBeInTheDocument();
      expect(
        within(etapes).getByText('Informations sur les collectes'),
      ).toBeInTheDocument();
      for (const ancienne of [
        'Lieu & contacts',
        'Date et heure de collecte',
        'Collecte(s)',
      ]) {
        expect(within(etapes).queryByText(ancienne)).toBeNull();
      }

      await screen.findByDisplayValue('Maison Dupont', undefined, ATTENTE_UI);

      // Écran 1 : les champs du lieu restants, sans les 5 retirés.
      expect(screen.getByLabelText("Adresse d'accès livraison")).toHaveValue(
        '53 avenue des Terroirs de France',
      );
      expect(screen.getByLabelText("Détails d'accès")).toBeInTheDocument();
      for (const retire of RETIRES) {
        expect(screen.queryByText(retire)).toBeNull();
      }
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

      // Écran 2 : une carte par collecte, ni récapitulatif ni champ retiré.
      const titre = await screen.findByRole(
        'heading',
        { level: 2, name: 'Informations sur les collectes' },
        ATTENTE_UI,
      );
      const ecran = titre.parentElement as HTMLElement;
      expect(within(ecran).getByTestId('carte-zd-1')).toBeInTheDocument();
      expect(within(ecran).queryByText('Récapitulatif')).toBeNull();
      expect(within(ecran).queryByText(/Maison Dupont/)).toBeNull();
      expect(within(ecran).queryByText(/Gala de printemps/)).toBeNull();
      expect(within(ecran).queryByText(/Musée des Arts Forains/)).toBeNull();
      for (const retire of RETIRES) {
        expect(screen.queryByText(retire)).toBeNull();
      }
      expect(
        within(ecran).getByRole('button', {
          name: /Confirmer la programmation/,
        }),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
