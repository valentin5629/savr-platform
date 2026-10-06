/**
 * R-UI-5 — champs de formulaire (F1, F2, F3, F7, F11) : FormGrid (une seule
 * recette de grille responsive), RadioGroup maison (radios natifs, sans
 * Radix), Label `required` (astérisque seul) et Label `choice` (libellé d'une
 * case / d'un radio), bornes texte libre importables côté client.
 * Chaque test fige la RECETTE ou le CONTRAT que la primitive centralise.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FormGrid } from '@/components/ui/form-grid';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { BORNES_TEXTE_LIBRE as BORNES_PURES } from '@/lib/champs-texte-libre-bornes';
import { BORNES_TEXTE_LIBRE } from '@/lib/champs-texte-libre';

describe('FormGrid — une seule recette de grille de champs (§5.5 règle 4)', () => {
  it('défaut 2 colonnes : 1 colonne en mobile, 2 dès sm, gap 16 px', () => {
    render(
      <FormGrid data-testid="grille">
        <div />
        <div />
      </FormGrid>,
    );
    const g = screen.getByTestId('grille');
    expect(g.className).toContain('grid');
    expect(g.className).toContain('grid-cols-1');
    expect(g.className).toContain('gap-4');
    expect(g.className).toContain('sm:grid-cols-2');
    // Aucune recette concurrente (md:, lg:, gap-3…) ne fuit.
    expect(g.className).not.toMatch(/\b(md|lg):grid-cols/);
    expect(g.className).not.toMatch(/\bgap-(2|3)\b/);
  });

  it('cols={3} : 3 colonnes dès sm ; className de l’appelant conservé', () => {
    render(
      <FormGrid cols={3} className="mt-2" data-testid="grille">
        <div />
      </FormGrid>,
    );
    const g = screen.getByTestId('grille');
    expect(g.className).toContain('sm:grid-cols-3');
    expect(g.className).not.toContain('sm:grid-cols-2');
    expect(g.className).toContain('mt-2');
  });
});

describe('Label — recette « field » et marqueur obligatoire unique', () => {
  it('required : astérisque seul après le libellé, recette §5.5 (600, neutral-700)', () => {
    render(
      <>
        <Label htmlFor="nom" required>
          Nom
        </Label>
        <input id="nom" />
      </>,
    );
    const label = screen.getByText('Nom').closest('label')!;
    expect(label.textContent).toBe('Nom*');
    expect(label.querySelector('span')).toHaveClass('text-savr-error');
    expect(label).toHaveClass(
      'block',
      'text-sm',
      'font-semibold',
      'text-savr-neutral-700',
    );
    // Association label ↔ champ conservée (getByLabelText).
    expect(screen.getByLabelText('Nom*')).toHaveAttribute('id', 'nom');
  });

  it('sans required : pas d’astérisque ; FormField required le délègue au Label', () => {
    render(
      <FormField label="Ville" htmlFor="ville" required>
        <Input id="ville" />
      </FormField>,
    );
    expect(screen.getByLabelText('Ville*')).toHaveAttribute('id', 'ville');
    render(<Label htmlFor="x">Commentaire</Label>);
    expect(screen.getByText('Commentaire').textContent).toBe('Commentaire');
  });

  it('variant="choice" : libellé de case à cocher (poids normal, curseur main, pas de mb)', () => {
    const onChange = vi.fn();
    render(
      <Label variant="choice" className="flex items-center gap-2">
        <Checkbox onCheckedChange={onChange} />
        Inclure les deux types
      </Label>,
    );
    const label = screen.getByText('Inclure les deux types');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveClass('cursor-pointer', 'text-sm', 'flex');
    expect(label).not.toHaveClass('font-semibold');
    expect(label).not.toHaveClass('mb-1.5');
    // La case DS reste nommée par son libellé englobant et cochable par lui.
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Inclure les deux types' }),
    );
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

function Profils({ onChange }: { onChange?: (v: string) => void }) {
  const [valeur, setValeur] = React.useState('');
  return (
    <RadioGroup
      name="type_profil"
      value={valeur}
      onValueChange={(v) => {
        setValeur(v);
        onChange?.(v);
      }}
      legend="Type de profil"
      legendClassName="sr-only"
    >
      {['traiteur', 'agence'].map((v) => (
        <Label key={v} variant="choice" className="flex gap-3">
          <RadioGroupItem value={v} />
          {v === 'traiteur' ? 'Traiteur' : 'Agence'}
        </Label>
      ))}
    </RadioGroup>
  );
}

describe('RadioGroup — radios natifs groupés (maison, sans dépendance)', () => {
  it('role radiogroup nommé par sa légende ; radios natifs partageant le name', () => {
    render(<Profils />);
    const groupe = screen.getByRole('radiogroup', { name: 'Type de profil' });
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) {
      expect(groupe).toContainElement(r);
      expect(r.tagName).toBe('INPUT');
      expect(r).toHaveAttribute('type', 'radio');
      expect(r).toHaveAttribute('name', 'type_profil');
      expect(r).not.toBeChecked();
    }
  });

  it('cocher une option (clic sur son libellé) émet sa valeur et la coche seule', () => {
    const onChange = vi.fn();
    render(<Profils onChange={onChange} />);
    fireEvent.click(screen.getByText('Agence'));
    expect(onChange).toHaveBeenCalledWith('agence');
    expect(screen.getByRole('radio', { name: 'Agence' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Traiteur' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Traiteur' }));
    expect(onChange).toHaveBeenLastCalledWith('traiteur');
    expect(screen.getByRole('radio', { name: 'Agence' })).not.toBeChecked();
  });

  it('recette DS calquée sur Checkbox : 20 px, coché primary-700, focus ring signature', () => {
    render(<Profils />);
    const radio = screen.getByRole('radio', { name: 'Traiteur' });
    expect(radio).toHaveClass(
      'h-5',
      'w-5',
      'rounded-savr-full',
      'checked:border-savr-primary-700',
      'focus-visible:outline-savr-primary-500',
    );
  });

  it('disabled sur le groupe désactive chaque radio', () => {
    render(
      <RadioGroup value="a" disabled aria-label="Choix">
        <RadioGroupItem value="a" aria-label="A" />
        <RadioGroupItem value="b" aria-label="B" />
      </RadioGroup>,
    );
    expect(screen.getByRole('radio', { name: 'A' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'B' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
  });
});

describe('Bornes texte libre — module pur importable côté client (F11)', () => {
  it('champs-texte-libre ré-exporte la même constante (route et formulaires alignés)', () => {
    expect(BORNES_TEXTE_LIBRE).toBe(BORNES_PURES);
    expect(BORNES_PURES.informations_supplementaires.max).toBe(1000);
  });
});
