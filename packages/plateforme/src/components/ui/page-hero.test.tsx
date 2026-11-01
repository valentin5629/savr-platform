/**
 * PageHero — logo de l'organisation en haut à droite du bandeau, après les
 * actions (« Programmer une collecte » à sa gauche) — Val 2026-11-01.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHero } from './page-hero';
import { IdentiteProvider } from '@/components/layout/logo-organisation';
import type { IdentiteSession } from '@/lib/identite-session';

const identite: IdentiteSession = {
  organisation: 'Kaspia',
  logoSrc: '/api/v1/mon-organisation/logo?v=1',
  logoAffichable: true,
  utilisateur: 'Camille Martin',
  poste: null,
};

function rendre(id: IdentiteSession | null, actions?: React.ReactNode) {
  return render(
    <IdentiteProvider value={id}>
      <PageHero title="Dashboard" actions={actions} />
    </IdentiteProvider>,
  );
}

describe('PageHero — logo de l’organisation', () => {
  it('à droite, après le bouton principal ; logo entier, nom au survol', () => {
    rendre(identite, <button>Programmer une collecte</button>);
    const logo = screen.getByRole('img', { name: 'Kaspia' });
    const bouton = screen.getByRole('button', {
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

  it('sans action : le logo est quand même à droite', () => {
    rendre(identite);
    expect(
      screen.getByRole('img', { name: 'Kaspia' }).parentElement!.className,
    ).toContain('ml-auto');
  });

  it('sans logo, ou logo introuvable : initiales de l’organisation', () => {
    const { unmount } = rendre({ ...identite, logoSrc: null });
    expect(screen.getByTestId('logo-organisation')).toHaveTextContent('K');
    unmount();

    rendre(identite);
    const tuile = screen.getByTestId('logo-organisation');
    fireEvent.error(tuile.querySelector('img')!);
    expect(tuile.querySelector('img')).toBeNull();
    expect(tuile).toHaveTextContent('K');
  });

  it('staff (logo non affichable) ou hors AppShell : pas de tuile', () => {
    const { unmount } = rendre({ ...identite, logoAffichable: false });
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
    unmount();
    render(<PageHero title="Dashboard" />);
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
  });
});
