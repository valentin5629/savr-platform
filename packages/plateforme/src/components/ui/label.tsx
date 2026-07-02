'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Label — §5.5 : text-sm poids 600 neutral-700, au-dessus du champ.
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'block text-sm font-semibold text-savr-neutral-700 mb-1.5',
      className,
    )}
    {...props}
  >
    {children}
    {required && <span className="text-savr-error ml-0.5">*</span>}
  </label>
));
Label.displayName = 'Label';

export { Label };
