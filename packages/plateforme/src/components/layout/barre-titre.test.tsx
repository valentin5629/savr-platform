/**
 * Titre de page dans la barre bleu ciel du haut (Val 2026-11-03) : dans le
 * cadre de l'application, PageHero place son titre dans la barre et ne garde
 * dans la page que ses actions ; hors du cadre, le bandeau pâle reste.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PageHero } from '@/components/ui/page-hero';
import { AppShell } from './app-shell';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/gestionnaire/collectes',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe('Titre de page dans la barre du haut', () => {
  it('dans le cadre : le titre est dans la barre, un seul titre, pas de bandeau', () => {
    render(
      <AppShell role="gestionnaire_lieux">
        <PageHero title="Collectes" actions={<button>Exporter</button>} />
      </AppShell>,
    );
    const barre = screen.getByTestId('barre-haut');
    expect(
      within(barre).getByRole('heading', { level: 1, name: 'Collectes' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const main = document.getElementById('main-content')!;
    expect(main.querySelector('header')).toBeNull();
    // Les actions restent dans la page, en tête du contenu.
    expect(within(main).getByTestId('actions-page').textContent).toContain(
      'Exporter',
    );
  });

  it('sans action : rien dans la page', () => {
    render(
      <AppShell role="gestionnaire_lieux">
        <PageHero title="Traiteurs" />
      </AppShell>,
    );
    expect(screen.queryByTestId('actions-page')).toBeNull();
  });

  it('barre bleu ciel, détachée de la barre latérale par un coin arrondi', () => {
    render(
      <AppShell role="gestionnaire_lieux">
        <p>contenu</p>
      </AppShell>,
    );
    const barre = screen.getByTestId('barre-haut');
    expect(barre.className).toContain('bg-savr-primary-100');
    expect(barre.className).toContain('lg:rounded-tl-savr-md');
    expect(document.getElementById('main-content')!.className).not.toContain(
      'rounded-tl',
    );
  });

  it('hors du cadre : bandeau pâle dans la page', () => {
    const { container } = render(<PageHero title="CGU" />);
    const header = container.querySelector('header')!;
    expect(header.className).toContain('bg-savr-primary-100');
    expect(within(header).getByRole('heading', { level: 1 })).toBeTruthy();
  });
});

describe('Barre latérale élargie et allégée (Val 2026-11-03)', () => {
  it('224 px dépliée, libellés sur une seule ligne', () => {
    const { container } = render(<Sidebar role="gestionnaire_lieux" />);
    const nav = container.querySelector('nav')!;
    expect(nav.className).toContain('w-56');
    const libelle = screen.getByText('Registre réglementaire');
    expect(libelle.className).toContain('whitespace-nowrap');
  });
});
