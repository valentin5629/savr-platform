'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { bordureChamp, declencheurBase } from '@/components/ui/date-picker';
import { dateVersIso, formatJourCourt, isoVersDate } from '@/lib/date-iso';

// DateRangePicker — une période en UN seul champ (DS règle 3 : jamais deux
// dates « Du / au » séparées). Déclencheur + Calendar en mode range + bouton
// Appliquer : la période n'est transmise qu'au clic sur Appliquer. Bornes en
// jours ISO `YYYY-MM-DD`, chaîne vide = borne ouverte (même convention que
// DatePicker et que les query-strings `from`/`to` des routes).
export interface PeriodeIso {
  from: string;
  to: string;
}

export interface DateRangePickerProps {
  value?: PeriodeIso;
  onChange?: (value: PeriodeIso) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

export const PERIODE_VIDE: PeriodeIso = { from: '', to: '' };

function libellePeriode(p: PeriodeIso): string | null {
  const from = isoVersDate(p.from);
  const to = isoVersDate(p.to);
  if (from && to) return `${formatJourCourt(from)} – ${formatJourCourt(to)}`;
  if (from) return `Depuis le ${formatJourCourt(from)}`;
  if (to) return `Jusqu'au ${formatJourCourt(to)}`;
  return null;
}

function DateRangePicker({
  value = PERIODE_VIDE,
  onChange,
  min,
  max,
  placeholder = 'Toutes les dates',
  id,
  disabled,
  error,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'data-testid': testId,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  // Brouillon : la sélection en cours n'est appliquée qu'au clic « Appliquer ».
  const [brouillon, setBrouillon] = React.useState<DateRange | undefined>();

  function ouvrir(o: boolean) {
    if (o)
      setBrouillon({
        from: isoVersDate(value.from),
        to: isoVersDate(value.to),
      });
    setOpen(o);
  }

  const libelle = libellePeriode(value);
  const borneMin = isoVersDate(min);
  const borneMax = isoVersDate(max);
  const desactives = [
    ...(borneMin ? [{ before: borneMin }] : []),
    ...(borneMax ? [{ after: borneMax }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={ouvrir}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={error || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid={testId}
          data-from={value.from}
          data-to={value.to}
          className={cn(declencheurBase, bordureChamp(error, open), className)}
        >
          <CalendarDays
            className="h-4 w-4 shrink-0 text-savr-neutral-400"
            aria-hidden="true"
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              !libelle && 'text-savr-neutral-500',
            )}
          >
            {libelle ?? placeholder}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-savr-neutral-400"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={brouillon}
          defaultMonth={brouillon?.from ?? borneMin}
          disabled={desactives}
          onSelect={setBrouillon}
          autoFocus
        />
        <div className="flex items-center justify-end gap-3 border-t border-savr-neutral-200 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange?.(PERIODE_VIDE);
              setOpen(false);
            }}
          >
            Effacer
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChange?.({
                from: dateVersIso(brouillon?.from),
                // Un seul jour cliqué = période d'un jour.
                to: dateVersIso(brouillon?.to ?? brouillon?.from),
              });
              setOpen(false);
            }}
          >
            Appliquer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DateRangePicker };
