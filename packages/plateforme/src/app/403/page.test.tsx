import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page403 from './page';

// Page 403 habillée au design system (décision Val 2026-10-28).
describe('page 403', () => {
  it('affiche le titre, l’explication et un bouton de retour à l’accueil', () => {
    render(<Page403 />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Accès refusé' }),
    ).toBeTruthy();
    expect(screen.getByText(/droits nécessaires/)).toBeTruthy();
    const lien = screen.getByRole('link', { name: 'Retour à l’accueil' });
    expect(lien.getAttribute('href')).toBe('/');
    expect(lien.className).toContain('bg-savr-primary-700');
  });

  it('n’utilise plus de style en ligne', () => {
    const { container } = render(<Page403 />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
