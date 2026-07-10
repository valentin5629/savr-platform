'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Select natif stylé §5.5 (pas de Radix Select — un <select> HTML suffit V1, cohérent
// avec le reste du form-kit qui reste volontairement simple).
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  success?: boolean;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, success, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          // Hauteur 44px mobile → 40px desktop (cible tactile §8/§10).
          'flex h-11 w-full appearance-none rounded-savr-md border bg-savr-white px-3 pr-9 text-sm text-savr-neutral-900 sm:h-10',
          'focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error
            ? 'border-savr-error'
            : success
              ? 'border-savr-success'
              : 'border-savr-neutral-300 hover:border-savr-primary-400',
          className,
        )}
        aria-invalid={error || undefined}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400" />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
