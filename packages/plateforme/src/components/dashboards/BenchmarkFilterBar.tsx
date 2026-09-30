'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarreFiltres,
  FiltreCoches,
  type OptionFiltre,
} from '@/components/ui/filtre-en-ligne';
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
  lieux: OptionFiltre[];
  traiteurs: OptionFiltre[];
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
  /**
   * Options des multi-selects pré-chargées côté serveur (R-perf, dashboard SSR) :
   * quand fournies, la barre NE fait PLUS le fetch `/filtres` au montage — la même
   * requête est déjà exécutée dans le Promise.all serveur de la page.
   */
  initialOptions?: BenchmarkFilterOptions;
  /** Masque le filtre Traiteurs même pour un rôle qui y a droit (fiche collecte). */
  masquerTraiteurs?: boolean;
}

/**
 * Encart « Filtres benchmark » (§06.05 Bloc 3 ZD), imbriqué dans la carte du
 * benchmark : une ligne « Comparer avec » + filtres en ligne (format unique des
 * barres de filtres, décision Val 2026-09-30). Critères qui ne s'appliquent
 * qu'au point rouge : Type d'événement, Taille, Lieux parc, Traiteurs parc. La
 * période est fixe (24 mois glissants, non affichée). Bouton Réinitialiser
 * (retour à l'héritage Type/Taille, Lieux/Traiteurs « Tous »).
 */
export function BenchmarkFilterBar({
  onChange,
  filtresEndpoint = '/api/v1/dashboards/benchmark/filtres',
  initialTypeEvenementIds,
  initialTailleCodes,
  initialOptions,
  masquerTraiteurs = false,
}: BenchmarkFilterBarProps) {
  const [filters, setFilters] = useState<BenchmarkFilters>(() =>
    defaultFilters(initialTypeEvenementIds, initialTailleCodes),
  );
  const [lieux, setLieux] = useState<OptionFiltre[]>(
    () => initialOptions?.lieux ?? [],
  );
  const [traiteurs, setTraiteurs] = useState<OptionFiltre[]>(
    () => initialOptions?.traiteurs ?? [],
  );
  const [types, setTypes] = useState<OptionFiltre[]>(() =>
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
            lieux?: OptionFiltre[];
            traiteurs?: OptionFiltre[];
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

  return (
    <div data-testid="benchmark-filter-bar" className="space-y-2">
      <BarreFiltres
        intro="Comparer avec"
        onReset={reset}
        resetTestId="benchmark-reinitialiser"
      >
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
          onChange={(ids) => apply({ ...filters, taille_evenement_codes: ids })}
          testid="benchmark-filter-taille"
        />
        <FiltreCoches
          label="Lieux"
          options={lieux}
          selected={filters.lieu_ids}
          onChange={(ids) => apply({ ...filters, lieu_ids: ids })}
          testid="benchmark-filter-lieux"
        />
        {/* Filtre traiteurs masqué pour les rôles traiteur (liste vide renvoyée). */}
        {traiteursVisibles && (
          <FiltreCoches
            label="Traiteurs"
            options={traiteurs}
            selected={filters.traiteur_ids}
            onChange={(ids) => apply({ ...filters, traiteur_ids: ids })}
            testid="benchmark-filter-traiteurs"
          />
        )}
      </BarreFiltres>
      {avertissementSoi}
    </div>
  );
}
