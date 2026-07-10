'use client';

import * as React from 'react';
import { FLUX_ZD, TAUX_RECYCLAGE_COLOR } from '@/components/dashboards/flux';
import type { FluxSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import type { Granularite } from '../types';
import { formatPeriode } from '../format';
import { ChartCard } from './ChartCard';
import { fmtInt } from './fmt';

// EvolutionZdChart (Cockpit R24) — barres empilées des 5 flux ZD (kg) + courbe du
// taux de valorisation superposée (axe droit 0-100 %). §11 Bloc 2 ZD. Empilement
// bas→haut = résiduel → biodéchets ; sommet arrondi ; séparateurs blancs fins ;
// légende cliquable (masque un flux). Échelle kg calculée depuis les données.
const VBW = 640;
const LEFT = 60;
const RIGHT = 600;
const BASE = 250;
const TOP = 30;
const PLOT_H = BASE - TOP; // 220
const PLOT_W = RIGHT - LEFT; // 540

// Empilement du bas vers le haut (résiduel au sol, biodéchets au sommet).
const STACK = [...FLUX_ZD].reverse();

function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

interface EvolutionZdChartProps {
  series: FluxSeriePoint[];
  granularite: Granularite;
}

const EvolutionZdChart = React.forwardRef<
  HTMLDivElement,
  EvolutionZdChartProps
>(({ series, granularite }, ref) => {
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const toggle = (code: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const empty = series.length === 0;
  const rawMax = Math.max(
    1,
    ...series.map((p) => Number(p.tonnage_total) || 0),
  );
  const niceMax = niceCeil(rawMax);
  const n = Math.max(1, series.length);
  const slot = PLOT_W / n;
  const barW = Math.min(52, slot * 0.5);
  const cx = (i: number) => LEFT + slot * (i + 0.5);

  // Points de la courbe taux (non-null uniquement)
  const ratePts = series
    .map((p, i) =>
      p.taux_recyclage != null
        ? ([cx(i), BASE - (p.taux_recyclage / 100) * PLOT_H] as const)
        : null,
    )
    .filter((v): v is readonly [number, number] => v !== null);

  const gridT = [0, 0.25, 0.5, 0.75, 1];

  return (
    <ChartCard
      ref={ref}
      title="Évolution mensuelle Zéro Déchet"
      subtitle="Tonnages par flux · taux de valorisation superposé"
      headerRight={
        <span className="text-[13px] tabular-nums text-savr-neutral-400">
          kg
        </span>
      }
    >
      {empty ? (
        <p className="py-10 text-center text-sm text-savr-neutral-500">
          Aucune collecte ZD sur la période.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${VBW} 300`}
            width="100%"
            style={{ display: 'block' }}
            role="img"
            aria-label="Évolution mensuelle des tonnages par flux et du taux de valorisation"
          >
            {/* gridlines + axe gauche kg */}
            {gridT.map((t) => {
              const y = BASE - t * PLOT_H;
              return (
                <g key={t}>
                  <line
                    x1={LEFT}
                    y1={y}
                    x2={RIGHT}
                    y2={y}
                    stroke={t === 0 ? '#DDE1EB' : '#EEF0F5'}
                    strokeWidth={1}
                  />
                  <text
                    x={LEFT - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="tabular-nums"
                    style={{ fontSize: 11, fill: '#9AA2B8' }}
                  >
                    {fmtInt(niceMax * t)}
                  </text>
                </g>
              );
            })}
            {/* axe droit % */}
            {[
              [0, '0'],
              [0.5, '50'],
              [1, '100 %'],
            ].map(([t, lbl]) => (
              <text
                key={String(t)}
                x={RIGHT + 8}
                y={BASE - (t as number) * PLOT_H + 4}
                className="tabular-nums"
                style={{ fontSize: 11, fill: '#B36400' }}
              >
                {lbl}
              </text>
            ))}

            {/* barres empilées */}
            {series.map((p, i) => {
              const x = cx(i) - barW / 2;
              const visible = STACK.filter((f) => !hidden.has(f.code));
              let yCursor = BASE;
              return (
                <g key={p.periode}>
                  {visible.map((f, vi) => {
                    const val = Number(p[f.code as keyof FluxSeriePoint]) || 0;
                    if (val <= 0) return null;
                    const h = (val / niceMax) * PLOT_H;
                    const segTop = yCursor - h;
                    const segBottom = yCursor;
                    yCursor = segTop;
                    const isTop = vi === visible.length - 1;
                    if (isTop) {
                      const r = Math.min(3, barW / 2);
                      return (
                        <path
                          key={f.code}
                          d={`M${x},${segTop + r} Q${x},${segTop} ${x + r},${segTop} H${x + barW - r} Q${x + barW},${segTop} ${x + barW},${segTop + r} V${segBottom} H${x} Z`}
                          fill={f.color}
                          stroke="#fff"
                          strokeWidth={0.75}
                        />
                      );
                    }
                    return (
                      <rect
                        key={f.code}
                        x={x}
                        y={segTop}
                        width={barW}
                        height={h}
                        fill={f.color}
                        stroke="#fff"
                        strokeWidth={0.75}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* courbe taux de valorisation */}
            {ratePts.length > 0 && (
              <>
                <polyline
                  points={ratePts
                    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                    .join(' ')}
                  fill="none"
                  stroke={TAUX_RECYCLAGE_COLOR}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {ratePts.map(([x, y], i) => {
                  const isLast = i === ratePts.length - 1;
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={isLast ? 4.5 : 3}
                      fill={isLast ? TAUX_RECYCLAGE_COLOR : '#fff'}
                      stroke={isLast ? '#fff' : TAUX_RECYCLAGE_COLOR}
                      strokeWidth={2}
                    />
                  );
                })}
              </>
            )}

            {/* étiquettes X */}
            {series.map((p, i) => (
              <text
                key={p.periode}
                x={cx(i)}
                y={270}
                textAnchor="middle"
                style={{ fontSize: 12, fill: '#6E7790', fontWeight: 600 }}
              >
                {formatPeriode(p.periode, granularite)}
              </text>
            ))}
          </svg>

          {/* légende cliquable */}
          <div className="mt-4 flex flex-wrap gap-2">
            {FLUX_ZD.map((f) => {
              const off = hidden.has(f.code);
              return (
                <button
                  key={f.code}
                  type="button"
                  onClick={() => toggle(f.code)}
                  aria-pressed={!off}
                  className="inline-flex items-center gap-1.5 rounded-savr-full border border-savr-neutral-100 bg-savr-neutral-50 px-2.5 py-1 text-xs font-semibold text-savr-neutral-700 transition-colors hover:border-savr-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
                  style={{ opacity: off ? 0.4 : 1 }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: f.color,
                      borderRadius: 3,
                    }}
                  />
                  {f.label}
                </button>
              );
            })}
            <span
              className="inline-flex items-center gap-1.5 rounded-savr-full border px-2.5 py-1 text-xs font-bold"
              style={{
                borderColor: '#FFE8C2',
                background: '#FFF4E0',
                color: '#B36400',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 3,
                  background: TAUX_RECYCLAGE_COLOR,
                  borderRadius: 2,
                }}
              />
              Taux de valorisation
            </span>
          </div>
        </>
      )}
    </ChartCard>
  );
});
EvolutionZdChart.displayName = 'EvolutionZdChart';

export { EvolutionZdChart };
