'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MultiSelectFilter, type MultiOption } from './MultiSelectFilter.js';

// Filtres du « point rouge » benchmark (§06.05 Bloc 3 ZD) — distincts des filtres
// globaux du dashboard : ils n'affectent QUE la moyenne parc, pas les jauges.
export interface BenchmarkFilters {
  periode_debut: string | null;
  periode_fin: string | null;
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
  lieu_ids: string[];
  traiteur_ids: string[];
}

const TAILLE_OPTIONS: MultiOption[] = [
  { id: 'XS', nom: 'XS (< 250 pax)' },
  { id: 'S', nom: 'S (250-499)' },
  { id: 'M', nom: 'M (500-749)' },
  { id: 'L', nom: 'L (750-999)' },
  { id: 'XL', nom: 'XL (≥ 1000)' },
];

type Preset = '12m' | '24m' | 'civile' | 'perso';

function isoDaysAgoMonths(months: number): { debut: string; fin: string } {
  const fin = new Date();
  const debut = new Date();
  debut.setMonth(debut.getMonth() - months);
  return {
    debut: debut.toISOString().slice(0, 10),
    fin: fin.toISOString().slice(0, 10),
  };
}

function anneeCivile(): { debut: string; fin: string } {
  const y = new Date().getFullYear();
  return { debut: `${y}-01-01`, fin: `${y}-12-31` };
}

// Défaut CDC : 12 mois glissants.
function defaultFilters(): BenchmarkFilters {
  const { debut, fin } = isoDaysAgoMonths(12);
  return {
    periode_debut: debut,
    periode_fin: fin,
    type_evenement_ids: [],
    taille_evenement_codes: [],
    lieu_ids: [],
    traiteur_ids: [],
  };
}

interface BenchmarkFilterBarProps {
  onChange: (filters: BenchmarkFilters) => void;
  /** Endpoint des données de filtres (défaut = route gestionnaire/traiteur). */
  filtresEndpoint?: string;
}

/**
 * Encart « Filtres benchmark » (§06.05 Bloc 3 ZD). 5 critères qui ne s'appliquent
 * qu'au point rouge : Période (+ raccourcis), Lieux parc, Traiteurs parc, Type
 * d'événement, Taille. Bouton Réinitialiser (retour au défaut 12 mois / Tous).
 */
export function BenchmarkFilterBar({
  onChange,
  filtresEndpoint = '/api/v1/dashboards/benchmark/filtres',
}: BenchmarkFilterBarProps) {
  const [filters, setFilters] = useState<BenchmarkFilters>(defaultFilters);
  const [preset, setPreset] = useState<Preset>('12m');
  const [lieux, setLieux] = useState<MultiOption[]>([]);
  const [traiteurs, setTraiteurs] = useState<MultiOption[]>([]);
  const [types, setTypes] = useState<MultiOption[]>([]);

  // Émet la sélection initiale + charge les listes une fois.
  useEffect(() => {
    onChange(filters);
    fetch(filtresEndpoint)
      .then((r) => r.json())
      .then(
        (j: {
          data?: {
            lieux?: MultiOption[];
            traiteurs?: MultiOption[];
            types?: { id: string; libelle: string }[];
          };
        }) => {
          setLieux(j.data?.lieux ?? []);
          setTraiteurs(j.data?.traiteurs ?? []);
          setTypes(
            (j.data?.types ?? []).map((t) => ({ id: t.id, nom: t.libelle })),
          );
        },
      )
      .catch(() => {});
    // onChange/filters volontairement hors deps (émission initiale unique).
  }, [filtresEndpoint]);

  const apply = useCallback(
    (next: BenchmarkFilters) => {
      setFilters(next);
      onChange(next);
    },
    [onChange],
  );

  function applyPreset(p: Preset): void {
    setPreset(p);
    if (p === 'perso') return;
    const range =
      p === 'civile' ? anneeCivile() : isoDaysAgoMonths(p === '24m' ? 24 : 12);
    apply({ ...filters, periode_debut: range.debut, periode_fin: range.fin });
  }

  function reset(): void {
    setPreset('12m');
    apply(defaultFilters());
  }

  const comparaisonSoi = useMemo(
    () => filters.lieu_ids.length > 0 || filters.traiteur_ids.length > 0,
    [filters.lieu_ids, filters.traiteur_ids],
  );

  return (
    <div
      data-testid="benchmark-filter-bar"
      className="space-y-3 rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-savr-neutral-700">
          Filtres benchmark
        </span>
        <button
          type="button"
          onClick={reset}
          data-testid="benchmark-reinitialiser"
          className="text-xs text-savr-primary-700 hover:underline"
        >
          Réinitialiser
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {/* Période + raccourcis */}
        <div className="md:col-span-3 lg:col-span-1">
          <span className="mb-1 block text-xs font-medium text-savr-neutral-600">
            Période benchmark
          </span>
          <div className="mb-1 flex flex-wrap gap-1">
            {(
              [
                ['12m', '12 mois'],
                ['24m', '24 mois'],
                ['civile', 'Année civile'],
              ] as const
            ).map(([key, lbl]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                data-testid={`benchmark-preset-${key}`}
                className={`rounded px-2 py-0.5 text-xs ${
                  preset === key
                    ? 'bg-savr-primary-700 text-savr-white'
                    : 'bg-savr-white text-savr-neutral-600 border border-savr-neutral-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Début période benchmark"
              value={filters.periode_debut ?? ''}
              onChange={(e) => {
                setPreset('perso');
                apply({ ...filters, periode_debut: e.target.value });
              }}
              className="w-full rounded border border-savr-neutral-300 px-1.5 py-1 text-xs"
            />
            <input
              type="date"
              aria-label="Fin période benchmark"
              value={filters.periode_fin ?? ''}
              onChange={(e) => {
                setPreset('perso');
                apply({ ...filters, periode_fin: e.target.value });
              }}
              className="w-full rounded border border-savr-neutral-300 px-1.5 py-1 text-xs"
            />
          </div>
        </div>

        <MultiSelectFilter
          label="Type d'événement"
          options={types}
          selected={filters.type_evenement_ids}
          onChange={(ids) => apply({ ...filters, type_evenement_ids: ids })}
          testid="benchmark-filter-type"
        />
        <MultiSelectFilter
          label="Taille d'événement"
          options={TAILLE_OPTIONS}
          selected={filters.taille_evenement_codes}
          onChange={(ids) => apply({ ...filters, taille_evenement_codes: ids })}
          testid="benchmark-filter-taille"
        />
        <MultiSelectFilter
          label="Lieux benchmark"
          options={lieux}
          selected={filters.lieu_ids}
          onChange={(ids) => apply({ ...filters, lieu_ids: ids })}
          testid="benchmark-filter-lieux"
        />
        {/* Filtre traiteurs masqué pour les rôles traiteur (liste vide renvoyée). */}
        {traiteurs.length > 0 && (
          <MultiSelectFilter
            label="Traiteurs benchmark"
            options={traiteurs}
            selected={filters.traiteur_ids}
            onChange={(ids) => apply({ ...filters, traiteur_ids: ids })}
            testid="benchmark-filter-traiteurs"
          />
        )}
      </div>

      {comparaisonSoi && (
        <p
          data-testid="benchmark-comparaison-soi"
          className="text-xs text-savr-warning-700"
        >
          ⚠ Si vous filtrez sur vos propres lieux/traiteurs, le benchmark
          compare vos données à vos propres données — il perd son rôle de
          référence parc.
        </p>
      )}
    </div>
  );
}
