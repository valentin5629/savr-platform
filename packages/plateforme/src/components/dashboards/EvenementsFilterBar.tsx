'use client';

import { useEffect, useState } from 'react';
import { MultiSelectFilter } from './MultiSelectFilter.js';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
} from './ParcMultiSelects.js';

// Filtres de la liste Événements gestionnaire (§06.05 §2 l.280-293) :
// 5 filtres globaux (Période + Lieux + Traiteurs + Type + Taille) + 2 spécifiques
// (Type de collecte single-select, Statut consolidé multi-select).
export interface EvenementsListFilters {
  from: string;
  to: string;
  lieu_ids: string[];
  traiteur_ids: string[];
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
  type_collecte: '' | 'avec_zd' | 'avec_ag' | 'zd_et_ag';
  statut_consolide: string[];
}

const STATUT_OPTIONS = [
  { id: 'En cours', nom: 'En cours' },
  { id: 'Terminé', nom: 'Terminé' },
  { id: 'Annulé', nom: 'Annulé' },
];

// Période défaut = 12 derniers mois (§06.05 l.282).
export function defaultEvenementsFilters(): EvenementsListFilters {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
    type_collecte: '',
    statut_consolide: [],
  };
}

interface EvenementsFilterBarProps {
  value: EvenementsListFilters;
  onChange: (next: EvenementsListFilters) => void;
  /** Nombre d'événements correspondant aux filtres (compteur §06.05 l.295). */
  resultCount?: number;
}

/**
 * Barre de filtres de la liste Événements (§06.05 §2). Composant contrôlé : l'état
 * vit dans la page (source unique, initialisée depuis la query string deep-linkable).
 * Charge ses propres options (Lieux/Traiteurs/Type) via /api/v1/gestionnaire/filtres.
 */
export function EvenementsFilterBar({
  value,
  onChange,
  resultCount,
}: EvenementsFilterBarProps) {
  const [options, setOptions] = useState<ParcFilterOptions>({
    lieux: [],
    traiteurs: [],
    types: [],
  });

  useEffect(() => {
    fetch('/api/v1/gestionnaire/filtres')
      .then((r) => r.json())
      .then((j: { data?: ParcFilterOptions }) => {
        if (j.data) setOptions(j.data);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className="space-y-3 rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-3"
      data-testid="evenements-filter-bar"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-savr-neutral-500">Du</span>
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="rounded-md border border-savr-neutral-300 bg-savr-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-savr-neutral-500">au</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="rounded-md border border-savr-neutral-300 bg-savr-white px-2 py-1 text-sm"
          />
        </label>

        <ParcMultiSelects
          value={value}
          options={options}
          onChange={(patch) => onChange({ ...value, ...patch })}
          testidPrefix="evenements-filter"
        />

        {/* Type de collecte (single-select, propre à la liste — l.292) */}
        <div>
          <span className="mb-1 block text-xs font-medium text-savr-neutral-600">
            Type de collecte
          </span>
          <select
            value={value.type_collecte}
            onChange={(e) =>
              onChange({
                ...value,
                type_collecte: e.target
                  .value as EvenementsListFilters['type_collecte'],
              })
            }
            data-testid="evenements-filter-type-collecte"
            className="rounded-md border border-savr-neutral-300 bg-savr-white px-3 py-1.5 text-sm"
          >
            <option value="">Toutes</option>
            <option value="avec_zd">Avec ZD</option>
            <option value="avec_ag">Avec AG</option>
            <option value="zd_et_ag">ZD et AG</option>
          </select>
        </div>

        <MultiSelectFilter
          label="Statut consolidé"
          options={STATUT_OPTIONS}
          selected={value.statut_consolide}
          onChange={(ids) => onChange({ ...value, statut_consolide: ids })}
          testid="evenements-filter-statut"
        />

        <button
          type="button"
          onClick={() => onChange(defaultEvenementsFilters())}
          data-testid="evenements-filter-reinitialiser"
          className="text-xs text-savr-primary-700 hover:underline"
        >
          Réinitialiser
        </button>
      </div>

      {resultCount != null && (
        <p
          className="text-xs text-savr-neutral-500"
          data-testid="evenements-filter-count"
        >
          {resultCount} événement{resultCount > 1 ? 's' : ''} correspond
          {resultCount > 1 ? 'ent' : ''}
        </p>
      )}
    </div>
  );
}
