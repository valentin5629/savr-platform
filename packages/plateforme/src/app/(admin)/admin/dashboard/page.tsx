'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  AlertTriangle,
  Clock,
  RefreshCw,
  Zap,
  Download,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { RevenusHistogramme } from '@/components/dashboards/index.js';

interface KpiData {
  non_transmises_zd: number;
  non_transmises_ag: number;
  attente_prestataire: number;
  dirty_tms: number;
  zd_48h: number;
  ag_48h: number;
}

interface RevenusRow {
  organisation_id: string;
  raison_sociale: string;
  type_organisation: string;
  type_label: string;
  nb_zd: number;
  montant_zd_ht: number;
  nb_ag: number;
  montant_ag_ht: number;
  montant_total: number;
}

function euro(v: number): string {
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

// Période par défaut : mois en cours (§11 §1.1).
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

const revenusColumns: Column<RevenusRow>[] = [
  { key: 'raison_sociale', header: 'Organisation', sortable: true },
  {
    key: 'type_organisation',
    header: 'Type',
    sortable: true,
    render: (r) => r.type_label,
  },
  { key: 'nb_zd', header: 'Nb ZD', sortable: true },
  {
    key: 'montant_zd_ht',
    header: 'CA ZD HT',
    sortable: true,
    render: (r) => <span className="font-medium">{euro(r.montant_zd_ht)}</span>,
  },
  { key: 'nb_ag', header: 'Nb AG', sortable: true },
  {
    key: 'montant_ag_ht',
    header: 'CA AG HT',
    sortable: true,
    render: (r) => <span className="font-medium">{euro(r.montant_ag_ht)}</span>,
  },
];

export default function DashboardAdminPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [revenus, setRevenus] = useState<RevenusRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingKpi, setLoadingKpi] = useState(true);
  const [loadingRevenus, setLoadingRevenus] = useState(true);

  const [periode, setPeriode] = useState(currentMonth);
  const [sortKey, setSortKey] = useState<string>('montant_total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Histogramme 12 mois glissants (§11 §1.1) — période propre, indépendante du tableau.
  const histo = (() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 11, 1)
        .toISOString()
        .slice(0, 10),
      to: now.toISOString().slice(0, 10),
    };
  })();

  useEffect(() => {
    fetch('/api/v1/admin/dashboard/kpi')
      .then((r) => r.json())
      .then((d: KpiData) => setKpi(d))
      .finally(() => setLoadingKpi(false));
  }, []);

  const revenusQs = useCallback(
    (extra?: Record<string, string>) => {
      const qs = new URLSearchParams({
        from: periode.from,
        to: periode.to,
        sort: sortKey,
        dir: sortDir,
        page: String(page),
        ...extra,
      });
      return qs.toString();
    },
    [periode, sortKey, sortDir, page],
  );

  useEffect(() => {
    setLoadingRevenus(true);
    fetch(`/api/v1/admin/dashboard/revenus-organisations?${revenusQs()}`)
      .then((r) => r.json())
      .then((d: { data?: RevenusRow[]; total?: number }) => {
        setRevenus(d.data ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => setLoadingRevenus(false));
  }, [revenusQs]);

  const handleSort = (key: string, direction: 'asc' | 'desc') => {
    setSortKey(key);
    setSortDir(direction);
    setPage(1);
  };

  const exportCsv = async () => {
    const res = await fetch(
      `/api/v1/admin/dashboard/revenus-organisations?${revenusQs({ format: 'csv' })}`,
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenus-organisations_${periode.from}_${periode.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-savr-neutral-600" />
        <h1 className="text-2xl font-bold text-savr-neutral-900">
          Dashboard Admin
        </h1>
      </div>

      {/* Bloc 1 — KPIs opérationnels */}
      <section>
        <h2 className="text-lg font-semibold text-savr-neutral-700 mb-4">
          Suivi opérationnel
        </h2>
        {loadingKpi ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : kpi ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              label="Non transmises ZD"
              value={kpi.non_transmises_zd}
              icon={<AlertTriangle />}
              className={
                kpi.non_transmises_zd > 0 ? 'border-savr-warning-300' : ''
              }
            />
            <StatCard
              label="Non transmises AG"
              value={kpi.non_transmises_ag}
              icon={<AlertTriangle />}
              className={
                kpi.non_transmises_ag > 0 ? 'border-savr-warning-300' : ''
              }
            />
            <StatCard
              label="Attente prestataire"
              value={kpi.attente_prestataire}
              icon={<Clock />}
            />
            <StatCard
              label="Dirty TMS"
              value={kpi.dirty_tms}
              icon={<RefreshCw />}
              className={kpi.dirty_tms > 0 ? 'border-savr-error-300' : ''}
            />
            <StatCard
              label="ZD dans 48h"
              value={kpi.zd_48h}
              icon={<Zap />}
              className={kpi.zd_48h > 0 ? 'border-savr-primary-300' : ''}
            />
            <StatCard
              label="AG dans 48h"
              value={kpi.ag_48h}
              icon={<Zap />}
              className={kpi.ag_48h > 0 ? 'border-savr-primary-300' : ''}
            />
          </div>
        ) : null}
      </section>

      {/* Bloc 2 — Revenus (histogramme 12 mois + tableau par organisation) */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-savr-neutral-700">Revenus</h2>

        {/* Histogramme 12 mois glissants (§11 §1.1) */}
        <Card className="p-4">
          <RevenusHistogramme from={histo.from} to={histo.to} />
        </Card>

        {/* Tableau « Revenus par organisation » */}
        <div
          className="flex flex-wrap items-end justify-between gap-3"
          data-testid="revenus-orgs-controls"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-savr-neutral-600">
              Du
              <input
                type="date"
                value={periode.from}
                onChange={(e) => {
                  setPeriode((p) => ({ ...p, from: e.target.value }));
                  setPage(1);
                }}
                className="ml-1 rounded border border-savr-neutral-300 px-2 py-1 text-sm"
                data-testid="revenus-from"
              />
            </label>
            <label className="text-xs text-savr-neutral-600">
              au
              <input
                type="date"
                value={periode.to}
                onChange={(e) => {
                  setPeriode((p) => ({ ...p, to: e.target.value }));
                  setPage(1);
                }}
                className="ml-1 rounded border border-savr-neutral-300 px-2 py-1 text-sm"
                data-testid="revenus-to"
              />
            </label>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            data-testid="revenus-export-csv"
          >
            <Download className="mr-1 h-4 w-4" />
            Exporter CSV
          </Button>
        </div>

        <Card>
          {loadingRevenus ? (
            <div className="p-6 space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : revenus.length === 0 ? (
            <p className="p-6 text-sm text-savr-neutral-500">
              Aucune donnée sur la période.
            </p>
          ) : (
            <>
              <DataTable
                columns={revenusColumns}
                data={revenus}
                keyExtractor={(row) => row.organisation_id}
                onSort={handleSort}
                sortKey={sortKey}
                sortDirection={sortDir}
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-savr-neutral-100 p-3 text-sm">
                  <span className="text-savr-neutral-500">
                    {total} organisation{total > 1 ? 's' : ''} · page {page}/
                    {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Précédent
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
