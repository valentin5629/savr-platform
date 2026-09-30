'use client';

import { useEffect, useState } from 'react';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
  type ParcFilterValue,
} from './ParcMultiSelects.js';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { BarreFiltres } from '@/components/ui/filtre-en-ligne';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

export interface DashboardFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  // Filtres « parc » globaux (§06.05 §1) — optionnels : présents seulement quand la
  // barre reçoit `parcOptions` (dashboard gestionnaire). Absents/vides pour les
  // autres dashboards (traiteur/agence/organisateur/admin) → rétro-compatible.
  lieu_ids?: string[];
  traiteur_ids?: string[];
  type_evenement_ids?: string[];
  taille_evenement_codes?: string[];
}

interface DashboardFilterBarProps {
  storageKey: string;
  onChange: (filters: DashboardFilters) => void;
  /** Si fourni, affiche les 4 filtres parc (Lieux/Traiteurs/Type/Taille) + Réinitialiser. */
  parcOptions?: ParcFilterOptions;
  className?: string;
}

function defaultFilters(): DashboardFilters {
  // Défaut = 12 derniers mois (CDC §11 l.179 aligné sur §06.04 l.73 / §06.05 l.105,
  // résolution divergence _Divergences/M0.8_20260710, décision Val 2026-07-10).
  // Même calcul que le raccourci « 12 derniers mois » : le déclencheur l'affiche
  // sous ce nom.
  return {
    ...douzeDerniersMois(),
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
  };
}

function douzeDerniersMois(): { from: string; to: string } {
  return periodeDerniers(12, 'mois')!;
}

function parcValue(f: DashboardFilters): ParcFilterValue {
  return {
    lieu_ids: f.lieu_ids ?? [],
    traiteur_ids: f.traiteur_ids ?? [],
    type_evenement_ids: f.type_evenement_ids ?? [],
    taille_evenement_codes: f.taille_evenement_codes ?? [],
  };
}

// Raccourcis de période (BL-P3-02) — liste CDC EXACTE §06.04 l.73 / §06.05 l.105
// (7 derniers jours / 30 derniers jours / Trimestre en cours / 12 derniers mois
// / Année civile / Personnalisé = le calendrier) : liste standard du panneau
// Période (`lib/periodes-raccourcis`). Un raccourci ne touche QUE from/to (les
// filtres parc sont préservés).

/**
 * Barre de filtres du dashboard — persistance localStorage (sobriété B1, pas de table).
 * Sans `parcOptions` : Période seule (12 derniers mois par défaut, §11 §8). Avec `parcOptions` :
 * Période + Lieux + Traiteurs + Type + Taille (§06.05 §1, 5 filtres globaux).
 */
export function DashboardFilterBar({
  storageKey,
  onChange,
  parcOptions,
  className,
}: DashboardFilterBarProps) {
  const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);

  // Charger depuis localStorage au mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as DashboardFilters;
        if (parsed.from && parsed.to) {
          const merged = { ...defaultFilters(), ...parsed };
          setFilters(merged);
          onChange(merged);
          return;
        }
      }
    } catch {
      // ignore
    }
    onChange(filters);
  }, [storageKey]);

  function apply(next: DashboardFilters) {
    setFilters(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    onChange(next);
  }

  return (
    <BarreFiltres
      surface="page"
      data-testid="dashboard-filter-bar"
      className={className}
      onReset={() => apply(defaultFilters())}
      resetTestId="dashboard-filter-reinitialiser"
    >
      {/* Format unique des barres de filtres (décision Val 2026-09-30) :
          « Période  12 derniers mois ▾ », raccourcis dans le panneau. */}
      <DateRangePicker
        titre="Période"
        id="dashboard-filter-periode"
        data-testid="dashboard-filter-periode"
        raccourcisTestIdPrefixe="dashboard-filter-preset"
        value={{ from: filters.from, to: filters.to }}
        onChange={(p) => {
          // « Effacer » (période vide) = retour au défaut 12 derniers mois :
          // les dashboards exigent toujours une période bornée.
          const periode = p.from && p.to ? p : douzeDerniersMois();
          apply({ ...filters, from: periode.from, to: periode.to });
        }}
      />

      {parcOptions && (
        <ParcMultiSelects
          value={parcValue(filters)}
          options={parcOptions}
          onChange={(patch) => apply({ ...filters, ...patch })}
          testidPrefix="dashboard-filter"
        />
      )}
    </BarreFiltres>
  );
}
