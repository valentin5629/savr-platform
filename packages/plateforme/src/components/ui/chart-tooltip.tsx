import * as React from 'react';
import { cn } from '@/lib/utils';

// ChartTooltip — infobulle des graphes (R-UI-6b, I7). Recette unique relevée
// dans 5 graphes (barres, courbes, donut, radar, histogramme) : surface
// blanche, bordure neutral-200, rayon md, ombre md. `floating` (défaut) la
// positionne en absolu hors flux et la rend transparente au pointeur ; les
// classes de position (`left-1/2`, `bottom-full`…) et de transition restent à
// l'appelant.
interface ChartTooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `false` = rendu en flux (ex. panneau fixe du radar). */
  floating?: boolean;
}

const ChartTooltip = React.forwardRef<HTMLDivElement, ChartTooltipProps>(
  ({ floating = true, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        floating && 'pointer-events-none absolute z-10',
        'rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md',
        className,
      )}
      {...props}
    />
  ),
);
ChartTooltip.displayName = 'ChartTooltip';

export { ChartTooltip };
