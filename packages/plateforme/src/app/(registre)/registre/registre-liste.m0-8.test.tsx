/**
 * Registre réglementaire (§06.03) — liste en Data Table. La liste est paginée
 * côté serveur : le tri d'en-tête doit repartir vers l'API (`sortBy`/`sortDir`),
 * jamais trier la seule page affichée. Le lien de bordereau ne doit pas ouvrir
 * la fiche de la ligne.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}));

import RegistrePage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ROWS = [
  {
    collecte_id: 'c1',
    date_evenement: '2026-06-01',
    lieu_id: 'l1',
    lieu_nom: 'Palais',
    traiteur_operationnel_organisation_id: 't1',
    traiteur_raison_sociale: 'Kaspia',
    exutoire_nom: 'Méthaniseur',
    poids_total_kg: 12.5,
    flux_codes: ['biodechet'],
    bordereau_id: 'b1',
    bordereau_numero: 'BS-001',
    bordereau_statut: 'emis',
    historique_partiel: false,
  },
];

const fetchParDefaut = (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url.includes('/bordereaux/'))
    return Promise.resolve({
      ok: true,
      json: async () => ({ url: 'https://exemple.invalid/b.pdf' }),
    } as Response);
  return Promise.resolve({
    ok: true,
    json: async () => ({ rows: ROWS, total: 1 }),
  } as Response);
};
const fetchMock = vi.fn(fetchParDefaut);

const dernierAppelListe = () =>
  new URL(
    String(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.startsWith('/api/v1/registre?'))
        .at(-1),
    ),
    'http://localhost',
  ).searchParams;

describe('M0.8 — Registre : liste en Data Table (tri serveur)', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    routerPush.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it(
    'clic sur un en-tête = tri envoyé à l’API (asc puis desc), retour page 1',
    async () => {
      render(<RegistrePage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );
      expect(table.getByText('Palais')).toBeInTheDocument();
      // Défaut : date décroissante, portée par l'API.
      expect(dernierAppelListe().get('sortBy')).toBe('date_evenement');
      expect(dernierAppelListe().get('sortDir')).toBe('desc');

      fireEvent.click(table.getByRole('button', { name: /Lieu/ }));
      await waitFor(() => {
        expect(dernierAppelListe().get('sortBy')).toBe('lieu_nom');
        expect(dernierAppelListe().get('sortDir')).toBe('asc');
      }, ATTENTE_UI);
      expect(dernierAppelListe().get('page')).toBe('1');

      fireEvent.click(
        within(
          await screen.findByRole('table', undefined, ATTENTE_UI),
        ).getByRole('button', {
          name: /Lieu/,
        }),
      );
      await waitFor(
        () => expect(dernierAppelListe().get('sortDir')).toBe('desc'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'le lien bordereau télécharge sans ouvrir la fiche ; la ligne ouvre la fiche',
    async () => {
      render(<RegistrePage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );

      fireEvent.click(table.getByRole('button', { name: /BS-001/ }));
      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.some((c) =>
              String(c[0]).includes('/api/v1/registre/bordereaux/b1/download'),
            ),
          ).toBe(true),
        ATTENTE_UI,
      );
      expect(routerPush).not.toHaveBeenCalled();

      fireEvent.click(table.getByText('Kaspia'));
      expect(routerPush).toHaveBeenCalledWith('/registre/c1');
    },
    ATTENTE_CAS_MS,
  );

  // §10 §7 : état Error distinct de l'état Empty. Sans contrôle de `r.ok`, une
  // panne de l'API affichait « Aucune collecte au registre pour ces critères. » :
  // un registre en panne se lisait comme un registre vide.
  it(
    'une panne de l’API affiche une erreur + Réessayer, jamais le registre vide',
    async () => {
      let appels = 0;
      fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/v1/registre?')) {
          appels += 1;
          // 1er appel en panne, le « Réessayer » réussit.
          if (appels === 1)
            return Promise.resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: 'boom' }),
            } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ rows: ROWS, total: 1 }),
        } as Response);
      });
      try {
        render(<RegistrePage />);

        expect(
          await screen.findByText(
            'Le chargement du registre a échoué.',
            undefined,
            ATTENTE_UI,
          ),
        ).toBeInTheDocument();
        expect(
          screen.queryByText('Aucune collecte au registre pour ces critères.'),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();

        // « Réessayer » relance l'appel ; la réponse OK affiche les lignes.
        fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
        const table = within(
          await screen.findByRole('table', undefined, ATTENTE_UI),
        );
        expect(table.getByText('Palais')).toBeInTheDocument();
        expect(
          screen.queryByText('Le chargement du registre a échoué.'),
        ).not.toBeInTheDocument();
        expect(appels).toBe(2);
      } finally {
        // Rend au mock partagé son comportement par défaut pour les autres cas.
        fetchMock.mockReset();
        fetchMock.mockImplementation(fetchParDefaut);
      }
    },
    ATTENTE_CAS_MS,
  );
});
