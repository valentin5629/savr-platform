'use client';

import { ChevronDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { MultiOption } from './MultiSelectFilter.js';

interface FiltreCochesProps {
  label: string;
  options: MultiOption[];
  /** ids cochés ; tableau vide = « Tous ». */
  selected: string[];
  onChange: (ids: string[]) => void;
  testid?: string;
}

// Résumé affiché à côté du titre : « Tous », le libellé court de l'option unique
// (« XL (≥ 1000) » → « XL »), ou le nombre d'options cochées.
function resumeSelection(options: MultiOption[], selected: string[]): string {
  if (selected.length === 0) return 'Tous';
  if (selected.length === 1) {
    const nom = options.find((o) => o.id === selected[0])?.nom;
    return nom ? nom.split(' (')[0]! : '1 sélectionné';
  }
  return `${selected.length} sélectionnés`;
}

/**
 * Filtre compact « titre cliquable → liste à cocher » (fiche collecte client,
 * radar « Votre collecte face aux événements comparables » — §06.04 refonte
 * 2026-09-29). Popover + Checkbox du DS : aucun <select> natif. Composant de
 * filtrage uniquement — aucune écriture.
 */
export function FiltreCoches({
  label,
  options,
  selected,
  onChange,
  testid,
}: FiltreCochesProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-savr-md px-2 text-sm font-bold text-savr-primary-700 transition-colors hover:bg-savr-primary-50 data-[state=open]:bg-savr-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
        >
          {label}
          <span className="font-normal text-savr-neutral-600">
            {resumeSelection(options, selected)}
          </span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-savr-neutral-500">
            Aucune option.
          </p>
        ) : (
          <ul aria-label={label} className="max-h-64 overflow-y-auto">
            {options.map((o) => {
              const coche = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-savr-sm px-2 text-sm text-savr-neutral-900 hover:bg-savr-neutral-50">
                    <Checkbox
                      checked={coche}
                      onCheckedChange={(v) =>
                        onChange(
                          v === true
                            ? [...selected, o.id]
                            : selected.filter((x) => x !== o.id),
                        )
                      }
                    />
                    {o.nom}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
