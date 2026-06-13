'use client';

import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  AlertTriangle,
  Clock,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/ui/data-table';

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
  total_ht: number;
}

const revenusColumns: Column<RevenusRow>[] = [
  { key: 'raison_sociale', header: 'Organisation' },
  {
    key: 'total_ht',
    header: 'CA HT',
    render: (row) => (
      <span className="font-medium">
        {row.total_ht.toLocaleString('fr-FR', {
          style: 'currency',
          currency: 'EUR',
        })}
      </span>
    ),
  },
];

export default function DashboardAdminPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [revenus, setRevenus] = useState<RevenusRow[]>([]);
  const [loadingKpi, setLoadingKpi] = useState(true);
  const [loadingRevenus, setLoadingRevenus] = useState(true);

  useEffect(() => {
    fetch('/api/v1/admin/dashboard/kpi')
      .then((r) => r.json())
      .then((d: KpiData) => setKpi(d))
      .finally(() => setLoadingKpi(false));

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1)
      .toISOString()
      .slice(0, 10);
    fetch(`/api/v1/admin/dashboard/revenus-organisations?from=${from}`)
      .then((r) => r.json())
      .then((d: { data: RevenusRow[] }) => setRevenus(d.data))
      .finally(() => setLoadingRevenus(false));
  }, []);

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

      {/* Bloc 2 — Revenus par organisation */}
      <section>
        <h2 className="text-lg font-semibold text-savr-neutral-700 mb-4">
          Revenus par organisation (12 derniers mois)
        </h2>
        <Card>
          {loadingRevenus ? (
            <div className="p-6 space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : revenus.length === 0 ? (
            <p className="p-6 text-sm text-savr-neutral-500">
              Aucune donnée de facturation disponible.
            </p>
          ) : (
            <DataTable
              columns={revenusColumns}
              data={revenus}
              keyExtractor={(row) => row.organisation_id}
            />
          )}
        </Card>
      </section>
    </div>
  );
}
