'use client';

import * as React from 'react';
import { Check, ChevronDown, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  ContenuDeclencheur,
  declencheurFiltre,
} from '@/components/ui/filtre-en-ligne';

// Combobox — choix dans une liste, avec recherche (Popover + Command, shadcn
// stylé Savr). Remplace tout <select> natif (DS « Mise en page des formulaires
// et filtres » règle 3). Hauteur unique `h-11 sm:h-10` (règle 2).
//
// Valeur « aucune » = chaîne vide, comme un <select> natif : pour proposer un
// choix « Tous », le consommateur passe une option `{ value: '', label: 'Tous' }`.
// Icône de tête : pin par défaut (Lieu) ; `icon={null}` pour les autres listes.
// Mode `multiple` : valeurs `string[]`, liste vide = « Tous ».
// Mode filtre (`titre`) : déclencheur « Titre  valeur ▾ » des barres de filtres
// (`filtre-en-ligne`, décision Val 2026-09-30) au lieu du champ bordé ; la
// liste (coche sur l'option choisie, fermeture au clic) est inchangée.

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  /** Mode filtre en ligne : titre affiché devant la valeur courante. */
  titre?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Icône de tête ; `null` = aucune. Défaut : pin (lieu). */
  icon?: React.ReactNode;
  /** Champ de recherche ; défaut = au-delà de 7 options. */
  searchable?: boolean;
  id?: string;
  /** Nom de champ de formulaire : rend un <input type="hidden">. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

interface ComboboxSingleProps extends ComboboxBaseProps {
  multiple?: false;
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
}

interface ComboboxMultipleProps extends ComboboxBaseProps {
  multiple: true;
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
}

export type ComboboxProps = ComboboxSingleProps | ComboboxMultipleProps;

const SEUIL_RECHERCHE = 7;

function Combobox(props: ComboboxProps) {
  const {
    options,
    titre,
    placeholder = titre ? 'Tous' : 'Sélectionner…',
    searchPlaceholder = 'Rechercher…',
    emptyText = 'Aucun résultat.',
    icon,
    searchable,
    id,
    name,
    disabled,
    required,
    error,
    className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    'data-testid': testId,
  } = props;

  const [open, setOpen] = React.useState(false);
  const titreId = React.useId();
  const commandRef = React.useRef<HTMLDivElement>(null);

  // Contrôlé ou non contrôlé, dans les deux modes.
  const [interne, setInterne] = React.useState<string | string[]>(
    props.multiple ? (props.defaultValue ?? []) : (props.defaultValue ?? ''),
  );
  const controle = props.value !== undefined;
  const courant: string | string[] = controle
    ? props.multiple
      ? (props.value ?? [])
      : (props.value ?? '')
    : interne;

  const selection = new Set(
    Array.isArray(courant) ? courant : courant === '' ? [] : [courant],
  );

  function choisir(v: string) {
    if (props.multiple) {
      const liste = courant as string[];
      const suivante =
        v === ''
          ? []
          : liste.includes(v)
            ? liste.filter((x) => x !== v)
            : [...liste, v];
      if (!controle) setInterne(suivante);
      props.onChange?.(suivante);
      return;
    }
    if (!controle) setInterne(v);
    props.onChange?.(v);
    setOpen(false);
  }

  const libelleDe = (v: string) => options.find((o) => o.value === v)?.label;
  const resume = (() => {
    if (Array.isArray(courant)) {
      if (courant.length === 0) return null;
      if (courant.length === 1) return libelleDe(courant[0]!) ?? null;
      return `${courant.length} sélectionnés`;
    }
    // Une option « vide » explicite (ex. « Tous les lieux ») s'affiche comme
    // le placeholder : grisée, c'est l'absence de filtre.
    return courant === '' ? null : (libelleDe(courant) ?? null);
  })();

  const avecRecherche = searchable ?? options.length > SEUIL_RECHERCHE;
  const iconeTete = icon === undefined ? <MapPin aria-hidden="true" /> : icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={titre && !ariaLabel ? titreId : undefined}
          aria-describedby={ariaDescribedBy}
          aria-invalid={error || undefined}
          aria-required={required || undefined}
          data-testid={testId}
          className={
            titre
              ? cn(declencheurFiltre, className)
              : cn(
                  'flex h-11 w-full min-w-0 items-center gap-2 rounded-savr-md border bg-savr-white px-3 text-left text-sm text-savr-neutral-900 sm:h-10',
                  'transition-colors duration-[120ms] ease-out',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  error
                    ? 'border-savr-error'
                    : open
                      ? 'border-savr-primary-500'
                      : 'border-savr-neutral-300 hover:border-savr-primary-400',
                  className,
                )
          }
        >
          {titre ? (
            <ContenuDeclencheur
              titre={titre}
              titreId={titreId}
              valeur={resume ?? placeholder}
            />
          ) : (
            <>
              {iconeTete && (
                <span className="shrink-0 text-savr-neutral-400 [&_svg]:h-4 [&_svg]:w-4">
                  {iconeTete}
                </span>
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  resume === null && 'text-savr-neutral-500',
                )}
              >
                {resume ?? placeholder}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 text-savr-neutral-400"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </PopoverTrigger>
      {name &&
        (Array.isArray(courant) ? (
          courant.map((v) => (
            <input key={v} type="hidden" name={name} value={v} />
          ))
        ) : (
          <input type="hidden" name={name} value={courant} />
        ))}
      <PopoverContent
        className={
          titre
            ? 'w-64 p-0'
            : 'w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0'
        }
        onOpenAutoFocus={(e) => {
          // Sans champ de recherche, le focus va sur la liste pour la
          // navigation clavier (flèches + Entrée).
          if (!avecRecherche) {
            e.preventDefault();
            commandRef.current?.focus();
          }
        }}
      >
        <Command ref={commandRef} tabIndex={-1}>
          {avecRecherche && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList
            role="listbox"
            aria-multiselectable={props.multiple || undefined}
          >
            <CommandEmpty>{emptyText}</CommandEmpty>
            {props.multiple && (
              <CommandItem
                value="__tous__"
                keywords={[placeholder]}
                onSelect={() => choisir('')}
                data-checked={selection.size === 0}
              >
                <Check
                  className={cn(
                    selection.size === 0 ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden="true"
                />
                {placeholder}
              </CommandItem>
            )}
            {options.map((o) => {
              const actif =
                o.value === '' ? selection.size === 0 : selection.has(o.value);
              return (
                <CommandItem
                  key={o.value || '__vide__'}
                  value={o.value || '__vide__'}
                  keywords={[o.label, o.hint ?? '']}
                  disabled={o.disabled}
                  onSelect={() => choisir(o.value)}
                  data-checked={actif}
                >
                  <Check
                    className={cn(
                      'text-savr-primary-700',
                      actif ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="shrink-0 text-xs text-savr-neutral-500">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
