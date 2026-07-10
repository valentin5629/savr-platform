'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// IconButton — bouton icône seule (§10 §6 « IconButton », actions de tableau).
// `aria-label` OBLIGATOIRE (§9 : jamais d'icône seule sans label). Cible tactile
// 44px sur mobile (§8/§10), 40px desktop ; focus ring signature (levier #4).
const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-savr-md transition-[background-color,color,transform] duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-5 [&>svg]:w-5',
  {
    variants: {
      variant: {
        // Neutre : action discrète de tableau/toolbar
        ghost:
          'bg-transparent text-savr-neutral-500 hover:bg-savr-neutral-100 hover:text-savr-neutral-700 focus-visible:outline-savr-primary-500',
        // Primaire plein
        primary:
          'bg-savr-primary-700 text-savr-white hover:bg-savr-primary-800 focus-visible:outline-savr-primary-500',
        // Destructif (supprimer)
        destructive:
          'bg-transparent text-savr-neutral-500 hover:bg-savr-error-subtle hover:text-savr-error-strong focus-visible:outline-savr-error',
      },
      size: {
        // 44px mobile → 40px desktop (cible tactile §8/§10)
        md: 'h-11 w-11 sm:h-10 sm:w-10',
        sm: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
);

export interface IconButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Libellé accessible (§9 — icône seule). */
  'aria-label': string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton, iconButtonVariants };
