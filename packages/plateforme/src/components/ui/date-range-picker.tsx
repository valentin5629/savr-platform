'use client';

import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { bordureChamp, declencheurBase } from '@/components/ui/date-picker';
import {
  ContenuDeclencheur,
  declencheurFiltre,
} from '@/components/ui/filtre-en-ligne';
import { dateVersIso, formatJourCourt, isoVersDate } from '@/lib/date-iso';
import {
  DERNIERS_N_MAX,
  periodeDerniers,
  raccourciDe,
  raccourcisPeriode,
  UNITES_PERIODE,
  type RaccourciPeriode,
  type UnitePeriode,
} from '@/lib/periodes-raccourcis';

// DateRangePicker — une période en UN seul champ (DS règle 3 : jamais deux
// dates « Du / au » séparées). Bornes en jours ISO `YYYY-MM-DD`, chaîne vide =
// borne ouverte (même convention que DatePicker et que les query-strings
// `from`/`to` des routes).
//
// Panneau (décision Val 2026-09-30, format « colonne de raccourcis +
// calendrier ») : raccourcis à gauche, ligne « Derniers [N] [unité] ☑ Inclure
// aujourd'hui », calendrier sur deux mois, période choisie résumée en pied avec
// Effacer / Annuler / Appliquer. Tout reste un brouillon jusqu'à Appliquer.
//
// Mode filtre (`titre`) : déclencheur « Période  12 derniers mois ▾ » des
// barres de filtres (`filtre-en-ligne`), raccourcis standard et ligne
// « Derniers N » affichés par défaut. Mode champ (sans `titre`) : champ bordé,
// ni raccourcis ni ligne sauf demande explicite.
export interface PeriodeIso {
  from: string;
  to: string;
}

export type { RaccourciPeriode };

export interface DateRangePickerProps {
  /** Mode filtre en ligne : titre affiché devant la période courante. */
  titre?: string;
  /** Colonne de raccourcis ; défaut = liste standard en mode filtre, aucune sinon. */
  raccourcis?: RaccourciPeriode[];
  /** Préfixe des data-testid des raccourcis (`${prefixe}-${cle}`). */
  raccourcisTestIdPrefixe?: string;
  /** Ligne « Derniers N unités » ; défaut = mode filtre. */
  avecDerniers?: boolean;
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

const versIso = (r: DateRange | undefined): PeriodeIso => ({
  from: dateVersIso(r?.from),
  // Un seul jour cliqué = période d'un jour.
  to: dateVersIso(r?.to ?? r?.from),
});

const versRange = (p: PeriodeIso): DateRange | undefined => {
  const from = isoVersDate(p.from);
  return from || p.to ? { from, to: isoVersDate(p.to) } : undefined;
};

// Deux mois affichés, le second contenant la fin de la période.
function premierMoisAffiche(r: DateRange | undefined, repli?: Date): Date {
  const ancre = r?.to ?? r?.from ?? repli ?? new Date();
  return new Date(ancre.getFullYear(), ancre.getMonth() - 1, 1);
}

interface Derniers {
  n: string;
  unite: UnitePeriode;
  inclure: boolean;
}

const DERNIERS_DEFAUT: Derniers = { n: '30', unite: 'jours', inclure: true };

function DateRangePicker({
  titre,
  raccourcis: raccourcisProp,
  raccourcisTestIdPrefixe,
  avecDerniers = Boolean(titre),
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
  // Recalculés à chaque rendu : « 7 derniers jours » se lit par rapport à aujourd'hui.
  const raccourcis = raccourcisProp ?? (titre ? raccourcisPeriode() : []);
  const [open, setOpen] = React.useState(false);
  const [brouillon, setBrouillon] = React.useState<DateRange | undefined>();
  const [mois, setMois] = React.useState<Date>(() =>
    premierMoisAffiche(undefined),
  );
  const [actif, setActif] = React.useState<string | null>(null);
  const [derniers, setDerniers] = React.useState<Derniers>(DERNIERS_DEFAUT);

  const borneMin = isoVersDate(min);
  const borneMax = isoVersDate(max);
  const desactives = [
    ...(borneMin ? [{ before: borneMin }] : []),
    ...(borneMax ? [{ after: borneMax }] : []),
  ];

  // Pose un brouillon et synchronise raccourci surligné + mois affichés.
  function poser(p: PeriodeIso) {
    const r = versRange(p);
    setBrouillon(r);
    setActif(raccourciDe(p, raccourcis)?.cle ?? null);
    setMois(premierMoisAffiche(r, borneMin));
  }

  function ouvrir(o: boolean) {
    if (o) {
      poser(value);
      const r = raccourciDe(value, raccourcis)?.relatif;
      setDerniers(
        r ? { n: String(r.n), unite: r.unite, inclure: true } : DERNIERS_DEFAUT,
      );
    }
    setOpen(o);
  }

  function choisirRaccourci(r: RaccourciPeriode) {
    poser(r.periode);
    if (r.relatif)
      setDerniers({
        n: String(r.relatif.n),
        unite: r.relatif.unite,
        inclure: true,
      });
  }

  function changerDerniers(next: Derniers) {
    setDerniers(next);
    const p = periodeDerniers(Number(next.n), next.unite, next.inclure);
    if (p) poser(p);
  }

  function fermerAvec(p?: PeriodeIso) {
    if (p) onChange?.(p);
    setOpen(false);
  }

  const libelle =
    raccourciDe(value, raccourcis)?.libelle ?? libellePeriode(value);
  const resume = libellePeriode(versIso(brouillon)) ?? 'Aucune période';

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
          className={
            titre
              ? cn(declencheurFiltre, className)
              : cn(declencheurBase, bordureChamp(error, open), className)
          }
        >
          {titre ? (
            <ContenuDeclencheur titre={titre} valeur={libelle ?? placeholder} />
          ) : (
            <>
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
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] overflow-y-auto p-0 [max-height:var(--radix-popover-content-available-height)]">
        <div className="flex flex-col sm:flex-row">
          {raccourcis.length > 0 && (
            <ul
              aria-label="Raccourcis de période"
              className="flex flex-wrap gap-1 border-b border-savr-neutral-200 p-2 sm:w-48 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r"
            >
              {raccourcis.map((r) => (
                <li key={r.cle}>
                  <button
                    type="button"
                    aria-pressed={actif === r.cle}
                    data-testid={
                      raccourcisTestIdPrefixe
                        ? `${raccourcisTestIdPrefixe}-${r.cle}`
                        : undefined
                    }
                    onClick={() => choisirRaccourci(r)}
                    className={cn(
                      'flex min-h-11 w-full items-center whitespace-nowrap sm:min-h-9 rounded-savr-sm px-3 text-left text-sm text-savr-neutral-900 transition-colors hover:bg-savr-neutral-50',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
                      actif === r.cle &&
                        'bg-savr-neutral-100 font-semibold hover:bg-savr-neutral-100',
                    )}
                  >
                    {r.libelle}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="p-3">
            {avecDerniers && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-savr-neutral-700">Derniers</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={DERNIERS_N_MAX}
                  aria-label="Nombre d'unités"
                  value={derniers.n}
                  onChange={(e) =>
                    changerDerniers({ ...derniers, n: e.target.value })
                  }
                  className="w-20 sm:h-9"
                />
                <Combobox
                  aria-label="Unité"
                  icon={null}
                  searchable={false}
                  options={UNITES_PERIODE}
                  value={derniers.unite}
                  onChange={(u) =>
                    changerDerniers({ ...derniers, unite: u as UnitePeriode })
                  }
                  className="w-32 sm:h-9"
                />
                <label className="flex min-h-11 items-center gap-2 text-sm text-savr-neutral-700 sm:min-h-9">
                  <Checkbox
                    checked={derniers.inclure}
                    onCheckedChange={(v) =>
                      changerDerniers({ ...derniers, inclure: v === true })
                    }
                  />
                  Inclure aujourd'hui
                </label>
              </div>
            )}
            <Calendar
              mode="range"
              numberOfMonths={2}
              // Deux mois côte à côte : les jours hors mois feraient doublon.
              showOutsideDays={false}
              selected={brouillon}
              month={mois}
              onMonthChange={setMois}
              disabled={desactives}
              onSelect={(r) => {
                setBrouillon(r);
                setActif(raccourciDe(versIso(r), raccourcis)?.cle ?? null);
              }}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-savr-neutral-200 pt-3">
              <p
                className="text-sm text-savr-neutral-700"
                data-testid={testId ? `${testId}-resume` : undefined}
              >
                {resume}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-8"
                  onClick={() => fermerAvec(PERIODE_VIDE)}
                >
                  Effacer
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-11 sm:h-8"
                  onClick={() => fermerAvec()}
                >
                  Annuler
                </Button>
                <Button
                  size="sm"
                  className="h-11 sm:h-8"
                  onClick={() => fermerAvec(versIso(brouillon))}
                >
                  Appliquer
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DateRangePicker };
