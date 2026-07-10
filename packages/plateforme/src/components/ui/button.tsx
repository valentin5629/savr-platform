'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base — hauteur 40px, radius md=8px, transitions franches (levier #8)
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-[background-color,transform] duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primaire : navy-700 → hover navy-800 + lift -1px (levier #8)
        primary:
          'bg-savr-primary-700 text-savr-white hover:bg-savr-primary-800 hover:-translate-y-px active:bg-savr-primary-800 focus-visible:outline-savr-primary-500',
        // Secondaire : fond blanc, bordure neutral-300
        secondary:
          'bg-savr-white border border-savr-neutral-300 text-savr-neutral-900 hover:bg-savr-neutral-100 active:bg-savr-neutral-200 focus-visible:outline-savr-primary-500',
        // Accent : orange réservé CTA secondaires (levier #3) — texte primary-950 (contraste)
        accent:
          'bg-savr-accent-500 text-savr-primary-950 hover:bg-savr-accent-600 hover:-translate-y-px active:bg-savr-accent-600 focus-visible:outline-savr-accent-600',
        // Destructif
        destructive:
          'bg-savr-error text-savr-white hover:bg-savr-error-strong active:bg-savr-error-strong focus-visible:outline-savr-error',
        // Ghost : transparent, texte primary-700
        ghost:
          'bg-transparent text-savr-primary-700 hover:bg-savr-primary-50 active:bg-savr-primary-100 focus-visible:outline-savr-primary-500',
        // Link : texte seul
        link: 'text-savr-primary-700 underline-offset-4 hover:underline focus-visible:outline-savr-primary-500',
      },
      size: {
        // Cible tactile 44px sur mobile → 40px desktop (§5.1, §8, §10). `sm` reste
        // compact (contextes denses, opt-in).
        sm: 'h-8 rounded-savr-md px-3 text-xs',
        md: 'h-11 rounded-savr-md px-4 sm:h-10',
        lg: 'h-11 rounded-savr-md px-6 text-base',
        icon: 'h-11 w-11 rounded-savr-md sm:h-10 sm:w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
