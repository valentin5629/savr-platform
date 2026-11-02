import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/layout/app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/traiteur',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('AppShell — zone de contenu', () => {
  // Bug E2E 2026-11-02 (/traiteur) : des textes `sr-only` sans ancêtre
  // positionné se plaçaient par rapport à la page, la rendaient défilable
  // derrière le cadre et laissaient une bande vide en bas de l'écran.
  it('la zone défilante ancre les éléments en position absolue', () => {
    render(
      <AppShell role="traiteur_manager" hiddenNavHrefs={[]}>
        <p>contenu</p>
      </AppShell>,
    );
    const main = screen.getByRole('main');
    expect(main.className.split(/\s+/)).toContain('relative');
    expect(main.className.split(/\s+/)).toContain('overflow-y-auto');
  });
});
