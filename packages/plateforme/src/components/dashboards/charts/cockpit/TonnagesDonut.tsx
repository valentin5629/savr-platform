'use client';

import * as React from 'react';
import { FLUX_ZD } from '@/components/dashboards/flux';
import type { FluxSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import { ChartCard } from './ChartCard';
import { fmtDec, fmtMasse } from './fmt';

// TonnagesDonut (Cockpit R24) — donut de répartition des 5 flux ZD, total au
// centre (§11 Bloc 4). Arcs SVG en stroke-dasharray sur r=70, séparations
// blanches très fines entre segments. Agrège la série ZD par flux.
const R = 70;
const C = 2 * Math.PI * R; // circonférence ≈ 439.82
const GAP = 2; // séparation blanche (unités de longueur d'arc)

interface TonnagesDonutProps {
  series: FluxSeriePoint[];
}

const TonnagesDonut = React.forwardRef<HTMLDivElement, TonnagesDonutProps>(
  ({ series }, ref) => {
    const perFlux = FLUX_ZD.map((f) => ({
      ...f,
      kg: series.reduce(
        (s, p) => s + (Number(p[f.code as keyof FluxSeriePoint]) || 0),
        0,
      ),
    }));
    const total = perFlux.reduce((s, f) => s + f.kg, 0);
    const masse = fmtMasse(total);

    // Arcs cumulés
    let cumulative = 0;
    const arcs = perFlux.map((f) => {
      const pct = total > 0 ? f.kg / total : 0;
      const len = pct * C;
      const drawLen = Math.max(0, len - GAP);
      const arc = {
        color: f.color,
        dasharray: `${drawLen} ${C - drawLen}`,
        dashoffset: -cumulative,
        pct,
      };
      cumulative += len;
      return arc;
    });

    return (
      <ChartCard
        ref={ref}
        title="Répartition des tonnages"
        subtitle="Zéro Déchet · 5 flux"
        className="flex flex-col"
      >
        <div className="my-3 flex justify-center">
          <svg
            viewBox="0 0 200 200"
            width={184}
            height={184}
            style={{ display: 'block' }}
            role="img"
            aria-label={`Répartition des tonnages, total ${masse.value} ${masse.unit}`}
          >
            {total > 0 ? (
              arcs.map((a, i) => {
                const f = perFlux[i]!;
                const m = fmtMasse(f.kg);
                return (
                  <circle
                    key={f.code}
                    cx={100}
                    cy={100}
                    r={R}
                    fill="none"
                    stroke={a.color}
                    strokeWidth={26}
                    strokeDasharray={a.dasharray}
                    strokeDashoffset={a.dashoffset}
                    transform="rotate(-90 100 100)"
                  >
                    {/* Tooltip natif au survol : kg + % (CDC §06.04 l.164). */}
                    <title>{`${f.label} : ${m.value} ${m.unit} (${fmtDec(a.pct * 100, 0)} %)`}</title>
                  </circle>
                );
              })
            ) : (
              <circle
                cx={100}
                cy={100}
                r={R}
                fill="none"
                stroke="#EEF0F5"
                strokeWidth={26}
              />
            )}
            <text
              x={100}
              y={94}
              textAnchor="middle"
              className="tabular-nums"
              style={{
                fontSize: 32,
                fontWeight: 900,
                fill: '#161A26',
                letterSpacing: '-0.02em',
              }}
            >
              {total > 0 ? masse.value : '—'}
            </text>
            <text
              x={100}
              y={116}
              textAnchor="middle"
              style={{
                fontSize: 10,
                fill: '#9AA2B8',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 700,
              }}
            >
              {total > 0
                ? masse.unit === 't'
                  ? 'tonnes'
                  : 'kg'
                : 'aucune pesée'}
            </text>
          </svg>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          {perFlux.map((f) => {
            const pct = total > 0 ? (f.kg / total) * 100 : 0;
            return (
              <div
                key={f.code}
                className="flex items-center justify-between text-[13px]"
              >
                <span className="flex items-center gap-2 font-semibold text-savr-neutral-700">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: f.color,
                      borderRadius: 3,
                    }}
                  />
                  {f.label}
                </span>
                <span className="font-extrabold tabular-nums">
                  {(() => {
                    const m = fmtMasse(f.kg);
                    return `${m.value} ${m.unit} · ${fmtDec(pct, 0)} %`;
                  })()}
                </span>
              </div>
            );
          })}
        </div>
      </ChartCard>
    );
  },
);
TonnagesDonut.displayName = 'TonnagesDonut';

export { TonnagesDonut };
