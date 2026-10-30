/**
 * Rangée de badges sur une ligne (décision Val 2026-10-30, registre : flux) :
 * au-delà de `max`, une pastille « +N » regroupe le reste, listé au survol et
 * aux lecteurs d'écran.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgesLigne } from '@/components/ui/badges-ligne';

const FLUX = ['Biodéchets', 'Emballages', 'Carton', 'Verre', 'Déchet résiduel'];

describe('BadgesLigne', () => {
  it('affiche les deux premiers et regroupe le reste dans « +3 »', () => {
    const { container } = render(<BadgesLigne libelles={FLUX} />);
    expect(screen.getByText('Biodéchets')).toBeTruthy();
    expect(screen.getByText('Emballages')).toBeTruthy();
    expect(screen.queryByText('Carton')).toBeNull();
    const reste = screen.getByTestId('badges-ligne-reste');
    expect(reste.textContent).toBe('+3 : Carton, Verre, Déchet résiduel');
    expect(container.firstElementChild?.getAttribute('title')).toBe(
      FLUX.join(', '),
    );
  });

  it('sans dépassement : aucune pastille « +N »', () => {
    render(<BadgesLigne libelles={['Carton', 'Verre']} />);
    expect(screen.queryByTestId('badges-ligne-reste')).toBeNull();
  });
});
