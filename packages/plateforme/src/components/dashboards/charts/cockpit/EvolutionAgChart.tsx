'use client';

import * as React from 'react';
import { REPAS_COLOR, RATIO_COLOR } from '@/components/dashboards/flux';
import type { RepasSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import type { Granularite } from '../types';
import { formatPeriode } from '../format';
import { ChartCard } from './ChartCard';
import { fmtInt, fmtDec } from './fmt';
import {
  INK,
  TEXT_MUTED,
  TEXT_FAINT,
  TEXT_STRONG,
  GRID,
  GRID_BASELINE,
} from './palette';

// EvolutionAgChart (Cockpit R24) — BARRES verticales des repas donnés (orange,
// axe gauche) + courbe du ratio repas/pax (ligne navy pointillée, axe droit).
// §11 Bloc 2 AG. Format paysage compact ; légende cliquable (masque les barres
// OU la courbe, symétrie avec le ZD) + tooltip au survol (repas + ratio + pax).
const VBW = 760;
const VBH = 210;
const LEFT = 44;
const RIGHT = 724;
const BASE = 172;
const TOP = 18;
const PLOT_H = BASE - TOP; // 154
const PLOT_W = RIGHT - LEFT; // 680

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
  // Séries masquables via la légende (symétrie avec le ZD).
  const [hidden, setHidden] = React.useState<Set<'repas' | 'ratio'>>(new Set());
  const toggle = (k: 'repas' | 'ratio') =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const empty = series.length === 0;
  const n = Math.max(1, series.length);
  const slot = PLOT_W / n;
  const barW = Math.min(46, slot * 0.5);
  const cx = (i: number) => LEFT + slot * (i + 0.5);

  const repasMax = niceCeil(
    Math.max(1, ...series.map((p) => p.repas_donnes || 0)),
  );
  const ratioMax = niceCeil(
    Math.max(0.1, ...series.map((p) => Number(p.ratio) || 0)),
  );

  const ratioPts = series
    .map((p, i) =>
      p.ratio != null
        ? ([cx(i), BASE - (p.ratio / ratioMax) * PLOT_H] as const)
        : null,
    )
    .filter((v): v is readonly [number, number] => v !== null);

  const gridT = [0, 0.5, 1];

  return (
    <ChartCard
      ref={ref}
      title="Évolution Anti-Gaspi"
      subtitle="Repas donnés · ratio repas / pax"
      headerRight={
        <div className="flex gap-2 text-[11px] font-semibold text-savr-neutral-600">
          <button
            type="button"
            onClick={() => toggle('repas')}
            aria-pressed={!hidden.has('repas')}
            className="flex items-center gap-1.5 rounded-savr-full px-1.5 py-0.5 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
            style={{ opacity: hidden.has('repas') ? 0.4 : 1 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                background: REPAS_COLOR,
                borderRadius: 2,
              }}
            />
            Repas
          </button>
          <button
            type="button"
            onClick={() => toggle('ratio')}
            aria-pressed={!hidden.has('ratio')}
            className="flex items-center gap-1.5 rounded-savr-full px-1.5 py-0.5 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
            style={{ opacity: hidden.has('ratio') ? 0.4 : 1 }}
          >
            <span
              style={{
                width: 14,
                height: 3,
                background: RATIO_COLOR,
                borderRadius: 2,
              }}
            />
            Ratio/pax
          </button>
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
            style={{ display: 'block', maxHeight: 340 }}
            role="img"
            aria-label="Évolution des repas donnés (barres) et du ratio repas par pax"
            onMouseLeave={() => setHover(null)}
          >
            {/* gridlines + axe gauche repas */}
            {gridT.map((t) => {
              const y = BASE - t * PLOT_H;
              return (
                <g key={t}>
                  <line
                    x1={LEFT}
                    y1={y}
                    x2={RIGHT}
                    y2={y}
                    stroke={t === 0 ? GRID_BASELINE : GRID}
                    strokeWidth={1}
                  />
                  <text
                    x={LEFT - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="tabular-nums"
                    style={{ fontSize: 10, fill: TEXT_FAINT }}
                  >
                    {fmtInt(repasMax * t)}
                  </text>
                </g>
              );
            })}
            {/* axe droit ratio */}
            {gridT.map((t) => (
              <text
                key={`r-${t}`}
                x={RIGHT + 6}
                y={BASE - t * PLOT_H + 3}
                className="tabular-nums"
                style={{ fontSize: 10, fill: TEXT_STRONG }}
              >
                {fmtDec(ratioMax * t, 2)}
              </text>
            ))}

            {/* colonne survolée (surbrillance discrète) */}
            {hover != null && (
              <rect
                x={cx(hover) - slot / 2}
                y={TOP}
                width={slot}
                height={PLOT_H}
                fill={INK}
                opacity={0.04}
              />
            )}

            {/* barres repas donnés (orange) — masquables via la légende */}
            {!hidden.has('repas') &&
              series.map((p, i) => {
                const val = p.repas_donnes || 0;
                if (val <= 0) return null;
                const h = (val / repasMax) * PLOT_H;
                const x = cx(i) - barW / 2;
                const y = BASE - h;
                const r = Math.min(3, barW / 2);
                return (
                  <path
                    key={p.periode}
                    d={`M${x},${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${BASE} H${x} Z`}
                    fill={REPAS_COLOR}
                    fillOpacity={0.75}
                    style={{ pointerEvents: 'none' }}
                  >
                    <title>{`${p.periode} — ${fmtInt(val)} repas`}</title>
                  </path>
                );
              })}

            {/* courbe ratio repas/pax (navy pointillée) — masquable via légende */}
            {ratioPts.length > 0 && !hidden.has('ratio') && (
              <>
                <polyline
                  points={ratioPts
                    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                    .join(' ')}
                  fill="none"
                  stroke={RATIO_COLOR}
                  strokeWidth={1.125}
                  strokeDasharray="1.5 5"
                  strokeLinecap="round"
                  style={{ pointerEvents: 'none' }}
                />
                {ratioPts.map(([x, y], k) => (
                  <circle
                    key={k}
                    cx={x}
                    cy={y}
                    r={1.25}
                    fill="#fff"
                    stroke={RATIO_COLOR}
                    strokeWidth={0.75}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
              </>
            )}

            {/* étiquettes X */}
            {series.map((p, i) => (
              <text
                key={p.periode}
                x={cx(i)}
                y={196}
                textAnchor="middle"
                style={{ fontSize: 10, fill: TEXT_MUTED, fontWeight: 600 }}
              >
                {formatPeriode(p.periode, granularite)}
              </text>
            ))}

            {/* zones de survol transparentes (captent le curseur sur toute la colonne) */}
            {series.map((p, i) => (
              <rect
                key={`hz-${p.periode}`}
                x={cx(i) - slot / 2}
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
              const leftPct = (cx(hover) / VBW) * 100;
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
