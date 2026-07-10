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
  type BlocsData,
} from '@/components/dashboards/index.js';
// Librairie data-viz « Cockpit » (R24) — importée EN DIRECT (hors barrel
// components/dashboards → aucun impact sur le gate orphan-components).
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkBulletGauges } from '@/components/dashboards/charts/cockpit/BenchmarkBulletGauges';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import {
  fmtInt,
  fmtDec,
  fmtEuro,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import {
  aggregateKpis,
  co2Totals,
  co2Equivalences,
  variationPct,
  sparkFromRows,
  aggregateBenchmarkPerFlux,
  benchmarkItems,
  FACTEURS_CO2_DEFAUT,
  type TraiteurKpiRow,
  type FacteursCo2,
  type BenchmarkRow,
} from '@/lib/dashboards/cockpit-derive';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { margeTooltipZd } from '@/lib/marge-tooltip';

// Pastilles couleur des cartes KPI (palette data-viz DS §2.4, figée par sens).
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

export default function TraiteurDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [rows, setRows] = useState<TraiteurKpiRow[]>([]);
  // Fenêtre N-1 (période précédente équivalente) — alimente la variation des KPIs.
  const [prevRows, setPrevRows] = useState<TraiteurKpiRow[]>([]);
  // Facteurs d'équivalence CO₂ (ADEME, parametres_co2_divers) — héros CO₂.
  const [facteursCo2, setFacteursCo2] =
    useState<FacteursCo2>(FACTEURS_CO2_DEFAUT);
  // tarif refacturé €/pax ZD (BL-P3-02) — alimente la formule du tooltip Marge.
  const [tarifZd, setTarifZd] = useState<number | null>(null);
  const [nbAttente, setNbAttente] = useState(0);
  const [pack, setPack] = useState<{
    pack_actif: boolean;
    credits_initiaux?: number;
    credits_restants?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocs, setBlocs] = useState<BlocsData | null>(null);
  // Benchmark parc par flux (Bloc 3 ZD) : 1 fetch page-level (vs 1/jauge) →
  // alimente les jauges bullet Cockpit. traiteur_ids jamais transmis (compétitif).
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [benchmarkFilters, setBenchmarkFilters] =
    useState<BenchmarkFilters | null>(null);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);
  const handleBenchmarkFilters = useCallback(
    (f: BenchmarkFilters) => setBenchmarkFilters(f),
    [],
  );

  // Bloc 2 (évolution) + Bloc 4 (donut) — série partagée §11 par onglet actif.
  const { granularite, zdSeries, agSeries } = useEvolutionBlocs(filters, tab);

  // KPIs + N-1 + facteurs CO₂ (compare=n1 → l'endpoint renvoie la période précédente).
  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
      compare: 'n1',
    });
    fetch(`/api/v1/dashboards/kpi-traiteur?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        setRows((j.data ?? []) as TraiteurKpiRow[]);
        setPrevRows((j.previous ?? []) as TraiteurKpiRow[]);
        setFacteursCo2(
          (j.facteurs_co2 as FacteursCo2 | undefined) ?? FACTEURS_CO2_DEFAUT,
        );
        setTarifZd(
          typeof j.tarif_refacture_pax_zd === 'number'
            ? j.tarif_refacture_pax_zd
            : null,
        );
      })
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

  // Blocs 5/6/7/3AG + kg/pax par flux (§11) — endpoint partagé, périmètre org.
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

  // Benchmark parc (Bloc 3 ZD) — piloté par l'encart « Filtres benchmark ».
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
    // traiteur_ids volontairement NON transmis (préservation compétitive §06.04 l.143).
    if (f.periode_debut) p.set('periode_debut', f.periode_debut);
    if (f.periode_fin) p.set('periode_fin', f.periode_fin);
    fetch(`/api/v1/dashboards/benchmark?${p}`)
      .then((r) => r.json())
      .then((j) => setBenchmarkRows((j.data ?? []) as BenchmarkRow[]))
      .catch(() => setBenchmarkRows([]));
  }, [benchmarkFilters, tab]);

  // ── Agrégats période courante + N-1 ──────────────────────────────────────────
  const agg = aggregateKpis(rows);
  const prev = aggregateKpis(prevRows);
  const co2 = co2Totals(rows);
  const equivalences = co2Equivalences(co2, facteursCo2);

  const seuilBas =
    pack?.pack_actif &&
    pack.credits_initiaux != null &&
    pack.credits_restants != null &&
    pack.credits_restants <= 0.1 * pack.credits_initiaux;
  const packEpuise = pack?.pack_actif && pack.credits_restants === 0;
  // Cartes KPI NON cliquables (décision Val GO-VISUAL 2026-07-10 — revient sur
  // BL-P2-11/BL-P2-43 « cartes cliquables ») : plus de href vers la liste collectes.

  // ── Top listes (Cockpit TopRankList) — value = métrique d'ordre, secondary =
  //    colonnes CDC §06.04 restantes (Nb collectes · Taux/Repas-pax · Ville). ──
  const nbColl = (n: number) => `${fmtInt(n)} collecte${n > 1 ? 's' : ''}`;
  const tauxStr = (t: number | null) =>
    t != null ? `${fmtDec(t, 1)} % recyclage` : 'taux n/d';
  const repasPaxStr = (r: number | null) =>
    r != null ? `${fmtDec(r, 2)} repas/pax` : 'repas/pax n/d';

  // Bloc 6 — ordonné par tonnage (ZD) / repas donnés (AG). CDC l.181/262.
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
  // Bloc 7 — ordonné par nb collectes (ZD/AG). CDC l.187/269.
  const topActeursItems = (blocs?.topActeurs ?? []).map((a) => ({
    label: a.label,
    raw: a.nb_collectes,
    value: nbColl(a.nb_collectes),
    secondary:
      tab === 'zero_dechet'
        ? `${masseStr(a.tonnage_kg ?? 0)} · ${a.taux_recyclage != null ? `${fmtDec(a.taux_recyclage, 1)} %` : '—'}`
        : `${fmtInt(a.repas_donnes ?? 0)} repas · ${repasPaxStr(a.repas_par_pax)}`,
  }));
  // Bloc 3 AG — ordonné par repas reçus. CDC l.219 (Association · Ville · Nb · Repas).
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
    blocs?.acteurLabel === 'Traiteur' ? 'Top 5 traiteurs' : 'Top 5 commerciaux';

  // ── Benchmark (Bloc 3 ZD) ────────────────────────────────────────────────────
  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    blocs?.kgParPaxParFlux ?? {},
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

  const margeNode =
    agg.marge == null ? (
      '—'
    ) : (
      <span style={{ color: agg.marge < 0 ? '#DC2626' : undefined }}>
        {agg.marge < 0 ? '−' : ''}
        {fmtEuro(Math.abs(agg.marge))}
      </span>
    );
  const margeTooltip =
    tarifZd != null && agg.marge != null
      ? margeTooltipZd(tarifZd, agg.pax, agg.marge)
      : 'Marge sur vos collectes ZD = tarif refacturé par pax × pax − total des factures HT ZD reçues, sur la période filtrée.';

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

      {!loading && filters && (
        <p
          data-testid="dashboard-collectes-count"
          className="text-sm text-savr-neutral-500"
        >
          {agg.nbCollectes} collecte{agg.nbCollectes > 1 ? 's' : ''} correspond
          {agg.nbCollectes > 1 ? 'ent' : ''} à votre sélection
        </p>
      )}

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : agg.nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (5 cartes ZD) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(agg.nbCollectes)}
              dotColor={DOT.navy}
              variationPct={variationPct(agg.nbCollectes, prev.nbCollectes)}
              sparkPoints={sparkFromRows(rows, (r) => r.nb_collectes)}
            />
            <KpiCockpitCard
              label="Tonnage collecté"
              value={fmtMasse(agg.tonnage).value}
              unit={fmtMasse(agg.tonnage).unit}
              dotColor={DOT.navy2}
              variationPct={variationPct(agg.tonnage, prev.tonnage)}
              sparkPoints={sparkFromRows(rows, (r) => r.tonnage_kg)}
            />
            <KpiCockpitCard
              label="Taux de recyclage"
              value={agg.taux != null ? fmtDec(agg.taux, 1) : '—'}
              unit={agg.taux != null ? '%' : undefined}
              dotColor={DOT.green}
              variationPct={variationPct(agg.taux ?? 0, prev.taux ?? 0)}
              sparkPoints={sparkFromRows(rows, (r) => r.taux_recyclage_pondere)}
              sparkColor={DOT.green}
            />
            <KpiCockpitCard
              label="kg/pax moyen"
              value={agg.kgPax != null ? fmtDec(agg.kgPax, 2) : '—'}
              unit={agg.kgPax != null ? 'kg/pax' : undefined}
              dotColor={DOT.navy3}
              sparkPoints={sparkFromRows(rows, (r) =>
                r.pax_total > 0 ? (r.tonnage_kg ?? 0) / r.pax_total : 0,
              )}
            />
            <div>
              <KpiCockpitCard
                label="Marge générée"
                value={margeNode}
                unit={agg.marge != null ? '€' : undefined}
                dotColor={DOT.accent}
                variationPct={variationPct(agg.marge ?? 0, prev.marge ?? 0)}
                sparkPoints={sparkFromRows(rows, (r) => r.marge_zd_ht)}
                sparkColor={DOT.accent}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {nbAttente >= 1 && (
                  <Badge variant="info">
                    {nbAttente} collecte{nbAttente > 1 ? 's' : ''} en attente de
                    facturation
                  </Badge>
                )}
                <Tooltip content={margeTooltip}>
                  <button
                    type="button"
                    aria-label="Détail du calcul de la marge"
                    className="inline-flex min-h-[44px] min-w-[44px] cursor-help items-center justify-center rounded-savr-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
                  >
                    {/* Cible tactile 44px (DS §10 l.447) ; « ? » visuel compact. */}
                    <span
                      aria-hidden
                      className="inline-flex h-5 w-5 items-center justify-center rounded-savr-full border border-savr-neutral-300 text-[11px] font-bold text-savr-neutral-500"
                    >
                      ?
                    </span>
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Héros CO₂ (ZD) — grandeurs figées v_kpi_traiteur + équivalences ADEME.
              Affiché seulement si un CO₂ évité existe (collectes ZD clôturées). */}
          {co2.eviteKg > 0 && (
            <Co2HeroCard
              eviteKg={co2.eviteKg}
              induitKg={co2.induitKg}
              netKg={co2.netKg}
              energiePrimaireKwh={co2.energieKwh}
              equivalences={equivalences}
            />
          )}

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-traiteur">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — Jauges kg/pax × benchmark parc (4 dimensions §06.04) */}
          <div className="space-y-4">
            <BenchmarkFilterBar
              onChange={handleBenchmarkFilters}
              initialTypeEvenementIds={filters?.type_evenement_ids ?? []}
              initialTailleCodes={filters?.taille_evenement_codes ?? []}
            />
            <BenchmarkBulletGauges items={gaugeItems} />
          </div>

          {/* Bloc 4 donut + Bloc 6 top lieux + Bloc 7 top commerciaux */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div data-testid="bloc-4-traiteur">
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

          {/* Bloc 5 — Prochaines collectes */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            hrefFor={(c) => `/traiteur/collectes/${c.id}`}
          />

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      ) : (
        <>
          {/* Bloc 1 — KPIs Cockpit (4 cartes AG) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(agg.nbCollectes)}
              dotColor={DOT.navy}
              variationPct={variationPct(agg.nbCollectes, prev.nbCollectes)}
              sparkPoints={sparkFromRows(rows, (r) => r.nb_collectes)}
            />
            <KpiCockpitCard
              label="Repas donnés"
              value={fmtInt(agg.repas)}
              dotColor={DOT.accent}
              variationPct={variationPct(agg.repas, prev.repas)}
              sparkPoints={sparkFromRows(rows, (r) => r.nb_repas_donnes)}
              sparkColor={DOT.accent}
            />
            <KpiCockpitCard
              label="Pax cumulés"
              value={fmtInt(agg.pax)}
              dotColor={DOT.navy2}
              variationPct={variationPct(agg.pax, prev.pax)}
              sparkPoints={sparkFromRows(rows, (r) => r.pax_total)}
            />
            <KpiCockpitCard
              label="Repas/pax moyen"
              value={agg.pax > 0 ? fmtDec(agg.repas / agg.pax, 2) : '—'}
              dotColor={DOT.navy3}
              sparkPoints={sparkFromRows(rows, (r) =>
                r.pax_total > 0 ? (r.nb_repas_donnes ?? 0) / r.pax_total : 0,
              )}
            />
          </div>

          {/* Bloc 2 — Évolution Anti-Gaspi */}
          <div data-testid="bloc-2-traiteur">
            <EvolutionAgChart series={agSeries} granularite={granularite} />
          </div>

          {/* Bloc 4 AG — Mon pack Anti-Gaspi */}
          {pack?.pack_actif &&
            pack.credits_initiaux != null &&
            pack.credits_restants != null && (
              <div data-testid="bloc-pack-ag" className="space-y-3">
                <PackAgRing
                  creditsInitiaux={pack.credits_initiaux}
                  creditsRestants={pack.credits_restants}
                />
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
            )}

          {/* Bloc 3 AG — Top associations + Bloc 6 top lieux */}
          <div className="grid gap-6 lg:grid-cols-2">
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
            <div data-testid="bloc-6-top-lieux">
              <TopRankList
                title="Top 5 lieux"
                subtitle="Par repas donnés"
                items={withBars(topLieuxItems)}
                showBar
              />
            </div>
          </div>

          {/* Bloc 7 — Top 5 commerciaux */}
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

          {/* Bloc 5 — Prochaines collectes */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            hrefFor={(c) => `/traiteur/collectes/${c.id}`}
          />

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      )}
    </div>
  );
}
