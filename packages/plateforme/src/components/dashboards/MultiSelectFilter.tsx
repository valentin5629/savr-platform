'use client';

import { useId } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';

// Même forme que les options des filtres en ligne (source unique du type).
export type { OptionFiltre as MultiOption } from '@/components/ui/filtre-en-ligne';
import type { OptionFiltre as MultiOption } from '@/components/ui/filtre-en-ligne';

interface MultiSelectFilterProps {
  label: string;
  options: MultiOption[];
  /** ids sélectionnés ; tableau vide = « Tous » (option par défaut). */
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel?: string;
  testid?: string;
}

/**
 * Filtre multi-choix : libellé au-dessus (`FormField`) + `Combobox multiple`
 * (DS « Mise en page des formulaires et filtres » règles 1 à 3). Sélection
 * vide = « Tous » (`allLabel`, première option de la liste). Composant de
 * filtrage uniquement — aucune écriture. Utilisé par l'encart « Filtres
 * benchmark » (§06.05 Bloc 3 ZD) et les filtres « parc ».
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel = 'Tous',
  testid,
}: MultiSelectFilterProps) {
  const autoId = useId();
  const id = testid ?? `multi-select-${autoId}`;
  return (
    <FormField label={label} htmlFor={id}>
      <Combobox
        multiple
        id={id}
        data-testid={testid}
        icon={null}
        placeholder={allLabel}
        emptyText="Aucune option."
        options={options.map((o) => ({ value: o.id, label: o.nom }))}
        value={selected}
        onChange={onChange}
      />
    </FormField>
  );
}
