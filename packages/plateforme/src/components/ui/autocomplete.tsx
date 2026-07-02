'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Autocomplete §5.5 — champ de recherche + liste de suggestions résolue par un
// `fetchOptions` fourni par l'appelant (autocomplétion traiteur/lieu de la liste
// collectes §06.06 §3, réutilisable). Sélection = chip effaçable.
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
}

function Autocomplete({
  placeholder = 'Rechercher…',
  fetchOptions,
  selected,
  onChange,
  className,
  minChars = 1,
  'aria-label': ariaLabel,
}: AutocompleteProps) {
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<AutocompleteOption[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

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
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, selected, minChars, fetchOptions]);

  // Fermeture au clic extérieur.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (selected) {
    return (
      <div
        className={cn(
          'flex h-10 items-center justify-between gap-2 rounded-savr-md border border-savr-primary-400 bg-savr-primary-50 px-3 text-sm',
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
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => options.length > 0 && setOpen(true)}
          className="flex h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white pl-9 pr-3 text-sm text-savr-neutral-900 hover:border-savr-primary-400 focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500"
        />
      </div>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-savr-md border border-savr-neutral-200 bg-savr-white py-1 shadow-lg"
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
            options.map((opt) => (
              <li key={opt.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-savr-neutral-800 hover:bg-savr-neutral-50"
                >
                  {opt.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export { Autocomplete };
