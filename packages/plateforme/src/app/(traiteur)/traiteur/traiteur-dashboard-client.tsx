'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  type CollecteType,
  type DashboardFilters,
  type BenchmarkFilters,
  type BenchmarkFilterOptions,
  type BlocsData,
} from '@/components/dashboards/index.js';
import type {
  FluxSeriePoint,
  RepasSeriePoint,
} from '@/components/dashboards/useEvolutionBlocs.js';
// Librairie data-viz « Cockpit » (R24) — importée EN DIRECT (hors barrel
// components/dashboards → aucun impact sur le gate orphan-components).
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import {
  Co2MethodePanel,
  type Co2FluxFactor,
} from '@/components/dashboards/charts/cockpit/Co2MethodePanel';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkBulletGauges } from '@/components/dashboards/charts/cockpit/BenchmarkBulletGauges';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import {
  fmtInt,
  fmtDec,
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
import { Modal } from '@/components/ui/modal';
import { Info } from 'lucide-react';
import type { TraiteurDashboardPayload } from '@/lib/dashboards/loaders';

// Variables du calcul CO₂ renvoyées par l'endpoint kpi-traiteur (modale méthode).
interface Co2Methode {
  forfait: { km: number; fe_camion: number };
  flux: Co2FluxFactor[];
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` (affichage FR de la période analysée). */
function frDate(iso?: string): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

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

export interface TraiteurDashboardClientProps {
  /** Payload SSR de l'onglet ZD, période par défaut (12 derniers mois). */
  initialData: TraiteurDashboardPayload;
  /** Période par défaut utilisée par le serveur (from/to identiques au client). */
  initialFilters: { from: string; to: string };
  /** Bloc 3 ZD — repère parc pré-chargé côté serveur (rows + options + filtres). */
  benchmark: {
    rows: BenchmarkRow[];
    options: BenchmarkFilterOptions;
    filters: BenchmarkFilters;
  };
}

/**
 * Coquille interactive du dashboard traiteur (Cockpit R24). Les DONNÉES viennent du
 * serveur (page SSR + endpoint consolidé) : ce composant ne fait QUE l'interactivité
 * (onglets ZD/AG, filtres période, N-1, filtres benchmark) et re-fetch au changement.
 * Le PREMIER rendu utilise `initialData` (aucun fetch au montage tant que les filtres
 * n'ont pas changé) → supprime le temps mort d'hydratation.
 */
export function TraiteurDashboardClient({
  initialData,
  initialFilters,
  benchmark,
}: TraiteurDashboardClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters>({
    from: initialFilters.from,
    to: initialFilters.to,
    lieu_ids: [],
    traiteur_ids: [],
    type_evenement_ids: [],
    taille_evenement_codes: [],
  });
  const [data, setData] = useState<TraiteurDashboardPayload>(initialData);
  const [loading, setLoading] = useState(false);
  // Facteurs / méthode CO₂ (modale « Impact carbone »).
  const [co2ModalOpen, setCo2ModalOpen] = useState(false);
  // Bloc 3 ZD — repère parc (rows pilotés par les filtres benchmark).
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>(
    benchmark.rows,
  );
  const [benchmarkFilters, setBenchmarkFilters] = useState<BenchmarkFilters>(
    benchmark.filters,
  );

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);
  const handleBenchmarkFilters = useCallback(
    (f: BenchmarkFilters) => setBenchmarkFilters(f),
    [],
  );

  // ── Re-fetch consolidé (endpoint traiteur-full) au changement d'onglet/période ──
  // Clé = signature de la requête (le dashboard traiteur n'envoie que from/to/type ;
  // pas de filtres « parc »). Initialisée à la requête SSR (déjà en état) → aucun
  // fetch au montage tant que la barre de filtres émet la même période.
  const mainKey = (f: DashboardFilters, t: CollecteType): string =>
    JSON.stringify({ from: f.from, to: f.to, t });
  const lastMainKey = useRef<string>(
    mainKey(
      { from: initialFilters.from, to: initialFilters.to },
      'zero_dechet',
    ),
  );

  useEffect(() => {
    const key = mainKey(filters, tab);
    if (key === lastMainKey.current) return; // données déjà en état (SSR ou fetch précédent)
    lastMainKey.current = key;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    fetch(`/api/v1/dashboards/traiteur-full?${qs}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { data?: TraiteurDashboardPayload }) => {
        if (!cancelled && j.data) setData(j.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, tab]);

  // ── Benchmark parc (Bloc 3 ZD) — piloté par ses propres filtres. Seedé par le
  //    SSR ; re-fetch uniquement quand les filtres benchmark changent réellement. ──
  // Clé NORMALISÉE (ordre de champs fixe) → insensible à l'ordre des propriétés.
  const benchKey = (f: BenchmarkFilters): string =>
    JSON.stringify({
      pd: f.periode_debut,
      pf: f.periode_fin,
      te: f.type_evenement_ids,
      ta: f.taille_evenement_codes,
      l: f.lieu_ids,
      tr: f.traiteur_ids,
    });
  const lastBenchKey = useRef<string | null>(benchKey(benchmark.filters));
  useEffect(() => {
    if (tab !== 'zero_dechet') {
      setBenchmarkRows([]);
      lastBenchKey.current = null;
      return;
    }
    const key = benchKey(benchmarkFilters);
    if (key === lastBenchKey.current) return;
    lastBenchKey.current = key;
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
    let cancelled = false;
    fetch(`/api/v1/dashboards/benchmark?${p}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { data?: BenchmarkRow[] }) => {
        if (!cancelled) setBenchmarkRows((j.data ?? []) as BenchmarkRow[]);
      })
      .catch(() => {
        if (!cancelled) setBenchmarkRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [benchmarkFilters, tab]);

  // ── Dérivations depuis le payload serveur ────────────────────────────────────
  const rows = (data.kpi.data ?? []) as TraiteurKpiRow[];
  const prevRows = (data.kpi.previous ?? []) as TraiteurKpiRow[];
  const facteursCo2 =
    (data.kpi.facteurs_co2 as FacteursCo2 | undefined) ?? FACTEURS_CO2_DEFAUT;
  const co2Methode = data.kpi.co2_methode as Co2Methode;
  const nbAttente = data.marge?.nb_en_attente ?? 0;
  const pack = data.pack;
  const blocs = data.blocs as unknown as BlocsData;
  const granularite = data.evolution.granularite;
  const zdSeries =
    tab === 'zero_dechet'
      ? (data.evolution.series as unknown as FluxSeriePoint[])
      : [];
  const agSeries =
    tab === 'anti_gaspi'
      ? (data.evolution.series as unknown as RepasSeriePoint[])
      : [];

  // ── Agrégats période courante + N-1 ──────────────────────────────────────────
  const agg = aggregateKpis(rows);
  const prev = aggregateKpis(prevRows);
  const co2 = co2Totals(rows);
  const co2Prev = co2Totals(prevRows);
  const co2Masse = fmtMasse(co2.eviteKg);
  const equivalences = co2Equivalences(co2, facteursCo2);

  const seuilBas =
    pack?.pack_actif &&
    pack.credits_initiaux != null &&
    pack.credits_restants != null &&
    pack.credits_restants <= 0.1 * pack.credits_initiaux;
  const packEpuise = pack?.pack_actif && pack.credits_restants === 0;

  // ── Top listes (Cockpit TopRankList) ─────────────────────────────────────────
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
    blocs?.acteurLabel === 'Traiteur' ? 'Top 5 traiteurs' : 'Top 5 commerciaux';

  // Drill-down Top listes → liste Collectes (onglet Historique) filtrée. Miroir
  // EXACT du chiffre du dashboard : même type, même période (from/to), et statut
  // `cloturee` seul (base du calcul Top listes) → le nombre de lignes = le chiffre.
  // Le libellé humain passe par sessionStorage (pas d'ID → nom en query string).
  // `perimetre=organisation` = restreint aux événements que l'org POSSÈDE
  // (evenements.organisation_id), comme le dashboard — la liste traiteur voit
  // sinon aussi les événements opérés pour des tiers → sur-comptage.
  const drillScope = `&type=${tab}&statut=cloturee&perimetre=organisation&from=${filters.from}&to=${filters.to}`;
  const goToLieu = (i: number) => {
    const l = blocs?.topLieux?.[i];
    if (!l) return;
    setCollecteFiltreLabel({ kind: 'lieu', id: l.lieu_id, label: l.lieu_nom });
    router.push(
      `/traiteur/collectes?onglet=historique&lieu=${l.lieu_id}${drillScope}`,
    );
  };
  const goToActeur = (i: number) => {
    const a = blocs?.topActeurs?.[i];
    if (!a) return;
    setCollecteFiltreLabel({ kind: 'commercial', id: a.id, label: a.label });
    router.push(
      `/traiteur/collectes?onglet=historique&commercial=${a.id}${drillScope}`,
    );
  };
  // Bloc 3 AG — clic sur une association bénéficiaire → collectes AG filtrées.
  const goToAssociation = (i: number) => {
    const a = blocs?.topAssociations?.[i];
    if (!a) return;
    setCollecteFiltreLabel({
      kind: 'association',
      id: a.association_id,
      label: a.nom,
    });
    router.push(
      `/traiteur/collectes?onglet=historique&association=${a.association_id}${drillScope}`,
    );
  };

  // ── Benchmark (Bloc 3 ZD) ────────────────────────────────────────────────────
  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    blocs?.kgParPaxParFlux ?? {},
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

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

      {!loading && (
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
            {/* CO₂ évité des collectes réalisées sur la période (retour Val —
                remplace « Marge générée », divergence §06.04 tracée). Cliquable :
                ouvre la modale « Impact carbone » (héros + méthode de calcul). */}
            <KpiCockpitCard
              label="CO₂ évité"
              value={co2Masse.value}
              unit={`${co2Masse.unit} CO₂e`}
              dotColor={DOT.green}
              variationPct={variationPct(co2.eviteKg, co2Prev.eviteKg)}
              sparkPoints={sparkFromRows(rows, (r) => r.co2_evite_kg)}
              sparkColor={DOT.green}
              onClick={
                co2.eviteKg > 0 ? () => setCo2ModalOpen(true) : undefined
              }
              headerRight={
                co2.eviteKg > 0 ? (
                  <Info aria-hidden className="h-4 w-4 text-savr-neutral-400" />
                ) : undefined
              }
            />
          </div>

          {/* Collectes en attente de facturation — info ops relogée depuis la
              carte Marge (retirée de la rangée KPI, retour Val). */}
          {nbAttente >= 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">
                {nbAttente} collecte{nbAttente > 1 ? 's' : ''} en attente de
                facturation
              </Badge>
            </div>
          )}

          {/* Modale « Impact carbone » — ouverte au clic sur la carte KPI CO₂
              évité (retour Val) : héros CO₂ (grandeurs figées v_kpi_traiteur) +
              méthode de calcul et variables utilisées. */}
          <Modal
            open={co2ModalOpen}
            onClose={() => setCo2ModalOpen(false)}
            title="Détail de l'impact carbone"
            wide
          >
            <div className="space-y-5">
              <p className="text-[13px] text-savr-neutral-500">
                Période analysée :{' '}
                <span className="font-semibold text-savr-neutral-700">
                  du {frDate(filters.from)} au {frDate(filters.to)}
                </span>{' '}
                · {agg.nbCollectes} collecte{agg.nbCollectes > 1 ? 's' : ''}{' '}
                clôturée{agg.nbCollectes > 1 ? 's' : ''} Zéro Déchet
              </p>
              <Co2HeroCard
                eviteKg={co2.eviteKg}
                induitKg={co2.induitKg}
                netKg={co2.netKg}
                energiePrimaireKwh={co2.energieKwh}
                equivalences={equivalences}
              />
              <Co2MethodePanel
                forfait={co2Methode?.forfait ?? { km: 50, fe_camion: 2.1 }}
                fluxFactors={co2Methode?.flux ?? []}
                equivalences={facteursCo2}
              />
            </div>
          </Modal>

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-traiteur">
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
                initialTypeEvenementIds={filters.type_evenement_ids ?? []}
                initialTailleCodes={filters.taille_evenement_codes ?? []}
                initialOptions={benchmark.options}
              />
            }
          />

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
                onItemClick={goToLieu}
                showBar
              />
            </div>
            {blocs?.topActeurs && blocs.acteurLabel && (
              <div data-testid="bloc-7-top-acteurs">
                <TopRankList
                  title={acteurTitre}
                  subtitle="Par nombre de collectes"
                  items={withBars(topActeursItems)}
                  onItemClick={goToActeur}
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
                onItemClick={goToAssociation}
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

          {/* Bloc 7 — Top 5 commerciaux */}
          {blocs?.topActeurs && blocs.acteurLabel && (
            <div data-testid="bloc-7-top-acteurs">
              <TopRankList
                title={acteurTitre}
                subtitle="Par nombre de collectes"
                items={withBars(topActeursItems)}
                onItemClick={goToActeur}
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
