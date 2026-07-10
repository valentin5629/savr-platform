'use client';

import * as React from 'react';
import { Calendar, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// DatePicker — date (+ créneau heure optionnel), §10 §6 « DatePicker »
// (programmation collecte). Bâti sur les inputs natifs `date`/`time` (calendrier
// + a11y clavier fournis par le navigateur), stylés §5.5 — même parti-pris que
// `select.tsx` (« un <select> HTML suffit V1 », pas de dépendance calendrier).
// Cible tactile 44px mobile (§8/§10), focus ring signature (levier #4).
export interface DatePickerProps {
  /** Valeur date au format ISO `YYYY-MM-DD`. */
  value?: string;
  onChange?: (value: string) => void;
  /** Affiche un second champ heure (créneau). */
  withTime?: boolean;
  /** Valeur heure `HH:MM` (si withTime). */
  timeValue?: string;
  onTimeChange?: (value: string) => void;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  error?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
}

const fieldBase =
  'flex h-11 w-full appearance-none rounded-savr-md border bg-savr-white px-3 text-sm text-savr-neutral-900 sm:h-10 ' +
  'focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  (
    {
      value,
      onChange,
      withTime,
      timeValue,
      onTimeChange,
      min,
      max,
      id,
      name,
      disabled,
      error,
      required,
      className,
      'aria-label': ariaLabel,
    },
    ref,
  ) => {
    const borderClass = error
      ? 'border-savr-error'
      : 'border-savr-neutral-300 hover:border-savr-primary-400';
    return (
      <div className={cn('flex flex-wrap gap-2', className)}>
        <div className="relative min-w-0 flex-1">
          <input
            ref={ref}
            type="date"
            id={id}
            name={name}
            value={value ?? ''}
            onChange={(e) => onChange?.(e.target.value)}
            min={min}
            max={max}
            disabled={disabled}
            required={required}
            aria-invalid={error || undefined}
            aria-label={ariaLabel}
            className={cn(fieldBase, 'pr-9', borderClass)}
          />
          <Calendar
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400"
            aria-hidden="true"
          />
        </div>
        {withTime && (
          <div className="relative w-32 shrink-0">
            <input
              type="time"
              value={timeValue ?? ''}
              onChange={(e) => onTimeChange?.(e.target.value)}
              disabled={disabled}
              aria-invalid={error || undefined}
              aria-label="Heure"
              className={cn(fieldBase, 'pr-9', borderClass)}
            />
            <Clock
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400"
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    );
  },
);
DatePicker.displayName = 'DatePicker';

export { DatePicker };
