'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Timeline — historique vertical (§10 §6, associé à StatusCollecte). Bordure
// gauche neutral-200 + points primary-400. §10 ne spécifie pas le détail visuel
// (bordure/points) → divergence tracée.
const Timeline = React.forwardRef<
  HTMLOListElement,
  React.HTMLAttributes<HTMLOListElement>
>(({ className, children, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      'ml-1.5 space-y-3.5 border-l-2 border-savr-neutral-200 pl-5',
      className,
    )}
    {...props}
  >
    {children}
  </ol>
));
Timeline.displayName = 'Timeline';

// TimelineItem — un point + son contenu (horodatage + libellé passés en enfants).
const TimelineItem = React.forwardRef<
  HTMLLIElement,
  React.HTMLAttributes<HTMLLIElement>
>(({ className, children, ...props }, ref) => (
  <li ref={ref} className={cn('relative', className)} {...props}>
    <span
      aria-hidden
      className="absolute -left-[24px] top-1.5 h-2 w-2 rounded-savr-full bg-savr-primary-400 ring-2 ring-savr-white"
    />
    {children}
  </li>
));
TimelineItem.displayName = 'TimelineItem';

export { Timeline, TimelineItem };
