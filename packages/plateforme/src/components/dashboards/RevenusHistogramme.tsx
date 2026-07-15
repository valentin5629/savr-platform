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

  const maxVal = Math.max(
    1,
    ...moisSet.map((m) => getValue(zdByMois[m]) + getValue(agByMois[m])),
  );

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

      <div className="flex h-40 items-end gap-1">
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
              title={`${label} — ZD: ${zdVal.toLocaleString('fr-FR')} | AG: ${agVal.toLocaleString('fr-FR')}`}
            >
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
              <span className="mt-1 text-[10px] text-savr-neutral-500">
                {label}
              </span>
            </div>
          );
        })}
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
