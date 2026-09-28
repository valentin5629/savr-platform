/**
 * TimePicker — créneaux de 15 min de 00:00 à 23:45 (formulaire de
 * programmation, CDC §06.01 « Time picker (pas de 15min) »).
 * Épingle : grille exacte (96 créneaux, bornes), aucun input time natif,
 * hauteur unique du déclencheur, choix d'un créneau → valeur `HH:MM`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TimePicker, creneaux } from '@/components/ui/time-picker';

describe('TimePicker', () => {
  it('ds/time_picker_grille_15_min_minuit_a_23h45', () => {
    const liste = creneaux();
    expect(liste).toHaveLength(96);
    expect(liste[0]).toBe('00:00');
    expect(liste[1]).toBe('00:15');
    expect(liste.at(-1)).toBe('23:45');
    expect(liste).not.toContain('24:00');
  });

  it('ds/time_picker_declencheur_sans_input_natif', () => {
    const { container } = render(
      <TimePicker aria-label="Heure de collecte" value="" />,
    );
    expect(container.querySelector('input[type="time"]')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Heure de collecte' });
    expect(trigger.className).toContain('h-11');
    expect(trigger.className).toContain('sm:h-10');
    expect(trigger).toHaveTextContent('Choisir une heure');
  });

  it('ds/time_picker_choix_creneau', () => {
    const onChange = vi.fn();
    render(
      <TimePicker
        aria-label="Heure de collecte"
        value="09:00"
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Heure de collecte' });
    expect(trigger).toHaveTextContent('09:00');
    fireEvent.click(trigger);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(96);
    expect(screen.getByRole('option', { name: '09:00' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('option', { name: '22:45' }));
    expect(onChange).toHaveBeenCalledWith('22:45');
  });

  it('ds/time_picker_valeur_hors_grille_affichee', () => {
    render(<TimePicker aria-label="Heure" value="10:10:00" />);
    expect(screen.getByRole('button', { name: 'Heure' })).toHaveTextContent(
      '10:10',
    );
  });
});
