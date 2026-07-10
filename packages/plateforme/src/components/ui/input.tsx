'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Input — §5.5 : fond blanc, bordure neutral-300, radius md. Hauteur 44px mobile
// → 40px desktop (cible tactile §8/§10). États erreur/succès (§6 « états
// erreur/succès ») : bordure error / success. FormError affiché par l'appelant.
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  success?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, success, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-savr-md border bg-savr-white px-3 text-sm text-savr-neutral-900 sm:h-10',
        'placeholder:text-savr-neutral-400',
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
    />
  ),
);
Input.displayName = 'Input';

export { Input };
