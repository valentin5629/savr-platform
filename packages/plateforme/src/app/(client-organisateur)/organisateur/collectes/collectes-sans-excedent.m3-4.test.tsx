/**
 * M3.4 — liste Collectes du client organisateur, onglet Anti-Gaspi : une
 * collecte AG sans excédent se lit « Réalisée », et « Sans excédent » prend la
 * place du nombre de repas — jamais « 0 » (décision Val 2026-10-09 : « sans
 * excédent » est un résultat, pas un statut d'avancement).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const { urlParams } = vi.hoisted(() => ({ urlParams: { current: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(urlParams.current),
  usePathname: () => '/organisateur/collectes',
}));

import CollectesPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ligne = (over: Record<string, unknown>) => ({
  id: 'c',
  type: 'anti_gaspi',
  statut: 'cloturee',
  date_collecte: '2026-09-30',
  heure_collecte: '22:00:00',
  taux_recyclage: null,
  co2_evite_kg: null,
  traiteur_nom: 'Butard',
  repas_donnes: null,
  evenements: {
    nom_evenement: 'Gala',
    pax: 300,
    lieux: { nom: 'Pavillon Gabriel', code_postal: '75008', ville: 'Paris' },
  },
  ...over,
});

const LIGNES = [
  ligne({
    id: 'c1',
    statut: 'realisee_sans_collecte',
    // Ce que rend la route : f_volume_repas_realise vaut 0, pas null.
    repas_donnes: 0,
    evenements: {
      nom_evenement: 'Cocktail sans reste',
      pax: 172,
      lieux: { nom: 'Musée', code_postal: '75012', ville: 'Paris' },
    },
  }),
  ligne({ id: 'c2', repas_donnes: 246 }),
];

afterEach(() => {
  cleanup();
  urlParams.current = '';
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/organisateur/collectes');
});

describe('M3.4 / liste Collectes organisateur — collecte AG sans excédent', () => {
  it(
    'M3.4/liste_organisateur_sans_excedent — statut « Réalisée », « Sans excédent » dans la colonne Repas, jamais « 0 »',
    async () => {
      urlParams.current = 'type=anti_gaspi';
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: LIGNES }), { status: 200 }),
          ),
        ),
      );
      render(<CollectesPage />);
      // Lu DANS le tableau : chaque ligne est aussi rendue en carte mobile.
      const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
      const ligneDe = (evenement: string): HTMLElement => {
        const l = table
          .getAllByRole('row')
          .find((r) => within(r).queryByText(evenement));
        if (!l) throw new Error(`ligne « ${evenement} » absente`);
        return l;
      };

      const sans = within(ligneDe('Cocktail sans reste'));
      expect(sans.getByText('Sans excédent')).toBeTruthy();
      expect(sans.getByText('Réalisée')).toBeTruthy();
      expect(sans.queryByText('0')).toBeNull();

      // Témoin : une collecte avec excédents garde son nombre de repas.
      const avec = within(ligneDe('Gala'));
      expect(avec.getByText('246')).toBeTruthy();
      expect(avec.queryByText('Sans excédent')).toBeNull();
      expect(table.queryByText(/Sans excédents/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
