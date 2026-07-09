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
  cleanup,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/alertes',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AlertesPage from '@/app/(admin)/admin/alertes/page.js';

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
});

describe('AlertesPage', () => {
  it('affiche les alertes ouvertes avec sévérité', async () => {
    render(<AlertesPage />);
    // DataTable rend une vue table + une vue cartes (responsive) → getAllBy*.
    expect(
      (await screen.findAllByText('Pack Anti-Gaspi épuisé')).length,
    ).toBeGreaterThan(0);
    // pack_ag_epuise → sévérité critique
    expect(screen.getAllByText('Critique').length).toBeGreaterThan(0);
    // filtre par défaut = ouverte
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/alertes?statut=ouverte',
    );
  });

  it('résoudre → PATCH action=resoudre + retrait optimiste', async () => {
    render(<AlertesPage />);
    const btns = await screen.findAllByRole('button', { name: 'Résoudre' });
    fireEvent.click(btns[0]!);

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]?.url).toBe('/api/v1/admin/alertes/a1');
    expect(patchCalls[0]?.body).toEqual({ action: 'resoudre' });
    // la ligne disparaît de la vue « Ouvertes »
    await waitFor(() =>
      expect(screen.queryAllByText('Pack Anti-Gaspi épuisé')).toHaveLength(0),
    );
  });

  it('aucune alerte → état vide', async () => {
    listData = [];
    render(<AlertesPage />);
    expect(await screen.findByText('Aucune alerte')).toBeTruthy();
  });
});
