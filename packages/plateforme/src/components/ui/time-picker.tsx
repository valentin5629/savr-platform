'use client';

import * as React from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { bordureChamp, declencheurBase } from '@/components/ui/date-picker';

// TimePicker — choix d'une heure dans une liste de créneaux (pas de 15 min,
// 00:00 → 23:45), sur le modèle d'une page de réservation : une colonne de
// boutons pleine largeur dans un Popover. Déclencheur identique au DatePicker
// et au Combobox (DS « Mise en page des formulaires et filtres » règles 2-3 :
// hauteur h-11 sm:h-10, aucun <input type="time"> natif). Valeur `HH:MM`.
export interface TimePickerProps {
  /** Valeur au format `HH:MM` (chaîne vide = aucune). */
  value?: string;
  onChange?: (value: string) => void;
  /** Pas entre deux créneaux, en minutes. Défaut : 15. */
  step?: number;
  /** Créneau mis en vue à l'ouverture quand aucune valeur n'est choisie. */
  defaultScrollTo?: string;
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

export function creneaux(step = 15): string[] {
  const liste: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const mn = String(m % 60).padStart(2, '0');
    liste.push(`${h}:${mn}`);
  }
  return liste;
}

const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(
  (
    {
      value,
      onChange,
      step = 15,
      defaultScrollTo = '08:00',
      id,
      name,
      disabled,
      error,
      required,
      placeholder = 'Choisir une heure',
      className,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      'data-testid': testId,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const liste = React.useMemo(() => creneaux(step), [step]);
    const listeRef = React.useRef<HTMLDivElement>(null);
    // Une valeur hors grille (saisie antérieure, ex. 10:10) reste affichée
    // dans le déclencheur ; la liste ne propose que les créneaux.
    const valeur = value ? value.slice(0, 5) : '';

    const boutons = () =>
      Array.from(
        listeRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="option"]',
        ) ?? [],
      );

    const focaliser = (index: number) => {
      const b = boutons();
      const cible = b[Math.max(0, Math.min(b.length - 1, index))];
      if (!cible) return;
      cible.focus();
      cible.scrollIntoView?.({ block: 'nearest' });
    };

    const onOpenAutoFocus = (e: Event) => {
      e.preventDefault();
      const ancre = liste.includes(valeur) ? valeur : defaultScrollTo;
      const index = Math.max(0, liste.indexOf(ancre));
      const b = boutons()[index];
      if (!b) return;
      b.scrollIntoView?.({ block: 'center' });
      b.focus({ preventScroll: true });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const b = boutons();
      const courant = b.indexOf(document.activeElement as HTMLButtonElement);
      const saut = Math.round(60 / step);
      const cibles: Record<string, number> = {
        ArrowDown: courant + 1,
        ArrowUp: courant - 1,
        PageDown: courant + saut,
        PageUp: courant - saut,
        Home: 0,
        End: b.length - 1,
      };
      const cible = cibles[e.key];
      if (cible !== undefined) {
        e.preventDefault();
        focaliser(cible);
      }
    };

    return (
      <div className={cn('flex', className)}>
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
              aria-haspopup="listbox"
              aria-expanded={open}
              data-testid={testId}
              data-value={valeur}
              className={cn(declencheurBase, bordureChamp(error, open))}
            >
              <Clock
                className="h-4 w-4 shrink-0 text-savr-neutral-400"
                aria-hidden="true"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate tabular-nums',
                  !valeur && 'text-savr-neutral-500',
                )}
              >
                {valeur || placeholder}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-savr-neutral-400"
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] min-w-44 p-2"
            onOpenAutoFocus={onOpenAutoFocus}
          >
            <div
              ref={listeRef}
              role="listbox"
              aria-label="Créneaux horaires"
              onKeyDown={onKeyDown}
              className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1"
            >
              {liste.map((c) => {
                const choisi = c === valeur;
                return (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={choisi}
                    tabIndex={-1}
                    onClick={() => {
                      onChange?.(c);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-10 w-full shrink-0 rounded-savr-md text-center text-sm font-medium tabular-nums',
                      'transition-colors duration-[120ms] ease-out',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-savr-primary-500',
                      choisi
                        ? 'bg-savr-primary-700 text-savr-white hover:bg-savr-primary-800'
                        : 'bg-savr-neutral-100 text-savr-neutral-900 hover:bg-savr-neutral-200',
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        {name && <input type="hidden" name={name} value={valeur} />}
      </div>
    );
  },
);
TimePicker.displayName = 'TimePicker';

export { TimePicker };
