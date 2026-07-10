'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Checkbox — case à cocher (§10 §6 « Checkbox »). Bâti sur Radix (a11y : role
// checkbox, indeterminate, clavier). Coché = aplat primary-700 (levier #2),
// radius sm (§4.3). Focus ring signature (levier #4).
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer h-5 w-5 shrink-0 rounded-savr-sm border border-savr-neutral-300 bg-savr-white transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-savr-primary-700 data-[state=checked]:bg-savr-primary-700 data-[state=checked]:text-savr-white',
      'data-[state=indeterminate]:border-savr-primary-700 data-[state=indeterminate]:bg-savr-primary-700 data-[state=indeterminate]:text-savr-white',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export { Checkbox };
