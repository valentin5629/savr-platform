/**
 * Sidebar — « Se déconnecter » tout en bas (Val 2026-10-30, ex-TopBar,
 * décision du bouton toujours affiché : Val 2026-07-03) ; picto à droite du
 * nom de l'utilisateur et de son poste, sur la même ligne, le logo de
 * l'organisation passant dans le bandeau de page (Val 2026-11-01).
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
import type { IdentiteSession } from '@/lib/identite-session';

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

describe('Sidebar — utilisateur et poste à gauche de la déconnexion', () => {
  const identite: IdentiteSession = {
    organisation: 'Viparis',
    logoSrc: '/api/v1/mon-organisation/logo?v=1',
    logoAffichable: true,
    utilisateur: 'Camille Martin',
    poste: 'Responsable RSE',
  };

  it('nom puis poste, sans organisation ni logo (passés dans le bandeau)', () => {
    render(<Sidebar role="gestionnaire_lieux" identite={identite} />);
    const bloc = screen.getByTestId('identite-session');
    const lignes = Array.from(bloc.querySelectorAll('p')).map(
      (p) => p.textContent,
    );
    expect(lignes).toEqual(['Camille Martin', 'Responsable RSE']);
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
    expect(screen.queryByText('Viparis')).toBeNull();
  });

  it('déconnexion à droite, sur la même ligne : picto seul de 44 px', () => {
    render(<Sidebar role="traiteur_manager" identite={identite} />);
    const bloc = screen.getByTestId('identite-session');
    const bouton = screen.getByRole('button', { name: 'Se déconnecter' });
    expect(bouton.parentElement).toBe(bloc.parentElement);
    expect(
      bloc.compareDocumentPosition(bouton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(bouton).not.toHaveTextContent('Se déconnecter');
    expect(bouton.getAttribute('title')).toBe('Se déconnecter');
    expect(bouton.className).toContain('h-11 w-11');
    // Texte tronqué : lisible en entier au survol.
    expect(bloc.getAttribute('title')).toBe('Camille Martin — Responsable RSE');
  });

  it('sans poste : le nom seul', () => {
    render(
      <Sidebar
        role="traiteur_manager"
        identite={{ ...identite, poste: null }}
      />,
    );
    const bloc = screen.getByTestId('identite-session');
    expect(bloc.querySelectorAll('p')).toHaveLength(1);
    expect(bloc.getAttribute('title')).toBe('Camille Martin');
  });

  it('barre réduite : picto seul, nom gardé pour les lecteurs d’écran', () => {
    render(
      <Sidebar
        role="gestionnaire_lieux"
        collapsed
        onToggle={() => {}}
        identite={identite}
      />,
    );
    const bloc = screen.getByTestId('identite-session');
    expect(bloc.className).toContain('sr-only');
    expect(bloc).toHaveTextContent('Camille Martin');
  });

  it('sans identité : pas de bloc, le bouton garde son libellé', () => {
    render(<Sidebar role="gestionnaire_lieux" />);
    expect(screen.queryByTestId('identite-session')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Se déconnecter' }),
    ).toHaveTextContent('Se déconnecter');
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
