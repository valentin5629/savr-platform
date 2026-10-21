/**
 * M1.2 / pax porté par la collecte — décision Val 2026-10-20 : le nombre de
 * convives se saisit avec la date de chaque collecte (étape 3), plus à
 * l'étape 1 ; il part avec la collecte, l'événement en calcule le sien.
 *
 * Même montage que programmer-nouveau-nom-evenement.test.tsx (duplication
 * ?from= et calendrier remplacé par un champ texte).
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
  pax: 650,
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

describe('M1.2/pax_par_collecte — formulaire de programmation', () => {
  it(
    'le nombre de convives se saisit avec la date de la collecte (étape 3), plus à l’étape 1',
    async () => {
      window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
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
        },
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<NouveauProgrammationPage />);

      // Étape 1 : aucun champ « Nombre de convives ».
      await screen.findByDisplayValue(
        'Gala de printemps',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.queryByLabelText(/Nombre de convives/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
      await screen.findByRole(
        'heading',
        { name: 'Lieu et contacts' },
        ATTENTE_UI,
      );
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

      // Étape 3 : le pax de la collecte dupliquée (650), pas celui de son
      // événement (1 000).
      const pax = await screen.findByTestId('pax-zd', undefined, ATTENTE_UI);
      expect(pax).toHaveValue(650);
      fireEvent.change(screen.getByTestId('date-zd'), {
        target: { value: '2030-01-15' },
      });
      const confirmer = screen.getByRole('button', {
        name: /Confirmer la programmation/,
      });

      // Sans pax, ni la confirmation ni le brouillon ne partent.
      fireEvent.change(pax, { target: { value: '' } });
      expect(confirmer).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      ).toBeDisabled();

      fireEvent.change(pax, { target: { value: '700' } });
      expect(confirmer).toBeEnabled();
      fireEvent.click(confirmer);

      const envoi = await waitFor(() => {
        const appel = fetchMock.mock.calls.find(
          ([u, i]) =>
            String(u) === '/api/v1/programmation/evenements' &&
            i?.method === 'POST',
        );
        expect(appel).toBeTruthy();
        return appel!;
      }, ATTENTE_UI);
      const corps = JSON.parse(String(envoi[1]?.body)) as {
        pax?: unknown;
        collectes: { type: string; pax: number }[];
      };
      // Le pax part avec la collecte ; l'événement n'en porte plus.
      expect(corps).not.toHaveProperty('pax');
      expect(corps.collectes).toEqual([
        expect.objectContaining({ type: 'zd', pax: 700 }),
      ]);
    },
    ATTENTE_CAS_MS,
  );
});
