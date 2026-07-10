'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/ui/form-error';

// FormField — regroupe Label + champ + FormError §5.5 (erreur : error-strong + icône).
interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

function FormField({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? (
        <FormError>{error}</FormError>
      ) : hint ? (
        <p className="text-xs text-savr-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

export { FormField };
