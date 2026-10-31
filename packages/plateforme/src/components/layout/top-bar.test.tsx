/**
 * TopBar — retirée sur ordinateur (Val 2026-10-30) : ni titre d'espace ni
 * cloche. Sur téléphone, seul le bouton qui ouvre la barre latérale reste.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TopBar } from './top-bar';

describe('TopBar', () => {
  it('ne garde que le bouton de menu, masqué sur ordinateur', () => {
    const { container } = render(<TopBar onMenuToggle={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Ouvrir le menu' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(container.querySelector('header')?.className).toContain('lg:hidden');
  });

  it('ne rend rien sans bouton de menu', () => {
    const { container } = render(<TopBar />);
    expect(container.firstChild).toBeNull();
  });
});
