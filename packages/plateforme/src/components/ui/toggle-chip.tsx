'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// ToggleChip — légende de graphe cliquable (R-UI-6b, K2) : un bouton
// `aria-pressed` avec pastille de couleur, atténué à 40 % quand la série est
// masquée. Trois recettes relevées, reproduites à l'identique :
//   - `bare`   : chip nue en en-tête de ChartCard (EvolutionAgChart) ;
//   - `pill`   : pilule neutre bordée (légende des 5 flux ZD) ;
//   - `accent` : pilule teintée orange (courbe « taux de recyclage »).
// Zone tactile ≥ 44 px (§10 accessibilité).
export interface ToggleChipSwatch {
  color: string;
  /** `square` = carré 10 px (série en barres) ; `line` = trait 14×3 (courbe). */
  shape?: 'square' | 'line';
  radius?: number;
}

interface ToggleChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  pressed: boolean;
  variant?: 'bare' | 'pill' | 'accent';
  swatch?: ToggleChipSwatch;
}

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500';
const VARIANT = {
  bare: `-my-3 flex min-h-[44px] items-center gap-1.5 rounded-savr-full px-1.5 transition-opacity ${FOCUS}`,
  pill: `inline-flex min-h-[44px] items-center gap-1.5 rounded-savr-full border border-savr-neutral-100 bg-savr-neutral-50 px-2.5 py-1 text-xs font-semibold text-savr-neutral-700 transition-colors hover:border-savr-neutral-300 ${FOCUS}`,
  accent: `inline-flex min-h-[44px] items-center gap-1.5 rounded-savr-full border border-savr-accent-100 bg-savr-accent-50 px-2.5 py-1 text-xs font-bold text-savr-accent-700 transition-colors ${FOCUS}`,
} as const;

const ToggleChip = React.forwardRef<HTMLButtonElement, ToggleChipProps>(
  (
    { pressed, variant = 'pill', swatch, className, style, children, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      className={cn(VARIANT[variant], className)}
      style={{ opacity: pressed ? 1 : 0.4, ...style }}
      {...props}
    >
      {swatch && (
        <span
          aria-hidden="true"
          style={
            swatch.shape === 'line'
              ? {
                  width: 14,
                  height: 3,
                  background: swatch.color,
                  borderRadius: swatch.radius ?? 2,
                }
              : {
                  width: 10,
                  height: 10,
                  background: swatch.color,
                  borderRadius: swatch.radius ?? 2,
                }
          }
        />
      )}
      {children}
    </button>
  ),
);
ToggleChip.displayName = 'ToggleChip';

export { ToggleChip };
