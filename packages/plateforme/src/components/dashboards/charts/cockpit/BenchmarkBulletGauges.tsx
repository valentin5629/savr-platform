'use client';

import * as React from 'react';
import { ChartCard } from './ChartCard';
import { fmtDec } from './fmt';

// BenchmarkBulletGauges — grille de 5 jauges « bullet » horizontales (R24) :
// intensité kg/pax par flux comparée à la moyenne du parc Savr (anonymisée). Le
// repère du parc est TOUJOURS positionné à 60 % de la piste (lecture homogène
// entre flux), le remplissage traduit le ratio value/benchmark. Statut (vert /
// orange / rouge) redondé par la valeur, le repère chiffré et le badge d'écart —
// jamais porté par la seule couleur. value ou benchmark null → état insuffisant.
export interface GaugeItem {
  label: string;
  value: number | null;
  benchmark: number | null;
}

interface BenchmarkBulletGaugesProps {
  items: GaugeItem[];
}

// Palette statut (levier couleur = signal, DS §5). Repère parc = navy-700.
const REPERE = '#223870';
const STATUTS = {
  vert: { color: '#16A34A', badgeColor: '#16A34A', badgeBg: '#F0FDF4' },
  orange: { color: '#FF9B00', badgeColor: '#B36400', badgeBg: '#FFF4E0' },
  rouge: { color: '#DC2626', badgeColor: '#DC2626', badgeBg: '#FEF2F2' },
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
    <div className="flex gap-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color="#16A34A" /> ≤ parc
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color="#FF9B00" /> 100-130 %
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color="#DC2626" /> &gt; 130 %
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-savr-neutral-600">
        <LegendDot color="#C3C9D9" /> n &lt; 5
      </span>
    </div>
  );
}

function Gauge({ item }: { item: GaugeItem }): React.ReactElement {
  const insuffisant = item.value == null || item.benchmark == null;

  if (insuffisant) {
    return (
      <div>
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
          style={{ background: '#EEF0F5' }}
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
              left: '60%',
              top: -4,
              bottom: -4,
              width: 2,
              background: '#C3C9D9',
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
            n &lt; 5
          </span>
        </div>
      </div>
    );
  }

  // value/benchmark non nuls ici (garde ci-dessus).
  const value = item.value as number;
  const benchmark = item.benchmark as number;
  const ratio = value / benchmark;
  const statut =
    ratio <= 1 ? STATUTS.vert : ratio <= 1.3 ? STATUTS.orange : STATUTS.rouge;
  const pct = clamp(ratio * 60, 0, 100);
  const delta = (ratio - 1) * 100;
  const badgeTxt = `${delta >= 0 ? '+' : '−'}${fmtDec(Math.abs(delta), 0)} %`;

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[13px] font-bold text-savr-neutral-800">
          {item.label}
        </span>
        <span className="text-lg font-extrabold tabular-nums">
          {fmtDec(value, 2)}
        </span>
      </div>
      <div
        className="relative h-3 rounded-[4px]"
        style={{ background: '#EEF0F5' }}
      >
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
            left: '60%',
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
    </div>
  );
}

export function BenchmarkBulletGauges({
  items,
}: BenchmarkBulletGaugesProps): React.ReactElement {
  return (
    <ChartCard
      title="Intensité par flux · kg/pax vs benchmark parc"
      subtitle="Repère = moyenne du parc Savr (anonymisée). Statut selon l'écart."
      headerRight={<Legend />}
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((item, i) => (
          <Gauge key={`${item.label}-${i}`} item={item} />
        ))}
      </div>
    </ChartCard>
  );
}
BenchmarkBulletGauges.displayName = 'BenchmarkBulletGauges';
