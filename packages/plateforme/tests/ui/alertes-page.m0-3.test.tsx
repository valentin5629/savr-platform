/**
 * UI — écran /admin/alertes (follow-up R22e). Rend la file d'alertes Admin
 * in-app et la résolution d'une alerte. Ferme le versant AFFICHAGE du gap
 * (émetteurs présents, lecteur absent).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/alertes',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // `useFiltresUrl` lit l'URL au montage : défauts (statut=ouverte).
  useSearchParams: () => null,
}));

import AlertesPage from '@/app/(admin)/admin/alertes/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const OUVERTE = {
  id: 'a1',
  code: 'pack_ag_epuise',
  titre: 'Pack Anti-Gaspi épuisé',
  message: 'Renouvellement requis.',
  entity_type: 'pack_antgaspi',
  entity_id: 'p1',
  statut: 'ouverte',
  created_at: '2026-07-09T08:00:00Z',
  resolue_at: null,
};

function jsonOk(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

let patchCalls: Array<{ url: string; body: unknown }> = [];
let listData: unknown[] = [];

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === 'PATCH') {
    patchCalls.push({ url, body: JSON.parse(String(init.body)) });
    return jsonOk({ data: { id: 'a1', statut: 'resolue' } });
  }
  // GET liste
  return jsonOk({ data: listData });
});

beforeEach(() => {
  patchCalls = [];
  listData = [OUVERTE];
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // L'URL jsdom survit d'un test à l'autre : on la remet à plat.
  window.history.replaceState(null, '', '/admin/alertes');
});

const urlsListe = () =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/api/v1/admin/alertes?'));

describe('AlertesPage', () => {
  it(
    'affiche les alertes ouvertes avec sévérité',
    async () => {
      render(<AlertesPage />);
      // DataTable rend une vue table + une vue cartes (responsive) → getAllBy*.
      expect(
        (
          await screen.findAllByText(
            'Pack Anti-Gaspi épuisé',
            undefined,
            ATTENTE_UI,
          )
        ).length,
      ).toBeGreaterThan(0);
      // pack_ag_epuise → sévérité critique
      expect(screen.getAllByText('Critique').length).toBeGreaterThan(0);
      // filtre par défaut = ouverte
      expect(urlsListe()).toContain('/api/v1/admin/alertes?statut=ouverte');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'R-UI-4b D3 — le filtre statut est un group aria-pressed, l’URL porte ?statut=…',
    async () => {
      render(<AlertesPage />);
      await screen.findAllByText(
        'Pack Anti-Gaspi épuisé',
        undefined,
        ATTENTE_UI,
      );
      const groupe = screen.getByRole('group', { name: 'Filtrer par statut' });
      const ouvertes = within(groupe).getByRole('button', { name: 'Ouvertes' });
      const resolues = within(groupe).getByRole('button', { name: 'Résolues' });
      expect(ouvertes).toHaveAttribute('aria-pressed', 'true');
      expect(resolues).toHaveAttribute('aria-pressed', 'false');
      // Défaut : pas de « Réinitialiser », URL vierge.
      expect(screen.queryByTestId('alertes-filtres-reset')).toBeNull();
      expect(window.location.search).toBe('');

      fireEvent.click(resolues);
      await waitFor(
        () =>
          expect(urlsListe().at(-1)).toBe(
            '/api/v1/admin/alertes?statut=resolue',
          ),
        ATTENTE_UI,
      );
      expect(resolues).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toBe('?statut=resolue');
      // Compteur dans le pied de la FilterBar (D5), un seul emplacement.
      await waitFor(
        () =>
          expect(screen.getByTestId('alertes-filtres-count')).toHaveTextContent(
            '1 alerte',
          ),
        ATTENTE_UI,
      );

      // « Réinitialiser les filtres » → retour au défaut (Ouvertes), URL vierge.
      fireEvent.click(screen.getByTestId('alertes-filtres-reset'));
      await waitFor(
        () =>
          expect(urlsListe().at(-1)).toBe(
            '/api/v1/admin/alertes?statut=ouverte',
          ),
        ATTENTE_UI,
      );
      expect(ouvertes).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toBe('');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'résoudre → PATCH action=resoudre + retrait optimiste',
    async () => {
      render(<AlertesPage />);
      const btns = await screen.findAllByRole(
        'button',
        { name: 'Résoudre' },
        ATTENTE_UI,
      );
      fireEvent.click(btns[0]!);

      await waitFor(() => expect(patchCalls).toHaveLength(1), ATTENTE_UI);
      expect(patchCalls[0]?.url).toBe('/api/v1/admin/alertes/a1');
      expect(patchCalls[0]?.body).toEqual({ action: 'resoudre' });
      // la ligne disparaît de la vue « Ouvertes »
      await waitFor(
        () =>
          expect(screen.queryAllByText('Pack Anti-Gaspi épuisé')).toHaveLength(
            0,
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'aucune alerte → état vide',
    async () => {
      listData = [];
      render(<AlertesPage />);
      expect(
        await screen.findByText('Aucune alerte', undefined, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});
