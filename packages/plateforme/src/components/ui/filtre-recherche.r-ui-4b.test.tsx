/**
 * R-UI-4b (D7) — `FiltreRecherche` : debounce intégré (une seule émission
 * après une rafale de frappes), bouton ✕ (vide et émet tout de suite),
 * `value` externe qui remplace la saisie (reset) sans que son écho ne
 * l'écrase, `onChange` natif conservé.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FiltreRecherche } from '@/components/ui/filtre-en-ligne';

afterEach(() => vi.useRealTimers());

describe('FiltreRecherche (R-UI-4b, D7)', () => {
  it('debounce : 2 frappes rapides → 1 seul onValueChange, après 300 ms', () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(<FiltreRecherche value="" onValueChange={onValueChange} />);
    const champ = screen.getByRole('searchbox', { name: 'Rechercher' });

    fireEvent.change(champ, { target: { value: 'Ka' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(champ, { target: { value: 'Kaspia ' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onValueChange).not.toHaveBeenCalled();
    // La saisie reste affichée telle quelle pendant l'attente.
    expect(champ).toHaveValue('Kaspia ');

    act(() => vi.advanceTimersByTime(1));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    // Émise sans espaces de bord (comme la liste clients le faisait).
    expect(onValueChange).toHaveBeenCalledWith('Kaspia');
  });

  it('✕ : visible seulement avec du texte, vide le champ et émet "" immédiatement', () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(<FiltreRecherche value="" onValueChange={onValueChange} />);
    expect(
      screen.queryByRole('button', { name: 'Effacer la recherche' }),
    ).toBeNull();

    const champ = screen.getByRole('searchbox', { name: 'Rechercher' });
    fireEvent.change(champ, { target: { value: 'Fleur' } });
    act(() => vi.advanceTimersByTime(300));
    expect(onValueChange).toHaveBeenLastCalledWith('Fleur');

    const effacer = screen.getByRole('button', {
      name: 'Effacer la recherche',
    });
    expect(effacer).toHaveAttribute('type', 'button');
    fireEvent.click(effacer);
    // Sans attendre le debounce.
    expect(onValueChange).toHaveBeenLastCalledWith('');
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(champ).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Effacer la recherche' }),
    ).toBeNull();
  });

  it('✕ pendant la frappe : annule le debounce (aucune émission de la saisie)', () => {
    vi.useFakeTimers();
    const onValueChange = vi.fn();
    render(<FiltreRecherche value="abc" onValueChange={onValueChange} />);
    const champ = screen.getByRole('searchbox', { name: 'Rechercher' });
    fireEvent.change(champ, { target: { value: 'abcd' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Effacer la recherche' }),
    );
    act(() => vi.advanceTimersByTime(300));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('');
  });

  it('`value` externe : un reset remplace la saisie, son écho ne l’écrase pas', () => {
    vi.useFakeTimers();
    function Hote() {
      const [q, setQ] = React.useState('');
      return (
        <>
          <FiltreRecherche value={q} onValueChange={setQ} />
          <output data-testid="q">{q}</output>
          <button type="button" onClick={() => setQ('')}>
            reset
          </button>
        </>
      );
    }
    render(<Hote />);
    const champ = screen.getByRole('searchbox', { name: 'Rechercher' });
    fireEvent.change(champ, { target: { value: 'Kaspia ' } });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('q')).toHaveTextContent('Kaspia');
    // L'écho (« Kaspia ») ne rogne pas l'espace en cours de frappe.
    expect(champ).toHaveValue('Kaspia ');

    // Frappe puis reset avant 300 ms : la saisie en vol n'est pas ré-émise
    // après le reset (revue principale #481).
    fireEvent.change(champ, { target: { value: 'Strike' } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(champ).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Effacer la recherche' }),
    ).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByTestId('q')).toHaveTextContent('');
    expect(champ).toHaveValue('');
  });

  it('onChange natif : appelé à chaque frappe (compat)', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FiltreRecherche onChange={onChange} />);
    const champ = screen.getByRole('searchbox', { name: 'Rechercher' });
    fireEvent.change(champ, { target: { value: 'a' } });
    fireEvent.change(champ, { target: { value: 'ab' } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
