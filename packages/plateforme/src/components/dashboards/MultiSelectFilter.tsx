'use client';

import { useEffect, useRef, useState } from 'react';

export interface MultiOption {
  id: string;
  nom: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: MultiOption[];
  /** ids sélectionnés ; tableau vide = « Tous » (option par défaut). */
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel?: string;
  testid?: string;
}

/**
 * Multi-select compact (bouton + panneau à cases). Sélection vide = « Tous ».
 * Composant de filtrage uniquement — aucune écriture. Utilisé par l'encart
 * « Filtres benchmark » (§06.05 Bloc 3 ZD).
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  allLabel = 'Tous',
  testid,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selectedSet = new Set(selected);
  const summary =
    selected.length === 0
      ? allLabel
      : `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}`;

  function toggle(id: string): void {
    if (selectedSet.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div ref={ref} className="relative" data-testid={testid}>
      <span className="mb-1 block text-xs font-medium text-savr-neutral-600">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-savr-neutral-300 bg-savr-white px-3 py-1.5 text-left text-sm hover:border-savr-neutral-400"
      >
        <span className={selected.length === 0 ? 'text-savr-neutral-500' : ''}>
          {summary}
        </span>
        <span className="ml-2 text-savr-neutral-400">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 max-h-56 w-full min-w-[12rem] overflow-y-auto rounded-md border border-savr-neutral-200 bg-savr-white p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => onChange([])}
            data-testid={testid ? `${testid}-opt-tous` : undefined}
            className={`w-full rounded px-2 py-1.5 text-left text-sm ${
              selected.length === 0
                ? 'bg-savr-primary-50 font-medium text-savr-primary-800'
                : 'hover:bg-savr-neutral-50'
            }`}
          >
            {allLabel}
          </button>
          {options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-savr-neutral-50"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(o.id)}
                onChange={() => toggle(o.id)}
                data-testid={testid ? `${testid}-opt-${o.id}` : undefined}
              />
              <span className="flex-1">{o.nom}</span>
            </label>
          ))}
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-savr-neutral-500">
              Aucune option.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
