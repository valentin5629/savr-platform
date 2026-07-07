'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { FLUX_ZD } from '../flux.js';
import type { FluxSeriePoint } from '../useEvolutionBlocs.js';
import { formatMasse } from './format.js';

interface TonnagesDonutProps {
  /** Même série que le Bloc 2 ZD — le donut agrège les flux sur la période. */
  series: FluxSeriePoint[];
  className?: string;
}

/**
 * Bloc 4 ZD (§06.04/§06.05 Bloc 4) — donut de répartition des tonnages entre les
 * 5 flux sur la période filtrée. Total au centre. Tooltip kg + %.
 */
export function TonnagesDonut({ series, className }: TonnagesDonutProps) {
  const { data, total } = useMemo(() => {
    const parts = FLUX_ZD.map((f) => ({
      code: f.code,
      label: f.label,
      color: f.color,
      kg: series.reduce(
        (s, p) => s + ((p[f.code as keyof FluxSeriePoint] as number) ?? 0),
        0,
      ),
    }));
    const t = parts.reduce((s, p) => s + p.kg, 0);
    return { data: parts.filter((p) => p.kg > 0), total: t };
  }, [series]);

  const useTonnes = total >= 10000;

  if (total <= 0) {
    return (
      <div className={className} data-testid="tonnages-donut">
        <p className="text-sm text-savr-neutral-500">
          Aucune donnée sur la période.
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid="tonnages-donut">
      <div className="relative h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="kg"
              nameKey="label"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={1}
              isAnimationActive={false}
            >
              {data.map((p) => (
                <Cell key={p.code} fill={p.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const v = Number(value);
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
                const label =
                  (item as { payload?: { label?: string } })?.payload?.label ??
                  '';
                return [`${formatMasse(v, useTonnes)} (${pct} %)`, label];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Total au centre (§06.04 Bloc 4 « Total au centre = tonnage total »). */}
        <div
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          data-testid="tonnages-donut-total"
        >
          <span className="text-xs text-savr-neutral-500">Total</span>
          <span className="text-lg font-bold text-savr-primary-800">
            {formatMasse(total, useTonnes)}
          </span>
        </div>
      </div>

      {/* Légende + parts (a11y + preuve testable sans dépendre du rendu SVG). */}
      <ul
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs"
        data-testid="tonnages-donut-legend"
      >
        {FLUX_ZD.map((f) => {
          const part = data.find((p) => p.code === f.code);
          const kg = part?.kg ?? 0;
          const pct = total > 0 ? ((kg / total) * 100).toFixed(1) : '0';
          return (
            <li key={f.code} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: f.color }}
              />
              {f.label}
              <span className="text-savr-neutral-400">
                {formatMasse(kg, useTonnes)} ({pct} %)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
