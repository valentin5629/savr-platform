import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiensLegaux } from './liens-legaux';

// Liens légaux discrets (Val 2026-11-16) : écrans d'authentification et bas de
// l'onglet « Mon profil ».
describe('LiensLegaux', () => {
  it('pointe vers les mentions légales et la politique de confidentialité', () => {
    render(<LiensLegaux />);
    expect(
      screen.getByRole('link', { name: 'Mentions légales' }),
    ).toHaveAttribute('href', '/mentions-legales');
    expect(
      screen.getByRole('link', { name: 'Confidentialité' }),
    ).toHaveAttribute('href', '/confidentialite');
    expect(
      screen.getByRole('link', { name: 'Confidentialité' }),
    ).not.toHaveAttribute('target');
  });

  it('depuis l’app : nouvel onglet, sans quitter l’écran en cours', () => {
    render(<LiensLegaux nouvelOnglet />);
    for (const nom of ['Mentions légales', 'Confidentialité']) {
      const lien = screen.getByRole('link', { name: nom });
      expect(lien).toHaveAttribute('target', '_blank');
      expect(lien).toHaveAttribute('rel', 'noopener');
    }
  });
});
