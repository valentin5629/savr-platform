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

export { StatCard };
