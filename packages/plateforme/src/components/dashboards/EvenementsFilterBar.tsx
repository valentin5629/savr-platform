'use client';

import { useEffect, useState } from 'react';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
} from './ParcMultiSelects.js';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { periodeDerniers } from '@/lib/periodes-raccourcis';
import type { TypeCollecteEvenement } from '@/lib/evenements-type-collecte';
import { OPTIONS_STATUT_EVENEMENT } from '@/lib/libelles/evenement';

// Filtres de la liste Événements gestionnaire (§06.05 §2 l.280-293) :
// 5 filtres globaux (Période + Lieux + Traiteurs + Type + Taille) + 2 spécifiques
// (Type de collecte et Statut consolidé, à choix multiple).
export interface EvenementsListFilters {
  from: string;
  to: string;
  lieu_ids: string[];
  traiteur_ids: string[];
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
  types_collecte: TypeCollecteEvenement[];
  statut_consolide: string[];
}

// Statut consolidé : source unique `lib/libelles/evenement` (R-UI-2 C13).
const STATUT_OPTIONS = OPTIONS_STATUT_EVENEMENT;

// Partition (arbitrage Val F1 2026-10-01) : chaque événement est dans une seule
// case. « Avec ZD » = ZD seul + ZD et AG ; « Avec AG » = AG seul + ZD et AG.
const TYPE_COLLECTE_OPTIONS: { id: TypeCollecteEvenement; nom: string }[] = [
  { id: 'zd_seul', nom: 'ZD seul' },
  { id: 'ag_seul', nom: 'AG seul' },
  { id: 'zd_et_ag', nom: 'ZD et AG' },
];

// Période défaut = 12 derniers mois (§06.05 l.282) — même calcul que le
// raccourci « 12 derniers mois », que le déclencheur affiche alors par son nom.
export function defaultEvenementsFilters(): EvenementsListFilters {
  return {
    ...periodeDerniers(12, 'mois')!,
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
    types_collecte: [],
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
    f.types_collecte.length > 0 ||
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
        ) : null
      }
    >
      <DateRangePicker
        titre="Période"
        id="evenements-filter-periode"
        data-testid="evenements-filter-periode"
        value={{ from: value.from, to: value.to }}
        onChange={(p) => onChange({ ...value, from: p.from, to: p.to })}
      />

      <ParcMultiSelects
        value={value}
        options={options}
        onChange={(patch) => onChange({ ...value, ...patch })}
        testidPrefix="evenements-filter"
      />

      {/* Type de collecte (propre à la liste — l.292), à choix multiple sur
          une partition ; case « Toutes » = aucun filtre. */}
      <FiltreCoches
        label="Type de collecte"
        testid="evenements-filter-type-collecte"
        libelleVide="Toutes"
        libelleTous="Toutes"
        options={TYPE_COLLECTE_OPTIONS}
        selected={value.types_collecte}
        onChange={(ids) =>
          onChange({
            ...value,
            types_collecte: ids as TypeCollecteEvenement[],
          })
        }
      />

      <FiltreCoches
        label="Statut consolidé"
        options={STATUT_OPTIONS}
        selected={value.statut_consolide}
        onChange={(ids) => onChange({ ...value, statut_consolide: ids })}
        testid="evenements-filter-statut"
      />
    </FilterBar>
  );
}
