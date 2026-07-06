'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { FLUX_ZD, TAUX_RECYCLAGE_COLOR } from '../flux.js';
import type { FluxSeriePoint } from '../useEvolutionBlocs.js';
import type { Granularite } from './types.js';
import { formatPeriode, formatMasse } from './format.js';

interface EvolutionFluxChartProps {
  series: FluxSeriePoint[];
  granularite: Granularite;
  className?: string;
}

/**
 * Bloc 2 ZD (§06.04/§06.05 Bloc 2) — évolution mensuelle : barres empilées des
 * 5 flux ZD + courbe superposée du taux de recyclage (axe secondaire %).
 * Légende cliquable (masque/affiche un flux). Bascule kg/t automatique > 10 000 kg.
 */
export function EvolutionFluxChart({
  series,
  granularite,
  className,
}: EvolutionFluxChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const maxTonnage = useMemo(
    () => Math.max(0, ...series.map((p) => p.tonnage_total)),
    [series],
  );
  const useTonnes = maxTonnage >= 10000;

  // Totaux par flux (pour la légende cliquable).
  const totauxFlux = useMemo(() => {
    const t: Record<string, number> = {};
    for (const f of FLUX_ZD) t[f.code] = 0;
    for (const p of series)
      for (const f of FLUX_ZD)
        t[f.code] =
          (t[f.code] ?? 0) +
          ((p[f.code as keyof FluxSeriePoint] as number) ?? 0);
    return t;
  }, [series]);

  function toggle(code: string): void {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  if (series.length === 0) {
    return (
      <div className={className} data-testid="evolution-flux-chart">
        <p className="text-sm text-savr-neutral-500">
          Aucune donnée sur la période.
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid="evolution-flux-chart">
      {/* Légende cliquable (§06.04 Bloc 2 « Légende cliquable ») */}
      <ul
        className="mb-3 flex flex-wrap gap-3 text-xs"
        data-testid="evolution-flux-legend"
      >
        {FLUX_ZD.map((f) => {
          const off = hidden.has(f.code);
          return (
            <li key={f.code}>
              <button
                type="button"
                onClick={() => toggle(f.code)}
                aria-pressed={!off}
                className={`flex items-center gap-1 ${off ? 'opacity-40' : ''}`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: f.color }}
                />
                {f.label}
                <span className="text-savr-neutral-400">
                  ({formatMasse(totauxFlux[f.code] ?? 0, useTonnes)})
                </span>
              </button>
            </li>
          );
        })}
        <li className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: TAUX_RECYCLAGE_COLOR }}
          />
          Taux de recyclage
        </li>
      </ul>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={series}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="periode"
              tickFormatter={(v: string) => formatPeriode(v, granularite)}
              fontSize={11}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={(v: number) =>
                useTonnes ? `${(v / 1000).toLocaleString('fr-FR')}` : `${v}`
              }
              fontSize={11}
              label={{
                value: useTonnes ? 't' : 'kg',
                position: 'insideTopLeft',
                fontSize: 10,
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              fontSize={11}
            />
            <Tooltip
              formatter={(value, name) => {
                const v = Number(value);
                const key = String(name);
                return key === 'taux_recyclage'
                  ? [`${v.toFixed(1)} %`, 'Taux de recyclage']
                  : [
                      formatMasse(v, useTonnes),
                      FLUX_ZD.find((f) => f.code === key)?.label ?? key,
                    ];
              }}
              labelFormatter={(label) =>
                formatPeriode(String(label), granularite)
              }
            />
            {FLUX_ZD.map((f) => (
              <Bar
                key={f.code}
                yAxisId="left"
                dataKey={f.code}
                stackId="tonnage"
                fill={f.color}
                hide={hidden.has(f.code)}
              />
            ))}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="taux_recyclage"
              stroke={TAUX_RECYCLAGE_COLOR}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
