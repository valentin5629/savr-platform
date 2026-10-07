'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertBar } from '@/components/ui/alert-bar';
import { FilterBar } from '@/components/ui/filter-bar';
import {
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

const memesIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Au moins un critère diffère de l'héritage (Type/Taille globaux, Lieux/Traiteurs sans sélection). */
function criteresPoses(f: BenchmarkFilters, defaut: BenchmarkFilters): boolean {
  return (
    !memesIds(f.type_evenement_ids, defaut.type_evenement_ids) ||
    !memesIds(f.taille_evenement_codes, defaut.taille_evenement_codes) ||
    f.lieu_ids.length > 0 ||
    f.traiteur_ids.length > 0
  );
}

/** Options des multi-selects fournies par le SSR (évite le fetch /filtres au mount). */
export interface BenchmarkFilterOptions {
  lieux: OptionFiltre[];
  traiteurs: OptionFiltre[];
  types: { id: string; libelle: string }[];
}

// Listes bornées au périmètre de l'appelant : sans rien cocher, le repère reste
// calculé sur tout le parc Savr. « Tous » se lirait « tous mes lieux » — la case
// de tête le dit, et cocher toutes les lignes reste une sélection explicite.
const LISTES_RATTACHEES = {
  libelleVide: 'Tout le parc Savr',
  libelleTous: 'Tout le parc Savr',
  listePartielle: true,
} as const;

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
  /**
   * Avertissement « comparaison à soi-même » (§06.05 l.176) quand Lieux ou
   * Traiteurs sont filtrés. `false` pour l'Admin, qui compare deux périmètres du
   * parc et n'a pas de « propres » lieux ou traiteurs.
   */
  avertissementComparaisonSoi?: boolean;
  /**
   * Ce que couvrent les listes Lieux / Traiteurs servies à cet espace : tout
   * le parc Savr (défaut), ou le seul périmètre de l'appelant — `'rattache'`
   * pour le gestionnaire de lieux (décision Val 2026-10-06). Donné par l'écran
   * et non lu dans la réponse : le libellé est juste dès le premier rendu.
   */
  perimetre?: 'parc' | 'rattache';
  /**
   * État initial complet (ré-hydratation après un remontage de la carte, ex.
   * Dashboard Client Admin dont le bloc ZD se démonte pendant « Chargement… »).
   * Prioritaire sur l'héritage Type/Taille ; « Réinitialiser » revient à l'héritage.
   */
  initialFilters?: BenchmarkFilters;
}

/**
 * Encart « Filtres benchmark » (§06.05 Bloc 3 ZD), imbriqué dans la carte du
 * benchmark : une ligne « Comparer avec » + filtres en ligne (format unique des
 * barres de filtres, décision Val 2026-09-30). Critères qui ne s'appliquent
 * qu'au point rouge : Type d'événement, Taille, Lieux, Traiteurs. Ces deux
 * listes couvrent tout le parc, ou (`perimetre="rattache"`) les seuls lieux
 * rattachés et traiteurs intervenus du gestionnaire — la case de tête
 * s'appelle alors « Tout le parc Savr » (décision Val 2026-10-06). La
 * période est fixe (24 mois glissants, non affichée). Bâti sur `FilterBar`
 * (R-UI-4b, D5 façon C, `surface="encart"`, `count={null}`) : « Réinitialiser
 * les filtres » (retour à l'héritage Type/Taille, Lieux/Traiteurs vidés)
 * seulement si un critère diffère de l'héritage.
 */
export function BenchmarkFilterBar({
  onChange,
  filtresEndpoint = '/api/v1/dashboards/benchmark/filtres',
  initialTypeEvenementIds,
  initialTailleCodes,
  initialOptions,
  masquerTraiteurs = false,
  avertissementComparaisonSoi = true,
  perimetre = 'parc',
  initialFilters,
}: BenchmarkFilterBarProps) {
  const [filters, setFilters] = useState<BenchmarkFilters>(
    () =>
      initialFilters ??
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

  const avertissementSoi = avertissementComparaisonSoi && comparaisonSoi && (
    <AlertBar
      variant="warn"
      data-testid="benchmark-comparaison-soi"
      className="px-3 py-2 text-xs"
    >
      ⚠ Si vous filtrez sur vos propres lieux/traiteurs, le benchmark compare
      vos données à vos propres données — il perd son rôle de référence parc.
    </AlertBar>
  );
  const traiteursVisibles = !masquerTraiteurs && traiteurs.length > 0;
  const listes = perimetre === 'rattache' ? LISTES_RATTACHEES : {};
  const actif = criteresPoses(
    filters,
    defaultFilters(initialTypeEvenementIds, initialTailleCodes),
  );

  return (
    <div data-testid="benchmark-filter-bar" className="space-y-2">
      <FilterBar
        surface="encart"
        intro="Comparer avec"
        count={null}
        actif={actif}
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
          {...listes}
        />
        {/* Filtre traiteurs masqué pour les rôles traiteur (liste vide renvoyée). */}
        {traiteursVisibles && (
          <FiltreCoches
            label="Traiteurs"
            options={traiteurs}
            selected={filters.traiteur_ids}
            onChange={(ids) => apply({ ...filters, traiteur_ids: ids })}
            testid="benchmark-filter-traiteurs"
            {...listes}
          />
        )}
      </FilterBar>
      {avertissementSoi}
    </div>
  );
}
