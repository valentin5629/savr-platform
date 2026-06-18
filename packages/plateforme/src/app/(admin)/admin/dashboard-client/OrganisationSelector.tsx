'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';

export interface OrganisationOption {
  id: string;
  /** Nom NOT NULL — colonne canonique de l'autocomplete (§06.06 §2). */
  nom: string;
  /** Raison sociale nullable — fallback = nom. */
  raison_sociale: string | null;
  type: string;
}

function orgLabel(o: OrganisationOption): string {
  return o.raison_sociale ?? o.nom;
}

interface OrganisationSelectorProps {
  organisations: OrganisationOption[];
  /** ids sélectionnés ; tableau vide = « Toutes les organisations ». */
  selected: string[];
  onChange: (ids: string[]) => void;
}

const TYPE_LABEL: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire de lieux',
};

/**
 * Sélecteur d'organisations du Dashboard Client (§06.06 §2).
 * Multi-sélection avec autocomplete sur la raison sociale, tous types confondus.
 * « Toutes les organisations » = sélection vide (option par défaut).
 * Composant de filtrage uniquement — aucune écriture.
 */
export function OrganisationSelector({
  organisations,
  selected,
  onChange,
}: OrganisationSelectorProps) {
  const [query, setQuery] = useState('');

  const byId = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toutes = selected.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return organisations;
    return organisations.filter((o) => orgLabel(o).toLowerCase().includes(q));
  }, [query, organisations]);

  function toggle(id: string): void {
    if (selectedSet.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div
      data-testid="organisation-selector"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-savr-neutral-700">
          Organisations
        </span>
        {toutes ? (
          <Badge variant="primary" data-testid="org-selection-toutes">
            Toutes les organisations
          </Badge>
        ) : (
          selected.map((id) => {
            const o = byId.get(id);
            const label = o ? orgLabel(o) : id;
            return (
              <Badge key={id} variant="primary" dot={false}>
                {label}
                <button
                  type="button"
                  aria-label={`Retirer ${label}`}
                  onClick={() => toggle(id)}
                  className="ml-1 text-savr-primary-700 hover:text-savr-primary-900"
                >
                  ×
                </button>
              </Badge>
            );
          })
        )}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher une organisation…"
        data-testid="org-search"
        aria-label="Rechercher une organisation"
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <ul
        role="listbox"
        aria-label="Organisations"
        aria-multiselectable="true"
        className="max-h-56 space-y-1 overflow-y-auto"
      >
        <li>
          <button
            type="button"
            data-testid="org-option-toutes"
            aria-selected={toutes}
            onClick={() => onChange([])}
            className={`w-full rounded px-2 py-1.5 text-left text-sm ${
              toutes
                ? 'bg-savr-primary-50 font-medium text-savr-primary-800'
                : 'hover:bg-savr-neutral-50'
            }`}
          >
            Toutes les organisations
          </button>
        </li>
        {filtered.map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-savr-neutral-50">
              <input
                type="checkbox"
                checked={selectedSet.has(o.id)}
                onChange={() => toggle(o.id)}
                data-testid={`org-option-${o.id}`}
              />
              <span className="flex-1">{orgLabel(o)}</span>
              <span className="text-xs text-savr-neutral-500">
                {TYPE_LABEL[o.type] ?? o.type}
              </span>
            </label>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-savr-neutral-500">
            Aucune organisation trouvée.
          </li>
        )}
      </ul>
    </div>
  );
}
