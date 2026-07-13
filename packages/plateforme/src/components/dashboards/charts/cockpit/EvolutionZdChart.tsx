'use client';

import * as React from 'react';
import { FLUX_ZD, TAUX_RECYCLAGE_COLOR } from '@/components/dashboards/flux';
import type { FluxSeriePoint } from '@/components/dashboards/useEvolutionBlocs';
import type { Granularite } from '../types';
import { formatPeriode } from '../format';
import { ChartCard } from './ChartCard';
import { fmtInt, fmtDec } from './fmt';
import {
  INK,
  TEXT_MUTED,
  TEXT_FAINT,
  GRID,
  GRID_BASELINE,
  ACCENT_TEXT,
} from './palette';

// EvolutionZdChart (Cockpit R24) — barres empilées des 5 flux ZD (kg) + courbe du
// taux de recyclage superposée (axe droit 0-100 %). §11 Bloc 2 ZD. Empilement
// bas→haut = résiduel → biodéchets ; sommet arrondi ; séparateurs blancs fins ;
// légende cliquable (masque un flux OU la courbe taux) ; tooltip au survol
// (kg + % par flux + taux). Format paysage compact pour ne pas dominer la page.
const VBW = 760;
const VBH = 230;
const LEFT = 46;
const RIGHT = 726;
const BASE = 188;
const TOP = 20;
const PLOT_H = BASE - TOP; // 168
const PLOT_W = RIGHT - LEFT; // 680

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
  // Survol au grain FLUX (segment de couleur), pas la barre entière (retour Val).
  const [hover, setHover] = React.useState<{ i: number; code: string } | null>(
    null,
  );
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
  const barW = Math.min(46, slot * 0.5);
  const cx = (i: number) => LEFT + slot * (i + 0.5);

  // Points de la courbe taux (non-null uniquement), avec l'index série conservé
  // (pour le survol de la courbe : accès à la valeur taux du mois).
  const ratePts = series
    .map((p, i) =>
      p.taux_recyclage != null
        ? { i, x: cx(i), y: BASE - (p.taux_recyclage / 100) * PLOT_H }
        : null,
    )
    .filter((v): v is { i: number; x: number; y: number } => v !== null);
  const TAUX = '__taux__';

  const gridT = [0, 0.25, 0.5, 0.75, 1];

  return (
    <ChartCard
      ref={ref}
      title="Évolution mensuelle Zéro Déchet"
      subtitle="Tonnages par flux · taux de recyclage superposé"
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
          <div className="relative">
            <svg
              viewBox={`0 0 ${VBW} ${VBH}`}
              width="100%"
              style={{ display: 'block', maxHeight: 340 }}
              role="img"
              aria-label="Évolution mensuelle des tonnages par flux et du taux de recyclage"
              onMouseLeave={() => setHover(null)}
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
                  x={RIGHT + 6}
                  y={BASE - (t as number) * PLOT_H + 3}
                  className="tabular-nums"
                  style={{ fontSize: 10, fill: ACCENT_TEXT }}
                >
                  {lbl}
                </text>
              ))}

              {/* colonne survolée (surbrillance discrète) */}
              {hover != null && (
                <rect
                  x={cx(hover.i) - slot / 2}
                  y={TOP}
                  width={slot}
                  height={PLOT_H}
                  fill={INK}
                  opacity={0.04}
                />
              )}

              {/* barres empilées */}
              {series.map((p, i) => {
                const x = cx(i) - barW / 2;
                const visible = STACK.filter((f) => !hidden.has(f.code));
                let yCursor = BASE;
                return (
                  <g key={p.periode}>
                    {visible.map((f, vi) => {
                      const val =
                        Number(p[f.code as keyof FluxSeriePoint]) || 0;
                      if (val <= 0) return null;
                      const h = (val / niceMax) * PLOT_H;
                      const segTop = yCursor - h;
                      const segBottom = yCursor;
                      yCursor = segTop;
                      const isTop = vi === visible.length - 1;
                      const total = Number(p.tonnage_total) || 0;
                      const pct = total > 0 ? (val / total) * 100 : 0;
                      const tip = `${f.label} : ${fmtInt(val)} kg (${fmtDec(pct, 0)} %)`;
                      const isHovered = hover?.i === i && hover.code === f.code;
                      const onEnter = () => setHover({ i, code: f.code });
                      if (isTop) {
                        const r = Math.min(3, barW / 2);
                        return (
                          <path
                            key={f.code}
                            d={`M${x},${segTop + r} Q${x},${segTop} ${x + r},${segTop} H${x + barW - r} Q${x + barW},${segTop} ${x + barW},${segTop + r} V${segBottom} H${x} Z`}
                            fill={f.color}
                            fillOpacity={0.75}
                            stroke={isHovered ? INK : '#fff'}
                            strokeWidth={isHovered ? 1.25 : 0.75}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={onEnter}
                          >
                            <title>{tip}</title>
                          </path>
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
                          fillOpacity={0.75}
                          stroke={isHovered ? INK : '#fff'}
                          strokeWidth={isHovered ? 1.25 : 0.75}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={onEnter}
                        >
                          <title>{tip}</title>
                        </rect>
                      );
                    })}
                  </g>
                );
              })}

              {/* courbe taux de recyclage (fine) — masquable via la légende */}
              {ratePts.length > 0 && !hidden.has(TAUX) && (
                <>
                  <polyline
                    points={ratePts
                      .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
                      .join(' ')}
                    fill="none"
                    stroke={TAUX_RECYCLAGE_COLOR}
                    strokeWidth={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'none' }}
                  />
                  {ratePts.map((pt, k) => {
                    const isLast = k === ratePts.length - 1;
                    const isHovered = hover?.code === TAUX && hover.i === pt.i;
                    return (
                      <circle
                        key={pt.i}
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 2.25 : isLast ? 1.75 : 1.25}
                        fill={
                          isHovered || isLast ? TAUX_RECYCLAGE_COLOR : '#fff'
                        }
                        stroke={
                          isHovered || isLast ? '#fff' : TAUX_RECYCLAGE_COLOR
                        }
                        strokeWidth={0.75}
                        style={{ pointerEvents: 'none' }}
                      />
                    );
                  })}
                  {/* Cibles de survol de la courbe taux (invisibles, larges). */}
                  {ratePts.map((pt) => (
                    <circle
                      key={`th-${pt.i}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={9}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHover({ i: pt.i, code: TAUX })}
                    />
                  ))}
                </>
              )}

              {/* étiquettes X */}
              {series.map((p, i) => (
                <text
                  key={p.periode}
                  x={cx(i)}
                  y={208}
                  textAnchor="middle"
                  style={{ fontSize: 10, fill: TEXT_MUTED, fontWeight: 600 }}
                >
                  {formatPeriode(p.periode, granularite)}
                </text>
              ))}
            </svg>

            {/* Tooltip au survol d'UN FLUX (segment de couleur) : ce flux seul +
                taux du mois en contexte (retour Val — grain flux, pas la barre). */}
            {hover != null &&
              (() => {
                const p = series[hover.i]!;
                const leftPctBase = (cx(hover.i) / VBW) * 100;
                const transformBase =
                  leftPctBase < 30
                    ? 'translateX(0)'
                    : leftPctBase > 70
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)';
                // Survol de la courbe taux de recyclage.
                if (hover.code === TAUX) {
                  return (
                    <div
                      className="pointer-events-none absolute z-10 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md"
                      style={{
                        left: `${leftPctBase}%`,
                        top: 4,
                        transform: transformBase,
                      }}
                    >
                      <div className="mb-1 text-[11px] font-semibold text-savr-neutral-500">
                        {formatPeriode(p.periode, granularite)}
                      </div>
                      <div className="flex items-center justify-between gap-5 text-[13px]">
                        <span className="flex items-center gap-1.5 font-bold text-savr-neutral-900">
                          <span
                            style={{
                              width: 14,
                              height: 3,
                              borderRadius: 2,
                              background: TAUX_RECYCLAGE_COLOR,
                            }}
                          />
                          Taux de recyclage
                        </span>
                        <span
                          className="font-extrabold tabular-nums"
                          style={{ color: ACCENT_TEXT }}
                        >
                          {p.taux_recyclage != null
                            ? `${fmtDec(p.taux_recyclage, 1)} %`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  );
                }
                const f = FLUX_ZD.find((x) => x.code === hover.code);
                if (!f) return null;
                const total = Number(p.tonnage_total) || 0;
                const val = Number(p[f.code as keyof FluxSeriePoint]) || 0;
                const pct = total > 0 ? (val / total) * 100 : 0;
                const leftPct = (cx(hover.i) / VBW) * 100;
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
                    <div className="mb-1 text-[11px] font-semibold text-savr-neutral-500">
                      {formatPeriode(p.periode, granularite)}
                    </div>
                    <div className="flex items-center justify-between gap-5 text-[13px]">
                      <span className="flex items-center gap-1.5 font-bold text-savr-neutral-900">
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 2,
                            background: f.color,
                          }}
                        />
                        {f.label}
                      </span>
                      <span className="font-extrabold tabular-nums text-savr-neutral-900">
                        {fmtInt(val)} kg
                      </span>
                    </div>
                    <div className="mt-0.5 text-right text-[11px] tabular-nums text-savr-neutral-500">
                      {fmtDec(pct, 0)} % du mois
                    </div>
                    {p.taux_recyclage != null && (
                      <div className="mt-1 flex items-center justify-between gap-5 border-t border-savr-neutral-100 pt-1 text-[11px]">
                        <span className="text-savr-neutral-600">
                          Taux de recyclage
                        </span>
                        <span
                          className="font-bold tabular-nums"
                          style={{ color: ACCENT_TEXT }}
                        >
                          {fmtDec(p.taux_recyclage, 1)} %
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>

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
            <button
              type="button"
              onClick={() => toggle(TAUX)}
              aria-pressed={!hidden.has(TAUX)}
              className="inline-flex items-center gap-1.5 rounded-savr-full border px-2.5 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
              style={{
                borderColor: '#FFE8C2',
                background: '#FFF4E0',
                color: ACCENT_TEXT,
                opacity: hidden.has(TAUX) ? 0.4 : 1,
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
              Taux de recyclage
            </button>
          </div>
        </>
      )}
    </ChartCard>
  );
});
EvolutionZdChart.displayName = 'EvolutionZdChart';

export { EvolutionZdChart };
