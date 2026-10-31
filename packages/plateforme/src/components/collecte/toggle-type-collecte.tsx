'use client';

import * as React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ForkKnifeIcon, LeafIcon } from '@/components/ui/icones';
import { cn } from '@/lib/utils';

// ToggleTypeCollecte — LE segmenté de type ZD / AG (R-UI-4b, D1). Avant : 4
// implémentations (`CollecteTypeTabs` clone sans clavier ×7, pilules
// `aria-pressed`, `ToggleGroup` nu, `FiltreCoches` Type). Bâti sur
// `ToggleGroup` (DS règle 6 : Tabs pour changer de vue, ToggleGroup pour
// filtrer) ; se range dans `FilterBar.toggle`. Libellés uniques « Zéro Déchet »
// / « Anti-Gaspi » ; « Toutes » en option quand le filtre peut être levé.
// Pictos des badges de type devant chaque libellé (variante B, Val
// 2026-10-31) : feuille verte ZD, couverts navy AG, les deux sur « Toutes » ;
// blancs sur l'item choisi (fond navy).

/** Picto coloré du type ; passe en blanc quand son item est choisi. */
function Picto({
  type,
  petit = false,
}: {
  type: CollecteType;
  petit?: boolean;
}) {
  const Icone = type === 'anti_gaspi' ? ForkKnifeIcon : LeafIcon;
  return (
    <Icone
      aria-hidden="true"
      className={cn(
        petit ? 'h-3.5 w-3.5' : 'h-4 w-4',
        type === 'anti_gaspi'
          ? 'text-savr-primary-700'
          : 'text-savr-success-strong',
        'group-data-[state=on]:text-savr-white',
      )}
    />
  );
}

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
      {avecTous && (
        <ToggleGroupItem value="tous" className="group gap-1.5">
          <span className="inline-flex items-center gap-0.5">
            <Picto type="zero_dechet" petit />
            <Picto type="anti_gaspi" petit />
          </span>
          Toutes
        </ToggleGroupItem>
      )}
      <ToggleGroupItem value="zero_dechet" className="group gap-1.5">
        <Picto type="zero_dechet" />
        Zéro Déchet
      </ToggleGroupItem>
      <ToggleGroupItem value="anti_gaspi" className="group gap-1.5">
        <Picto type="anti_gaspi" />
        Anti-Gaspi
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
