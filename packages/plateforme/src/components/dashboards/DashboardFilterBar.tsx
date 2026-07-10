'use client';

import { useEffect, useState } from 'react';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
  type ParcFilterValue,
} from './ParcMultiSelects.js';

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
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
  };
}

function parcValue(f: DashboardFilters): ParcFilterValue {
  return {
    lieu_ids: f.lieu_ids ?? [],
    traiteur_ids: f.traiteur_ids ?? [],
    type_evenement_ids: f.type_evenement_ids ?? [],
    taille_evenement_codes: f.taille_evenement_codes ?? [],
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Presets de période (BL-P3-02) — raccourcis rapides sur la barre globale. Chacun
// ne touche QUE from/to (les filtres parc sont préservés).
type PresetKey = '7j' | '30j' | 'mois';
const PERIOD_PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7j', label: '7 derniers jours' },
  { key: '30j', label: '30 derniers jours' },
  { key: 'mois', label: 'Mois en cours' },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (key === '7j') from.setDate(from.getDate() - 7);
  else if (key === '30j') from.setDate(from.getDate() - 30);
  else from.setDate(1); // mois en cours : 1er jour du mois courant
  return { from: iso(from), to: iso(to) };
}

/**
 * Barre de filtres du dashboard — persistance localStorage (sobriété B1, pas de table).
 * Sans `parcOptions` : Période seule (30 j par défaut, §11 §8). Avec `parcOptions` :
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
    <div
      className={`flex flex-wrap items-end gap-3 ${className ?? ''}`}
      data-testid="dashboard-filter-bar"
    >
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Du</span>
        <input
          type="date"
          value={filters.from}
          max={filters.to}
          onChange={(e) => apply({ ...filters, from: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">au</span>
        <input
          type="date"
          value={filters.to}
          min={filters.from}
          onChange={(e) => apply({ ...filters, to: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {/* Presets de période (BL-P3-02) — raccourcis sur tous les dashboards. */}
      <div className="flex flex-wrap items-center gap-1">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => apply({ ...filters, ...presetRange(p.key) })}
            data-testid={`dashboard-filter-preset-${p.key}`}
            className="rounded-md border border-savr-neutral-200 px-2 py-1 text-xs text-savr-neutral-600 hover:bg-savr-neutral-100"
          >
            {p.label}
          </button>
        ))}
      </div>

      {parcOptions && (
        <ParcMultiSelects
          value={parcValue(filters)}
          options={parcOptions}
          onChange={(patch) => apply({ ...filters, ...patch })}
          testidPrefix="dashboard-filter"
        />
      )}

      {/* Réinitialiser — généralisé à tous les dashboards (BL-P3-02, avant
          gestionnaire-only). Ramène période 30 j + filtres parc vides. */}
      <button
        type="button"
        onClick={() => apply(defaultFilters())}
        data-testid="dashboard-filter-reinitialiser"
        className="text-xs text-savr-primary-700 hover:underline"
      >
        Réinitialiser
      </button>
    </div>
  );
}
