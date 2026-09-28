'use client';

import * as React from 'react';
import { CalendarDays, ChevronDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { dateVersIso, formatJourLong, isoVersDate } from '@/lib/date-iso';

// DatePicker — date seule (+ créneau heure optionnel), DS « Mise en page des
// formulaires et filtres » règle 3 : aucun <input type="date"> natif visible.
// Déclencheur identique au Combobox (h-11 sm:h-10, radius md, bordure
// neutral-300, primary-500 à l'ouverture) + Calendar dans un Popover. L'API
// reste en jours ISO `YYYY-MM-DD` (valeur, min, max) ; l'heure reste un
// `<input type="time">` (DS « DateTimePicker »).
export interface DatePickerProps {
  /** Valeur date au format ISO `YYYY-MM-DD` (chaîne vide = aucune). */
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
  /** Nom de champ de formulaire : rend un <input type="hidden">. */
  name?: string;
  disabled?: boolean;
  error?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

const declencheurBase =
  'flex h-11 w-full min-w-0 items-center gap-2 rounded-savr-md border bg-savr-white px-3 text-left text-sm text-savr-neutral-900 sm:h-10 ' +
  'transition-colors duration-[120ms] ease-out ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function bordureChamp(error?: boolean, open?: boolean): string {
  if (error) return 'border-savr-error';
  if (open) return 'border-savr-primary-500';
  return 'border-savr-neutral-300 hover:border-savr-primary-400';
}

const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
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
      placeholder = 'Choisir une date',
      className,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      'data-testid': testId,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const selection = isoVersDate(value);
    const borneMin = isoVersDate(min);
    const borneMax = isoVersDate(max);
    const desactives = [
      ...(borneMin ? [{ before: borneMin }] : []),
      ...(borneMax ? [{ after: borneMax }] : []),
    ];

    return (
      <div className={cn('flex flex-wrap gap-2', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            <button
              ref={ref}
              type="button"
              id={id}
              aria-label={ariaLabel}
              aria-describedby={ariaDescribedBy}
              aria-invalid={error || undefined}
              aria-required={required || undefined}
              aria-haspopup="dialog"
              aria-expanded={open}
              data-testid={testId}
              data-value={value ?? ''}
              className={cn(
                declencheurBase,
                'flex-1',
                bordureChamp(error, open),
              )}
            >
              <CalendarDays
                className="h-4 w-4 shrink-0 text-savr-neutral-400"
                aria-hidden="true"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  !selection && 'text-savr-neutral-500',
                )}
              >
                {selection ? formatJourLong(selection) : placeholder}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-savr-neutral-400"
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <Calendar
              mode="single"
              selected={selection}
              defaultMonth={selection ?? borneMin}
              disabled={desactives}
              onSelect={(d) => {
                onChange?.(dateVersIso(d));
                setOpen(false);
              }}
              autoFocus
            />
            {!required && selection && (
              <div className="flex justify-end border-t border-savr-neutral-200 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange?.('');
                    setOpen(false);
                  }}
                >
                  Effacer
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        {name && <input type="hidden" name={name} value={value ?? ''} />}
        {withTime && (
          <div className="relative w-32 shrink-0">
            <input
              type="time"
              value={timeValue ?? ''}
              onChange={(e) => onTimeChange?.(e.target.value)}
              disabled={disabled}
              aria-invalid={error || undefined}
              aria-label="Heure"
              className={cn(
                'flex h-11 w-full appearance-none rounded-savr-md border bg-savr-white px-3 pr-9 text-sm text-savr-neutral-900 sm:h-10',
                'focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                '[&::-webkit-calendar-picker-indicator]:hidden',
                bordureChamp(error),
              )}
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

export { DatePicker, declencheurBase };
