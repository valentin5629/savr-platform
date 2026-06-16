'use client';

import { useEffect, useState } from 'react';

interface BenchmarkRow {
  flux_code: string;
  bracket: string;
  median_kg_pax: number;
  nb_collectes: number;
}

interface BenchmarkGaugeProps {
  bracket: string;
  fluxCode?: string;
  /** kg/pax de l'utilisateur pour ce bracket/flux (null = pas de collecte) */
  myKgPax?: number | null;
  className?: string;
}

/**
 * Jauge kg/pax × benchmark parc (k-anonymat ≥5, §04 f_benchmark_kg_pax_zd).
 * Affiche "Données insuffisantes" si k-anonymat non satisfait (nb_collectes < 5).
 */
export function BenchmarkGauge({
  bracket,
  fluxCode,
  myKgPax,
  className,
}: BenchmarkGaugeProps) {
  const [data, setData] = useState<BenchmarkRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ bracket });
    if (fluxCode) params.set('flux_code', fluxCode);

    fetch(`/api/v1/dashboards/benchmark?${params}`)
      .then((r) => r.json())
      .then((json: { data?: BenchmarkRow[]; error?: string }) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        const row = (json.data ?? []).find(
          (r) =>
            r.bracket === bracket && (!fluxCode || r.flux_code === fluxCode),
        );
        setData(row ?? null);
      })
      .catch(() => setError('Erreur réseau'))
      .finally(() => setLoading(false));
  }, [bracket, fluxCode]);

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

  if (!data) {
    return (
      <div
        className={`rounded-md border border-border p-3 text-sm text-muted-foreground ${className ?? ''}`}
      >
        <span className="font-medium">{bracket}</span> — Données insuffisantes
        pour benchmark
      </div>
    );
  }

  const ratio =
    myKgPax != null && data.median_kg_pax > 0
      ? myKgPax / data.median_kg_pax
      : null;
  const isSelf = data.nb_collectes < 5;

  return (
    <div
      className={`rounded-md border border-border p-3 ${className ?? ''}`}
      data-testid={`benchmark-gauge-${bracket}`}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">{bracket}</span>
        {isSelf && (
          <span title="La moyenne benchmarkée inclut vos propres collectes">
            ⚠ comparaison à soi-même
          </span>
        )}
      </div>
      <p className="mt-1 text-sm">
        Médiane parc :{' '}
        <strong>
          {data.median_kg_pax.toLocaleString('fr-FR', {
            maximumFractionDigits: 2,
          })}{' '}
          kg/pax
        </strong>
      </p>
      {ratio != null && (
        <p
          className={`text-xs ${ratio > 1 ? 'text-red-600' : 'text-green-600'}`}
        >
          Vous : {(ratio * 100).toFixed(0)}% de la médiane
        </p>
      )}
    </div>
  );
}
