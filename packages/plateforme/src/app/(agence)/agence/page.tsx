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
  ProchainesCollectesBloc,
  TopLieuxBloc,
  TopAssociationsBloc,
  FLUX_ZD,
  useEvolutionBlocs,
  type CollecteType,
  type DashboardFilters,
  type BenchmarkFilters,
  type BlocsData,
} from '@/components/dashboards/index.js';
import {
  EvolutionFluxChart,
  EvolutionRepasChart,
  TonnagesDonut,
} from '@/components/dashboards/charts/lazy.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// §06.11 diff #7 — pas de carte « Marge générée » : marge_zd_ht n'est pas exposé
// par l'API pour le rôle agence (strip serveur dans /api/v1/dashboards/kpi-traiteur).
interface KpiRow {
  mois: string;
  type_collecte: CollecteType;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  nb_repas_donnes: number | null;
  pax_total: number;
}

export default function AgenceDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [pack, setPack] = useState<{
    pack_actif: boolean;
    credits_initiaux?: number;
    credits_restants?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // Blocs §11 partagés (5 prochaines / 6 top lieux / 3 AG associations + kg/pax
  // par flux). Bloc 7 « Top 5 commerciaux » RETIRÉ côté agence (§06.11 diff #8).
  const [blocs, setBlocs] = useState<BlocsData | null>(null);
  const [benchmarkFilters, setBenchmarkFilters] =
    useState<BenchmarkFilters | null>(null);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);
  const handleBenchmarkFilters = useCallback(
    (f: BenchmarkFilters) => setBenchmarkFilters(f),
    [],
  );

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
    if (tab !== 'anti_gaspi') return;
    fetch('/api/v1/programmation/pack-ag')
      .then((r) => r.json())
      .then((j) => setPack(j));
  }, [tab]);

  // Blocs 5/6/3AG + kg/pax par flux (§11) — endpoint partagé, périmètre org.
  useEffect(() => {
    if (!filters) return;
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    fetch(`/api/v1/dashboards/blocs?${qs}`)
      .then((r) => r.json())
      .then((j) => setBlocs((j.data ?? null) as BlocsData | null))
      .catch(() => setBlocs(null));
  }, [filters, tab]);

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
    <div className="space-y-6" data-testid="agence-dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Dashboard</h1>
        <Button asChild>
          <a href="/programmer/nouveau">Programmer un événement</a>
        </Button>
      </div>

      <DashboardFilterBar
        storageKey="agence-dashboard"
        onChange={handleFilters}
      />
      <CollecteTypeTabs value={tab} onChange={setTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : (
        <>
          {/* Bloc 1 — KPIs (ZD : 4 cartes sans Marge — diff #7) */}
          {tab === 'zero_dechet' ? (
            <div
              className="grid grid-cols-2 gap-4 lg:grid-cols-4"
              data-testid="agence-kpi-zd"
            >
              <KpiCard
                label="Nombre de collectes"
                value={nbCollectes}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="Tonnage collecté"
                value={<TonnageDisplay kg={tonnage} />}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="Taux de recyclage"
                value={taux != null ? `${taux.toFixed(1)} %` : '—'}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="kg/pax moyen"
                value={kgPax != null ? kgPax.toFixed(2) : '—'}
                href={`/agence/collectes${qsLink}`}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard
                label="Nombre de collectes"
                value={nbCollectes}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="Repas donnés"
                value={repas}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="Pax cumulés"
                value={pax}
                href={`/agence/collectes${qsLink}`}
              />
              <KpiCard
                label="Repas/pax moyen"
                value={pax > 0 ? (repas / pax).toFixed(2) : '—'}
                href={`/agence/collectes${qsLink}`}
              />
            </div>
          )}

          {/* Bloc 2 — Évolution mensuelle (§06.11 hérite §06.04 Bloc 2) */}
          <Card data-testid="bloc-2-agence">
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

          {/* Bloc 3 ZD — jauges benchmark parc (4 dimensions §06.04, réplique
              stricte §06.11) / Bloc 3 AG — Top associations bénéficiaires */}
          {tab === 'zero_dechet' ? (
            <Card>
              <CardHeader>
                <CardTitle>Performance vs benchmark parc (kg/pax)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Encart benchmark 4 dimensions — Traiteurs masqué (endpoint
                    /filtres renvoie liste vide, traiteur_ids[] rejeté serveur). */}
                <BenchmarkFilterBar
                  onChange={handleBenchmarkFilters}
                  initialTypeEvenementIds={filters?.type_evenement_ids ?? []}
                  initialTailleCodes={filters?.taille_evenement_codes ?? []}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                  {FLUX_ZD.map((f) => (
                    <BenchmarkGauge
                      key={f.code}
                      bracket="M"
                      fluxCode={f.code}
                      label={f.label}
                      myKgPax={blocs?.kgParPaxParFlux[f.code] ?? null}
                      benchmarkFilters={benchmarkFilters ?? undefined}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <TopAssociationsBloc items={blocs?.topAssociations ?? []} />
          )}

          {/* Bloc 4 ZD — Répartition des tonnages (donut) /
              Bloc 4 AG — Mon pack Anti-Gaspi (§06.11 hérite §06.04) */}
          {tab === 'zero_dechet' ? (
            <Card data-testid="bloc-4-agence">
              <CardHeader>
                <CardTitle>Répartition des tonnages</CardTitle>
              </CardHeader>
              <CardContent>
                <TonnagesDonut series={zdSeries} />
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
                  {/* §06.11 l.44 — onglet AG identique au §06.04 : bouton
                      « Demander un renouvellement » (BL-P1-AGENCE-01), actif
                      dès solde ≤ 10 % ou = 0 (§06.04 l.242). Endpoint partagé. */}
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

          {/* Bloc 5 — Prochaines collectes (§06.11 hérite §06.04 Bloc 5) */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            hrefFor={(c) => `/agence/collectes/${c.id}`}
          />

          {/* Bloc 6 — Top 5 lieux (§06.11 hérite §06.04 Bloc 6) */}
          <TopLieuxBloc items={blocs?.topLieux ?? []} type={tab} />

          {/* Bloc 7 « Top 5 commerciaux » RETIRÉ côté agence (§06.11 diff #8,
              F1 2026-06-07 — RLS users agence = self). Non monté. */}

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
