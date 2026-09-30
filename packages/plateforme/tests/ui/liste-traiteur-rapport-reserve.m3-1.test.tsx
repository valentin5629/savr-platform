/**
 * M3.1 — Liste Collectes traiteur : rapport de don réservé au donneur d'ordre
 * (D12, arbitrage Val 2026-09-30). La route de téléchargement répond 404 au
 * traiteur opérationnel d'une collecte AG programmée par une agence ; la liste
 * ne doit donc pas lui proposer le picto (qui resterait inerte), mais la mention
 * de la fiche. Ce cas épingle le CÂBLAGE page → table : le champ
 * `rapport_reserve_donneur_ordre` de l'API atteint bien la cellule Résultats.
 *
 * Requêtes bornées au <table> : DataGrid rend aussi chaque ligne en carte
 * mobile (< 640 px), qui dupliquerait chaque libellé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams('onglet=historique&type=anti_gaspi'),
  usePathname: () => '/traiteur/collectes',
}));

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));

import TraiteurCollectesPage from '@/app/(traiteur)/traiteur/collectes/page.js';

function collecteAg(id: string, lieu: string, reserve: boolean) {
  return {
    id,
    type: 'anti_gaspi',
    statut: 'cloturee',
    date_collecte: '2026-09-20',
    heure_collecte: '22:00:00',
    programmee_par_tiers: reserve,
    rapport_reserve_donneur_ordre: reserve,
    poids_total_kg: 0,
    taux_recyclage: null,
    co2_evite_kg: 850,
    nb_repas_donnes: 340,
    evenements: {
      created_by: null,
      pax: 200,
      nom_client_organisateur: null,
      lieux: { nom: lieu, adresse_acces: null, code_postal: null, ville: null },
    },
  };
}

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  const data = url.includes('/traiteur/collectes/filtres')
    ? { lieux: [], clients: [], programmateurs: [] }
    : [
        collecteAg('ag-agence', 'Pavillon Agence', true),
        collecteAg('ag-propre', 'Pavillon Propre', false),
      ];
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response);
});

describe('M3.1 / liste traiteur — rapport réservé au donneur d’ordre (D12)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    'M3.1/liste_rapport_reserve_donneur_ordre_page — la page transmet le champ de l’API : picto retiré sur la seule collecte réservée',
    async () => {
      render(<TraiteurCollectesPage />);
      const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
      const ligne = async (lieu: string) =>
        within(
          (await table.findByText(lieu, {}, ATTENTE_UI)).closest(
            'tr',
          ) as HTMLElement,
        );

      const reservee = await ligne('Pavillon Agence');
      expect(
        reservee.queryByRole('button', { name: /Télécharger le rapport/ }),
      ).toBeNull();
      expect(
        reservee.getByText(
          'Réservé à l’organisation qui a programmé la collecte',
        ),
      ).toBeTruthy();

      const propre = await ligne('Pavillon Propre');
      expect(
        propre.getByRole('button', { name: /Télécharger le rapport/ }),
      ).toBeTruthy();
      expect(
        propre.queryByText(
          'Réservé à l’organisation qui a programmé la collecte',
        ),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
