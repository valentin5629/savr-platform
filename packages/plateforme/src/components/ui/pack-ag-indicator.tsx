'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface PackAGIndicatorProps {
  total: number;
  restant: number;
  label?: string;
  className?: string;
}

const PackAGIndicator = React.forwardRef<HTMLDivElement, PackAGIndicatorProps>(
  ({ total, restant, label = 'Collectes AG restantes', className }, ref) => {
    const pct = total > 0 ? Math.round((restant / total) * 100) : 0;
    const color =
      pct > 50
        ? 'bg-savr-success'
        : pct > 20
          ? 'bg-savr-warning'
          : 'bg-savr-error';

    return (
      <div ref={ref} className={cn('flex flex-col gap-1.5', className)}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-savr-neutral-600">
            {label}
          </span>
          <span className="text-xs font-bold text-savr-neutral-900">
            {restant}
            <span className="font-normal text-savr-neutral-500">
              {' '}
              / {total}
            </span>
          </span>
        </div>
        <div
          className="h-2 w-full rounded-savr-full bg-savr-neutral-200 overflow-hidden"
          role="progressbar"
          aria-valuenow={restant}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={label}
        >
          <div
            className={cn(
              'h-full rounded-savr-full transition-all duration-300',
              color,
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  },
);
PackAGIndicator.displayName = 'PackAGIndicator';

export { PackAGIndicator };
