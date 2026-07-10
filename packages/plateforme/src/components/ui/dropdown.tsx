'use client';

import * as React from 'react';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

// Dropdown — menu contextuel (§10 §6 « Dropdown » : menu kebab). Bâti sur Radix
// (a11y clavier + ARIA). Panneau blanc radius md, ombre md §4.4, items hover
// neutral-100. Focus ring signature hérité (levier #4).
const Dropdown = DropdownPrimitive.Root;
const DropdownTrigger = DropdownPrimitive.Trigger;
const DropdownGroup = DropdownPrimitive.Group;

const DropdownContent = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-[10rem] overflow-hidden rounded-savr-md border border-savr-neutral-200 bg-savr-white p-1 shadow-savr-md',
        className,
      )}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownContent.displayName = 'DropdownContent';

const DropdownItem = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
    destructive?: boolean;
  }
>(({ className, destructive, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-savr-sm px-2.5 py-2 text-sm outline-none',
      'transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      destructive
        ? 'text-savr-error-strong data-[highlighted]:bg-savr-error-subtle'
        : 'text-savr-neutral-700 data-[highlighted]:bg-savr-neutral-100 data-[highlighted]:text-savr-neutral-900',
      '[&>svg]:h-4 [&>svg]:w-4',
      className,
    )}
    {...props}
  />
));
DropdownItem.displayName = 'DropdownItem';

const DropdownLabel = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Label
    ref={ref}
    className={cn(
      'px-2.5 py-1.5 text-xs font-semibold text-savr-neutral-500',
      className,
    )}
    {...props}
  />
));
DropdownLabel.displayName = 'DropdownLabel';

const DropdownSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-savr-neutral-200', className)}
    {...props}
  />
));
DropdownSeparator.displayName = 'DropdownSeparator';

export {
  Dropdown,
  DropdownTrigger,
  DropdownGroup,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
};
