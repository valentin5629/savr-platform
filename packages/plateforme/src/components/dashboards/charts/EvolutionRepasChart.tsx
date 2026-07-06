'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { REPAS_COLOR, RATIO_COLOR } from '../flux.js';
import type { RepasSeriePoint } from '../useEvolutionBlocs.js';
import type { Granularite } from './types.js';
import { formatPeriode } from './format.js';

interface EvolutionRepasChartProps {
  series: RepasSeriePoint[];
  granularite: Granularite;
  className?: string;
}

/**
 * Bloc 2 AG (§06.04/§06.05 Bloc 2) — évolution mensuelle : nombre de repas donnés
 * (barres, axe gauche) + ratio repas/pax (courbe, axe droit). Pas de jauge
 * benchmark AG (un seul flux `don_alimentaire`).
 */
export function EvolutionRepasChart({
  series,
  granularite,
  className,
}: EvolutionRepasChartProps) {
  if (series.length === 0) {
    return (
      <div className={className} data-testid="evolution-repas-chart">
        <p className="text-sm text-savr-neutral-500">
          Aucune donnée sur la période.
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid="evolution-repas-chart">
      <ul
        className="mb-3 flex flex-wrap gap-3 text-xs"
        data-testid="evolution-repas-legend"
      >
        <li className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: REPAS_COLOR }}
          />
          Repas donnés
        </li>
        <li className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: RATIO_COLOR }}
          />
          Repas/pax
        </li>
      </ul>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={series}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="periode"
              tickFormatter={(v: string) => formatPeriode(v, granularite)}
              fontSize={11}
            />
            <YAxis yAxisId="left" fontSize={11} allowDecimals={false} />
            <YAxis
              yAxisId="right"
              orientation="right"
              fontSize={11}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              formatter={(value, name) => {
                const v = Number(value);
                return String(name) === 'ratio'
                  ? [v.toFixed(2), 'Repas/pax']
                  : [v.toLocaleString('fr-FR'), 'Repas donnés'];
              }}
              labelFormatter={(label) =>
                formatPeriode(String(label), granularite)
              }
            />
            <Bar
              yAxisId="left"
              dataKey="repas_donnes"
              fill={REPAS_COLOR}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="ratio"
              stroke={RATIO_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
