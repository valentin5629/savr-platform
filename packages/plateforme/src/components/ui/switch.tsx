'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

// Switch — toggle on/off (§10 §6 « Switch »). Bâti sur Radix (a11y : role switch,
// clavier). Piste primary-700 quand actif (levier #2), neutral-300 au repos ;
// pilule radius-full (§4.3). Focus ring signature (levier #4).
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-savr-full border-2 border-transparent transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-savr-primary-700 data-[state=unchecked]:bg-savr-neutral-300',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-5 w-5 rounded-savr-full bg-savr-white shadow-savr-sm transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export { Switch };
