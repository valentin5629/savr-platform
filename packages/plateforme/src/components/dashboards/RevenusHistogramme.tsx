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
        className={`h-48 animate-pulse rounded-md bg-muted ${className ?? ''}`}
        aria-busy
      />
    );
  }

  if (moisSet.length === 0) {
    return (
      <p className={`text-sm text-muted-foreground ${className ?? ''}`}>
        Aucune donnée sur la période.
      </p>
    );
  }

  return (
    <div className={className} data-testid="revenus-histogramme">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Revenus 12 mois glissants</h3>
        <div className="inline-flex rounded border border-border text-xs">
          <button
            onClick={() => setToggle('montant')}
            className={`px-2 py-1 ${toggle === 'montant' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Montant HT
          </button>
          <button
            onClick={() => setToggle('nombre')}
            className={`px-2 py-1 ${toggle === 'nombre' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
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
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${label} — ZD: ${zdVal.toLocaleString('fr-FR')} | AG: ${agVal.toLocaleString('fr-FR')}`}
            >
              {agVal > 0 && (
                <div
                  className="w-full rounded-t bg-amber-400"
                  style={{ height: `${agPct}%` }}
                  aria-label={`AG ${label}`}
                />
              )}
              {zdVal > 0 && (
                <div
                  className={`w-full ${agVal > 0 ? '' : 'rounded-t'} bg-emerald-500`}
                  style={{ height: `${zdPct}%` }}
                  aria-label={`ZD ${label}`}
                />
              )}
              {zdVal <= 0 && agVal <= 0 && (
                <div className="h-1 w-full rounded bg-muted" />
              )}
              <span className="mt-1 text-[10px] text-muted-foreground">
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          Zéro déchet
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-400" />
          Anti-gaspi
        </span>
      </div>
    </div>
  );
}
