/**
 * R23c / BL-P3-13 — Panneau « Sécurité du compte » (CDC §15 §2.3).
 * Affiche l'historique self des accès admin ; empty-state si aucun ; n'expose
 * jamais l'identité de l'admin.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { SecuriteAccesPanel } from './securite-acces-panel';

function stubFetch(data: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ data }) })),
  );
}

describe('M0.8-61 — Sécurité du compte : historique self des accès admin (BL-P3-13)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('liste les accès admin (date + libellé générique, sans identité admin)', async () => {
    stubFetch([
      { accede_le: '2026-07-01T10:00:00Z', type_acces: 'acces_administrateur' },
    ]);
    render(<SecuriteAccesPanel />);

    await waitFor(() =>
      expect(screen.getByTestId('acces-liste')).toBeInTheDocument(),
    );
    expect(screen.getByText('Sécurité du compte')).toBeInTheDocument();
    expect(screen.getAllByText('Accès administrateur').length).toBeGreaterThan(
      0,
    );
    // Ne fuit aucune identité admin (le composant n'affiche jamais d'email/nom).
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('empty-state quand aucun accès administrateur', async () => {
    stubFetch([]);
    render(<SecuriteAccesPanel />);

    await waitFor(() =>
      expect(screen.getByTestId('acces-vide')).toBeInTheDocument(),
    );
    expect(
      screen.getByText('Aucun accès administrateur enregistré.'),
    ).toBeInTheDocument();
  });
});
