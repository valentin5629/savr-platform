'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// ChartCard — conteneur commun des graphes Cockpit (R24, DS §5.2/§10) : fond
// blanc, bordure portante neutral-200, radius 12px (lg), ombre sobre, padding 6.
// En-tête optionnel : titre (extrabold tracking serré, levier #7) + sous-titre
// neutral-500 + slot d'actions/legende à droite.
interface ChartCardProps {
  title?: string;
  subtitle?: string;
  /** Contenu aligné à droite de l'en-tête (légende, unité, filtres). */
  headerRight?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const ChartCard = React.forwardRef<HTMLDivElement, ChartCardProps>(
  ({ title, subtitle, headerRight, className, children }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm',
        className,
      )}
    >
      {(title || headerRight) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h3 className="text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[13px] text-savr-neutral-500">
                {subtitle}
              </p>
            )}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  ),
);
ChartCard.displayName = 'ChartCard';

export { ChartCard };
