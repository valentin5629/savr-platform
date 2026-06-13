'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Skeleton — shimmer neutral-100 animé, jamais spinner seul (§7 Design System)
const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'animate-pulse rounded-savr-md bg-savr-neutral-100',
      className,
    )}
    aria-busy="true"
    aria-label="Chargement…"
    {...props}
  />
));
Skeleton.displayName = 'Skeleton';

export { Skeleton };
