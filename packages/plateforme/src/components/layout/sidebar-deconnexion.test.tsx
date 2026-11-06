/**
 * Sidebar — « Se déconnecter » tout en bas (Val 2026-10-30, ex-TopBar,
 * décision du bouton toujours affiché : Val 2026-07-03) ; avec une identité,
 * avatar, nom et poste ouvrent un menu « Paramètres » / « Se déconnecter »
 * (Val 2026-11-02), le logo de l'organisation passant dans le bandeau.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockSignOut = vi.fn().mockResolvedValue({ error: null });
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { signOut: mockSignOut } }),
}));
const mockPathname = vi.hoisted(() => vi.fn(() => '/gestionnaire'));
vi.mock('next/navigation', () => ({ usePathname: mockPathname }));
vi.mock('next/link', async () => {
  const { forwardRef } = await import('react');
  // Fait suivre les attributs : le menu pose role="menuitem" sur le lien.
  const Lien = forwardRef<HTMLAnchorElement, React.ComponentProps<'a'>>(
    (props, ref) => <a ref={ref} {...props} />,
  );
  return { default: Lien };
});

import { Sidebar } from './sidebar';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import type { IdentiteSession } from '@/lib/identite-session';

const originalLocation = window.location;

beforeEach(() => {
  mockSignOut.mockClear();
  mockPathname.mockReturnValue('/gestionnaire');
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

describe('Sidebar — menu de l’utilisateur en pied de menu (Val 2026-11-02)', () => {
  const identite: IdentiteSession = {
    organisation: 'Viparis',
    logoSrc: '/api/v1/mon-organisation/logo?v=1',
    logoAffichable: true,
    utilisateur: 'Camille Martin',
    poste: 'Responsable RSE',
  };

  function ouvrir() {
    const bouton = screen.getByTestId('menu-utilisateur');
    fireEvent.keyDown(bouton, { key: 'Enter' });
    return bouton;
  }

  it('avatar aux initiales, nom puis poste, sans organisation ni logo', () => {
    render(<Sidebar role="gestionnaire_lieux" identite={identite} />);
    const bouton = screen.getByTestId('menu-utilisateur');
    expect(screen.getByTestId('avatar-utilisateur')).toHaveTextContent('CM');
    expect(screen.getByTestId('identite-session')).toHaveTextContent(
      'Camille MartinResponsable RSE',
    );
    expect(bouton.getAttribute('title')).toBe(
      'Camille Martin — Responsable RSE',
    );
    expect(bouton.className).toContain('min-h-11');
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
    expect(screen.queryByText('Viparis')).toBeNull();
  });

  it('clic sur le nom : menu « Paramètres », « Confidentialité », « Se déconnecter »', () => {
    render(<Sidebar role="traiteur_manager" identite={identite} />);
    expect(screen.queryByRole('menu')).toBeNull();
    ouvrir();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Paramètres',
      'Confidentialité',
      'Mentions légales',
      'Se déconnecter',
    ]);
    expect(items[0]!.getAttribute('href')).toBe('/traiteur/parametres');
    // Politique de confidentialité (CDC §15, 3.4) : nouvel onglet.
    expect(items[1]!.getAttribute('href')).toBe('/confidentialite');
    expect(items[1]!.getAttribute('target')).toBe('_blank');
    expect(items[1]!.getAttribute('rel')).toBe('noopener');
    expect(items[2]!.getAttribute('href')).toBe('/mentions-legales');
    expect(items[2]!.getAttribute('target')).toBe('_blank');
  });

  it('« Paramètres » quitte la navigation principale', () => {
    render(<Sidebar role="traiteur_manager" identite={identite} />);
    expect(screen.queryByRole('link', { name: 'Paramètres' })).toBeNull();
  });

  it(
    '« Se déconnecter » du menu → signOut() puis /login',
    async () => {
      render(<Sidebar role="gestionnaire_lieux" identite={identite} />);
      ouvrir();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }));
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

  it('barre réduite : avatar seul, nom au survol, menu toujours là', () => {
    render(
      <Sidebar
        role="traiteur_manager"
        collapsed
        onToggle={() => {}}
        identite={identite}
      />,
    );
    expect(screen.queryByTestId('identite-session')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Menu de Camille Martin' }),
    ).toHaveTextContent('CM');
    ouvrir();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('Admin : « Paramètres » (réglages métier) reste dans la barre, le menu ne porte que la confidentialité et la déconnexion', () => {
    render(<Sidebar role="admin_savr" identite={identite} />);
    expect(
      screen.getByRole('link', { name: 'Paramètres' }),
    ).toBeInTheDocument();
    ouvrir();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Confidentialité',
      'Mentions légales',
      'Se déconnecter',
    ]);
  });

  it('page Paramètres ouverte : le bouton du menu porte la marque active', () => {
    mockPathname.mockReturnValue('/traiteur/parametres');
    render(<Sidebar role="traiteur_manager" identite={identite} />);
    expect(screen.getByTestId('menu-utilisateur').className).toContain(
      'bg-savr-white/10',
    );
    ouvrir();
    expect(
      screen
        .getByRole('menuitem', { name: 'Paramètres' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('un onLogout explicite est appelé depuis le menu (pas de signOut auto)', () => {
    const onLogout = vi.fn();
    render(
      <Sidebar
        role="gestionnaire_lieux"
        identite={identite}
        onLogout={onLogout}
      />,
    );
    ouvrir();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Se déconnecter' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('sans poste : le nom seul', () => {
    render(
      <Sidebar
        role="traiteur_manager"
        identite={{ ...identite, poste: null }}
      />,
    );
    expect(screen.getByTestId('identite-session')).toHaveTextContent(
      /^Camille Martin$/,
    );
    expect(screen.getByTestId('menu-utilisateur').getAttribute('title')).toBe(
      'Camille Martin',
    );
  });

  it('sans identité : bouton « Se déconnecter » avec libellé, Paramètres dans la navigation', () => {
    render(<Sidebar role="traiteur_manager" />);
    expect(screen.queryByTestId('menu-utilisateur')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Se déconnecter' }),
    ).toHaveTextContent('Se déconnecter');
    expect(
      screen.getByRole('link', { name: 'Paramètres' }),
    ).toBeInTheDocument();
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
