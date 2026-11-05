'use client';

import * as React from 'react';
import { MagnifyingGlassIcon, XIcon } from '@/components/ui/icones';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { DELAI_DEBOUNCE_MS } from '@/lib/hooks/use-debounce';

// Autocomplete §5.5 — champ de recherche + liste de suggestions résolue par un
// `fetchOptions` fourni par l'appelant (autocomplétion traiteur/lieu de la liste
// collectes §06.06 §3, réutilisable). Sélection = chip effaçable.
//
// La liste s'ouvre dans le panneau flottant du DS (Popover, posé sur la page
// et accroché sous le champ), comme celles du Combobox : dessinée dans le
// champ, elle restait cachée sous le pied d'une modale, dont le corps défile
// (fenêtre « Inviter un membre », constaté en production le 2026-11-05).
export interface AutocompleteOption {
  id: string;
  label: string;
}

interface AutocompleteProps {
  placeholder?: string;
  /** Résout les options correspondant à la saisie (déjà filtrées/paginées). */
  fetchOptions: (query: string) => Promise<AutocompleteOption[]>;
  /** Option sélectionnée (label affiché en chip), null = aucune. */
  selected: AutocompleteOption | null;
  onChange: (option: AutocompleteOption | null) => void;
  className?: string;
  /** Nombre de caractères minimum avant de déclencher la recherche. */
  minChars?: number;
  'aria-label'?: string;
  /** Id du champ de saisie (cible du `htmlFor` d'un FormField). */
  id?: string;
}

function Autocomplete({
  placeholder = 'Rechercher…',
  fetchOptions,
  selected,
  onChange,
  className,
  minChars = 1,
  'aria-label': ariaLabel,
  id,
}: AutocompleteProps) {
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<AutocompleteOption[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  // Option active au clavier (motif `aria-activedescendant` : le focus reste
  // dans le champ, les flèches déplacent l'option active, Entrée la choisit).
  const [actif, setActif] = React.useState(-1);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listeId = React.useId();
  const idOption = (i: number) => `${listeId}-option-${i}`;
  const actifVisible =
    open && !loading && actif >= 0 && actif < options.length ? actif : -1;

  React.useEffect(() => setActif(-1), [options]);
  React.useEffect(() => {
    if (actifVisible < 0) return;
    document
      .getElementById(idOption(actifVisible))
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [actifVisible]);

  function ouvrirFermer(ouvert: boolean) {
    setOpen(ouvert);
    if (!ouvert) setActif(-1);
  }

  function choisir(opt: AutocompleteOption) {
    onChange(opt);
    ouvrirFermer(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (loading || options.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bas = e.key === 'ArrowDown';
      if (!open) {
        setOpen(true);
        setActif(bas ? 0 : options.length - 1);
        return;
      }
      setActif((i) =>
        bas ? Math.min(i + 1, options.length - 1) : Math.max(i - 1, 0),
      );
    } else if (e.key === 'Enter' && actifVisible >= 0) {
      // Sans option active, Entrée garde son effet habituel (envoi du
      // formulaire).
      e.preventDefault();
      choisir(options[actifVisible]!);
    }
  }

  // Debounce + fetch. Un compteur de requête neutralise les réponses obsolètes.
  React.useEffect(() => {
    if (selected) return;
    if (query.trim().length < minChars) {
      setOptions([]);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      void fetchOptions(query.trim())
        .then((opts) => {
          if (active) {
            setOptions(opts);
            setOpen(true);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, DELAI_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, selected, minChars, fetchOptions]);

  if (selected) {
    return (
      <div
        className={cn(
          'flex h-11 items-center justify-between gap-2 rounded-savr-md border border-savr-primary-400 bg-savr-primary-50 px-3 text-sm sm:h-10',
          className,
        )}
      >
        <span className="truncate font-medium text-savr-neutral-900">
          {selected.label}
        </span>
        <button
          type="button"
          aria-label="Effacer la sélection"
          onClick={() => {
            onChange(null);
            setQuery('');
          }}
          className="shrink-0 text-savr-neutral-500 hover:text-savr-neutral-900"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={ouvrirFermer}>
      <PopoverAnchor asChild>
        <div ref={rootRef} className={cn('relative', className)}>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400" />
          {/* Champ du DS (R-UI-4b, D7 : avant, classes de `Input` recopiées). */}
          <Input
            type="text"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listeId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              actifVisible >= 0 ? idOption(actifVisible) : undefined
            }
            aria-label={ariaLabel}
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => options.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            className="pl-9"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        // La saisie continue dans le champ : le panneau ne prend pas le focus.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Un clic dans le champ n'est pas un clic « hors du panneau ».
        onInteractOutside={(e) => {
          if (rootRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <ul
          id={listeId}
          role="listbox"
          className="max-h-64 overflow-auto py-1"
          // Un clic dans la liste ne retire pas le focus du champ.
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <li className="px-3 py-2 text-sm text-savr-neutral-400">
              Recherche…
            </li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-savr-neutral-400">
              Aucun résultat
            </li>
          ) : (
            options.map((opt, i) => (
              <li
                key={opt.id}
                id={idOption(i)}
                role="option"
                aria-selected={i === actifVisible}
                onClick={() => choisir(opt)}
                onMouseMove={() => setActif(i)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm text-savr-neutral-800',
                  i === actifVisible && 'bg-savr-neutral-50',
                )}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export { Autocomplete };
