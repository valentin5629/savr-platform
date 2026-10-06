/**
 * R-UI-1 H6 — Paramètres CO₂ : lecture staff (GET requireStaff), écriture
 * admin-only (PUT requireAdmin) → bandeau « Lecture seule » pour ops_savr,
 * comme grilles-zd / tarifs-ag / taux-recyclage. H2 : erreur du mix en AlertBar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const roleRef = vi.hoisted(() => ({ current: 'admin_savr' }));
vi.mock('@/lib/use-user-role', () => ({
  useUserRole: () => roleRef.current,
}));

import ParametresCo2Page from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const LECTURE_SEULE = 'Lecture seule — édition réservée admin.';
const mix = [
  {
    id: 'mx-1',
    code_materiau: 'verre',
    nom_materiau: 'Verre',
    part_pct: 100,
    fe_induit_kg_t: 1,
    fe_evite_kg_t: 2,
  },
];

beforeEach(() => {
  roleRef.current = 'admin_savr';
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT')
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: 'Somme du mix invalide' }),
      }) as unknown as Promise<Response>;
    const data = url.includes('mix-emballages')
      ? mix
      : url.includes('facteurs-co2-ag')
        ? null
        : [];
    return Promise.resolve({
      ok: true,
      json: async () => ({ data }),
    }) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('R-UI-1 — Paramètres CO₂', () => {
  it(
    'ops_savr : bandeau « Lecture seule » affiché',
    async () => {
      roleRef.current = 'ops_savr';
      render(<ParametresCo2Page />);
      expect(
        await screen.findByText(LECTURE_SEULE, {}, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'admin_savr : pas de bandeau ; erreur API du mix en AlertBar err',
    async () => {
      render(<ParametresCo2Page />);
      await screen.findByText('Mix emballages (7 matériaux)', {}, ATTENTE_UI);
      expect(screen.queryByText(LECTURE_SEULE)).not.toBeInTheDocument();

      // R-UI-5 F7 : marqueur obligatoire = astérisque (`Label required`).
      const commentaires = screen.getAllByLabelText(
        /^Commentaire de modification\*$/,
      );
      fireEvent.change(commentaires[1]!, {
        target: { value: 'Mise à jour ADEME' },
      });
      const boutons = screen.getAllByRole('button', { name: /Enregistrer/ });
      fireEvent.click(boutons[1]!);
      const message = await screen.findByText(
        'Somme du mix invalide',
        {},
        ATTENTE_UI,
      );
      expect(message.closest('.bg-savr-error-subtle')).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
