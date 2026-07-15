'use client';

import { useEffect, useState } from 'react';

interface KpiAdminRow {
  mois: string;
  type_collecte: string;
  nb_collectes: number;
  nb_cloturees: number;
  montant_factures_ht: number;
}

type Toggle = 'nombre' | 'montant';

interface RevenusHistogrammeProps {
  from?: string;
  to?: string;
  className?: string;
}

/**
 * Histogramme 12 mois glissants — barres empilées ZD + AG, toggle nombre/montant (§11 §1.1 Bloc 2).
 * Source : /api/v1/dashboards/kpi-admin
 * Avoirs comptés en négatif sur leur mois d'émission (F5 lot ⑫).
 */
export function RevenusHistogramme({
  from,
  to,
  className,
}: RevenusHistogrammeProps) {
  const [rows, setRows] = useState<KpiAdminRow[]>([]);
  const [toggle, setToggle] = useState<Toggle>('montant');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    fetch(`/api/v1/dashboards/kpi-admin?${params}`)
      .then((r) => r.json())
      .then((json: { kpi?: KpiAdminRow[] }) => setRows(json.kpi ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [from, to]);

  // Grouper par mois
  const moisSet = Array.from(new Set(rows.map((r) => r.mois))).sort();

  const zdByMois = Object.fromEntries(
    rows
      .filter((r) => r.type_collecte === 'zero_dechet')
      .map((r) => [r.mois, r]),
  );
  const agByMois = Object.fromEntries(
    rows
      .filter((r) => r.type_collecte === 'anti_gaspi')
      .map((r) => [r.mois, r]),
  );

  function getValue(row: KpiAdminRow | undefined): number {
    if (!row) return 0;
    return toggle === 'montant' ? row.montant_factures_ht : row.nb_collectes;
  }

  // Formatage d'une valeur selon la bascule active — € sans décimales en montant,
  // entier en nombre de collectes (alimente le tooltip de survol des barres).
  const fmtVal = (v: number): string =>
    toggle === 'montant'
      ? v.toLocaleString('fr-FR', {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        })
      : v.toLocaleString('fr-FR');

  const maxVal = Math.max(
    1,
    ...moisSet.map((m) => getValue(zdByMois[m]) + getValue(agByMois[m])),
  );

  // Axe des ordonnées : pas de graduation « rond » (1/2/5 × 10ⁿ) proche de maxVal/4,
  // puis une ligne de repère à chaque multiple sous maxVal. Les barres restent
  // calées sur maxVal (proportions inchangées) → elles peuvent dépasser la dernière
  // graduation, comme un histogramme classique.
  const niceStep = (x: number): number => {
    if (x <= 0) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / base;
    const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nf * base;
  };
  const gridStep = niceStep(maxVal / 4);
  const gridValues: number[] = [];
  for (let v = 0; v < maxVal; v += gridStep) gridValues.push(v);

  // Libellé d'une graduation d'axe — compact (k€) en montant, entier en nombre.
  const fmtAxis = (v: number): string => {
    if (v === 0) return '0';
    if (toggle === 'montant')
      return v >= 1000
        ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`
        : `${v.toLocaleString('fr-FR')} €`;
    return v.toLocaleString('fr-FR');
  };

  if (loading) {
    return (
      <div
        className={`h-48 animate-pulse rounded-savr-md bg-savr-neutral-100 ${className ?? ''}`}
        aria-busy
      />
    );
  }

  if (moisSet.length === 0) {
    return (
      <p className={`text-sm text-savr-neutral-500 ${className ?? ''}`}>
        Aucune donnée sur la période.
      </p>
    );
  }

  return (
    <div className={className} data-testid="revenus-histogramme">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
          Revenus 12 mois glissants
        </h3>
        {/* Bascule montant/nombre — segmented control DS (§5.4) */}
        <div className="inline-flex overflow-hidden rounded-savr-md border border-savr-neutral-300 text-xs font-semibold">
          <button
            type="button"
            aria-pressed={toggle === 'montant'}
            onClick={() => setToggle('montant')}
            className={`px-3 py-1.5 transition-colors duration-[120ms] ${toggle === 'montant' ? 'bg-savr-primary-700 text-savr-white' : 'text-savr-neutral-500 hover:bg-savr-neutral-100'}`}
          >
            Montant HT
          </button>
          <button
            type="button"
            aria-pressed={toggle === 'nombre'}
            onClick={() => setToggle('nombre')}
            className={`border-l border-savr-neutral-300 px-3 py-1.5 transition-colors duration-[120ms] ${toggle === 'nombre' ? 'bg-savr-primary-700 text-savr-white' : 'text-savr-neutral-500 hover:bg-savr-neutral-100'}`}
          >
            Nb collectes
          </button>
        </div>
      </div>

      {/* Zone graphe : axe des ordonnées à gauche + surface traçante. */}
      <div className="flex gap-2">
        {/* Axe Y — graduations « rondes » alignées sur les lignes de repère. */}
        <div className="relative h-[200px] w-12 shrink-0">
          {gridValues.map((v) => (
            <span
              key={v}
              className="absolute right-0 -translate-y-1/2 pr-1 text-[10px] tabular-nums text-savr-neutral-400"
              style={{ bottom: `${(v / maxVal) * 100}%` }}
            >
              {fmtAxis(v)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          {/* Surface traçante (hauteur +25 % vs. 160px) : lignes de repère
              pointillées très fines derrière les barres empilées. */}
          <div className="relative h-[200px]">
            <div className="pointer-events-none absolute inset-0">
              {gridValues.map((v) => (
                <div
                  key={v}
                  className="absolute inset-x-0 border-t border-dotted border-savr-neutral-200"
                  style={{ bottom: `${(v / maxVal) * 100}%` }}
                />
              ))}
            </div>

            <div className="relative flex h-full items-end gap-1">
              {moisSet.map((mois) => {
                const zdVal = getValue(zdByMois[mois]);
                const agVal = getValue(agByMois[mois]);
                const total = zdVal + agVal;
                const zdPct = total > 0 ? (zdVal / maxVal) * 100 : 0;
                const agPct = total > 0 ? (agVal / maxVal) * 100 : 0;
                const label = new Date(mois).toLocaleDateString('fr-FR', {
                  month: 'short',
                  year: '2-digit',
                });

                return (
                  <div
                    key={mois}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end"
                  >
                    {/* Tooltip valeurs au survol — surface claire DS, calquée sur
                        les graphes cockpit (EvolutionZdChart) : ZD, AG et total
                        formatés selon la bascule montant/nombre. */}
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 text-left opacity-0 shadow-savr-md transition-opacity duration-[120ms] group-hover:opacity-100"
                    >
                      <div className="mb-1 text-[11px] font-semibold text-savr-neutral-500">
                        {label}
                      </div>
                      <div className="flex items-center justify-between gap-5 text-[13px]">
                        <span className="flex items-center gap-1.5 font-bold text-savr-neutral-900">
                          <span className="inline-block h-2 w-2 rounded-savr-sm bg-savr-success" />
                          Zéro déchet
                        </span>
                        <span className="font-extrabold tabular-nums text-savr-neutral-900">
                          {fmtVal(zdVal)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-5 text-[13px]">
                        <span className="flex items-center gap-1.5 font-bold text-savr-neutral-900">
                          <span className="inline-block h-2 w-2 rounded-savr-sm bg-savr-accent-500" />
                          Anti-gaspi
                        </span>
                        <span className="font-extrabold tabular-nums text-savr-neutral-900">
                          {fmtVal(agVal)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-5 border-t border-savr-neutral-100 pt-1.5 text-[13px]">
                        <span className="font-semibold text-savr-neutral-500">
                          Total
                        </span>
                        <span className="font-extrabold tabular-nums text-savr-neutral-900">
                          {fmtVal(total)}
                        </span>
                      </div>
                    </div>
                    {agVal > 0 && (
                      <div
                        className="w-full rounded-t-savr-sm bg-savr-accent-500"
                        style={{ height: `${agPct}%` }}
                        aria-label={`AG ${label}`}
                      />
                    )}
                    {zdVal > 0 && (
                      <div
                        className={`w-full ${agVal > 0 ? '' : 'rounded-t-savr-sm'} bg-savr-success`}
                        style={{ height: `${zdPct}%` }}
                        aria-label={`ZD ${label}`}
                      />
                    )}
                    {zdVal <= 0 && agVal <= 0 && (
                      <div className="h-1 w-full rounded-savr-sm bg-savr-neutral-200" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Libellés des mois — alignés sous les barres, hors surface traçante. */}
          <div className="mt-1 flex gap-1">
            {moisSet.map((mois) => (
              <span
                key={mois}
                className="flex-1 text-center text-[10px] text-savr-neutral-500"
              >
                {new Date(mois).toLocaleDateString('fr-FR', {
                  month: 'short',
                  year: '2-digit',
                })}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-4 text-xs text-savr-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-savr-sm bg-savr-success" />
          Zéro déchet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-savr-sm bg-savr-accent-500" />
          Anti-gaspi
        </span>
      </div>
    </div>
  );
}
