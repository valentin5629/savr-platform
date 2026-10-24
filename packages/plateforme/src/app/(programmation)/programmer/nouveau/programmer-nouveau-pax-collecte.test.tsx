/**
 * M1.2 / pax porté par la collecte — décision Val 2026-10-20 : le nombre de
 * convives se saisit avec la date de chaque collecte, plus avec l'événement ;
 * il part avec la collecte, l'événement en calcule le sien. Depuis la refonte
 * du formulaire (lot B2) : sur la carte de chaque collecte (écran 2), plus à
 * l'écran 1 « Informations sur l'événement ».
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

describe('M1.2/pax_par_collecte — formulaire de programmation', () => {
  it(
    'le nombre de convives se saisit avec la date de la collecte (carte de l’écran 2), plus à l’écran 1',
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

      // Écran 1 : aucun champ « Nombre de convives ».
      await screen.findByDisplayValue(
        'Gala de printemps',
        undefined,
        ATTENTE_UI,
      );
      expect(screen.queryByLabelText(/Nombre de convives/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));

      // Écran 2 : sur la carte de la collecte, avec sa date, le pax de la
      // collecte dupliquée (650), pas celui de son événement (1 000).
      const pax = await screen.findByTestId('pax-zd-1', undefined, ATTENTE_UI);
      expect(pax).toHaveValue('650');
      expect(screen.getByTestId('carte-zd-1')).toContainElement(pax);
      expect(screen.getByTestId('carte-zd-1')).toContainElement(
        screen.getByTestId('date-zd-1'),
      );
      fireEvent.change(screen.getByTestId('date-zd-1'), {
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

  it(
    'dupliquer une collecte au pax inconnu (0, reprise Bubble) : le champ reste vide, jamais le pax de l’événement',
    async () => {
      window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
      vi.stubGlobal(
        'fetch',
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          const corps = url.startsWith('/api/v1/traiteur/collectes/c-src')
            ? { data: { ...SOURCE, pax: 0 } }
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
      await screen.findByDisplayValue(
        'Gala de printemps',
        undefined,
        ATTENTE_UI,
      );
      fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
      const pax = await screen.findByTestId('pax-zd-1', undefined, ATTENTE_UI);
      expect(pax).toHaveValue('');
    },
    ATTENTE_CAS_MS,
  );
});
