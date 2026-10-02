/**
 * SavrLogoMark — couleur de base. Blanc par défaut (sidebar navy, zone figée
 * #221 : rendu inchangé) ; `base` la remplace (écrans d'authentification sur
 * fond clair) sans fuiter dans le DOM.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SavrLogoMark } from '@/components/layout/savr-logo';

describe('SavrLogoMark — couleur de base', () => {
  it('sans `base` : logo peint en blanc (rendu sidebar inchangé)', () => {
    const { container } = render(<SavrLogoMark />);
    const rectBase = container.querySelector('svg > rect');
    expect(rectBase?.getAttribute('fill')).toBe('var(--color-savr-white)');
  });

  it('avec `base` : logo peint dans la couleur fournie', () => {
    const { container } = render(
      <SavrLogoMark base="var(--color-savr-primary-700)" />,
    );
    const rectBase = container.querySelector('svg > rect');
    expect(rectBase?.getAttribute('fill')).toBe(
      'var(--color-savr-primary-700)',
    );
  });

  it("`base` n'est pas transmis comme attribut du <svg>", () => {
    const { container } = render(<SavrLogoMark base="#223870" />);
    expect(container.querySelector('svg')?.hasAttribute('base')).toBe(false);
  });
});
