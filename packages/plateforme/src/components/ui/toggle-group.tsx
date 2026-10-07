'use client';

import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

// ToggleGroup — segmenté de FILTRE (Toutes / Zéro Déchet / Anti-Gaspi), Radix
// Toggle Group stylé Savr : item actif en aplat primary-700, texte blanc (DS
// règle 6 : Tabs soulignés pour changer de vue, ToggleGroup pour filtrer).
const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-11 items-center gap-1 rounded-savr-md border border-savr-neutral-200 bg-savr-white p-1 sm:h-10',
      className,
    )}
    {...props}
  />
));
ToggleGroup.displayName = 'ToggleGroup';

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      'inline-flex h-full items-center justify-center whitespace-nowrap rounded-savr-sm px-3 text-sm font-semibold text-savr-neutral-600',
      'transition-colors duration-savr-fast ease-out hover:bg-savr-neutral-100 hover:text-savr-neutral-900',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=on]:bg-savr-primary-700 data-[state=on]:text-savr-white data-[state=on]:hover:bg-savr-primary-800',
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = 'ToggleGroupItem';

export { ToggleGroup, ToggleGroupItem };
