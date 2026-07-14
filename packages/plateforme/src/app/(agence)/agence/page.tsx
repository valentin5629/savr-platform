'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';
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
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkBulletGauges } from '@/components/dashboards/charts/cockpit/BenchmarkBulletGauges';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
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
import { Button } from '@/components/ui/button';

// Pastilles couleur des cartes KPI (palette data-viz DS §2.4, figée par sens —
// identique traiteur/gestionnaire).
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

// §06.11 diff #7 — pas de carte « Marge générée » : marge_zd_ht n'est pas exposé
// par l'API pour le rôle agence (strip serveur dans /api/v1/dashboards/kpi-traiteur).
// Pas de colonne CO₂ non plus (endpoint role-stripped) → 4 cartes ZD, comme le
// dashboard gestionnaire (§06.05).
interface KpiRow {
  mois: string;
  type_collecte: CollecteType;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  nb_repas_donnes: number | null;
  pax_total: number;
}

/**
 * Dashboard agence (§06.11 — réplique stricte du §06.04 traiteur, périmètre
 * donneur d'ordre). Décliné en Cockpit (R24c) à parité de sens avec
 * traiteur/gestionnaire, en réutilisant la lib Cockpit figée : KPIs
 * `KpiCockpitCard`, Top listes `TopRankList` (drill-down lieux préservé),
 * évolution `EvolutionZd/AgChart`, donut `TonnagesDonut`, benchmark
 * `BenchmarkBulletGauges`. Divergences forcées §06.11 conservées : 4 cartes ZD
 * (pas de Marge, diff #7) et pas de Bloc 7 « Top 5 commerciaux » (diff #8).
 */
export default function AgenceDashboardPage() {
  const router = useRouter();
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
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);

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

  // Benchmark parc (Bloc 3 ZD) — 4 dimensions §06.04 : traiteur_ids VOLONTAIREMENT
  // NON transmis (préservation compétitive §06.04 l.143 ; parité stricte traiteur).
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
    if (f.periode_debut) p.set('periode_debut', f.periode_debut);
    if (f.periode_fin) p.set('periode_fin', f.periode_fin);
    fetch(`/api/v1/dashboards/benchmark?${p}`)
      .then((r) => r.json())
      .then((j) => setBenchmarkRows((j.data ?? []) as BenchmarkRow[]))
      .catch(() => setBenchmarkRows([]));
  }, [benchmarkFilters, tab]);

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

  // ── Top listes (Cockpit TopRankList) — colonnes §06.04 préservées via `secondary`. ──
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

  // Drill-down Top lieux → liste Collectes agence filtrée. Miroir EXACT du chiffre
  // du dashboard : type courant + période (from/to) + statut `cloturee` seul (base
  // du calcul Top listes). Libellé humain via sessionStorage (pas d'ID → nom en
  // query string). Périmètre donneur d'ordre garanti par la RLS agence (jamais
  // opératrice) → pas de `perimetre=organisation`, contrairement au traiteur.
  const drillScope = `type=${tab}&statut=cloturee${
    filters ? `&from=${filters.from}&to=${filters.to}` : ''
  }`;
  const goToLieu = (i: number) => {
    const l = blocs?.topLieux?.[i];
    if (!l) return;
    setCollecteFiltreLabel({ kind: 'lieu', id: l.lieu_id, label: l.lieu_nom });
    router.push(`/agence/collectes?lieu=${l.lieu_id}&${drillScope}`);
  };

  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    blocs?.kgParPaxParFlux ?? {},
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

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

      {/* Compteur « X collectes correspondent » (BL-P3-02) — parité gestionnaire. */}
      {!loading && filters && (
        <p
          data-testid="dashboard-collectes-count"
          className="text-sm text-savr-neutral-500"
        >
          {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''} correspond
          {nbCollectes > 1 ? 'ent' : ''} à votre sélection
        </p>
      )}

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (4 cartes ZD sans Marge, diff #7 ; non cliquables) */}
          <div
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            data-testid="agence-kpi-zd"
          >
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(nbCollectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Tonnage collecté"
              value={fmtMasse(tonnage).value}
              unit={fmtMasse(tonnage).unit}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Taux de recyclage"
              value={taux != null ? fmtDec(taux, 1) : '—'}
              unit={taux != null ? '%' : undefined}
              dotColor={DOT.green}
            />
            <KpiCockpitCard
              label="kg/pax moyen"
              value={kgPax != null ? fmtDec(kgPax, 2) : '—'}
              unit={kgPax != null ? 'kg/pax' : undefined}
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-agence">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — Filtres du repère + jauges kg/pax en UN seul bloc
              (retour Val R24b : filtres imbriqués dans la carte des jauges).
              Benchmark 4 dimensions §06.04 — Traiteurs masqué (endpoint /filtres
              renvoie liste vide, traiteur_ids[] rejeté serveur). */}
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

          {/* Bloc 4 donut + Bloc 6 top lieux (pas de Bloc 7 côté agence, diff #8) */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div data-testid="bloc-4-agence">
              <TonnagesDonut series={zdSeries} />
            </div>
            <div data-testid="bloc-6-top-lieux" className="lg:col-span-2">
              <TopRankList
                title="Top 5 lieux"
                subtitle="Par tonnage collecté"
                items={withBars(topLieuxItems)}
                onItemClick={goToLieu}
                showBar
              />
            </div>
          </div>

          {/* Bloc 5 — Prochaines collectes (§06.11 hérite §06.04 Bloc 5) */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            hrefFor={(c) => `/agence/collectes/${c.id}`}
          />

          {/* Bloc 8 — Export synthèse PDF (§06.11 réplique stricte §06.04, R20b-2) */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      ) : (
        <>
          {/* Bloc 1 — KPIs Cockpit AG (4 cartes, non cliquables) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(nbCollectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Repas donnés"
              value={fmtInt(repas)}
              dotColor={DOT.accent}
            />
            <KpiCockpitCard
              label="Pax cumulés"
              value={fmtInt(pax)}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Repas/pax moyen"
              value={pax > 0 ? fmtDec(repas / pax, 2) : '—'}
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution Anti-Gaspi */}
          <div data-testid="bloc-2-agence">
            <EvolutionAgChart series={agSeries} granularite={granularite} />
          </div>

          {/* Bloc 4 AG — Mon pack Anti-Gaspi (§06.11 l.44, hérite §06.04) :
              jauge Cockpit + bouton « Demander un renouvellement » (BL-P1-AGENCE-01),
              actif dès solde ≤ 10 % ou = 0 (§06.04 l.242). Endpoint partagé. */}
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

          {/* Bloc 3 AG — Top associations + Bloc 6 top lieux (pas de Bloc 7, diff #8) */}
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
                onItemClick={goToLieu}
                showBar
              />
            </div>
          </div>

          {/* Bloc 5 — Prochaines collectes */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            hrefFor={(c) => `/agence/collectes/${c.id}`}
          />

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      )}
    </div>
  );
}
