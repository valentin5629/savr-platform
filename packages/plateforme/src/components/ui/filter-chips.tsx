'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FilterChip {
  key: string;
  label: string;
  /** Compteur optionnel affiché en pastille accent (levier #3). Omis = pas de pastille. */
  count?: number;
}

interface FilterChipsProps {
  chips: FilterChip[];
  /** Clé du chip actif (sélection unique). */
  activeKey: string;
  onSelect: (key: string) => void;
  /** Libellé accessible du groupe. */
  ariaLabel?: string;
  className?: string;
}

// FilterChips — rangée de filtres prédéfinis (sélection unique). Chip = pilule
// radius-full bordée neutral-300 ; actif = aplat primary-700 texte blanc ; la
// pastille compteur reste le seul aplat orange (accent-500 texte primary-950,
// levier #3). §10 est silencieux sur la pastille compteur → divergence tracée.
const FilterChips = React.forwardRef<HTMLDivElement, FilterChipsProps>(
  ({ chips, activeKey, onSelect, ariaLabel, className }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {chips.map((chip) => {
        const active = chip.key === activeKey;
        return (
          <button
            key={chip.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(chip.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-savr-full border px-3.5 py-1.5 text-xs font-bold transition-colors duration-[120ms]',
              active
                ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
                : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-600 hover:border-savr-primary-300',
            )}
          >
            {chip.label}
            {chip.count != null && (
              <span
                className={cn(
                  'inline-flex min-w-[1.1rem] justify-center rounded-savr-full px-1.5 text-[10px] leading-4',
                  active
                    ? 'bg-savr-white/20 text-savr-white'
                    : 'bg-savr-accent-500 text-savr-primary-950',
                )}
              >
                {chip.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  ),
);
FilterChips.displayName = 'FilterChips';

export { FilterChips };
