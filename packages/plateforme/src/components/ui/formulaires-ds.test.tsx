/**
 * DS « Mise en page des formulaires et filtres » — composants shadcn stylés
 * Savr : Combobox, DateRangePicker, ToggleGroup, FilterBar.
 * Épingle ce qui est régressable : hauteur unique des contrôles (h-11 sm:h-10),
 * sélection simple / multiple du Combobox, période appliquée seulement au clic
 * « Appliquer », réinitialisation visible seulement si un filtre est actif.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FilterBar } from '@/components/ui/filter-bar';
import { Modal } from '@/components/ui/modal';
import { dateVersIso, isoVersDate } from '@/lib/date-iso';

const OPTIONS = [
  { value: '', label: 'Tous les lieux' },
  { value: 'a', label: 'Pavillon Gabriel' },
  { value: 'b', label: 'Carreau du Temple' },
];

describe('Combobox', () => {
  it('ds/combobox_hauteur_controle_unique', () => {
    render(<Combobox aria-label="Lieu" options={OPTIONS} value="" />);
    const trigger = screen.getByRole('combobox', { name: 'Lieu' });
    expect(trigger.className).toContain('h-11');
    expect(trigger.className).toContain('sm:h-10');
    // Option vide sélectionnée = placeholder affiché.
    expect(trigger).toHaveTextContent('Sélectionner…');
  });

  it('ds/combobox_simple_emet_la_valeur_et_se_ferme', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        aria-label="Lieu"
        options={OPTIONS}
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Lieu' }));
    fireEvent.click(screen.getByRole('option', { name: 'Carreau du Temple' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('ds/combobox_multiple_cumule_et_reste_ouvert', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        multiple
        icon={null}
        aria-label="Statut"
        placeholder="Tous"
        options={OPTIONS.slice(1)}
        value={['a']}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Statut' });
    expect(trigger).toHaveTextContent('Pavillon Gabriel');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Carreau du Temple' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    // « Tous » vide la sélection.
    fireEvent.click(screen.getByRole('option', { name: 'Tous' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('ds/combobox_name_rend_un_champ_de_formulaire', () => {
    const { container } = render(
      <Combobox name="lieu_id" options={OPTIONS} value="a" />,
    );
    expect(
      container.querySelector('input[type="hidden"][name="lieu_id"]'),
    ).toHaveValue('a');
  });
});

describe('DateRangePicker', () => {
  it('ds/periode_affichee_en_un_seul_champ', () => {
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Période' });
    expect(trigger).toHaveTextContent('1 sept. 2026 – 30 sept. 2026');
    expect(trigger.className).toContain('h-11');
  });

  it('ds/periode_effacer_vide_les_deux_bornes', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Période' }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
  });

  it('ds/periode_appliquee_seulement_au_clic_appliquer', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Période' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});

describe('date-iso', () => {
  it('ds/iso_date_aller_retour_sans_decalage_de_fuseau', () => {
    expect(dateVersIso(isoVersDate('2026-03-29'))).toBe('2026-03-29');
    expect(isoVersDate('2026-13-01')).toBeDefined(); // normalisé par Date
    expect(isoVersDate('pas-une-date')).toBeUndefined();
    expect(dateVersIso(undefined)).toBe('');
  });
});

describe('ToggleGroup', () => {
  it('ds/toggle_actif_en_aplat_primary_700', () => {
    render(
      <ToggleGroup type="single" value="zd" aria-label="Type">
        <ToggleGroupItem value="zd">Zéro Déchet</ToggleGroupItem>
        <ToggleGroupItem value="ag">Anti-Gaspi</ToggleGroupItem>
      </ToggleGroup>,
    );
    const actif = screen.getByRole('radio', { name: 'Zéro Déchet' });
    expect(actif).toHaveAttribute('data-state', 'on');
    expect(actif.className).toContain('data-[state=on]:bg-savr-primary-700');
  });
});

describe('FilterBar', () => {
  it('ds/filterbar_reinitialiser_visible_seulement_si_actif', () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <FilterBar data-testid="fb" count="3 résultats" onReset={onReset}>
        <div>champ</div>
      </FilterBar>,
    );
    expect(screen.queryByTestId('fb-reset')).toBeNull();
    expect(screen.getByTestId('fb-count')).toHaveTextContent('3 résultats');
    rerender(
      <FilterBar data-testid="fb" count="3 résultats" actif onReset={onReset}>
        <div>champ</div>
      </FilterBar>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Réinitialiser les filtres' }),
    );
    expect(onReset).toHaveBeenCalled();
  });

  it('ds/filterbar_conteneur_et_grille_trois_colonnes', () => {
    render(
      <FilterBar data-testid="fb" tabs={<div>onglets</div>}>
        <div>champ</div>
      </FilterBar>,
    );
    const bloc = screen.getByTestId('fb');
    expect(bloc.className).toContain('rounded-savr-xl');
    expect(bloc.className).toContain('border-savr-neutral-200');
    const grille = screen.getByText('champ').parentElement!;
    expect(grille.className).toContain('repeat(auto-fill');
  });
});

describe('Combobox dans une Modal', () => {
  it('ds/echap_ferme_la_liste_pas_la_modale', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Test" onClose={onClose}>
        <Combobox aria-label="Lieu" options={OPTIONS} value="" />
      </Modal>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Lieu' }));
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(onClose).not.toHaveBeenCalled();
    // Liste fermée : Échap ferme maintenant la modale.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
