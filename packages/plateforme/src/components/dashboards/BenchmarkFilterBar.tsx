'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MultiSelectFilter, type MultiOption } from './MultiSelectFilter.js';
import { TAILLE_OPTIONS } from './taille-options.js';

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

// Défaut CDC : 12 mois glissants. Type/Taille hérités des filtres globaux du
// dashboard (§06.05 l.160 — « à l'ouverture, les filtres benchmark héritent par
// défaut des filtres globaux (Type d'événement + Taille uniquement) »).
function defaultFilters(
  initType: string[] = [],
  initTaille: string[] = [],
): BenchmarkFilters {
  const { debut, fin } = isoDaysAgoMonths(12);
  return {
    periode_debut: debut,
    periode_fin: fin,
    type_evenement_ids: initType,
    taille_evenement_codes: initTaille,
    lieu_ids: [],
    traiteur_ids: [],
  };
}

/** Options des multi-selects fournies par le SSR (évite le fetch /filtres au mount). */
export interface BenchmarkFilterOptions {
  lieux: MultiOption[];
  traiteurs: MultiOption[];
  types: { id: string; libelle: string }[];
}

interface BenchmarkFilterBarProps {
  onChange: (filters: BenchmarkFilters) => void;
  /** Endpoint des données de filtres (défaut = route gestionnaire/traiteur). */
  filtresEndpoint?: string;
  /** Héritage §06.05 l.160 : Type d'événement des filtres globaux (init + reset). */
  initialTypeEvenementIds?: string[];
  /** Héritage §06.05 l.160 : Taille d'événement des filtres globaux (init + reset). */
  initialTailleCodes?: string[];
  /** Rendu compact SANS carte (pour être imbriqué dans la carte des jauges). */
  embedded?: boolean;
  /**
   * Options des multi-selects pré-chargées côté serveur (R-perf, dashboard SSR) :
   * quand fournies, la barre NE fait PLUS le fetch `/filtres` au montage — la même
   * requête est déjà exécutée dans le Promise.all serveur de la page.
   */
  initialOptions?: BenchmarkFilterOptions;
}

/**
 * Encart « Filtres benchmark » (§06.05 Bloc 3 ZD). 5 critères qui ne s'appliquent
 * qu'au point rouge : Période (+ raccourcis), Lieux parc, Traiteurs parc, Type
 * d'événement, Taille. Bouton Réinitialiser (retour au défaut 12 mois / Tous).
 */
export function BenchmarkFilterBar({
  onChange,
  filtresEndpoint = '/api/v1/dashboards/benchmark/filtres',
  initialTypeEvenementIds,
  initialTailleCodes,
  embedded = false,
  initialOptions,
}: BenchmarkFilterBarProps) {
  const [filters, setFilters] = useState<BenchmarkFilters>(() =>
    defaultFilters(initialTypeEvenementIds, initialTailleCodes),
  );
  const [preset, setPreset] = useState<Preset>('12m');
  const [lieux, setLieux] = useState<MultiOption[]>(
    () => initialOptions?.lieux ?? [],
  );
  const [traiteurs, setTraiteurs] = useState<MultiOption[]>(
    () => initialOptions?.traiteurs ?? [],
  );
  const [types, setTypes] = useState<MultiOption[]>(() =>
    (initialOptions?.types ?? []).map((t) => ({ id: t.id, nom: t.libelle })),
  );

  // Émet la sélection initiale + charge les listes une fois. Quand `initialOptions`
  // est fourni (dashboard SSR), les listes sont déjà en état → pas de fetch.
  useEffect(() => {
    onChange(filters);
    if (initialOptions) return;
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
    // onChange/filters/initialOptions volontairement hors deps (init unique).
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
    // Retour à l'héritage par défaut (Type/Taille des filtres globaux — §06.05 l.160).
    apply(defaultFilters(initialTypeEvenementIds, initialTailleCodes));
  }

  const comparaisonSoi = useMemo(
    () => filters.lieu_ids.length > 0 || filters.traiteur_ids.length > 0,
    [filters.lieu_ids, filters.traiteur_ids],
  );

  return (
    <div
      data-testid="benchmark-filter-bar"
      className={
        embedded
          ? 'space-y-3'
          : 'space-y-4 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm'
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {embedded ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-savr-neutral-500">
              Filtres du repère parc
            </span>
          ) : (
            <>
              <h3 className="text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
                Filtres benchmark
              </h3>
              <p className="mt-0.5 text-[13px] text-savr-neutral-500">
                Affinent uniquement la moyenne du parc (le repère), pas vos
                données.
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={reset}
          data-testid="benchmark-reinitialiser"
          className="shrink-0 rounded-savr-md px-2 py-1 text-xs font-semibold text-savr-primary-700 hover:bg-savr-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
        >
          Réinitialiser
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {/* Période + raccourcis */}
        <div className="md:col-span-3 lg:col-span-1">
          <span className="mb-1.5 block text-xs font-semibold text-savr-neutral-600">
            Période benchmark
          </span>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
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
                className={`rounded-savr-md px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 ${
                  preset === key
                    ? 'bg-savr-primary-700 text-savr-white'
                    : 'border border-savr-neutral-300 bg-savr-white text-savr-neutral-600 hover:border-savr-neutral-400'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="Début période benchmark"
              value={filters.periode_debut ?? ''}
              onChange={(e) => {
                setPreset('perso');
                apply({ ...filters, periode_debut: e.target.value });
              }}
              className="w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 py-1.5 text-xs text-savr-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
            />
            <input
              type="date"
              aria-label="Fin période benchmark"
              value={filters.periode_fin ?? ''}
              onChange={(e) => {
                setPreset('perso');
                apply({ ...filters, periode_fin: e.target.value });
              }}
              className="w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 py-1.5 text-xs text-savr-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
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
          className="rounded-savr-md border border-savr-warning/30 bg-savr-warning-subtle px-3 py-2 text-xs text-savr-warning-strong"
        >
          ⚠ Si vous filtrez sur vos propres lieux/traiteurs, le benchmark
          compare vos données à vos propres données — il perd son rôle de
          référence parc.
        </p>
      )}
    </div>
  );
}
