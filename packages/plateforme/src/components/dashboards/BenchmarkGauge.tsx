'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BenchmarkFilters } from './BenchmarkFilterBar.js';

// Ligne renvoyée par f_benchmark_kg_pax_zd — grain CDC §04 (flux × type × taille).
interface BenchmarkRow {
  flux_id: string;
  flux_code: string;
  type_evenement_id: string;
  taille_evenement: string;
  // Moyenne pondérée par tonnage du parc (BL-P1-GEST-04).
  kg_par_pax_moyen: number;
  nb_collectes_segment: number;
  nb_organisations_distinctes: number;
}

// Agrégat mono-flux pour la jauge (le point rouge = 1 valeur par flux).
interface BenchmarkAgg {
  kg_par_pax_moyen: number;
  nb_collectes: number;
}

interface BenchmarkGaugeProps {
  bracket: string;
  fluxCode?: string;
  /** Libellé affiché (défaut = bracket) — ex nom du flux côté gestionnaire. */
  label?: string;
  /** kg/pax de l'utilisateur pour ce flux (null = pas de collecte) */
  myKgPax?: number | null;
  /** Endpoint benchmark (défaut = route client ; route staff côté Admin). */
  endpoint?: string;
  /**
   * Filtres de l'encart « Filtres benchmark » (§06.05). Si fournis, ils pilotent
   * le périmètre du point rouge (taille/type/période/lieux/traiteurs) ; sinon la
   * jauge retombe sur le `bracket` (compat autres dashboards).
   */
  benchmarkFilters?: BenchmarkFilters;
  className?: string;
}

/**
 * Jauge kg/pax × benchmark parc (k-anonymat ≥5, §04 f_benchmark_kg_pax_zd).
 * Légende couleur (§06.05) : vert ≤100 %, orange 100-130 %, rouge >130 %,
 * gris = benchmark masqué (k-anonymat < 5).
 */
export function BenchmarkGauge({
  bracket,
  fluxCode,
  label,
  myKgPax,
  endpoint = '/api/v1/dashboards/benchmark',
  benchmarkFilters,
  className,
}: BenchmarkGaugeProps) {
  const [data, setData] = useState<BenchmarkAgg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Construit la query : filtres encart si présents, sinon bracket legacy.
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (fluxCode) p.set('flux_code', fluxCode);
    if (benchmarkFilters) {
      const f = benchmarkFilters;
      if (f.taille_evenement_codes.length)
        p.set('taille_evenement_codes', f.taille_evenement_codes.join(','));
      if (f.type_evenement_ids.length)
        p.set('type_evenement_ids', f.type_evenement_ids.join(','));
      if (f.lieu_ids.length) p.set('lieu_ids', f.lieu_ids.join(','));
      if (f.traiteur_ids.length)
        p.set('traiteur_ids', f.traiteur_ids.join(','));
      if (f.periode_debut) p.set('periode_debut', f.periode_debut);
      if (f.periode_fin) p.set('periode_fin', f.periode_fin);
    } else {
      p.set('bracket', bracket);
    }
    return p.toString();
  }, [bracket, fluxCode, benchmarkFilters]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${endpoint}?${query}`)
      .then((r) => r.json())
      .then((json: { data?: BenchmarkRow[]; error?: string }) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        // La fonction renvoie le grain CDC (flux × type × taille), déjà filtré
        // serveur-side (taille/encart). On agrège les segments de ce flux en une
        // valeur unique (point rouge), pondérée par le nb de collectes.
        const rows = (json.data ?? []).filter(
          (r) => !fluxCode || r.flux_code === fluxCode,
        );
        if (rows.length === 0) {
          setData(null);
          return;
        }
        const totalColl = rows.reduce((s, r) => s + r.nb_collectes_segment, 0);
        const moyenne =
          totalColl > 0
            ? rows.reduce(
                (s, r) => s + r.kg_par_pax_moyen * r.nb_collectes_segment,
                0,
              ) / totalColl
            : 0;
        setData({ kg_par_pax_moyen: moyenne, nb_collectes: totalColl });
      })
      .catch(() => setError('Erreur réseau'))
      .finally(() => setLoading(false));
  }, [query, endpoint, fluxCode]);

  const heading = label ?? bracket;

  if (loading) {
    return (
      <div
        className={`h-16 animate-pulse rounded-md bg-muted ${className ?? ''}`}
        aria-busy
      />
    );
  }

  if (error) {
    return (
      <p className={`text-xs text-destructive ${className ?? ''}`}>{error}</p>
    );
  }

  // Benchmark masqué (k-anonymat) → gris, pas de couleur de performance.
  if (!data) {
    return (
      <div
        className={`rounded-md border border-border p-3 text-sm text-muted-foreground ${className ?? ''}`}
        data-testid={`benchmark-gauge-${fluxCode ?? bracket}`}
      >
        <span className="font-medium">{heading}</span> — Données insuffisantes
        pour benchmark
      </div>
    );
  }

  const ratio =
    myKgPax != null && data.kg_par_pax_moyen > 0
      ? myKgPax / data.kg_par_pax_moyen
      : null;
  // Légende couleur §06.05 : vert ≤100 %, orange 100-130 %, rouge >130 %.
  const ratioColor =
    ratio == null
      ? ''
      : ratio <= 1
        ? 'text-green-600'
        : ratio <= 1.3
          ? 'text-amber-600'
          : 'text-red-600';

  return (
    <div
      className={`rounded-md border border-border p-3 ${className ?? ''}`}
      data-testid={`benchmark-gauge-${fluxCode ?? bracket}`}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">{heading}</span>
      </div>
      <p className="mt-1 text-sm">
        Moyenne pondérée parc :{' '}
        <strong>
          {data.kg_par_pax_moyen.toLocaleString('fr-FR', {
            maximumFractionDigits: 2,
          })}{' '}
          kg/pax
        </strong>
      </p>
      {ratio != null && (
        <p className={`text-xs ${ratioColor}`}>
          Vous : {(ratio * 100).toFixed(0)}% de la moyenne parc
        </p>
      )}
    </div>
  );
}
