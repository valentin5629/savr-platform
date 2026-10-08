/**
 * M3.2 — Dashboard gestionnaire, onglet Anti-Gaspi, bloc « Mon pack Anti-Gaspi »
 * (§11 l.142 ; badges §06.04 Bloc 4 AG : orange dès solde ≤ 10 % des crédits
 * initiaux, rouge « Pack épuisé » à solde nul).
 *
 * Le pack est monté à la forme que sert `/api/v1/gestionnaire/dashboard` : les
 * colonnes de `packs_antgaspi`. Avant, l'écran lisait deux champs que la route
 * ne sert pas — crédits vides, jamais de badge — et tous les tests du dashboard
 * montaient `pack: null`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire',
}));

import GestionnaireDashboardPage from '@/app/(gestionnaire)/gestionnaire/page.js';
import type { PackActifGestionnaire } from '@/components/dashboards/useKpisGestionnaire';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const KPIS_AG = {
  nb_collectes: 3,
  nb_repas_donnes: 120,
  pax_total: 400,
  repas_par_pax: 0.3,
};

// Ligne `packs_antgaspi` telle que la route la sélectionne et la renvoie.
const packServi = (credits_restants: number, credits_initiaux = 20) => ({
  id: 'pk1',
  credits_initiaux,
  credits_consommes: credits_initiaux - credits_restants,
  credits_restants,
  statut: 'actif',
});

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
  } as Response);
}

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

async function monterBlocPack(
  pack: PackActifGestionnaire | null,
): Promise<HTMLElement | null> {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/gestionnaire/dashboard')
        ? jsonResponse({ data: { kpis: KPIS_AG, pack } })
        : jsonResponse({}),
    ),
  );
  render(<GestionnaireDashboardPage />);
  fireEvent.click(
    await screen.findByRole('radio', { name: 'Anti-Gaspi' }, ATTENTE_UI),
  );
  await screen.findByText('Repas donnés', undefined, ATTENTE_UI);
  return screen.queryByTestId('bloc-pack-ag');
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal('localStorage', makeLocalStorage());
});

describe('M3.2 / dashboard — bloc « Mon pack Anti-Gaspi »', () => {
  it(
    'M3.2/dashboard_pack_ag_credits_affiches — crédits restants et crédits initiaux du pack servi, sans badge au-dessus du seuil',
    async () => {
      const bloc = await monterBlocPack(packServi(12));
      expect(bloc).not.toBeNull();
      expect(bloc).toHaveTextContent('Crédits restants : 12 / 20');
      expect(within(bloc!).queryByText('Pack épuisé')).toBeNull();
      expect(within(bloc!).queryByText('Pack bientôt épuisé')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/dashboard_pack_ag_badge_bientot_epuise — solde ≤ 10 % des crédits initiaux : badge « Pack bientôt épuisé », borne incluse',
    async () => {
      const bloc = await monterBlocPack(packServi(2));
      expect(bloc).toHaveTextContent('Crédits restants : 2 / 20');
      expect(
        within(bloc!).getByText('Pack bientôt épuisé'),
      ).toBeInTheDocument();
      expect(within(bloc!).queryByText('Pack épuisé')).toBeNull();

      // Juste au-dessus de la borne : aucun badge.
      cleanup();
      const audessus = await monterBlocPack(packServi(3));
      expect(audessus).toHaveTextContent('Crédits restants : 3 / 20');
      expect(within(audessus!).queryByText('Pack bientôt épuisé')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/dashboard_pack_ag_badge_epuise — solde nul : badge « Pack épuisé » seul',
    async () => {
      const bloc = await monterBlocPack(packServi(0));
      expect(bloc).toHaveTextContent('Crédits restants : 0 / 20');
      expect(within(bloc!).getByText('Pack épuisé')).toBeInTheDocument();
      expect(within(bloc!).queryByText('Pack bientôt épuisé')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/dashboard_pack_ag_absent_sans_pack — aucun pack actif : le bloc ne se monte pas',
    async () => {
      expect(await monterBlocPack(null)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
