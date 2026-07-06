'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  KpiCard,
  BenchmarkGauge,
  TonnageDisplay,
  EmptyDashboardState,
  FLUX_ZD,
  useEvolutionBlocs,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import {
  EvolutionFluxChart,
  EvolutionRepasChart,
  TonnagesDonut,
} from '@/components/dashboards/charts/lazy.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface KpiRow {
  mois: string;
  type_collecte: CollecteType;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  nb_repas_donnes: number | null;
  marge_zd_ht: number | null;
  pax_total: number;
}

function formatEuro(v: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export default function TraiteurDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [nbAttente, setNbAttente] = useState(0);
  const [pack, setPack] = useState<{
    pack_actif: boolean;
    credits_initiaux?: number;
    credits_restants?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);

  // Bloc 2 (évolution) + Bloc 4 (donut) — série partagée §11 par onglet actif.
  const { granularite, zdSeries, agSeries } = useEvolutionBlocs(filters, tab);

  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    fetch(`/api/v1/dashboards/kpi-traiteur?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as KpiRow[]))
      .finally(() => setLoading(false));
  }, [filters, tab]);

  useEffect(() => {
    if (!filters || tab !== 'zero_dechet') return;
    const qs = new URLSearchParams({ from: filters.from, to: filters.to });
    fetch(`/api/v1/traiteur/marge-attente-facturation?${qs}`)
      .then((r) => r.json())
      .then((j) => setNbAttente(j.data?.nb_en_attente ?? 0));
  }, [filters, tab]);

  useEffect(() => {
    if (tab !== 'anti_gaspi') return;
    fetch('/api/v1/programmation/pack-ag')
      .then((r) => r.json())
      .then((j) => setPack(j));
  }, [tab]);

  // Agrégats sur la période filtrée
  const nbCollectes = rows.reduce((s, r) => s + (r.nb_collectes ?? 0), 0);
  const tonnage = rows.reduce((s, r) => s + (r.tonnage_kg ?? 0), 0);
  const pax = rows.reduce((s, r) => s + (r.pax_total ?? 0), 0);
  const repas = rows.reduce((s, r) => s + (r.nb_repas_donnes ?? 0), 0);
  const tauxNum = rows.reduce(
    (s, r) => s + (r.taux_recyclage_pondere ?? 0) * (r.tonnage_kg ?? 0),
    0,
  );
  const tauxDen = rows.reduce(
    (s, r) => s + (r.taux_recyclage_pondere != null ? (r.tonnage_kg ?? 0) : 0),
    0,
  );
  const taux = tauxDen > 0 ? tauxNum / tauxDen : null;
  const kgPax = pax > 0 ? tonnage / pax : null;
  const margeRows = rows.filter((r) => r.marge_zd_ht != null);
  const marge =
    margeRows.length > 0
      ? margeRows.reduce((s, r) => s + (r.marge_zd_ht ?? 0), 0)
      : null;

  const seuilBas =
    pack?.pack_actif &&
    pack.credits_initiaux != null &&
    pack.credits_restants != null &&
    pack.credits_restants <= 0.1 * pack.credits_initiaux;
  const packEpuise = pack?.pack_actif && pack.credits_restants === 0;

  const qsLink = filters
    ? `?from=${filters.from}&to=${filters.to}&type=${tab}`
    : '';

  return (
    <div className="space-y-6" data-testid="traiteur-dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Dashboard</h1>
        <Button asChild>
          <a href="/programmer/nouveau">Programmer un événement</a>
        </Button>
      </div>

      <DashboardFilterBar
        storageKey="traiteur-dashboard"
        onChange={handleFilters}
      />
      <CollecteTypeTabs value={tab} onChange={setTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : (
        <>
          {/* Bloc 1 — KPIs */}
          {tab === 'zero_dechet' ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiCard
                label="Nombre de collectes"
                value={nbCollectes}
                href={`/traiteur/collectes${qsLink}`}
              />
              <KpiCard
                label="Tonnage collecté"
                value={<TonnageDisplay kg={tonnage} />}
              />
              <KpiCard
                label="Taux de recyclage"
                value={taux != null ? `${taux.toFixed(1)} %` : '—'}
              />
              <KpiCard
                label="kg/pax moyen"
                value={kgPax != null ? kgPax.toFixed(2) : '—'}
              />
              <div>
                <KpiCard
                  label="Marge générée"
                  value={
                    marge == null
                      ? '—'
                      : marge < 0
                        ? `−${formatEuro(Math.abs(marge))} €`
                        : `${formatEuro(marge)} €`
                  }
                  className={
                    marge != null && marge < 0 ? 'text-savr-error' : ''
                  }
                />
                {nbAttente >= 1 && (
                  <Badge variant="info" className="mt-1">
                    {nbAttente} collecte{nbAttente > 1 ? 's' : ''} en attente de
                    facturation
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard
                label="Nombre de collectes"
                value={nbCollectes}
                href={`/traiteur/collectes${qsLink}`}
              />
              <KpiCard label="Repas donnés" value={repas} />
              <KpiCard label="Pax cumulés" value={pax} />
              <KpiCard
                label="Repas/pax moyen"
                value={pax > 0 ? (repas / pax).toFixed(2) : '—'}
              />
            </div>
          )}

          {/* Bloc 2 — Évolution mensuelle (§06.04 Bloc 2) */}
          <Card data-testid="bloc-2-traiteur">
            <CardHeader>
              <CardTitle>Évolution mensuelle</CardTitle>
            </CardHeader>
            <CardContent>
              {tab === 'zero_dechet' ? (
                <EvolutionFluxChart
                  series={zdSeries}
                  granularite={granularite}
                />
              ) : (
                <EvolutionRepasChart
                  series={agSeries}
                  granularite={granularite}
                />
              )}
            </CardContent>
          </Card>

          {/* Bloc 3 ZD — jauges benchmark / Bloc 4 AG — Mon pack AG */}
          {tab === 'zero_dechet' ? (
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
                    myKgPax={pax > 0 ? tonnage / pax / FLUX_ZD.length : null}
                  />
                ))}
              </CardContent>
            </Card>
          ) : (
            pack?.pack_actif && (
              <Card data-testid="bloc-pack-ag">
                <CardHeader>
                  <CardTitle>Mon pack Anti-Gaspi</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    Crédits restants : <strong>{pack.credits_restants}</strong>{' '}
                    / {pack.credits_initiaux}
                  </p>
                  {packEpuise && <Badge variant="error">Pack épuisé</Badge>}
                  {seuilBas && !packEpuise && (
                    <Badge variant="warning">Pack bientôt épuisé</Badge>
                  )}
                  <div>
                    <Button
                      disabled={!seuilBas && !packEpuise}
                      onClick={() =>
                        fetch('/api/v1/traiteur/pack-ag/renouvellement', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({}),
                        })
                      }
                    >
                      Demander un renouvellement
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          )}

          {/* Bloc 4 ZD — Répartition des tonnages (donut, §06.04 Bloc 4) */}
          {tab === 'zero_dechet' && (
            <Card data-testid="bloc-4-traiteur">
              <CardHeader>
                <CardTitle>Répartition des tonnages</CardTitle>
              </CardHeader>
              <CardContent>
                <TonnagesDonut series={zdSeries} />
              </CardContent>
            </Card>
          )}

          {/* Bloc 8 — Export synthèse PDF (mécanique complète : lot ⑫ V4) */}
          <div>
            <Button
              variant="ghost"
              disabled
              title="Disponible en V4 (Reporting)"
            >
              Exporter une synthèse PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
