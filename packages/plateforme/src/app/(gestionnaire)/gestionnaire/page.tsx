'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  BenchmarkFilterBar,
  EmptyDashboardState,
  ProchainesCollectesBloc,
  ExportSyntheseBloc,
  FLUX_ZD,
  useEvolutionBlocs,
  type CollecteType,
  type DashboardFilters,
  type BenchmarkFilters,
  type ParcFilterOptions,
  type BlocsData,
} from '@/components/dashboards/index.js';
// Librairie data-viz « Cockpit » (R24) — importée en direct (hors barrel).
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkBulletGauges } from '@/components/dashboards/charts/cockpit/BenchmarkBulletGauges';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import {
  fmtInt,
  fmtDec,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import {
  aggregateBenchmarkPerFlux,
  benchmarkItems,
  type BenchmarkRow,
} from '@/lib/dashboards/cockpit-derive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const DOT = {
  navy: '#223870',
  navy2: '#3F5599',
  green: '#16A34A',
  navy3: '#6379B6',
  accent: '#FF9B00',
};

function masseStr(kg: number): string {
  const m = fmtMasse(kg);
  return `${m.value} ${m.unit}`;
}

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

export default function GestionnaireDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [parcOptions, setParcOptions] = useState<ParcFilterOptions | undefined>(
    undefined,
  );
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [perFlux, setPerFlux] = useState<Record<string, number>>({});
  const [pack, setPack] = useState<PackActif | null>(null);
  const [loading, setLoading] = useState(true);
  const [benchmarkFilters, setBenchmarkFilters] =
    useState<BenchmarkFilters | null>(null);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [blocs, setBlocs] = useState<BlocsData | null>(null);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);
  const handleBenchmarkFilters = useCallback(
    (f: BenchmarkFilters) => setBenchmarkFilters(f),
    [],
  );

  // Bloc 2 (évolution) + Bloc 4 (donut) — série partagée §11, honore les filtres parc.
  const { granularite, zdSeries, agSeries } = useEvolutionBlocs(filters, tab);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/filtres')
      .then((r) => r.json())
      .then((j: { data?: ParcFilterOptions }) => {
        if (j.data) setParcOptions(j.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    (filters.lieu_ids ?? []).forEach((id) => qs.append('lieu_ids[]', id));
    (filters.traiteur_ids ?? []).forEach((id) =>
      qs.append('traiteur_ids[]', id),
    );
    (filters.type_evenement_ids ?? []).forEach((id) =>
      qs.append('type_evenement_ids[]', id),
    );
    (filters.taille_evenement_codes ?? []).forEach((c) =>
      qs.append('taille_evenements[]', c),
    );
    fetch(`/api/v1/gestionnaire/dashboard?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        setKpi((j.data?.kpis ?? null) as KpiData | null);
        setPerFlux(
          (j.data?.kg_par_pax_par_flux ?? {}) as Record<string, number>,
        );
        setPack((j.data?.pack ?? null) as PackActif | null);
      })
      .finally(() => setLoading(false));
  }, [filters, tab]);

  // Blocs 5/6/7/3AG (§11) — endpoint partagé, mêmes filtres globaux parc.
  useEffect(() => {
    if (!filters) return;
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    (filters.lieu_ids ?? []).forEach((id) => qs.append('lieu_ids[]', id));
    (filters.traiteur_ids ?? []).forEach((id) =>
      qs.append('traiteur_ids[]', id),
    );
    (filters.type_evenement_ids ?? []).forEach((id) =>
      qs.append('type_evenement_ids[]', id),
    );
    (filters.taille_evenement_codes ?? []).forEach((c) =>
      qs.append('taille_evenements[]', c),
    );
    fetch(`/api/v1/dashboards/blocs?${qs}`)
      .then((r) => r.json())
      .then((j) => setBlocs((j.data ?? null) as BlocsData | null))
      .catch(() => setBlocs(null));
  }, [filters, tab]);

  // Benchmark parc (Bloc 3 ZD) — 5 dimensions gestionnaire (traiteurs AUTORISÉ,
  // §06.05, contrairement au traiteur/agence où traiteur_ids est rejeté).
  useEffect(() => {
    if (tab !== 'zero_dechet' || !benchmarkFilters) {
      setBenchmarkRows([]);
      return;
    }
    const f = benchmarkFilters;
    const p = new URLSearchParams();
    if (f.taille_evenement_codes.length)
      p.set('taille_evenement_codes', f.taille_evenement_codes.join(','));
    if (f.type_evenement_ids.length)
      p.set('type_evenement_ids', f.type_evenement_ids.join(','));
    if (f.lieu_ids.length) p.set('lieu_ids', f.lieu_ids.join(','));
    if (f.traiteur_ids.length) p.set('traiteur_ids', f.traiteur_ids.join(','));
    if (f.periode_debut) p.set('periode_debut', f.periode_debut);
    if (f.periode_fin) p.set('periode_fin', f.periode_fin);
    fetch(`/api/v1/dashboards/benchmark?${p}`)
      .then((r) => r.json())
      .then((j) => setBenchmarkRows((j.data ?? []) as BenchmarkRow[]))
      .catch(() => setBenchmarkRows([]));
  }, [benchmarkFilters, tab]);

  const packEpuise = pack && pack.nb_collectes_restantes === 0;
  const packBas =
    pack &&
    !packEpuise &&
    pack.nb_collectes_restantes <= 0.1 * pack.nb_collectes_total;

  // ── Top listes (Cockpit) — colonnes §06.05 préservées via `secondary`. ──
  const nbColl = (n: number) => `${fmtInt(n)} collecte${n > 1 ? 's' : ''}`;
  const tauxStr = (t: number | null) =>
    t != null ? `${fmtDec(t, 1)} % recyclage` : 'taux n/d';
  const repasPaxStr = (r: number | null) =>
    r != null ? `${fmtDec(r, 2)} repas/pax` : 'repas/pax n/d';
  const topLieuxItems = (blocs?.topLieux ?? []).map((l) =>
    tab === 'zero_dechet'
      ? {
          label: l.lieu_nom,
          raw: l.tonnage_kg ?? 0,
          value: masseStr(l.tonnage_kg ?? 0),
          secondary: `${nbColl(l.nb_collectes)} · ${tauxStr(l.taux_recyclage)}`,
        }
      : {
          label: l.lieu_nom,
          raw: l.repas_donnes ?? 0,
          value: `${fmtInt(l.repas_donnes ?? 0)} repas`,
          secondary: `${nbColl(l.nb_collectes)} · ${repasPaxStr(l.repas_par_pax)}`,
        },
  );
  const topActeursItems = (blocs?.topActeurs ?? []).map((a) => ({
    label: a.label,
    raw: a.nb_collectes,
    value: nbColl(a.nb_collectes),
    secondary:
      tab === 'zero_dechet'
        ? `${masseStr(a.tonnage_kg ?? 0)} · ${a.taux_recyclage != null ? `${fmtDec(a.taux_recyclage, 1)} %` : '—'}`
        : `${fmtInt(a.repas_donnes ?? 0)} repas · ${repasPaxStr(a.repas_par_pax)}`,
  }));
  const topAssociationsItems = (blocs?.topAssociations ?? []).map((a) => ({
    label: a.nom,
    raw: a.repas_recus,
    value: `${fmtInt(a.repas_recus)} repas`,
    secondary: `${a.ville ?? 'Ville n/d'} · ${nbColl(a.nb_collectes)}`,
  }));
  const withBars = <T extends { raw: number }>(
    items: T[],
  ): (T & { barPct: number })[] => {
    const max = Math.max(1, ...items.map((i) => i.raw));
    return items.map((i) => ({ ...i, barPct: (i.raw / max) * 100 }));
  };
  const acteurTitre =
    blocs?.acteurLabel === 'Commercial'
      ? 'Top 5 commerciaux'
      : 'Top 5 traiteurs';

  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    perFlux,
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

  return (
    <div className="space-y-6" data-testid="gestionnaire-dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Dashboard</h1>
        <Button asChild>
          <a href="/programmer/nouveau">Programmer un événement</a>
        </Button>
      </div>

      <DashboardFilterBar
        storageKey="gestionnaire-dashboard"
        onChange={handleFilters}
        parcOptions={parcOptions}
      />
      {!loading && kpi && (
        <p
          className="text-sm text-savr-neutral-500"
          data-testid="dashboard-collectes-count"
        >
          {kpi.nb_collectes} collecte{kpi.nb_collectes > 1 ? 's' : ''}{' '}
          correspond{kpi.nb_collectes > 1 ? 'ent' : ''}
        </p>
      )}
      <CollecteTypeTabs value={tab} onChange={setTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : !kpi || kpi.nb_collectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (non cliquables, décision Val 2026-07-10) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(kpi.nb_collectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Tonnage collecté"
              value={fmtMasse(kpi.tonnage_kg ?? 0).value}
              unit={fmtMasse(kpi.tonnage_kg ?? 0).unit}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Taux de recyclage"
              value={
                kpi.taux_recyclage_pondere != null
                  ? fmtDec(kpi.taux_recyclage_pondere, 1)
                  : '—'
              }
              unit={kpi.taux_recyclage_pondere != null ? '%' : undefined}
              dotColor={DOT.green}
            />
            <KpiCockpitCard
              label="kg/pax moyen"
              value={kpi.kg_par_pax != null ? fmtDec(kpi.kg_par_pax, 2) : '—'}
              unit={kpi.kg_par_pax != null ? 'kg/pax' : undefined}
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-gestionnaire">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — Filtres du repère + jauges kg/pax en UN seul bloc
              (retour Val R24b : filtres imbriqués dans la carte des jauges). */}
          <BenchmarkBulletGauges
            items={gaugeItems}
            filtersSlot={
              <BenchmarkFilterBar
                embedded
                onChange={handleBenchmarkFilters}
                initialTypeEvenementIds={filters?.type_evenement_ids ?? []}
                initialTailleCodes={filters?.taille_evenement_codes ?? []}
              />
            }
          />

          {/* Bloc 4 donut + Bloc 6 lieux + Bloc 7 traiteurs */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div data-testid="bloc-4-gestionnaire">
              <TonnagesDonut series={zdSeries} />
            </div>
            <div data-testid="bloc-6-top-lieux">
              <TopRankList
                title="Top 5 lieux"
                subtitle="Par tonnage collecté"
                items={withBars(topLieuxItems)}
                showBar
              />
            </div>
            {blocs?.topActeurs && blocs.acteurLabel && (
              <div data-testid="bloc-7-top-acteurs">
                <TopRankList
                  title={acteurTitre}
                  subtitle="Par nombre de collectes"
                  items={withBars(topActeursItems)}
                  showBar
                />
              </div>
            )}
          </div>

          {/* Bloc 5 — Prochaines collectes (colonne Traiteur §06.05 l.194) */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            showTraiteur
            hrefFor={(c) =>
              c.evenement_id
                ? `/gestionnaire/evenements/${c.evenement_id}`
                : undefined
            }
          />

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      ) : (
        <>
          {/* Bloc 1 — KPIs Cockpit AG (non cliquables) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(kpi.nb_collectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Repas donnés"
              value={fmtInt(kpi.nb_repas_donnes ?? 0)}
              dotColor={DOT.accent}
            />
            <KpiCockpitCard
              label="Pax cumulés"
              value={fmtInt(kpi.pax_total ?? 0)}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Repas/pax moyen"
              value={
                kpi.repas_par_pax != null ? fmtDec(kpi.repas_par_pax, 2) : '—'
              }
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution Anti-Gaspi */}
          <div data-testid="bloc-2-gestionnaire">
            <EvolutionAgChart series={agSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 AG — Top associations bénéficiaires */}
          <div data-testid="bloc-3ag-top-associations">
            <TopRankList
              title="Top associations bénéficiaires"
              subtitle="Par repas reçus"
              items={withBars(topAssociationsItems)}
              avatarShape="round"
              avatarTint="orange"
              showBar
            />
          </div>

          {/* Mon pack AG (lecture seule gestionnaire) */}
          {pack && (
            <div
              data-testid="bloc-pack-ag"
              className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm"
            >
              <h3 className="mb-2 text-base font-extrabold text-savr-neutral-900">
                Mon pack Anti-Gaspi
              </h3>
              <p className="text-sm text-savr-neutral-700">
                Crédits restants :{' '}
                <strong className="tabular-nums">
                  {pack.nb_collectes_restantes}
                </strong>{' '}
                / {pack.nb_collectes_total}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {packEpuise && <Badge variant="error">Pack épuisé</Badge>}
                {packBas && (
                  <Badge variant="warning">Pack bientôt épuisé</Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-savr-neutral-500">
                Contactez votre responsable Savr pour renouveler votre pack.
              </p>
            </div>
          )}

          {/* Bloc 6 lieux + Bloc 7 traiteurs */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div data-testid="bloc-6-top-lieux">
              <TopRankList
                title="Top 5 lieux"
                subtitle="Par repas donnés"
                items={withBars(topLieuxItems)}
                showBar
              />
            </div>
            {blocs?.topActeurs && blocs.acteurLabel && (
              <div data-testid="bloc-7-top-acteurs">
                <TopRankList
                  title={acteurTitre}
                  subtitle="Par nombre de collectes"
                  items={withBars(topActeursItems)}
                  showBar
                />
              </div>
            )}
          </div>

          {/* Bloc 5 — Prochaines collectes */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            showTraiteur
            hrefFor={(c) =>
              c.evenement_id
                ? `/gestionnaire/evenements/${c.evenement_id}`
                : undefined
            }
          />

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      )}
    </div>
  );
}
