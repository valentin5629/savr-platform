/**
 * M3.3 — Test UI R19c : dashboard agence, onglet AG — bouton renouvellement pack.
 * BL-P1-AGENCE-01 : §06.11 l.36/l.44 (onglet AG identique au §06.04) →
 * le bloc « Mon pack Anti-Gaspi » rend le bouton « Demander un renouvellement »
 * (parité stricte avec la page traiteur §06.04 l.242) et son clic POST sur
 * l'endpoint partagé /api/v1/traiteur/pack-ag/renouvellement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/agence',
}));

import AgenceDashboardPage from '@/app/(agence)/agence/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

// Pack épuisé (credits_restants = 0) → bouton actif (§06.04 l.242).
const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/dashboards/kpi-traiteur'))
    return jsonResponse({
      data: [
        {
          mois: '2026-06-01',
          type_collecte: 'anti_gaspi',
          nb_collectes: 2,
          tonnage_kg: 40,
          taux_recyclage_pondere: null,
          nb_repas_donnes: 30,
          pax_total: 100,
        },
      ],
    });
  if (url.includes('/programmation/pack-ag'))
    return jsonResponse({
      pack_actif: true,
      credits_initiaux: 20,
      credits_restants: 0,
    });
  if (url.includes('/dashboards/benchmark')) return jsonResponse({ data: [] });
  return jsonResponse({});
});

function makeLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeLocalStorage());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('M3.3 / dashboard agence — bouton renouvellement pack AG (BL-P1-AGENCE-01)', () => {
  it('M3.3/AGENCE01_bouton_renouvellement_onglet_ag — présent dans le bloc pack AG', async () => {
    render(<AgenceDashboardPage />);
    // Basculer sur l'onglet Anti-gaspi → bloc « Mon pack Anti-Gaspi ».
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    expect(await screen.findByText('Mon pack Anti-Gaspi')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /demander un renouvellement/i }),
    ).toBeInTheDocument();
  });

  it('M3.3/AGENCE01_bouton_renouvellement_poste_endpoint — clic POST /traiteur/pack-ag/renouvellement', async () => {
    render(<AgenceDashboardPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /anti-gaspi/i }));
    const bouton = await screen.findByRole('button', {
      name: /demander un renouvellement/i,
    });
    fetchMock.mockClear();
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) =>
            String(u).includes('/traiteur/pack-ag/renouvellement') &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});
