'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-savr-md border bg-savr-white px-3 py-2 text-sm text-savr-neutral-900',
        'placeholder:text-savr-neutral-400',
        'focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error
          ? 'border-savr-error'
          : 'border-savr-neutral-300 hover:border-savr-primary-400',
        className,
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
