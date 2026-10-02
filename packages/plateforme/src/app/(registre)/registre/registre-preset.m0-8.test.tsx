/**
 * R23c / BL-P3-10 — Registre : preset « 30 derniers jours » (CDC §06.03 barre de
 * filtres). Teste la fenêtre calculée (helper, date fixe) + le bouton qui applique
 * from/to au clic. Le défaut au chargement reste vide (arbitrage Val R23c).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { periodeDerniers } from '@/lib/periodes-raccourcis';

vi.mock('next/navigation', () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import RegistrePage from './page';

describe('M0.8-58 — Registre : preset « 30 derniers jours » (BL-P3-10)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('helper : fenêtre [J−30 ; J] au format YYYY-MM-DD (date fixe)', () => {
    const r = periodeDerniers(30, 'jours', true, new Date(2026, 6, 10)); // 10 juillet 2026 (mois 0-indexé)
    expect(r).toEqual({ from: '2026-06-10', to: '2026-07-10' });
  });

  it('le raccourci applique la fenêtre 30 jours au filtre Période (défaut vide avant clic)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ rows: [], total: 0 }),
        }),
      ),
    );
    render(<RegistrePage />);

    // Période = un seul champ (DateRangePicker) ; bornes exposées en data-from/data-to.
    const periode = screen.getByTestId('registre-periode');
    // Défaut au chargement = vide (historique complet, arbitrage Val).
    expect(periode).toHaveAttribute('data-from', '');
    expect(periode).toHaveAttribute('data-to', '');

    // Raccourci de la colonne du panneau Période (brouillon), validé par Appliquer.
    fireEvent.click(periode);
    fireEvent.click(screen.getByTestId('registre-preset-30j'));
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));

    const expected = periodeDerniers(30, 'jours')!;
    expect(periode).toHaveAttribute('data-from', expected.from);
    expect(periode).toHaveAttribute('data-to', expected.to);
  });
});
