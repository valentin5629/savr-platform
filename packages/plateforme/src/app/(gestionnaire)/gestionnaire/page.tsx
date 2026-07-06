'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  KpiCard,
  BenchmarkGauge,
  BenchmarkFilterBar,
  TonnageDisplay,
  EmptyDashboardState,
  type CollecteType,
  type DashboardFilters,
  type BenchmarkFilters,
} from '@/components/dashboards/index.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface KpiData {
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  kg_par_pax: number | null;
  nb_repas_donnes: number | null;
  pax_total: number | null;
  repas_par_pax: number | null;
}

interface PackActif {
  id: string;
  nb_collectes_total: number;
  nb_collectes_restantes: number;
  statut: string;
}

const FLUX_ZD = [
  { code: 'biodechet', label: 'Biodéchets' },
  { code: 'emballage', label: 'Emballages' },
  { code: 'carton', label: 'Cartons' },
  { code: 'verre', label: 'Verre' },
  { code: 'dechet_residuel', label: 'Déchet résiduel' },
];

export default function GestionnaireDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  // kg/pax du gestionnaire PAR FLUX (jauge §06.05 Bloc 3 : chaque flux comparé à
  // son propre point rouge benchmark).
  const [perFlux, setPerFlux] = useState<Record<string, number>>({});
  const [pack, setPack] = useState<PackActif | null>(null);
  const [loading, setLoading] = useState(true);
  // Filtres de l'encart benchmark (§06.05 Bloc 3) — pilotent le point rouge.
  const [benchmarkFilters, setBenchmarkFilters] =
    useState<BenchmarkFilters | null>(null);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);
  const handleBenchmarkFilters = useCallback(
    (f: BenchmarkFilters) => setBenchmarkFilters(f),
    [],
  );

  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    fetch(`/api/v1/gestionnaire/dashboard?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        // §06.05 Bloc 1 — la route renvoie `data.kpis` (pluriel). Lire `kpi`
        // (singulier) laissait toujours kpi=null → EmptyState systématique
        // (BL-P1-GEST-03).
        setKpi((j.data?.kpis ?? null) as KpiData | null);
        setPerFlux(
          (j.data?.kg_par_pax_par_flux ?? {}) as Record<string, number>,
        );
        setPack((j.data?.pack ?? null) as PackActif | null);
      })
      .finally(() => setLoading(false));
  }, [filters, tab]);

  const packEpuise = pack && pack.nb_collectes_restantes === 0;
  const packBas =
    pack &&
    !packEpuise &&
    pack.nb_collectes_restantes <= 0.1 * pack.nb_collectes_total;

  return (
    <div className="space-y-6" data-testid="gestionnaire-dashboard">
      {/* §06.05 — bouton primaire « Programmer un événement » en bandeau
          actions rapides (parcours métier principal du gestionnaire,
          parité §06.04 traiteur/agence — BL-P1-GEST-01). */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Dashboard</h1>
        <Button asChild>
          <a href="/programmer/nouveau">Programmer un événement</a>
        </Button>
      </div>

      <DashboardFilterBar
        storageKey="gestionnaire-dashboard"
        onChange={handleFilters}
      />
      <CollecteTypeTabs value={tab} onChange={setTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : !kpi || kpi.nb_collectes === 0 ? (
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

          {tab === 'zero_dechet' ? (
            <Card>
              <CardHeader>
                <CardTitle>Performance vs benchmark parc (kg/pax)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Encart « Filtres benchmark » — l'utilisateur choisit le
                    périmètre du point rouge (§06.05 Bloc 3). */}
                <BenchmarkFilterBar onChange={handleBenchmarkFilters} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                  {FLUX_ZD.map((f) => (
                    <BenchmarkGauge
                      key={f.code}
                      bracket="M"
                      fluxCode={f.code}
                      label={f.label}
                      myKgPax={perFlux[f.code] ?? null}
                      benchmarkFilters={benchmarkFilters ?? undefined}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            pack && (
              <Card data-testid="bloc-pack-ag">
                <CardHeader>
                  <CardTitle>Mon pack Anti-Gaspi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">
                    Crédits restants :{' '}
                    <strong>{pack.nb_collectes_restantes}</strong> /{' '}
                    {pack.nb_collectes_total}
                  </p>
                  {packEpuise && <Badge variant="error">Pack épuisé</Badge>}
                  {packBas && (
                    <Badge variant="warning">Pack bientôt épuisé</Badge>
                  )}
                  <p className="text-sm text-savr-neutral-500">
                    Contactez votre responsable Savr pour renouveler votre pack.
                  </p>
                </CardContent>
              </Card>
            )
          )}
        </>
      )}
    </div>
  );
}
