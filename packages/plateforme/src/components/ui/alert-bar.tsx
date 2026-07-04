'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// AlertBar — bandeau de message persistant (§10 §6 « Alert »). Fond {semantic}-subtle
// + texte {semantic}-strong + bordure teintée, radius md (levier #6). §10 ne
// spécifie pas la structure (icône/padding) → divergence tracée ; couleurs = tokens.
const alertBarVariants = cva(
  'flex items-start gap-2.5 rounded-savr-md border px-4 py-3 text-sm font-semibold',
  {
    variants: {
      variant: {
        warn: 'border-savr-warning/40 bg-savr-warning-subtle text-savr-warning-strong',
        err: 'border-savr-error/40 bg-savr-error-subtle text-savr-error-strong',
        info: 'border-savr-info/40 bg-savr-info-subtle text-savr-info-strong',
        neutral:
          'border-savr-neutral-200 bg-savr-neutral-100 text-savr-neutral-600',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface AlertBarProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertBarVariants> {
  /** Icône optionnelle rendue à gauche (lucide, 16px). */
  icon?: React.ReactNode;
}

const AlertBar = React.forwardRef<HTMLDivElement, AlertBarProps>(
  ({ className, variant, icon, children, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn(alertBarVariants({ variant }), className)}
      {...props}
    >
      {icon && (
        <span className="mt-px shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </div>
  ),
);
AlertBar.displayName = 'AlertBar';

export { AlertBar, alertBarVariants };
