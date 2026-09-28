'use client';

import { useEffect, useState } from 'react';
import { MultiSelectFilter } from './MultiSelectFilter.js';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
} from './ParcMultiSelects.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FormField } from '@/components/ui/form-field';

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

const TYPE_COLLECTE_OPTIONS: {
  value: EvenementsListFilters['type_collecte'];
  label: string;
}[] = [
  { value: '', label: 'Toutes' },
  { value: 'avec_zd', label: 'Avec ZD' },
  { value: 'avec_ag', label: 'Avec AG' },
  { value: 'zd_et_ag', label: 'ZD et AG' },
];

// Période défaut = 12 derniers mois (§06.05 l.282).
export function defaultEvenementsFilters(): EvenementsListFilters {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  return {
    from: jourParis(from),
    to: jourParis(to),
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
    type_collecte: '',
    statut_consolide: [],
  };
}

/** Au moins un filtre diffère du défaut : affiche « Réinitialiser les filtres ». */
export function filtresEvenementsActifs(f: EvenementsListFilters): boolean {
  const d = defaultEvenementsFilters();
  return (
    f.from !== d.from ||
    f.to !== d.to ||
    f.lieu_ids.length > 0 ||
    f.traiteur_ids.length > 0 ||
    f.type_evenement_ids.length > 0 ||
    f.taille_evenement_codes.length > 0 ||
    f.type_collecte !== '' ||
    f.statut_consolide.length > 0
  );
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
    <FilterBar
      data-testid="evenements-filter-bar"
      actif={filtresEvenementsActifs(value)}
      onReset={() => onChange(defaultEvenementsFilters())}
      count={
        resultCount != null ? (
          <span data-testid="evenements-filter-count">
            {resultCount} événement{resultCount > 1 ? 's' : ''} correspond
            {resultCount > 1 ? 'ent' : ''}
          </span>
        ) : undefined
      }
    >
      <FormField label="Période" htmlFor="evenements-filter-periode">
        <DateRangePicker
          id="evenements-filter-periode"
          data-testid="evenements-filter-periode"
          value={{ from: value.from, to: value.to }}
          onChange={(p) => onChange({ ...value, from: p.from, to: p.to })}
        />
      </FormField>

      <ParcMultiSelects
        value={value}
        options={options}
        onChange={(patch) => onChange({ ...value, ...patch })}
        testidPrefix="evenements-filter"
      />

      {/* Type de collecte (single-select, propre à la liste — l.292) */}
      <FormField
        label="Type de collecte"
        htmlFor="evenements-filter-type-collecte"
      >
        <Combobox
          id="evenements-filter-type-collecte"
          data-testid="evenements-filter-type-collecte"
          icon={null}
          placeholder="Toutes"
          options={TYPE_COLLECTE_OPTIONS}
          value={value.type_collecte}
          onChange={(v) =>
            onChange({
              ...value,
              type_collecte: v as EvenementsListFilters['type_collecte'],
            })
          }
        />
      </FormField>

      <MultiSelectFilter
        label="Statut consolidé"
        options={STATUT_OPTIONS}
        selected={value.statut_consolide}
        onChange={(ids) => onChange({ ...value, statut_consolide: ids })}
        testid="evenements-filter-statut"
      />
    </FilterBar>
  );
}
