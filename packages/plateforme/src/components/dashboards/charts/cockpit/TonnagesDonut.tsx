'use client';

import * as React from 'react';
import { FLUX_ZD } from '@/components/dashboards/flux';
import type { FluxSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import { ChartCard } from './ChartCard';
import { fmtDec, fmtMasse } from './fmt';

// TonnagesDonut (Cockpit R24) — donut de répartition des 5 flux ZD, total au
// centre (§11 Bloc 4). Arcs SVG en stroke-dasharray sur r=70, séparations
// blanches très fines entre segments. Survol d'un arc (ou d'une ligne de légende)
// = mise en avant + valeur kg/% affichée au centre (CDC §06.04 l.164).
const R = 70;
const C = 2 * Math.PI * R; // circonférence ≈ 439.82
const GAP = 2; // séparation blanche (unités de longueur d'arc)

interface TonnagesDonutProps {
  series: FluxSeriePoint[];
}

const TonnagesDonut = React.forwardRef<HTMLDivElement, TonnagesDonutProps>(
  ({ series }, ref) => {
    const [hover, setHover] = React.useState<number | null>(null);
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

    // Valeur affichée au centre : le flux survolé, sinon le total.
    const focus = hover != null ? perFlux[hover]! : null;
    const centerMasse = focus ? fmtMasse(focus.kg) : masse;
    const centerPct =
      focus && total > 0 ? Math.round((focus.kg / total) * 100) : null;

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
            onMouseLeave={() => setHover(null)}
          >
            {total > 0 ? (
              arcs.map((a, i) => {
                const f = perFlux[i]!;
                const m = fmtMasse(f.kg);
                const dim = hover != null && hover !== i;
                return (
                  <circle
                    key={f.code}
                    cx={100}
                    cy={100}
                    r={R}
                    fill="none"
                    stroke={a.color}
                    strokeWidth={hover === i ? 30 : 26}
                    strokeDasharray={a.dasharray}
                    strokeDashoffset={a.dashoffset}
                    transform="rotate(-90 100 100)"
                    opacity={dim ? 0.35 : 1}
                    style={{ cursor: 'pointer', transition: 'opacity 120ms' }}
                    onMouseEnter={() => setHover(i)}
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
              y={focus ? 90 : 94}
              textAnchor="middle"
              className="tabular-nums"
              style={{
                fontSize: 30,
                fontWeight: 900,
                fill: '#161A26',
                letterSpacing: '-0.02em',
              }}
            >
              {total > 0 ? centerMasse.value : '—'}
            </text>
            <text
              x={100}
              y={focus ? 108 : 116}
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
                ? centerMasse.unit === 't'
                  ? 'tonnes'
                  : 'kg'
                : 'aucune pesée'}
            </text>
            {focus && centerPct != null && (
              <text
                x={100}
                y={124}
                textAnchor="middle"
                className="tabular-nums"
                style={{ fontSize: 11, fill: '#6E7790', fontWeight: 700 }}
              >
                {`${focus.label} · ${centerPct} %`}
              </text>
            )}
          </svg>
        </div>
        <div className="mt-auto flex flex-col gap-1">
          {perFlux.map((f, i) => {
            const pct = total > 0 ? (f.kg / total) * 100 : 0;
            const m = fmtMasse(f.kg);
            return (
              <div
                key={f.code}
                className="flex items-center justify-between rounded-savr-sm px-1.5 py-1 text-[13px] transition-colors"
                style={{ background: hover === i ? '#F7F8FB' : 'transparent' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
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
                  {`${m.value} ${m.unit} · ${fmtDec(pct, 0)} %`}
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
