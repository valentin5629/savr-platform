'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Badge — pilule radius-full, text-xs, §5.4
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-savr-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        // Sémantiques : fond {semantic}-subtle + texte {semantic}-strong + point
        success: 'bg-savr-success-subtle text-savr-success-strong',
        warning: 'bg-savr-warning-subtle text-savr-warning-strong',
        error: 'bg-savr-error-subtle text-savr-error-strong',
        info: 'bg-savr-info-subtle text-savr-info-strong',
        // Action requise : seul usage texte orange (accent-700 ≥ AA)
        action: 'bg-savr-accent-50 text-savr-accent-700',
        // Neutre
        neutral: 'bg-savr-neutral-100 text-savr-neutral-700',
        // Primaire (ex : statut actif)
        primary: 'bg-savr-primary-50 text-savr-primary-700',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, dot = true, children, ...props }, ref) => {
    const dotColor: Record<string, string> = {
      success: 'bg-savr-success',
      warning: 'bg-savr-warning',
      error: 'bg-savr-error',
      info: 'bg-savr-info',
      action: 'bg-savr-accent-500',
      neutral: 'bg-savr-neutral-400',
      primary: 'bg-savr-primary-500',
    };
    const dotClass = dotColor[variant ?? 'neutral'];
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full shrink-0',
              dotClass,
            )}
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  },
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
