'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

interface StatCardProps {
  label: string;
  value: string | number;
  variation?: {
    value: number;
    label?: string;
  };
  icon?: React.ReactNode;
  className?: string;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, variation, icon, className }, ref) => (
    <Card ref={ref} className={cn('p-6 flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-savr-neutral-500">
          {label}
        </span>
        {icon && (
          <span className="text-savr-neutral-400 [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-bold tracking-[-0.02em] text-savr-neutral-900 leading-none">
          {value}
        </span>
        {variation !== undefined && (
          <span
            className={cn(
              'text-sm font-medium mb-0.5',
              variation.value >= 0
                ? 'text-savr-success-strong'
                : 'text-savr-error-strong',
            )}
          >
            {variation.value >= 0 ? '+' : ''}
            {variation.value}%{variation.label ? ` ${variation.label}` : ''}
          </span>
        )}
      </div>
    </Card>
  ),
);
StatCard.displayName = 'StatCard';

// StatCardGrid — grille responsive de KPIs (§8 « Dashboard KPIs : 1 col mobile /
// 2 tablet / 3-4 desktop »). Encode la règle une fois pour que les dashboards la
// réutilisent au lieu de la redéfinir écran par écran.
interface StatCardGridProps {
  children: React.ReactNode;
  /** Nombre de colonnes desktop (≥ 1024px). 3 ou 4. Défaut 4. */
  desktopCols?: 3 | 4;
  className?: string;
}

const StatCardGrid = React.forwardRef<HTMLDivElement, StatCardGridProps>(
  ({ children, desktopCols = 4, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        // 1 col mobile · 2 tablet (≥640px) · 3-4 desktop (≥1024px)
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        desktopCols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  ),
);
StatCardGrid.displayName = 'StatCardGrid';

export { StatCard, StatCardGrid };
