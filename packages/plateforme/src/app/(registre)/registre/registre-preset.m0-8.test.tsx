/**
 * R23c / BL-P3-10 — Registre : preset « 30 derniers jours » (CDC §06.03 barre de
 * filtres). Teste la fenêtre calculée (helper, date fixe) + le bouton qui applique
 * from/to au clic. Le défaut au chargement reste vide (arbitrage Val R23c).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { preset30JoursRange } from '@/lib/registre-presets';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import RegistrePage from './page';

describe('M0.8-58 — Registre : preset « 30 derniers jours » (BL-P3-10)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('helper : fenêtre [J−30 ; J] au format YYYY-MM-DD (date fixe)', () => {
    const r = preset30JoursRange(new Date(2026, 6, 10)); // 10 juillet 2026 (mois 0-indexé)
    expect(r).toEqual({ from: '2026-06-10', to: '2026-07-10' });
  });

  it('le bouton applique la fenêtre 30 jours aux champs Du/Au (défaut vide avant clic)', () => {
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

    const from = screen.getByTestId('registre-from') as HTMLInputElement;
    const to = screen.getByTestId('registre-to') as HTMLInputElement;
    // Défaut au chargement = vide (historique complet, arbitrage Val).
    expect(from.value).toBe('');
    expect(to.value).toBe('');

    fireEvent.click(screen.getByTestId('registre-preset-30j'));

    const expected = preset30JoursRange();
    expect(from.value).toBe(expected.from);
    expect(to.value).toBe(expected.to);
  });
});
