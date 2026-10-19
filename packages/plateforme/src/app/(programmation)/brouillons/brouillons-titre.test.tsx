/**
 * M1.2 / nom_evenement_client_final — titres des brouillons (décision Val
 * 2026-10-19) : la liste « Mes brouillons » et la page « Confirmer le
 * brouillon » titrent par le nom de l'événement, à défaut le client final, à
 * défaut « Sans nom ».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'evt-1' }),
}));

import BrouillonsPage from './page';
import RepriseBrouillonPage from '../programmer/brouillon/[id]/page';

function repondre(corps: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(corps),
      } as Response),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M1.2 / nom_evenement_client_final — titres des brouillons', () => {
  it(
    'liste : nom de l’événement, à défaut client final, à défaut « Sans nom »',
    async () => {
      repondre({
        data: [
          {
            id: 'a',
            nom_evenement: 'Gala de printemps',
            nom_client_organisateur: 'Maison Dupont',
            created_at: '2026-10-19T08:00:00Z',
            collectes: [],
          },
          {
            id: 'b',
            nom_evenement: null,
            nom_client_organisateur: 'Viparis',
            created_at: '2026-10-19T08:00:00Z',
            collectes: [],
          },
          {
            id: 'c',
            nom_evenement: null,
            nom_client_organisateur: null,
            created_at: '2026-10-19T08:00:00Z',
            collectes: [],
          },
        ],
      });

      render(<BrouillonsPage />);

      expect(
        await screen.findByText('Gala de printemps', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.queryByText('Maison Dupont')).toBeNull();
      expect(screen.getByText('Viparis')).toBeInTheDocument();
      expect(screen.getByText('Sans nom')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'reprise : titre = nom de l’événement, pas le client final',
    async () => {
      repondre({
        id: 'evt-1',
        nom_evenement: 'Gala de printemps',
        nom_client_organisateur: 'Maison Dupont',
        collectes: [
          {
            id: 'c1',
            type: 'zero_dechet',
            statut: 'brouillon',
            date_collecte: '2030-01-15',
          },
        ],
      });

      render(<RepriseBrouillonPage />);

      expect(
        await screen.findByText('Gala de printemps', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(screen.queryByText('Maison Dupont')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
