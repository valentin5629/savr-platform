/**
 * Écran Attribution AG — lieu sans région ni code postal (C1, Val 2026-11-03).
 * L'algorithme ne peut rien recommander : un seul message dit que c'est le
 * lieu qu'il faut compléter, à la place des deux avertissements « Aucune
 * association disponible… » et « Aucun transporteur éligible… ».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ collecteId: 'col-1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

import AttributionDetailPage from './page';
import { MESSAGE_LIEU_A_COMPLETER } from '@/components/admin/attribution-ag-form';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ALGO_VIDE = {
  associations: [],
  assoc_count: 0,
  transporteur: null,
  transporteurs: [],
  branche: 'aucun_prestataire',
  is_idf: false,
  no_asso: true,
  no_prestataire: true,
  delai_minutes: 600,
  nb_pax: 150,
};

function installFetch(algo: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.includes('/recommandation')
        ? { data: algo }
        : { data: [] };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Attribution AG — lieu à compléter', () => {
  it(
    'lieu sans région ni code postal : message unique sur le lieu',
    async () => {
      installFetch({ ...ALGO_VIDE, region_inconnue: true });
      render(<AttributionDetailPage />);

      expect(
        await screen.findByText(MESSAGE_LIEU_A_COMPLETER, {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText(/Aucune association disponible/)).toBeNull();
      expect(screen.queryByText(/Aucun transporteur éligible/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'lieu complet sans recommandation : avertissements habituels, pas de message lieu',
    async () => {
      installFetch({ ...ALGO_VIDE, region_inconnue: false });
      render(<AttributionDetailPage />);

      expect(
        await screen.findByText(
          /Aucune association disponible/,
          {},
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(screen.getByText(/Aucun transporteur éligible/)).toBeTruthy();
      expect(screen.queryByText(MESSAGE_LIEU_A_COMPLETER)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sous 640 px, la grille tient dans l’écran et le nom d’une carte de choix n’est plus coupé',
    async () => {
      installFetch({ ...ALGO_VIDE, region_inconnue: false });
      render(<AttributionDetailPage />);

      const titre = await screen.findByText(
        'Association bénéficiaire',
        {},
        ATTENTE_UI,
      );
      // Colonne bornée : sans elle la carte de choix élargit la grille et les
      // champs sortent de l'écran.
      expect(titre.closest('.grid')!.className).toContain('max-sm:grid-cols-1');
      const nom = screen.getByText('Choisir une association…');
      expect(nom.className).toContain('max-sm:whitespace-normal');
      expect(nom.parentElement!.className).toContain('max-sm:flex-wrap');
    },
    ATTENTE_CAS_MS,
  );
});
