'use client';

import { useEffect, useState } from 'react';
import {
  ParcMultiSelects,
  type ParcFilterOptions,
  type ParcFilterValue,
} from './ParcMultiSelects.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FormField } from '@/components/ui/form-field';

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

const iso = (d: Date) => jourParis(d);

// Grille DS (identique à `FilterBar`) : 3 colonnes pleines en desktop, repli à
// 2 puis 1 dès qu'une colonne passerait sous 220px.
const GRILLE_FILTRES =
  'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(max(220px,calc((100%_-_2*1rem)/3)),1fr))]';

// Presets de période (BL-P3-02) — liste CDC EXACTE §06.04 l.73 / §06.05 l.105 :
// 7j / 30j / Trimestre en cours / 12 derniers mois (défaut) / Année civile /
// Personnalisé (= le champ Période). Chaque preset ne touche QUE from/to (les
// filtres parc sont préservés).
type PresetKey = '7j' | '30j' | 'trimestre' | '12m' | 'civile';
const PERIOD_PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7j', label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: 'trimestre', label: 'Trimestre en cours' },
  { key: '12m', label: '12 derniers mois' },
  { key: 'civile', label: 'Année civile' },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const from = new Date();
  if (key === '7j') {
    from.setDate(from.getDate() - 7);
  } else if (key === '30j') {
    from.setDate(from.getDate() - 30);
  } else if (key === 'trimestre') {
    // Trimestre en cours : 1er jour du trimestre courant → aujourd'hui.
    return {
      from: iso(
        new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
      ),
      to: iso(now),
    };
  } else if (key === '12m') {
    from.setMonth(from.getMonth() - 12);
  } else {
    // Année civile — aligné sur le preset benchmark existant (Jan 1 → Dec 31).
    return {
      from: `${now.getFullYear()}-01-01`,
      to: `${now.getFullYear()}-12-31`,
    };
  }
  return { from: iso(from), to: iso(now) };
}

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
    <div
      className={`space-y-3 ${className ?? ''}`}
      data-testid="dashboard-filter-bar"
    >
      {/* DS « Mise en page des formulaires et filtres » : libellé au-dessus,
          une seule période (DateRangePicker), grille de 3 colonnes max. */}
      <div className={GRILLE_FILTRES}>
        <FormField label="Période" htmlFor="dashboard-filter-periode">
          <DateRangePicker
            id="dashboard-filter-periode"
            data-testid="dashboard-filter-periode"
            value={{ from: filters.from, to: filters.to }}
            onChange={(p) => {
              // « Effacer » (période vide) = retour au défaut 12 derniers mois :
              // les dashboards exigent toujours une période bornée.
              const periode = p.from && p.to ? p : presetRange('12m');
              apply({ ...filters, from: periode.from, to: periode.to });
            }}
          />
        </FormField>

        {parcOptions && (
          <ParcMultiSelects
            value={parcValue(filters)}
            options={parcOptions}
            onChange={(patch) => apply({ ...filters, ...patch })}
            testidPrefix="dashboard-filter"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Presets de période (BL-P3-02) — raccourcis sur tous les dashboards. */}
        {PERIOD_PRESETS.map((p) => (
          <Button
            key={p.key}
            variant="secondary"
            size="sm"
            onClick={() => apply({ ...filters, ...presetRange(p.key) })}
            data-testid={`dashboard-filter-preset-${p.key}`}
          >
            {p.label}
          </Button>
        ))}

        {/* Réinitialiser — généralisé à tous les dashboards (BL-P3-02, avant
            gestionnaire-only). Ramène période 12 derniers mois + filtres parc vides. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => apply(defaultFilters())}
          data-testid="dashboard-filter-reinitialiser"
          className="ml-auto"
        >
          Réinitialiser
        </Button>
      </div>
    </div>
  );
}
