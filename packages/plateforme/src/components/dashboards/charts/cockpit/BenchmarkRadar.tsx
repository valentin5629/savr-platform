'use client';

import * as React from 'react';
import type { GaugeItem } from '@/lib/dashboards/cockpit-derive';
import { ChartCard } from './ChartCard';
import { fmtDec } from './fmt';
import {
  STATUT,
  NAVY,
  GRID,
  GRID_BASELINE,
  TEXT_MUTED,
  TEXT_FAINT,
  TEXT_XFAINT,
  SURFACE_HOVER,
} from './palette';

// BenchmarkRadar — radar « lignes seules » (modèle shadcn Radar Chart - Lines
// Only, décision Val 2026-09-28, remplace les 5 jauges bullet R24) : intensité
// kg/pax par flux comparée à la moyenne du parc Savr (anonymisée).
// Échelle = INDICE « parc = 100 » par flux (les flux n'ont pas le même ordre de
// grandeur — 0,02 à 0,12 kg/pax — un axe brut écraserait les petits flux) : le
// parc est un pentagone régulier, votre ligne passe dedans (moins de déchets que
// le parc) ou dehors. Les kg/pax réels restent lisibles dans la liste à côté et
// au survol. Statut (vert / orange / rouge) porté par la liste (valeur + badge
// d'écart), jamais par la seule couleur. value/benchmark null → axe « n/d »,
// point absent (segments adjacents non tracés : pas de fausse continuité).
interface BenchmarkRadarProps {
  items: GaugeItem[];
  /** Filtres du repère parc, imbriqués DANS la carte (au-dessus du radar) —
   *  filtres + graphe = un seul bloc (retour Val R24b). */
  filtersSlot?: React.ReactNode;
}

// Série « Vous » = navy-700 (encre forte), série « Parc » = primary-300 (repère
// en retrait) — échelle primary DS §10.
const VOUS = NAVY;
const PARC = '#92A3D2'; // primary-300

// Géométrie SVG (viewBox fixe, rendu fluide en largeur).
const VB_W = 460; // marge latérale : libellés longs (« Déchet résiduel ») ; « n/d » va en 2e ligne
const VB_H = 290;
const CX = VB_W / 2;
const CY = 145;
const R = 100; // rayon de l'anneau extérieur
const LABEL_R = R + 22;

const STATUTS = {
  vert: {
    badge: STATUT.vert.badge,
    bg: STATUT.vert.badgeBg,
    label: 'Inférieur',
  },
  orange: {
    badge: STATUT.orange.badge,
    bg: STATUT.orange.badgeBg,
    label: 'Supérieur',
  },
  rouge: {
    badge: STATUT.rouge.badge,
    bg: STATUT.rouge.badgeBg,
    label: 'Largement supérieur',
  },
} as const;

interface Axe {
  item: GaugeItem;
  /** value / benchmark ; null si non comparable (valeur absente, non finie, ou
   *  parc ≤ 0). UN seul prédicat pour le radar, la liste et l'infobulle. */
  ratio: number | null;
  /** Le parc a un repère exploitable sur cet axe (fini et > 0). */
  parcOk: boolean;
  angle: number;
}

function fini(n: number | null): n is number {
  return n != null && Number.isFinite(n);
}

function statutDe(ratio: number) {
  return ratio <= 1
    ? STATUTS.vert
    : ratio <= 1.3
      ? STATUTS.orange
      : STATUTS.rouge;
}

function ecartTxt(ratio: number): string {
  const delta = (ratio - 1) * 100;
  return `${delta >= 0 ? '+' : '−'}${fmtDec(Math.abs(delta), 0)} %`;
}

function point(angle: number, r: number): [number, number] {
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
}

/** Anneau extérieur : ≥ 150 (le parc à 100 reste lisible), pas de 50, plafonné
 *  à 300 (au-delà le point est posé sur le bord ; l'écart exact est dans la liste). */
function anneauMax(axes: Axe[]): number {
  const max = Math.max(0, ...axes.map((a) => (a.ratio ?? 0) * 100));
  return Math.min(300, Math.max(150, Math.ceil(max / 50) * 50));
}

/** Segments entre sommets consécutifs tous deux présents (boucle fermée). */
function segments(pts: ([number, number] | null)[]): string {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a && b && n > 1) d += `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
  }
  return d;
}

function LegendLine({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
      <span
        aria-hidden
        className="inline-block rounded-savr-full"
        style={{ width: 14, height: 3, background: color }}
      />
      {children}
    </span>
  );
}

function LegendDot({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
      <span
        aria-hidden
        className="inline-block rounded-savr-full"
        style={{ width: 9, height: 9, background: color }}
      />
      {children}
    </span>
  );
}

function Tooltip({ axe }: { axe: Axe }): React.ReactElement {
  const { item, ratio } = axe;
  return (
    <div
      data-testid="benchmark-radar-tooltip"
      className="pointer-events-none whitespace-nowrap rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md"
    >
      <div className="mb-1 text-[12px] font-bold text-savr-neutral-900">
        {item.label}
      </div>
      <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
        <div className="flex justify-between gap-4">
          <span className="text-savr-neutral-600">Vous</span>
          <span className="font-bold">
            {fini(item.value) ? `${fmtDec(item.value, 2)} kg/pax` : '—'}
          </span>
        </div>
        {fini(item.benchmark) ? (
          <div className="flex justify-between gap-4">
            <span className="text-savr-neutral-600">Parc</span>
            <span className="font-bold">
              {fmtDec(item.benchmark, 2)} kg/pax
            </span>
          </div>
        ) : (
          <div className="text-savr-neutral-500">Parc : données manquantes</div>
        )}
        {ratio != null && (
          <div className="flex justify-between gap-4 border-t border-savr-neutral-100 pt-0.5">
            <span className="text-savr-neutral-600">Écart</span>
            <span
              className="font-bold"
              style={{ color: statutDe(ratio).badge }}
            >
              {ecartTxt(ratio)} · {statutDe(ratio).label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function LigneFlux({
  axe,
  active,
  onHover,
}: {
  axe: Axe;
  active: boolean;
  onHover: (on: boolean) => void;
}): React.ReactElement {
  const { item, ratio } = axe;
  const statut = ratio != null ? statutDe(ratio) : null;
  return (
    <li
      data-testid="benchmark-radar-ligne"
      className="flex items-center justify-between gap-3 rounded-savr-sm px-2 py-1.5 transition-colors"
      style={{ background: active ? SURFACE_HOVER : 'transparent' }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="min-w-0">
        <div
          className={
            statut
              ? 'text-[13px] font-bold text-savr-neutral-800'
              : 'text-[13px] font-bold text-savr-neutral-400'
          }
        >
          {item.label}
        </div>
        <div className="text-[11px] tabular-nums text-savr-neutral-500">
          {fini(item.value) ? `${fmtDec(item.value, 2)} kg/pax` : '—'}
          {' · '}
          {fini(item.benchmark)
            ? `parc ${fmtDec(item.benchmark, 2)}`
            : 'parc n/d'}
        </div>
      </div>
      {statut && ratio != null ? (
        <span
          className="shrink-0 rounded-savr-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ color: statut.badge, background: statut.bg }}
        >
          {ecartTxt(ratio)}
        </span>
      ) : (
        <span
          className="shrink-0 rounded-savr-md px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ color: TEXT_MUTED, background: GRID }}
        >
          Données manquantes
        </span>
      )}
    </li>
  );
}

export function BenchmarkRadar({
  items,
  filtersSlot,
}: BenchmarkRadarProps): React.ReactElement {
  const [hover, setHover] = React.useState<number | null>(null);
  const n = items.length;
  const axes: Axe[] = items.map((item, i) => {
    const parcOk = fini(item.benchmark) && item.benchmark > 0;
    return {
      item,
      parcOk,
      ratio:
        parcOk && fini(item.value)
          ? item.value / (item.benchmark as number)
          : null,
      angle: -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n),
    };
  });
  const max = anneauMax(axes);
  const scale = (idx: number) => (Math.min(idx, max) / max) * R;
  const anneaux: number[] = [];
  for (let v = 50; v <= max; v += 50) anneaux.push(v);

  const ptsVous = axes.map((a) =>
    a.ratio != null ? point(a.angle, scale(a.ratio * 100)) : null,
  );
  // Le repère parc n'existe que là où le parc a une valeur exploitable.
  const ptsParc = axes.map((a) =>
    a.parcOk ? point(a.angle, scale(100)) : null,
  );

  const focus = hover != null ? axes[hover] : undefined;
  const focusLabel = focus ? point(focus.angle, LABEL_R) : null;
  // Axes du bas : infobulle AU-DESSUS du libellé (sinon elle déborde sous le
  // radar et recouvre la liste en affichage une colonne).
  const tooltipDessus = focus != null && Math.sin(focus.angle) > 0.2;

  return (
    <ChartCard
      title="Intensité par flux · kg/pax vs benchmark parc"
      subtitle="Indice : moyenne du parc Savr (anonymisée) = 100. À l'intérieur du repère, vous produisez moins que le parc."
      headerRight={
        <div className="flex flex-wrap gap-3">
          <LegendLine color={VOUS}>Vous</LegendLine>
          <LegendLine color={PARC}>Moyenne parc</LegendLine>
        </div>
      }
    >
      {filtersSlot && (
        <div className="mb-5 border-b border-savr-neutral-100 pb-5">
          {filtersSlot}
        </div>
      )}
      <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <div className="relative mx-auto w-full max-w-[480px]">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="block h-auto w-full"
            role="img"
            aria-label="Radar de l'intensité kg/pax par flux, indice parc = 100"
            data-testid="benchmark-radar"
          >
            {/* Grille polygonale (sans rayons — variante « lines only »). */}
            {anneaux.map((v) => (
              <polygon
                key={v}
                points={axes
                  .map((a) => point(a.angle, scale(v)).join(','))
                  .join(' ')}
                fill="none"
                stroke={v === max ? GRID_BASELINE : GRID}
                strokeWidth={1}
              />
            ))}
            {/* Axe survolé mis en évidence. */}
            {focus && (
              <line
                x1={CX}
                y1={CY}
                x2={point(focus.angle, R)[0]}
                y2={point(focus.angle, R)[1]}
                stroke={GRID_BASELINE}
                strokeWidth={1}
              />
            )}
            <path
              d={segments(ptsParc)}
              fill="none"
              stroke={PARC}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={segments(ptsVous)}
              fill="none"
              stroke={VOUS}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {ptsVous.map((p, i) =>
              p ? (
                <circle
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  r={hover === i ? 4.5 : 3}
                  fill={VOUS}
                />
              ) : null,
            )}
            {axes.map((a, i) => {
              const [lx, ly] = point(a.angle, LABEL_R);
              const cos = Math.cos(a.angle);
              const anchor =
                Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
              const manquant = a.ratio == null;
              return (
                <g
                  key={`${a.item.label}-${i}`}
                  data-testid={`benchmark-radar-axe-${i}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'default' }}
                >
                  {/* Zone de survol : secteur de l'axe (du centre au libellé). */}
                  <line
                    x1={CX}
                    y1={CY}
                    x2={lx}
                    y2={ly}
                    stroke="transparent"
                    strokeWidth={28}
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={anchor}
                    dominantBaseline="middle"
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      fill: manquant ? TEXT_XFAINT : TEXT_MUTED,
                    }}
                  >
                    {a.item.label}
                    {/* 2e ligne : un suffixe en ligne rognerait le libellé des
                        axes latéraux (le SVG coupe ce qui dépasse). */}
                    {manquant && (
                      <tspan x={lx} dy="1.2em" style={{ fontSize: 11 }}>
                        n/d
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
            <text
              x={CX + 4}
              y={CY - scale(100) - 4}
              style={{ fontSize: 9, fill: TEXT_FAINT, fontWeight: 600 }}
            >
              100
            </text>
          </svg>
          {focus && focusLabel && (
            <div
              className={
                tooltipDessus
                  ? 'absolute z-20 -translate-x-1/2 -translate-y-full'
                  : 'absolute z-20 -translate-x-1/2'
              }
              style={{
                left: `${(focusLabel[0] / VB_W) * 100}%`,
                top: `${((focusLabel[1] + (tooltipDessus ? -12 : 12)) / VB_H) * 100}%`,
              }}
            >
              <Tooltip axe={focus} />
            </div>
          )}
        </div>
        <div>
          <ul className="flex flex-col gap-0.5">
            {axes.map((a, i) => (
              <LigneFlux
                key={`${a.item.label}-${i}`}
                axe={a}
                active={hover === i}
                onHover={(on) => setHover(on ? i : null)}
              />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3 border-t border-savr-neutral-100 px-2 pt-3">
            <LegendDot color={STATUT.vert.fill}>Inférieur</LegendDot>
            <LegendDot color={STATUT.orange.fill}>Supérieur</LegendDot>
            <LegendDot color={STATUT.rouge.fill}>Largement supérieur</LegendDot>
            <LegendDot color={TEXT_XFAINT}>Données manquantes</LegendDot>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
BenchmarkRadar.displayName = 'BenchmarkRadar';
