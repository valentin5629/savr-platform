'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Input — §5.5 : fond blanc, bordure neutral-300, radius md, hauteur 40px.
// Focus : bordure + anneau primary-500. Erreur : bordure error (FormError affiché par l'appelant).
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-savr-md border bg-savr-white px-3 text-sm text-savr-neutral-900',
        'placeholder:text-savr-neutral-400',
        'focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error
          ? 'border-savr-error'
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
