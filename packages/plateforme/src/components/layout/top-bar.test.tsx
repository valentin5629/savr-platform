/**
 * TopBar — bouton « Se déconnecter » (décision Val 2026-07-03).
 * Le bouton est toujours affiché (les layouts Server Components ne peuvent pas
 * fournir de handler) : par défaut il appelle `signOut()` puis redirige vers
 * /login. Un `onLogout` explicite, s'il est fourni, prend le dessus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { signOut: mockSignOut } }),
}));

import { TopBar } from './top-bar';

const originalLocation = window.location;

beforeEach(() => {
  mockSignOut.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe('TopBar — déconnexion', () => {
  it('affiche le bouton « Se déconnecter »', () => {
    render(<TopBar title="Espace traiteur" userName="a@b.c" />);
    expect(
      screen.getByRole('button', { name: 'Se déconnecter' }),
    ).toBeInTheDocument();
  });

  it('clic → signOut() puis redirection vers /login', async () => {
    render(<TopBar title="Espace traiteur" userName="a@b.c" />);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toBe('/login'));
  });

  it('un onLogout explicite prend le dessus (pas de signOut auto)', () => {
    const onLogout = vi.fn();
    render(<TopBar userName="a@b.c" onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });
});
