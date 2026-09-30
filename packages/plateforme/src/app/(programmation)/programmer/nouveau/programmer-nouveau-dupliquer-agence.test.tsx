/**
 * M3.3 — « Dupliquer » depuis la liste Collectes agence (§06.11 = §06.04 §3) :
 * la collecte source est lue sur la route agence, et son traiteur opérationnel
 * est pré-sélectionné ET affiché dans le sélecteur — même quand il est absent de
 * la liste chargée (plafonnée à 20 traiteurs du référentiel, fiches shadow
 * exclues), sinon il serait choisi sans être visible.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const JETON_AGENCE = `${b64url({ alg: 'HS256' })}.${b64url({
  user_role: 'agence',
})}.sig`;
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: JETON_AGENCE } } }),
    },
  }),
}));

import NouveauProgrammationPage from './page';

const SOURCE = {
  type: 'zero_dechet',
  heure_collecte: '22:00:00',
  controle_acces_requis: false,
  informations_supplementaires: null,
  evenement: {
    pax: 1443,
    type_evenement_id: null,
    nom_client_organisateur: 'Viparis',
    reference_affaire: null,
    contact_principal_nom: null,
    contact_principal_telephone: null,
    contact_secours_nom: null,
    contact_secours_telephone: null,
    lieu: null,
  },
  traiteur_operationnel: { id: 't-shadow', nom: 'Maison Bertrand' },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('M3.3 / Dupliquer côté agence', () => {
  it(
    'M3.3/dupliquer_agence_traiteur_operationnel_preselectionne — route agence, traiteur source affiché',
    async () => {
      window.history.replaceState({}, '', '/programmer/nouveau?from=c-src');
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const corps = url.startsWith('/api/v1/agence/collectes/c-src')
          ? { data: SOURCE }
          : []; // liste des traiteurs (vide : le traiteur source n'y est pas), etc.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(corps),
        } as Response);
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<NouveauProgrammationPage />);

      // Le sélecteur n'apparaît qu'une fois le rôle lu (session asynchrone).
      await waitFor(
        () =>
          expect(document.getElementById('traiteur-select')).toHaveTextContent(
            'Maison Bertrand',
          ),
        ATTENTE_UI,
      );
      // Le reste du formulaire est bien pré-rempli depuis la même source.
      expect(screen.getByDisplayValue('Viparis')).toBeTruthy();
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).startsWith('/api/v1/traiteur/collectes/'),
        ),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );
});
