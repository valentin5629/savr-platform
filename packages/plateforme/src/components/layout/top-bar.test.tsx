/**
 * TopBar — barre navy du haut (Val 2026-11-02) : « Programmer une collecte »
 * puis le logo de l'organisation, à droite ; sur téléphone, le bouton qui ouvre
 * la barre latérale, à gauche.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TopBar } from './top-bar';
import { IdentiteProvider } from '@/components/layout/logo-organisation';
import type { IdentiteSession } from '@/lib/identite-session';
import type { NavRole } from '@/lib/roles';

let pathname = '/gestionnaire';
let recherche = '';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(recherche),
}));

const identite: IdentiteSession = {
  organisation: 'Kaspia',
  logoSrc: '/api/v1/mon-organisation/logo?v=1',
  logoAffichable: true,
  utilisateur: 'Camille Martin',
  poste: null,
};

function rendre(role: NavRole, id: IdentiteSession | null = identite) {
  return render(
    <IdentiteProvider value={id}>
      <TopBar role={role} onMenuToggle={() => {}} />
    </IdentiteProvider>,
  );
}

beforeEach(() => {
  pathname = '/gestionnaire';
  recherche = '';
});

describe('TopBar', () => {
  it('bouton de menu masqué sur ordinateur, ni titre ni cloche', () => {
    rendre('traiteur_manager');
    const menu = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(menu.className).toContain('lg:hidden');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
  });

  it('sans bouton de menu : pas de bouton « Ouvrir le menu »', () => {
    render(<TopBar role="traiteur_manager" />);
    expect(screen.queryByRole('button', { name: 'Ouvrir le menu' })).toBeNull();
  });

  it.each([
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'admin_savr',
  ] as const)('%s : « Programmer une collecte » vers le formulaire', (role) => {
    rendre(role);
    expect(
      screen.getByRole('link', { name: 'Programmer une collecte' }),
    ).toHaveAttribute('href', '/programmer/nouveau');
  });

  it('client organisateur : pas de bouton (il ne programme pas)', () => {
    rendre('client_organisateur');
    expect(
      screen.queryByRole('link', { name: 'Programmer une collecte' }),
    ).toBeNull();
  });

  it('liste Collectes filtrée par type : formulaire ouvert sur ce type (§06.04)', () => {
    pathname = '/traiteur/collectes';
    recherche = 'onglet=a_venir&type=anti_gaspi';
    rendre('traiteur_manager');
    expect(
      screen.getByRole('link', { name: 'Programmer une collecte' }),
    ).toHaveAttribute('href', '/programmer/nouveau?type=anti_gaspi');
  });

  it('type hors liste Collectes, ou inconnu : formulaire sans type', () => {
    pathname = '/traiteur';
    recherche = 'type=anti_gaspi';
    const { unmount } = rendre('traiteur_manager');
    expect(
      screen.getByRole('link', { name: 'Programmer une collecte' }),
    ).toHaveAttribute('href', '/programmer/nouveau');
    unmount();
    pathname = '/traiteur/collectes';
    recherche = 'type=autre';
    rendre('traiteur_manager');
    expect(
      screen.getByRole('link', { name: 'Programmer une collecte' }),
    ).toHaveAttribute('href', '/programmer/nouveau');
  });

  it('sur le formulaire lui-même : pas de bouton', () => {
    pathname = '/programmer/nouveau';
    rendre('traiteur_manager');
    expect(
      screen.queryByRole('link', { name: 'Programmer une collecte' }),
    ).toBeNull();
  });

  it('logo de l’organisation à droite du bouton, entier, nom au survol', () => {
    rendre('gestionnaire_lieux');
    const logo = screen.getByRole('img', { name: 'Kaspia' });
    const bouton = screen.getByRole('link', {
      name: 'Programmer une collecte',
    });
    expect(
      bouton.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(logo.getAttribute('title')).toBe('Kaspia');
    const img = logo.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(identite.logoSrc);
    expect(img.getAttribute('class')).toContain('object-contain');
  });

  it('sans logo, ou logo introuvable : initiales de l’organisation', () => {
    const { unmount } = rendre('agence', { ...identite, logoSrc: null });
    expect(screen.getByTestId('logo-organisation')).toHaveTextContent('K');
    unmount();

    rendre('agence');
    const tuile = screen.getByTestId('logo-organisation');
    fireEvent.error(tuile.querySelector('img')!);
    expect(tuile.querySelector('img')).toBeNull();
    expect(tuile).toHaveTextContent('K');
  });

  it('staff (logo non affichable) ou organisation illisible : pas de tuile', () => {
    const { unmount } = rendre('admin_savr', {
      ...identite,
      logoAffichable: false,
    });
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
    unmount();
    rendre('traiteur_manager', { ...identite, organisation: null });
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
  });
});
