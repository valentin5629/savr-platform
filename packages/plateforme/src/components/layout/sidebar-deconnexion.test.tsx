/**
 * Sidebar — « Se déconnecter » tout en bas à gauche (Val 2026-10-30, ex-TopBar,
 * décision du bouton toujours affiché : Val 2026-07-03). Par défaut il appelle
 * `signOut()` puis redirige vers /login ; un `onLogout` explicite prend le dessus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { signOut: mockSignOut } }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/gestionnaire' }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { Sidebar } from './sidebar';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe('Sidebar — déconnexion', () => {
  it('« Se déconnecter » est le dernier bouton de la navigation', () => {
    render(<Sidebar role="gestionnaire_lieux" onToggle={() => {}} />);
    const boutons = screen.getAllByRole('button');
    expect(boutons.at(-1)).toHaveAccessibleName('Se déconnecter');
    expect(boutons.at(-1)).toHaveTextContent('Se déconnecter');
  });

  it('navigation réduite : icône seule, nom accessible conservé', () => {
    render(<Sidebar role="gestionnaire_lieux" collapsed onToggle={() => {}} />);
    const bouton = screen.getByRole('button', { name: 'Se déconnecter' });
    expect(bouton).not.toHaveTextContent('Se déconnecter');
  });

  it('présent aussi dans la navigation mobile (sans bouton réduire)', () => {
    render(<Sidebar role="traiteur_manager" />);
    expect(
      screen.getByRole('button', { name: 'Se déconnecter' }),
    ).toBeInTheDocument();
  });

  it(
    'clic → signOut() puis redirection vers /login',
    async () => {
      render(<Sidebar role="gestionnaire_lieux" />);
      fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
      await waitFor(
        () => expect(mockSignOut).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(window.location.href).toBe('/login'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it('un onLogout explicite prend le dessus (pas de signOut auto)', () => {
    const onLogout = vi.fn();
    render(<Sidebar role="gestionnaire_lieux" onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });
});
