'use client';

import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilterChips } from '@/components/ui/filter-chips';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { RevenusHistogramme } from '@/components/dashboards/index.js';
// Librairie data-viz « Cockpit » (R24) — importée EN DIRECT (hors barrel
// components/dashboards → aucun impact sur le gate orphan-components).
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { ChartCard } from '@/components/dashboards/charts/cockpit/ChartCard';
import { fmtInt } from '@/components/dashboards/charts/cockpit/fmt';

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

// Pastilles couleur des KPI opérationnels (cockpit R24, palette data-viz DS §2.4 /
// sémantique §10). La pastille encode la SÉVÉRITÉ (à traiter / à jour), le badge de
// pied la reformule en clair — remplace l'ancien code couleur porté par la bordure.
const OPS_DOT = {
  warn: '#d97706', // warning
  error: '#dc2626', // error
  success: '#16a34a', // success
  info: '#2563eb', // info
  neutral: '#9aa2b8', // neutral-400
  zd: '#16a34a', // Zéro déchet (vert)
  ag: '#ff9b00', // Anti-gaspi (orange)
};

// Badge d'état d'un KPI d'alerte : action requise si > 0, « À jour » sinon.
function badgeAlerte(
  v: number,
  variantActif: 'warning' | 'error',
  labelActif: string,
) {
  return v > 0 ? (
    <Badge variant={variantActif}>{labelActif}</Badge>
  ) : (
    <Badge variant="success">À jour</Badge>
  );
}

// Badge d'état d'un KPI de veille (échéances 48 h, attente prestataire) : bleu info
// si > 0, neutre sinon — pas d'alarme, juste un repère de charge à venir.
function badgeVeille(v: number, labelActif: string) {
  return v > 0 ? (
    <Badge variant="info">{labelActif}</Badge>
  ) : (
    <Badge variant="neutral">Aucune</Badge>
  );
}

// Champ date DS (§5.5) — bornes de période du tableau Revenus. Input natif stylé
// aux tokens savr-* (h-10, radius md, focus ring signature global), aligné sur le
// parti-pris DatePicker sans son icône superposée (redondante avec l'indicateur
// natif dans une barre de filtres dense).
const dateFieldClass =
  'h-10 rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm text-savr-neutral-900 hover:border-savr-primary-400';

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

// Presets de période (BL-P3-02) — liste CDC §06.04 l.73 / §06.05 l.105.
type PresetKey = '7j' | '30j' | 'trimestre' | '12m' | 'civile';
const DASHBOARD_PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7j', label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: 'trimestre', label: 'Trimestre en cours' },
  { key: '12m', label: '12 derniers mois' },
  { key: 'civile', label: 'Année civile' },
];
function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (key === 'trimestre')
    return {
      from: iso(
        new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
      ),
      to: iso(now),
    };
  if (key === 'civile')
    return {
      from: `${now.getFullYear()}-01-01`,
      to: `${now.getFullYear()}-12-31`,
    };
  const from = new Date();
  if (key === '12m') from.setMonth(from.getMonth() - 12);
  else from.setDate(from.getDate() - (key === '7j' ? 7 : 30));
  return { from: iso(from), to: iso(now) };
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
  // Preset actif de la barre de période (`''` = plage personnalisée / réinitialisée).
  const [activePreset, setActivePreset] = useState<string>('');
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

  // Édition manuelle des bornes → aucun preset actif.
  const setBorne = (champ: 'from' | 'to', value: string) => {
    setPeriode((p) => ({ ...p, [champ]: value }));
    setActivePreset('');
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
        <LayoutDashboard className="h-6 w-6 text-savr-primary-700" />
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-savr-neutral-900">
          Dashboard Admin
        </h1>
      </div>

      {/* Bloc 1 — KPIs opérationnels (rangée cockpit R24) */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-savr-neutral-700">
          Suivi opérationnel
        </h2>
        {loadingKpi ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-savr-lg" />
            ))}
          </div>
        ) : kpi ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {/* Chaque carte est un lien vers la liste Collectes filtrée sur le
                MÊME prédicat que le compteur (miroir exact, §11 §1.1) — chip
                partagé lib/collectes-chips. */}
            <KpiCockpitCard
              label="Non transmises ZD"
              value={fmtInt(kpi.non_transmises_zd)}
              href="/admin/collectes?chip=non_transmises_zd"
              dotColor={
                kpi.non_transmises_zd > 0 ? OPS_DOT.warn : OPS_DOT.success
              }
              footer={badgeAlerte(
                kpi.non_transmises_zd,
                'warning',
                'À traiter',
              )}
            />
            <KpiCockpitCard
              label="Non transmises AG"
              value={fmtInt(kpi.non_transmises_ag)}
              href="/admin/collectes?chip=non_transmises_ag"
              dotColor={
                kpi.non_transmises_ag > 0 ? OPS_DOT.warn : OPS_DOT.success
              }
              footer={badgeAlerte(
                kpi.non_transmises_ag,
                'warning',
                'À traiter',
              )}
            />
            <KpiCockpitCard
              label="Attente prestataire"
              value={fmtInt(kpi.attente_prestataire)}
              href="/admin/collectes?chip=attente_prestataire"
              dotColor={
                kpi.attente_prestataire > 0 ? OPS_DOT.info : OPS_DOT.neutral
              }
              footer={badgeVeille(kpi.attente_prestataire, 'En cours')}
            />
            <KpiCockpitCard
              label="Dirty TMS"
              value={fmtInt(kpi.dirty_tms)}
              href="/admin/collectes?chip=dirty_tms"
              dotColor={kpi.dirty_tms > 0 ? OPS_DOT.error : OPS_DOT.success}
              footer={badgeAlerte(kpi.dirty_tms, 'error', 'À resynchroniser')}
            />
            <KpiCockpitCard
              label="ZD dans 48h"
              value={fmtInt(kpi.zd_48h)}
              href="/admin/collectes?chip=zd_48h"
              dotColor={OPS_DOT.zd}
              footer={badgeVeille(kpi.zd_48h, 'À anticiper')}
            />
            <KpiCockpitCard
              label="AG dans 48h"
              value={fmtInt(kpi.ag_48h)}
              href="/admin/collectes?chip=ag_48h"
              dotColor={OPS_DOT.ag}
              footer={badgeVeille(kpi.ag_48h, 'À anticiper')}
            />
          </div>
        ) : null}
      </section>

      {/* Bloc 2 — Revenus (histogramme 12 mois + tableau par organisation) */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-savr-neutral-700">Revenus</h2>

        {/* Histogramme 12 mois glissants (§11 §1.1) — surface graphe DS */}
        <ChartCard>
          <RevenusHistogramme from={histo.from} to={histo.to} />
        </ChartCard>

        {/* Tableau « Revenus par organisation » — barre de période DS */}
        <div className="space-y-3" data-testid="revenus-orgs-controls">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="revenus-from"
                  className="block text-xs font-medium text-savr-neutral-600"
                >
                  Du
                </label>
                <input
                  id="revenus-from"
                  type="date"
                  value={periode.from}
                  max={periode.to}
                  onChange={(e) => setBorne('from', e.target.value)}
                  aria-label="Date de début"
                  data-testid="revenus-from"
                  className={dateFieldClass}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="revenus-to"
                  className="block text-xs font-medium text-savr-neutral-600"
                >
                  au
                </label>
                <input
                  id="revenus-to"
                  type="date"
                  value={periode.to}
                  min={periode.from}
                  onChange={(e) => setBorne('to', e.target.value)}
                  aria-label="Date de fin"
                  data-testid="revenus-to"
                  className={dateFieldClass}
                />
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              data-testid="revenus-export-csv"
            >
              <Download className="h-4 w-4" />
              Exporter CSV
            </Button>
          </div>

          {/* Presets + Réinitialiser (BL-P3-02) */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              ariaLabel="Période prédéfinie"
              chips={DASHBOARD_PRESETS.map((p) => ({
                key: p.key,
                label: p.label,
              }))}
              activeKey={activePreset}
              onSelect={(k) => {
                setPeriode(presetRange(k as PresetKey));
                setActivePreset(k);
                setPage(1);
              }}
            />
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setPeriode(currentMonth());
                setActivePreset('');
                setPage(1);
              }}
              data-testid="revenus-reinitialiser"
            >
              Réinitialiser
            </Button>
          </div>
        </div>

        <Card>
          {loadingRevenus ? (
            <div className="space-y-2 p-6">
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
                    {total} organisation{total > 1 ? 's' : ''}
                  </span>
                  {/* Pagination DS (BL-P3-07) — remplace le footer Précédent/Suivant maison. */}
                  <Pagination
                    page={page}
                    pageCount={totalPages}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
