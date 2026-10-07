'use client';

import * as React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// ToggleTypeCollecte — LE segmenté de type ZD / AG (R-UI-4b, D1). Avant : 4
// implémentations (`CollecteTypeTabs` clone sans clavier ×7, pilules
// `aria-pressed`, `ToggleGroup` nu, `FiltreCoches` Type). Bâti sur
// `ToggleGroup` (DS règle 6 : Tabs pour changer de vue, ToggleGroup pour
// filtrer) ; se range dans `FilterBar.toggle`. Libellés uniques « Zéro Déchet »
// / « Anti-Gaspi » ; « Toutes » en option quand le filtre peut être levé.

export type CollecteType = 'zero_dechet' | 'anti_gaspi';
/** Valeur du filtre : un type, ou `'tous'` (listes où le type n'est pas imposé). */
export type TypeCollecteFiltre = CollecteType | 'tous';

interface ToggleTypeCollecteProps<V extends TypeCollecteFiltre> {
  value: V;
  onChange: (type: V) => void;
  /** Item « Toutes » en tête (filtre levable). Défaut : non. */
  avecTous?: boolean;
  'aria-label'?: string;
  className?: string;
  'data-testid'?: string;
}

export function ToggleTypeCollecte<V extends TypeCollecteFiltre>({
  value,
  onChange,
  avecTous = false,
  'aria-label': ariaLabel = 'Type de collecte',
  className,
  'data-testid': testId,
}: ToggleTypeCollecteProps<V>) {
  return (
    <ToggleGroup
      type="single"
      aria-label={ariaLabel}
      value={value}
      onValueChange={(v) => {
        // Un clic sur l'item actif le désélectionne (v = '') : le choix est
        // obligatoire, on l'ignore.
        if (v) onChange(v as V);
      }}
      className={className}
      data-testid={testId}
    >
      {avecTous && <ToggleGroupItem value="tous">Toutes</ToggleGroupItem>}
      <ToggleGroupItem value="zero_dechet">Zéro Déchet</ToggleGroupItem>
      <ToggleGroupItem value="anti_gaspi">Anti-Gaspi</ToggleGroupItem>
    </ToggleGroup>
  );
}
