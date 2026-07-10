'use client';

import * as React from 'react';
import { REPAS_COLOR, RATIO_COLOR } from '@/components/dashboards/flux';
import type { RepasSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import type { Granularite } from '../types';
import { formatPeriode } from '../format';
import { ChartCard } from './ChartCard';
import { fmtInt, fmtDec } from './fmt';

// EvolutionAgChart (Cockpit R24) — courbe des repas donnés (aire dégradée orange)
// + ratio repas/pax (ligne navy pointillée, axe droit). §11 Bloc 2 AG. Format
// paysage compact + tooltip au survol (repas + ratio + pax par période).
const VBW = 760;
const VBH = 210;
const LEFT = 44;
const RIGHT = 724;
const BASE = 172;
const TOP = 18;
const PLOT_H = BASE - TOP; // 154
const PLOT_W = RIGHT - LEFT; // 680
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
  const [hover, setHover] = React.useState<number | null>(null);
  const empty = series.length === 0;
  const n = series.length;
  const xOf = (i: number) =>
    n > 1 ? LEFT + (PLOT_W * i) / (n - 1) : LEFT + PLOT_W / 2;
  const slot = n > 0 ? PLOT_W / n : PLOT_W;

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
        <div className="relative">
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            width="100%"
            style={{ display: 'block', maxHeight: 320 }}
            role="img"
            aria-label="Évolution des repas donnés et du ratio repas par pax"
            onMouseLeave={() => setHover(null)}
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
            {hover != null && (
              <line
                x1={xOf(hover)}
                y1={TOP}
                x2={xOf(hover)}
                y2={BASE}
                stroke="#161A26"
                strokeWidth={1}
                opacity={0.12}
              />
            )}
            {areaPath && <path d={areaPath} fill={`url(#${GRAD_ID})`} />}
            <polyline
              points={repasPts
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke={REPAS_COLOR}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {last && (
              <circle
                cx={last[0]}
                cy={last[1]}
                r={3.5}
                fill={REPAS_COLOR}
                stroke="#fff"
                strokeWidth={1.5}
              />
            )}
            {ratioPts.length > 0 && (
              <polyline
                points={ratioPts
                  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                  .join(' ')}
                fill="none"
                stroke={RATIO_COLOR}
                strokeWidth={2}
                strokeDasharray="1 5"
                strokeLinecap="round"
              />
            )}
            {lastRatio && (
              <circle
                cx={lastRatio[0]}
                cy={lastRatio[1]}
                r={3.5}
                fill={RATIO_COLOR}
                stroke="#fff"
                strokeWidth={1.5}
              />
            )}
            {/* point survolé */}
            {hover != null && series[hover] && (
              <circle
                cx={xOf(hover)}
                cy={
                  BASE -
                  ((series[hover]!.repas_donnes || 0) / repasMax) * PLOT_H
                }
                r={4}
                fill={REPAS_COLOR}
                stroke="#fff"
                strokeWidth={1.5}
                style={{ pointerEvents: 'none' }}
              />
            )}
            {series.map((p, i) => (
              <text
                key={p.periode}
                x={xOf(i)}
                y={196}
                textAnchor="middle"
                style={{ fontSize: 9, fill: '#6E7790', fontWeight: 600 }}
              >
                {formatPeriode(p.periode, granularite)}
              </text>
            ))}
            {/* zones de survol transparentes */}
            {series.map((p, i) => (
              <rect
                key={`hz-${p.periode}`}
                x={xOf(i) - slot / 2}
                y={TOP}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
          </svg>

          {/* Tooltip au survol : repas + ratio + pax (CDC §06.04 l.208). */}
          {hover != null &&
            (() => {
              const p = series[hover]!;
              const leftPct = (xOf(hover) / VBW) * 100;
              const transform =
                leftPct < 30
                  ? 'translateX(0)'
                  : leftPct > 70
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)';
              return (
                <div
                  className="pointer-events-none absolute z-10 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md"
                  style={{ left: `${leftPct}%`, top: 4, transform }}
                >
                  <div className="mb-1.5 text-[11px] font-bold text-savr-neutral-900">
                    {formatPeriode(p.periode, granularite)}
                  </div>
                  <div className="flex flex-col gap-1 text-[11px] tabular-nums">
                    <div className="flex items-center justify-between gap-5">
                      <span className="flex items-center gap-1.5 text-savr-neutral-600">
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: REPAS_COLOR,
                          }}
                        />
                        Repas donnés
                      </span>
                      <span className="font-bold text-savr-neutral-900">
                        {fmtInt(p.repas_donnes || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-5">
                      <span className="flex items-center gap-1.5 text-savr-neutral-600">
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: RATIO_COLOR,
                          }}
                        />
                        Ratio repas/pax
                      </span>
                      <span className="font-bold text-savr-neutral-900">
                        {p.ratio != null ? fmtDec(p.ratio, 2) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-5 border-t border-savr-neutral-100 pt-1 text-savr-neutral-500">
                      <span>Pax</span>
                      <span className="font-semibold">
                        {fmtInt(p.pax || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      )}
    </ChartCard>
  );
});
EvolutionAgChart.displayName = 'EvolutionAgChart';

export { EvolutionAgChart };
