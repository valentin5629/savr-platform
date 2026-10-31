/**
 * M1.2 / nom_evenement_client_final — titres des brouillons (décision Val
 * 2026-10-19) : la liste « Mes brouillons » titre par le nom de l'événement, à
 * défaut le client final, à défaut « Sans nom ». La reprise d'un brouillon
 * rouvre le formulaire complet (refonte, lot B2 ; décision Val 2026-10-24,
 * B2-Q2) : le nom de l'événement et le client final y reviennent chacun dans sa
 * case. La liste nomme le type de chaque collecte (« Zéro Déchet »,
 * « Anti-Gaspi »), jamais l'enum de la base.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'evt-1' }),
}));
// Le formulaire lit le rôle dans la session Supabase du navigateur, absente ici.
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => 'traiteur_manager',
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
            collectes: [
              { type: 'zero_dechet', date_collecte: '2030-01-15' },
              { type: 'anti_gaspi', date_collecte: '2030-01-15' },
            ],
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
    'liste : le type de chaque collecte par son libellé, jamais l’enum de la base',
    async () => {
      repondre({
        data: [
          {
            id: 'a',
            nom_evenement: 'Gala de printemps',
            nom_client_organisateur: null,
            created_at: '2026-10-19T08:00:00Z',
            collectes: [
              { type: 'zero_dechet', date_collecte: '2030-01-15' },
              { type: 'anti_gaspi', date_collecte: '2030-01-15' },
            ],
          },
        ],
      });

      render(<BrouillonsPage />);

      const ligne = (
        await screen.findByText('Gala de printemps', undefined, ATTENTE_UI)
      ).closest('li') as HTMLElement;
      expect(
        within(ligne).getByText('Zéro Déchet + Anti-Gaspi'),
      ).toBeInTheDocument();
      expect(within(ligne).queryByText(/ZERO_DECHET|ANTI_GASPI/)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'reprise : le nom de l’événement et le client final rouvrent chacun dans sa case',
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
        await screen.findByDisplayValue(
          'Gala de printemps',
          undefined,
          ATTENTE_UI,
        ),
      ).toBe(screen.getByLabelText(/Nom de l'événement/));
      expect(screen.getByLabelText(/^Client final/)).toHaveValue(
        'Maison Dupont',
      );
    },
    ATTENTE_CAS_MS,
  );
});
