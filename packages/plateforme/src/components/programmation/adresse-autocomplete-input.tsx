'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
// Import de TYPE seulement : le module (appel IGN) reste hors du bundle navigateur.
import type { SuggestionAdresse } from '@/lib/adresse-suggestions';

// Même seuil que le relais (la BAN refuse moins de 3 caractères) : évite un aller-retour inutile.
const MIN_CARACTERES_SUGGESTION = 3;

// Suggestions via le relais serveur (jamais d'appel direct navigateur → IGN).
// Fail-open : toute erreur (401, réseau, JSON inattendu) → aucune suggestion.
async function chargerSuggestions(
  saisie: string,
  signal: AbortSignal,
): Promise<SuggestionAdresse[]> {
  try {
    const res = await fetch(
      `/api/v1/programmation/adresses?q=${encodeURIComponent(saisie.trim())}`,
      { signal },
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as SuggestionAdresse[]) : [];
  } catch {
    return [];
  }
}

// Champ adresse avec suggestions BAN (relais /api/v1/programmation/adresses). Contrairement à
// l'Autocomplete §5.5 (sélection = chip figée), le champ reste une saisie libre
// éditable : une adresse d'accès livraison peut légitimement sortir de la BAN
// (« quai de livraison, porte 3 »). Choisir une suggestion remplit l'adresse ET
// délègue code postal + ville à l'appelant via `onSelect`.
export function AdresseAutocompleteInput({
  id,
  value,
  placeholder,
  onChange,
  onSelect,
}: {
  id: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: SuggestionAdresse) => void;
}) {
  const [suggestions, setSuggestions] = React.useState<SuggestionAdresse[]>([]);
  const [open, setOpen] = React.useState(false);
  const [actif, setActif] = React.useState(-1);
  // Vrai seulement quand la valeur vient de la frappe : une valeur posée par une
  // sélection ne doit pas relancer la recherche (la liste se rouvrirait aussitôt).
  const saisieUtilisateur = React.useRef(false);
  const listboxId = `${id}-suggestions`;

  React.useEffect(() => {
    if (!saisieUtilisateur.current) return;
    if (value.trim().length < MIN_CARACTERES_SUGGESTION) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    // Debounce + annulation de la requête précédente (réponses obsolètes neutralisées).
    const controller = new AbortController();
    const t = setTimeout(() => {
      void chargerSuggestions(value, controller.signal).then((s) => {
        if (controller.signal.aborted) return;
        setSuggestions(s);
        setActif(-1);
        setOpen(s.length > 0);
      });
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [value]);

  const choisir = (s: SuggestionAdresse) => {
    saisieUtilisateur.current = false;
    setOpen(false);
    setSuggestions([]);
    onSelect(s);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActif((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActif((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && actif >= 0) {
      e.preventDefault();
      choisir(suggestions[actif]!);
    } else if (e.key === 'Escape') {
      // Ne ferme que la liste, pas la modale qui contient le champ. La modale écoute
      // `keydown` sur document, là même où React (racine = document sous l'App
      // Router) délègue ses événements : stopPropagation ne suffit pas.
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={actif >= 0 ? `${listboxId}-${actif}` : undefined}
        // Désactive l'autofill navigateur, qui se superposerait à la liste.
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          saisieUtilisateur.current = true;
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        // Quitter le champ (Tab, clic ailleurs) ferme la liste, qui sinon masquerait
        // code postal et ville. Le clic sur une option est protégé (preventDefault).
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-savr-md border border-savr-neutral-200 bg-savr-white py-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === actif}
              // mousedown + preventDefault : le champ ne perd pas le focus (pas de blur).
              onMouseDown={(e) => {
                e.preventDefault();
                choisir(s);
              }}
              onMouseEnter={() => setActif(i)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm text-savr-neutral-800 sm:min-h-10',
                i === actif && 'bg-savr-primary-50',
              )}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
