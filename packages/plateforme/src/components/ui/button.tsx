'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base — hauteur 40px, radius md=8px, transitions franches (levier #8).
  // L'icône (svg enfant direct) fait 16px et s'espace par le `gap-2` : plus de
  // `mr-*` ni de `h-4 w-4` à poser site par site (R-UI-3, B6).
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-[background-color,transform] duration-savr-fast ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
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
          'bg-savr-accent-500 text-savr-primary-950 hover:bg-savr-accent-600 hover:-translate-y-px active:bg-savr-accent-600',
        // Destructif
        destructive:
          'bg-savr-error text-savr-white hover:bg-savr-error-strong active:bg-savr-error-strong',
        // Ghost : transparent, texte primary-700
        ghost:
          'bg-transparent text-savr-primary-700 hover:bg-savr-primary-50 active:bg-savr-primary-100 focus-visible:outline-savr-primary-500',
        // Link : texte seul
        link: 'text-savr-primary-700 underline-offset-4 hover:underline focus-visible:outline-savr-primary-500',
        // Destructif secondaire (R-UI-3, B3) : ghost rouge — ex-`ghost` +
        // `className="text-savr-error"` ; action discrète (supprimer une ligne).
        'ghost-destructive':
          'bg-transparent text-savr-error hover:bg-savr-error-subtle active:bg-savr-error-subtle focus-visible:outline-savr-primary-500',
        // Destructif en contour rouge sur fond blanc — ex-`secondary` +
        // `ACTION_DESTRUCTIVE_CONTOUR` : « Annuler la collecte », « Désactiver »
        // (décision Val 2026-09-30, même rendu partout).
        'outline-destructive':
          'bg-savr-white border border-savr-error text-savr-error-strong hover:bg-savr-error-subtle active:bg-savr-error-subtle focus-visible:outline-savr-primary-500',
        // Avertissement en contour (action réversible mais engageante).
        'outline-warning':
          'bg-savr-white border border-savr-warning-strong text-savr-warning-strong hover:bg-savr-warning-subtle active:bg-savr-warning-subtle focus-visible:outline-savr-primary-500',
      },
      size: {
        // Cible tactile 44px sur mobile → 40px desktop (§5.1, §8, §10). `sm` reste
        // compact (contextes denses, opt-in).
        sm: 'h-8 rounded-savr-md px-3 text-xs',
        md: 'h-11 rounded-savr-md px-4 sm:h-10',
        lg: 'h-11 rounded-savr-md px-6 text-base',
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
  /**
   * État « en cours » (R-UI-3, B1) : bouton désactivé, `aria-busy`, spinner
   * à la place de l'icône et libellé `loadingText` (ex. « Enregistrement… »)
   * à la place des enfants. Remplace le couple `disabled={x}` +
   * `{x ? 'Enregistrement…' : 'Enregistrer'}`.
   */
  loading?: boolean;
  loadingText?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          aria-busy={loading || undefined}
          disabled={disabled || loading}
          {...props}
        >
          {children}
        </Comp>
      );
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
