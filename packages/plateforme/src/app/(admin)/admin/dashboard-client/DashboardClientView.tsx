'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  KpiCard,
  BenchmarkGauge,
  TonnageDisplay,
  EmptyDashboardState,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  OrganisationSelector,
  type OrganisationOption,
} from './OrganisationSelector.js';

interface KpiData {
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  kg_par_pax: number | null;
  nb_repas_donnes: number | null;
  pax_total: number | null;
  repas_par_pax: number | null;
}

const STORAGE_KEY = 'savr.dashboard-client.organisations';
const BENCHMARK_ENDPOINT = '/api/v1/admin/dashboard-client/benchmark';

const FLUX_ZD = [
  { code: 'biodechet', label: 'Biodéchets' },
  { code: 'emballage', label: 'Emballages' },
  { code: 'carton', label: 'Cartons' },
  { code: 'verre', label: 'Verre' },
  { code: 'dechet_residuel', label: 'Déchet résiduel' },
];

/**
 * Dashboard Client (§06.06 §2) — vue Admin LECTURE SEULE répliquant le dashboard
 * gestionnaire (§06.05), agrégée sur le périmètre d'organisations sélectionné.
 * « Toutes les organisations » (défaut) = totalité des collectes Savr.
 * La sélection est persistée/restaurée via localStorage. Aucune écriture.
 */
export function DashboardClientView() {
  const [organisations, setOrganisations] = useState<OrganisationOption[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const hydrated = useRef(false);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);

  // Liste des organisations pour le sélecteur.
  useEffect(() => {
    fetch('/api/v1/admin/dashboard-client/organisations')
      .then((r) => r.json())
      .then((j: { data?: OrganisationOption[] }) =>
        setOrganisations(j.data ?? []),
      )
      .catch(() => setOrganisations([]));
  }, []);

  // Restauration de la sélection depuis localStorage (au mount).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          setSelectedOrgs(
            arr.filter((x): x is string => typeof x === 'string'),
          );
        }
      }
    } catch {
      // ignore
    }
    hydrated.current = true;
  }, []);

  // Persistance de la sélection (après hydratation, pour ne pas écraser au mount).
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedOrgs));
    } catch {
      // ignore
    }
  }, [selectedOrgs]);

  // Chargement des KPI agrégés sur le périmètre.
  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      type: tab,
      from: filters.from,
      to: filters.to,
    });
    for (const id of selectedOrgs) qs.append('organisation_ids[]', id);

    fetch(`/api/v1/admin/dashboard-client?${qs.toString()}`)
      .then((r) => r.json())
      .then((j: { data?: { kpi?: KpiData } }) => setKpi(j.data?.kpi ?? null))
      .catch(() => setKpi(null))
      .finally(() => setLoading(false));
  }, [filters, tab, selectedOrgs]);

  const isEmpty = !kpi || kpi.nb_collectes === 0;

  return (
    <div className="space-y-6" data-testid="dashboard-client">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Dashboard Client
          </h1>
        </div>
        <Badge variant="info" data-testid="lecture-seule-badge">
          Lecture seule
        </Badge>
      </div>

      <OrganisationSelector
        organisations={organisations}
        selected={selectedOrgs}
        onChange={setSelectedOrgs}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardFilterBar
          storageKey="savr.dashboard-client.filters"
          onChange={handleFilters}
        />
        <CollecteTypeTabs value={tab} onChange={setTab} />
      </div>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : isEmpty ? (
        <EmptyDashboardState />
      ) : (
        <>
          {tab === 'zero_dechet' ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Nombre de collectes" value={kpi.nb_collectes} />
              <KpiCard
                label="Tonnage collecté"
                value={<TonnageDisplay kg={kpi.tonnage_kg ?? 0} />}
              />
              <KpiCard
                label="Taux de recyclage"
                value={
                  kpi.taux_recyclage_pondere != null
                    ? `${kpi.taux_recyclage_pondere.toFixed(1)} %`
                    : '—'
                }
              />
              <KpiCard
                label="kg/pax moyen"
                value={kpi.kg_par_pax != null ? kpi.kg_par_pax.toFixed(2) : '—'}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Nombre de collectes" value={kpi.nb_collectes} />
              <KpiCard label="Repas donnés" value={kpi.nb_repas_donnes ?? 0} />
              <KpiCard label="Pax cumulés" value={kpi.pax_total ?? 0} />
              <KpiCard
                label="Repas/pax moyen"
                value={
                  kpi.repas_par_pax != null ? kpi.repas_par_pax.toFixed(2) : '—'
                }
              />
            </div>
          )}

          {tab === 'zero_dechet' && (
            <Card>
              <CardHeader>
                <CardTitle>Performance vs benchmark parc (kg/pax)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                {FLUX_ZD.map((f) => (
                  <BenchmarkGauge
                    key={f.code}
                    bracket="M"
                    fluxCode={f.code}
                    myKgPax={kpi.kg_par_pax}
                    endpoint={BENCHMARK_ENDPOINT}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
