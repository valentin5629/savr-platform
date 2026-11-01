/**
 * Sidebar — « Se déconnecter » tout en bas (Val 2026-10-30, ex-TopBar,
 * décision du bouton toujours affiché : Val 2026-07-03) ; picto à droite de
 * l'organisation et de l'utilisateur, sur la même ligne (Val 2026-11-01). Par défaut il appelle
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

describe('Sidebar — organisation et utilisateur au-dessus de la déconnexion', () => {
  const identite = {
    organisation: 'Viparis',
    logoSrc: '/api/v1/mon-organisation/logo?v=1',
    utilisateur: 'Camille Martin',
  };

  it('logo entier (non rogné), nom de l’organisation puis de l’utilisateur', () => {
    render(<Sidebar role="gestionnaire_lieux" identite={identite} />);
    const bloc = screen.getByTestId('identite-session');
    const lignes = Array.from(bloc.querySelectorAll('p')).map(
      (p) => p.textContent,
    );
    expect(lignes).toEqual(['Viparis', 'Camille Martin']);
    const img = bloc.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(identite.logoSrc);
    expect(img.getAttribute('class')).toContain('object-contain');
    // Le bloc précède le bouton de déconnexion.
    const bouton = screen.getByRole('button', { name: 'Se déconnecter' });
    expect(
      bloc.compareDocumentPosition(bouton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('déconnexion à droite des noms, sur la même ligne : picto seul de 44 px (Val 2026-11-01)', () => {
    render(<Sidebar role="traiteur_manager" identite={identite} />);
    const bloc = screen.getByTestId('identite-session');
    const bouton = screen.getByRole('button', { name: 'Se déconnecter' });
    const ligne = bloc.parentElement!;
    expect(bouton.parentElement).toBe(ligne);
    expect(ligne.className).toContain('flex');
    expect(ligne.className).not.toContain('flex-col');
    expect(bouton).not.toHaveTextContent('Se déconnecter');
    expect(bouton.getAttribute('title')).toBe('Se déconnecter');
    expect(bouton.className).toContain('h-11 w-11');
    // Noms tronqués : lisibles en entier au survol.
    expect(bloc.getAttribute('title')).toBe('Viparis — Camille Martin');
  });

  it('barre réduite : le picto passe sous le logo', () => {
    render(
      <Sidebar
        role="traiteur_manager"
        collapsed
        onToggle={() => {}}
        identite={identite}
      />,
    );
    const ligne = screen.getByTestId('identite-session').parentElement!;
    expect(ligne.className).toContain('flex-col');
  });

  it('sans logo, ou logo introuvable : initiales de l’organisation', () => {
    const { unmount } = render(
      <Sidebar
        role="gestionnaire_lieux"
        identite={{
          ...identite,
          organisation: 'Pavillon Gabriel',
          logoSrc: null,
        }}
      />,
    );
    expect(screen.getByTestId('logo-organisation')).toHaveTextContent('PG');
    unmount();

    render(<Sidebar role="gestionnaire_lieux" identite={identite} />);
    const tuile = screen.getByTestId('logo-organisation');
    fireEvent.error(tuile.querySelector('img')!);
    expect(tuile.querySelector('img')).toBeNull();
    expect(tuile).toHaveTextContent('V');
  });

  it('barre réduite : logo seul, noms gardés pour les lecteurs d’écran', () => {
    render(
      <Sidebar
        role="gestionnaire_lieux"
        collapsed
        onToggle={() => {}}
        identite={identite}
      />,
    );
    const bloc = screen.getByTestId('identite-session');
    expect(bloc.getAttribute('title')).toBe('Viparis — Camille Martin');
    expect(bloc.querySelector('.sr-only')).toHaveTextContent('Viparis');
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
