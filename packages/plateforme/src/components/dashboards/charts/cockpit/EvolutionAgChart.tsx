'use client';

import * as React from 'react';
import { REPAS_COLOR, RATIO_COLOR } from '@/components/dashboards/flux';
import type { RepasSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import type { Granularite } from '../types';
import { formatPeriode } from '../format';
import { ChartCard } from './ChartCard';

// EvolutionAgChart (Cockpit R24) — courbe des repas donnés (aire dégradée orange)
// + ratio repas/pax (ligne navy pointillée, axe droit). §11 Bloc 2 AG.
const VBW = 580;
const LEFT = 40;
const RIGHT = 560;
const BASE = 200;
const TOP = 30;
const PLOT_H = BASE - TOP; // 170
const PLOT_W = RIGHT - LEFT; // 520
const GRAD_ID = 'r24-ag-area';

function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

interface EvolutionAgChartProps {
  series: RepasSeriePoint[];
  granularite: Granularite;
}

const EvolutionAgChart = React.forwardRef<
  HTMLDivElement,
  EvolutionAgChartProps
>(({ series, granularite }, ref) => {
  const empty = series.length === 0;
  const n = series.length;
  const xOf = (i: number) =>
    n > 1 ? LEFT + (PLOT_W * i) / (n - 1) : LEFT + PLOT_W / 2;

  const repasMax = niceCeil(
    Math.max(1, ...series.map((p) => p.repas_donnes || 0)),
  );
  const ratioMax = niceCeil(
    Math.max(0.1, ...series.map((p) => Number(p.ratio) || 0)),
  );

  const repasPts = series.map(
    (p, i) =>
      [xOf(i), BASE - ((p.repas_donnes || 0) / repasMax) * PLOT_H] as const,
  );
  const ratioPts = series
    .map((p, i) =>
      p.ratio != null
        ? ([xOf(i), BASE - (p.ratio / ratioMax) * PLOT_H] as const)
        : null,
    )
    .filter((v): v is readonly [number, number] => v !== null);

  const areaPath =
    repasPts.length > 0
      ? `M${repasPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} L${xOf(n - 1).toFixed(1)},${BASE} L${LEFT},${BASE} Z`
      : '';
  const last = repasPts[repasPts.length - 1];
  const lastRatio = ratioPts[ratioPts.length - 1];

  return (
    <ChartCard
      ref={ref}
      title="Évolution Anti-Gaspi"
      subtitle="Repas donnés · ratio repas / pax"
      headerRight={
        <div className="flex gap-3 text-[11px] font-semibold text-savr-neutral-600">
          <span className="flex items-center gap-1.5">
            <span
              style={{
                width: 14,
                height: 3,
                background: REPAS_COLOR,
                borderRadius: 2,
              }}
            />
            Repas
          </span>
          <span className="flex items-center gap-1.5">
            <span
              style={{
                width: 14,
                height: 3,
                background: RATIO_COLOR,
                borderRadius: 2,
              }}
            />
            Ratio/pax
          </span>
        </div>
      }
    >
      {empty ? (
        <p className="py-10 text-center text-sm text-savr-neutral-500">
          Aucune collecte Anti-Gaspi sur la période.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${VBW} 240`}
          width="100%"
          style={{ display: 'block' }}
          role="img"
          aria-label="Évolution des repas donnés et du ratio repas par pax"
        >
          <defs>
            <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={REPAS_COLOR} stopOpacity={0.2} />
              <stop offset="1" stopColor={REPAS_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 0.5, 0.85, 1].map((t) => (
            <line
              key={t}
              x1={LEFT}
              y1={BASE - t * PLOT_H}
              x2={RIGHT}
              y2={BASE - t * PLOT_H}
              stroke={t === 0 ? '#DDE1EB' : '#EEF0F5'}
              strokeWidth={1}
            />
          ))}
          {areaPath && <path d={areaPath} fill={`url(#${GRAD_ID})`} />}
          <polyline
            points={repasPts
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(' ')}
            fill="none"
            stroke={REPAS_COLOR}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {last && (
            <circle
              cx={last[0]}
              cy={last[1]}
              r={4.5}
              fill={REPAS_COLOR}
              stroke="#fff"
              strokeWidth={2}
            />
          )}
          {ratioPts.length > 0 && (
            <polyline
              points={ratioPts
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke={RATIO_COLOR}
              strokeWidth={2.5}
              strokeDasharray="1 5"
              strokeLinecap="round"
            />
          )}
          {lastRatio && (
            <circle
              cx={lastRatio[0]}
              cy={lastRatio[1]}
              r={4}
              fill={RATIO_COLOR}
              stroke="#fff"
              strokeWidth={2}
            />
          )}
          {series.map((p, i) => (
            <text
              key={p.periode}
              x={xOf(i)}
              y={222}
              textAnchor="middle"
              style={{ fontSize: 12, fill: '#6E7790', fontWeight: 600 }}
            >
              {formatPeriode(p.periode, granularite)}
            </text>
          ))}
        </svg>
      )}
    </ChartCard>
  );
});
EvolutionAgChart.displayName = 'EvolutionAgChart';

export { EvolutionAgChart };
