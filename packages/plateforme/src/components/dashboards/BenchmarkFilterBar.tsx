'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MultiSelectFilter, type MultiOption } from './MultiSelectFilter.js';
import { FiltreCoches } from './FiltreCoches.js';
import { TAILLE_OPTIONS } from './taille-options.js';
import { periodeBenchmark } from '@/lib/dashboards/periode-benchmark.js';

// Filtres du « point rouge » benchmark (§06.05 Bloc 3 ZD) — distincts des filtres
// globaux du dashboard : ils n'affectent QUE la moyenne parc, pas les valeurs « Vous ».
export interface BenchmarkFilters {
  periode_debut: string | null;
  periode_fin: string | null;
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
  lieu_ids: string[];
  traiteur_ids: string[];
}

// Période FIXE 24 mois glissants (décision Val 2026-09-28, plus de choix UI). Type/Taille hérités des filtres globaux du
// dashboard (§06.05 l.160 — « à l'ouverture, les filtres benchmark héritent par
// défaut des filtres globaux (Type d'événement + Taille uniquement) »).
function defaultFilters(
  initType: string[] = [],
  initTaille: string[] = [],
): BenchmarkFilters {
  const { debut, fin } = periodeBenchmark();
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
  /** Rendu compact SANS carte (pour être imbriqué dans la carte du benchmark). */
  embedded?: boolean;
  /**
   * Options des multi-selects pré-chargées côté serveur (R-perf, dashboard SSR) :
   * quand fournies, la barre NE fait PLUS le fetch `/filtres` au montage — la même
   * requête est déjà exécutée dans le Promise.all serveur de la page.
   */
  initialOptions?: BenchmarkFilterOptions;
  /**
   * 'ligne' (fiche collecte client, §06.04 refonte 2026-09-29) : une seule ligne
   * « Comparer avec » + titres cliquables ouvrant une liste à cocher.
   * 'grille' (défaut, dashboards) : libellés au-dessus, grille de Combobox.
   */
  presentation?: 'grille' | 'ligne';
  /** Masque le filtre Traiteurs même pour un rôle qui y a droit (fiche collecte). */
  masquerTraiteurs?: boolean;
}

/**
 * Encart « Filtres benchmark » (§06.05 Bloc 3 ZD). Critères qui ne s'appliquent
 * qu'au point rouge : Lieux parc, Traiteurs parc, Type d'événement, Taille. La
 * période est fixe (24 mois glissants, non affichée). Bouton Réinitialiser
 * (retour à l'héritage Type/Taille, Lieux/Traiteurs « Tous »).
 */
export function BenchmarkFilterBar({
  onChange,
  filtresEndpoint = '/api/v1/dashboards/benchmark/filtres',
  initialTypeEvenementIds,
  initialTailleCodes,
  embedded = false,
  initialOptions,
  presentation = 'grille',
  masquerTraiteurs = false,
}: BenchmarkFilterBarProps) {
  const [filters, setFilters] = useState<BenchmarkFilters>(() =>
    defaultFilters(initialTypeEvenementIds, initialTailleCodes),
  );
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

  function reset(): void {
    // Retour à l'héritage par défaut (Type/Taille des filtres globaux — §06.05 l.160).
    apply(defaultFilters(initialTypeEvenementIds, initialTailleCodes));
  }

  const comparaisonSoi = useMemo(
    () => filters.lieu_ids.length > 0 || filters.traiteur_ids.length > 0,
    [filters.lieu_ids, filters.traiteur_ids],
  );

  const avertissementSoi = comparaisonSoi && (
    <p
      data-testid="benchmark-comparaison-soi"
      className="rounded-savr-md border border-savr-warning/30 bg-savr-warning-subtle px-3 py-2 text-xs text-savr-warning-strong"
    >
      ⚠ Si vous filtrez sur vos propres lieux/traiteurs, le benchmark compare
      vos données à vos propres données — il perd son rôle de référence parc.
    </p>
  );
  const traiteursVisibles = !masquerTraiteurs && traiteurs.length > 0;

  if (presentation === 'ligne') {
    return (
      <div data-testid="benchmark-filter-bar" className="space-y-2">
        <div className="flex flex-wrap items-center gap-1 rounded-savr-md bg-savr-neutral-50 px-3 py-2 md:flex-nowrap">
          <span className="mr-1 whitespace-nowrap text-[13px] font-semibold text-savr-neutral-500">
            Comparer avec
          </span>
          <FiltreCoches
            label="Type d'événement"
            options={types}
            selected={filters.type_evenement_ids}
            onChange={(ids) => apply({ ...filters, type_evenement_ids: ids })}
            testid="benchmark-filter-type"
          />
          <FiltreCoches
            label="Taille d'événement"
            options={TAILLE_OPTIONS}
            selected={filters.taille_evenement_codes}
            onChange={(ids) =>
              apply({ ...filters, taille_evenement_codes: ids })
            }
            testid="benchmark-filter-taille"
          />
          <FiltreCoches
            label="Lieux"
            options={lieux}
            selected={filters.lieu_ids}
            onChange={(ids) => apply({ ...filters, lieu_ids: ids })}
            testid="benchmark-filter-lieux"
          />
          {traiteursVisibles && (
            <FiltreCoches
              label="Traiteurs"
              options={traiteurs}
              selected={filters.traiteur_ids}
              onChange={(ids) => apply({ ...filters, traiteur_ids: ids })}
              testid="benchmark-filter-traiteurs"
            />
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={reset}
            data-testid="benchmark-reinitialiser"
            className="shrink-0 rounded-savr-md px-2 py-1 text-xs font-semibold text-savr-primary-700 hover:bg-savr-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
          >
            Réinitialiser
          </button>
        </div>
        {avertissementSoi}
      </div>
    );
  }

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          label="Lieux"
          options={lieux}
          selected={filters.lieu_ids}
          onChange={(ids) => apply({ ...filters, lieu_ids: ids })}
          testid="benchmark-filter-lieux"
        />
        {/* Filtre traiteurs masqué pour les rôles traiteur (liste vide renvoyée). */}
        {traiteursVisibles && (
          <MultiSelectFilter
            label="Traiteurs benchmark"
            options={traiteurs}
            selected={filters.traiteur_ids}
            onChange={(ids) => apply({ ...filters, traiteur_ids: ids })}
            testid="benchmark-filter-traiteurs"
          />
        )}
      </div>

      {avertissementSoi}
    </div>
  );
}
