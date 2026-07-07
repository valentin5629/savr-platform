'use client';

import dynamic from 'next/dynamic';

/**
 * Chargement paresseux des graphes recharts (§11 Bloc 2/4) — `ssr: false` : la lib
 * de charting reste dans un chunk asynchrone hors du bundle initial des dashboards
 * (budget bundle). Réutilisé par les 3 dashboards client (traiteur/agence/gestionnaire).
 */
function ChartSkeleton() {
  return (
    <div
      className="h-72 w-full animate-pulse rounded-md bg-muted"
      aria-busy="true"
    />
  );
}

export const EvolutionFluxChart = dynamic(
  () => import('./EvolutionFluxChart.js').then((m) => m.EvolutionFluxChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

export const EvolutionRepasChart = dynamic(
  () => import('./EvolutionRepasChart.js').then((m) => m.EvolutionRepasChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

export const TonnagesDonut = dynamic(
  () => import('./TonnagesDonut.js').then((m) => m.TonnagesDonut),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
