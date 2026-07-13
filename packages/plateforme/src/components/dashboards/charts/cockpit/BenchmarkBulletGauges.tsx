'use client';

import * as React from 'react';
import { ChartCard } from './ChartCard';
import { fmtDec } from './fmt';
import { STATUT, NAVY, TEXT_XFAINT, TRACK } from './palette';

// BenchmarkBulletGauges — grille de 5 jauges « bullet » horizontales (R24) :
// intensité kg/pax par flux comparée à la moyenne du parc Savr (anonymisée). Le
// repère du parc est TOUJOURS positionné à 50 % de la piste (milieu = « à la
// moyenne » ; lecture homogène entre flux), le remplissage traduit le ratio
// value/benchmark (ratio 1 → pile au repère, ratio 2 → bout de piste). Statut
// (vert / orange / rouge) redondé par la valeur, le repère chiffré et le badge
// d'écart — jamais porté par la seule couleur. value/benchmark null → insuffisant.
export interface GaugeItem {
  label: string;
  value: number | null;
  benchmark: number | null;
}

interface BenchmarkBulletGaugesProps {
  items: GaugeItem[];
  /** Filtres du repère parc, imbriqués DANS la carte (au-dessus des jauges) —
   *  filtres + jauges = un seul bloc (retour Val R24b). */
  filtersSlot?: React.ReactNode;
}

// Position fixe du repère « moyenne parc » sur la piste (milieu = intuitif).
const REPERE_PCT = 50;
// Palette statut (levier couleur = signal, DS §5). Repère parc = navy-700.
const REPERE = NAVY;
const STATUTS = {
  vert: {
    color: STATUT.vert.fill,
    badgeColor: STATUT.vert.badge,
    badgeBg: STATUT.vert.badgeBg,
  },
  orange: {
    color: STATUT.orange.fill,
    badgeColor: STATUT.orange.badge,
    badgeBg: STATUT.orange.badgeBg,
  },
  rouge: {
    color: STATUT.rouge.fill,
    badgeColor: STATUT.rouge.badge,
    badgeBg: STATUT.rouge.badgeBg,
  },
} as const;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function LegendDot({ color }: { color: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      className="inline-block rounded-savr-full"
      style={{ width: 9, height: 9, background: color }}
    />
  );
}

function Legend(): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color={STATUT.vert.fill} /> Inférieur
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color={STATUT.orange.fill} /> Supérieur
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color={STATUT.rouge.fill} /> Largement supérieur
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color={TEXT_XFAINT} /> Données manquantes
      </span>
    </div>
  );
}

// Tooltip de survol d'une jauge (retour Val — voir les valeurs au survol).
function GaugeTooltip({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md">
      {children}
    </div>
  );
}

function Gauge({ item }: { item: GaugeItem }): React.ReactElement {
  const insuffisant = item.value == null || item.benchmark == null;
  const [hover, setHover] = React.useState(false);

  if (insuffisant) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="text-[13px] font-bold text-savr-neutral-400">
            {item.label}
          </span>
          <span className="text-lg font-extrabold tabular-nums text-savr-neutral-400">
            {item.value != null ? fmtDec(item.value, 2) : '—'}
          </span>
        </div>
        <div
          className="relative h-3 rounded-[4px]"
          style={{ background: TRACK }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'repeating-linear-gradient(45deg,#E4E7EF,#E4E7EF 5px,#EEF0F5 5px,#EEF0F5 10px)',
              borderRadius: 4,
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: `${REPERE_PCT}%`,
              top: -4,
              bottom: -4,
              width: 2,
              background: TEXT_XFAINT,
              borderRadius: 2,
            }}
          />
        </div>
        <div className="mt-2.5 flex justify-between">
          <span className="text-[11px] tabular-nums text-savr-neutral-400">
            {item.benchmark != null
              ? `parc ${fmtDec(item.benchmark, 2)}`
              : 'parc n/a'}
          </span>
          <span
            className="rounded-savr-md px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: '#6E7790', background: '#EEF0F5' }}
          >
            Données manquantes
          </span>
        </div>
        {hover && (
          <GaugeTooltip>
            <div className="mb-1 text-[12px] font-bold text-savr-neutral-900">
              {item.label}
            </div>
            <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
              <div className="flex justify-between gap-4">
                <span className="text-savr-neutral-600">Vous</span>
                <span className="font-bold">
                  {item.value != null ? `${fmtDec(item.value, 2)} kg/pax` : '—'}
                </span>
              </div>
              <div className="text-savr-neutral-500">
                Parc : données manquantes
              </div>
            </div>
          </GaugeTooltip>
        )}
      </div>
    );
  }

  // value/benchmark non nuls ici (garde ci-dessus).
  const value = item.value as number;
  const benchmark = item.benchmark as number;
  const ratio = value / benchmark;
  const statut =
    ratio <= 1 ? STATUTS.vert : ratio <= 1.3 ? STATUTS.orange : STATUTS.rouge;
  const pct = clamp(ratio * REPERE_PCT, 0, 100);
  const delta = (ratio - 1) * 100;
  const badgeTxt = `${delta >= 0 ? '+' : '−'}${fmtDec(Math.abs(delta), 0)} %`;
  const statutLabel =
    ratio <= 1
      ? 'Inférieur'
      : ratio <= 1.3
        ? 'Supérieur'
        : 'Largement supérieur';

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[13px] font-bold text-savr-neutral-800">
          {item.label}
        </span>
        <span className="text-lg font-extrabold tabular-nums">
          {fmtDec(value, 2)}
        </span>
      </div>
      <div className="relative h-3 rounded-[4px]" style={{ background: TRACK }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: statut.color,
            borderRadius: 3,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${REPERE_PCT}%`,
            top: -4,
            bottom: -4,
            width: 2,
            background: REPERE,
            borderRadius: 2,
          }}
        />
      </div>
      <div className="mt-2.5 flex justify-between">
        <span className="text-[11px] tabular-nums text-savr-neutral-400">
          {`parc ${fmtDec(benchmark, 2)}`}
        </span>
        <span
          className="rounded-savr-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ color: statut.badgeColor, background: statut.badgeBg }}
        >
          {badgeTxt}
        </span>
      </div>
      {hover && (
        <GaugeTooltip>
          <div className="mb-1 text-[12px] font-bold text-savr-neutral-900">
            {item.label}
          </div>
          <div className="flex flex-col gap-0.5 text-[11px] tabular-nums">
            <div className="flex justify-between gap-4">
              <span className="text-savr-neutral-600">Vous</span>
              <span className="font-bold">{fmtDec(value, 2)} kg/pax</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-savr-neutral-600">Parc</span>
              <span className="font-bold">{fmtDec(benchmark, 2)} kg/pax</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-savr-neutral-100 pt-0.5">
              <span className="text-savr-neutral-600">Écart</span>
              <span className="font-bold" style={{ color: statut.badgeColor }}>
                {badgeTxt} · {statutLabel}
              </span>
            </div>
          </div>
        </GaugeTooltip>
      )}
    </div>
  );
}

export function BenchmarkBulletGauges({
  items,
  filtersSlot,
}: BenchmarkBulletGaugesProps): React.ReactElement {
  return (
    <ChartCard
      title="Intensité par flux · kg/pax vs benchmark parc"
      subtitle="Repère = moyenne du parc Savr (anonymisée). Statut selon l'écart."
      headerRight={<Legend />}
    >
      {filtersSlot && (
        <div className="mb-5 border-b border-savr-neutral-100 pb-5">
          {filtersSlot}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item, i) => (
          <Gauge key={`${item.label}-${i}`} item={item} />
        ))}
      </div>
    </ChartCard>
  );
}
BenchmarkBulletGauges.displayName = 'BenchmarkBulletGauges';
