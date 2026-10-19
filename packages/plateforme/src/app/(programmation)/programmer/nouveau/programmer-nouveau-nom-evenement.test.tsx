/**
 * M1.2 / nom de l'événement et client final — décision Val 2026-10-19, pour
 * tous les rôles : l'étape 1 sépare « Nom de l'événement » (obligatoire) et
 * « Client final (optionnel) », qui n'étaient qu'une case « Nom du client
 * final » écrite dans les deux colonnes.
 *
 * Le formulaire est pré-rempli par « Dupliquer » (?from=). Le sélecteur de date,
 * un calendrier dans une fenêtre surgissante, est remplacé par un champ texte :
 * ce test porte sur ce que la page envoie, pas sur le calendrier.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/ui/date-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DatePicker: (p: {
    id?: string;
    'data-testid'?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <input
      id={p.id}
      data-testid={p['data-testid']}
      value={p.value ?? ''}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
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
    nom_evenement: 'Gala de printemps',
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

/**
 * Parcourt les trois étapes depuis « Dupliquer » et rend le corps envoyé à la
 * confirmation. `clientFinal` remplace la valeur dupliquée de la case « Client
 * final » juste avant de quitter l'étape 1.
 */
async function programmer(clientFinal: string) {
  window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const corps = url.startsWith('/api/v1/traiteur/collectes/c-src')
      ? { data: SOURCE }
      : url.includes('/programmation/types-evenements')
        ? [{ id: 't1', code: 'cocktail', libelle: 'Cocktail' }]
        : init?.method === 'POST'
          ? { evenement_id: 'evt-1' }
          : [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(corps),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<NouveauProgrammationPage />);

  // La duplication remplit chaque case avec sa propre valeur.
  const nomEvenement = await screen.findByLabelText(
    /^Nom de l'événement/,
    undefined,
    ATTENTE_UI,
  );
  await waitFor(
    () => expect(nomEvenement).toHaveValue('Gala de printemps'),
    ATTENTE_UI,
  );
  const champClient = screen.getByLabelText('Client final (optionnel)');
  expect(champClient).toHaveValue('Maison Dupont');
  expect(nomEvenement).toBeRequired();
  expect(champClient).not.toBeRequired();
  expect(screen.queryByText(/Nom du client final/)).toBeNull();

  const continuer = () => screen.getByRole('button', { name: /Continuer/ });

  // Sans nom de l'événement, l'étape 1 ne se valide pas.
  fireEvent.change(nomEvenement, { target: { value: '   ' } });
  expect(continuer()).toBeDisabled();
  fireEvent.change(nomEvenement, { target: { value: 'Gala de printemps' } });

  fireEvent.change(champClient, { target: { value: clientFinal } });
  expect(continuer()).toBeEnabled();
  fireEvent.click(continuer());

  // Étape 2 pré-remplie par la duplication.
  await screen.findByRole('heading', { name: 'Lieu et contacts' }, ATTENTE_UI);
  fireEvent.click(continuer());

  // Étape 3 : la date, puis la confirmation.
  fireEvent.change(
    await screen.findByTestId('date-zd', undefined, ATTENTE_UI),
    {
      target: { value: '2030-01-15' },
    },
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Confirmer la programmation/ }),
  );

  const envoi = await waitFor(() => {
    const appel = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u) === '/api/v1/programmation/evenements' &&
        init?.method === 'POST',
    );
    expect(appel).toBeTruthy();
    return appel!;
  }, ATTENTE_UI);
  return JSON.parse(String(envoi[1]?.body)) as Record<string, unknown>;
}

describe('M1.2 / nom_evenement_client_final — étape 1', () => {
  it(
    'client final renseigné : le nom de l’événement et le client final partent chacun dans sa colonne',
    async () => {
      const corps = await programmer('Maison Dupont');
      expect(corps.nom_evenement).toBe('Gala de printemps');
      expect(corps.nom_client_organisateur).toBe('Maison Dupont');
      expect(corps.confirmer).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'client final vide : l’étape 1 se valide et aucun client n’est envoyé',
    async () => {
      const corps = await programmer('');
      expect(corps.nom_evenement).toBe('Gala de printemps');
      expect(corps).not.toHaveProperty('nom_client_organisateur');
      expect(corps.confirmer).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'dupliquer un événement sans nom : la case reste vide et l’étape 1 attend un nom',
    async () => {
      window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
      const sansNom = {
        ...SOURCE,
        evenement: { ...SOURCE.evenement, nom_evenement: null },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          const corps = url.startsWith('/api/v1/traiteur/collectes/c-src')
            ? { data: sansNom }
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

      // Le client final dupliqué prouve que la source est chargée.
      await screen.findByDisplayValue('Maison Dupont', undefined, ATTENTE_UI);
      const nomEvenement = screen.getByLabelText(/^Nom de l'événement/);
      expect(nomEvenement).toHaveValue('');
      const continuer = screen.getByRole('button', { name: /Continuer/ });
      expect(continuer).toBeDisabled();

      fireEvent.change(nomEvenement, { target: { value: 'Gala d’automne' } });
      expect(continuer).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );
});
