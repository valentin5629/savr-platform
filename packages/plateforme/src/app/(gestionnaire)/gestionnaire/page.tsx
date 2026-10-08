'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';
import {
  DashboardFilterBar,
  BenchmarkFilterBar,
  EmptyDashboardState,
  ExportSyntheseBloc,
  FLUX_ZD,
  useEvolutionBlocs,
  type CollecteType,
  type DashboardFilters,
  type BenchmarkFilters,
  type ParcFilterOptions,
  type BlocsData,
} from '@/components/dashboards/index.js';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import { CartesKpiGestionnaire } from '@/components/dashboards/CartesKpiGestionnaire';
import { useKpisGestionnaire } from '@/components/dashboards/useKpisGestionnaire';
// Librairie data-viz « Cockpit » (R24) — importée en direct (hors barrel).
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
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
import { ErrorState } from '@/components/ui/error-state';
import { Heading } from '@/components/ui/heading';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { fmtPct } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/lib/routes';

function masseStr(kg: number): string {
  const m = fmtMasse(kg);
  return `${m.value} ${m.unit}`;
}

export default function GestionnaireDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [parcOptions, setParcOptions] = useState<ParcFilterOptions | undefined>(
    undefined,
  );
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
  // Bloc 1 (cartes KPI + variation N-1, §06.05 l.136), kg/pax par flux du
  // benchmark et pack AG : une seule réponse, mêmes filtres parc.
  const {
    kpi,
    kpiPrev,
    kgParPaxParFlux: perFlux,
    pack,
    loading,
    erreur,
  } = useKpisGestionnaire(filters, tab);
  // « Réessayer » : des filtres identiques mais neufs relancent les chargements
  // qu'ils pilotent (KPI, évolution, Top listes), tous touchés par la même panne.
  const recharger = () => setFilters((f) => (f ? { ...f } : f));

  useEffect(() => {
    fetch('/api/v1/gestionnaire/filtres')
      .then((r) => r.json())
      .then((j: { data?: ParcFilterOptions }) => {
        if (j.data) setParcOptions(j.data);
      })
      .catch(() => {});
  }, []);

  // Blocs 6/7/3AG (§11) — endpoint partagé, mêmes filtres globaux parc.
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

  const packEpuise = pack && pack.credits_restants === 0;
  const packBas =
    pack && !packEpuise && pack.credits_restants <= 0.1 * pack.credits_initiaux;

  // ── Top listes (Cockpit) — colonnes §06.05 préservées via `secondary`. ──
  const nbColl = (n: number) => `${fmtInt(n)} collecte${n > 1 ? 's' : ''}`;
  const tauxStr = (t: number | null) =>
    t != null ? `${fmtPct(t, 1)} recyclage` : 'taux n/d';
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
        ? `${masseStr(a.tonnage_kg ?? 0)} · ${a.taux_recyclage != null ? fmtPct(a.taux_recyclage, 1) : '—'}`
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

  // Drill-down Top listes → liste Collectes du gestionnaire. §06.05 l.209 : liste
  // PLATE, « tous statuts, type ZD/AG non figé ; filtres du dashboard propagés
  // (période + Type/Taille d'événement) ». Libellé via sessionStorage (pas d'ID →
  // nom en query string).
  //
  // ⚠ C'est l'INVERSE de la règle §06.04 TRAITEUR (« miroir 5/5 » : type + statut
  // `cloturee` figés, l.193/201/233/278). Les deux espaces divergent EXPRÈS — le
  // traiteur veut retrouver le chiffre exact de sa Top liste, le gestionnaire veut
  // ouvrir large sur son parc. Ne pas « harmoniser » en remettant type/statut ici :
  // c'est précisément la règle traiteur qui avait été appliquée par erreur au
  // gestionnaire (53bec7c, 2026-07-14), contre le texte du §06.05.
  const drillUrl = (cle: 'lieu' | 'traiteur', id: string): string => {
    const qs = new URLSearchParams({ [cle]: id });
    if (filters) {
      qs.set('from', filters.from);
      qs.set('to', filters.to);
      (filters.type_evenement_ids ?? []).forEach((v) =>
        qs.append('type_evenement_ids[]', v),
      );
      (filters.taille_evenement_codes ?? []).forEach((v) =>
        qs.append('taille_evenements[]', v),
      );
    }
    return `${ROUTES.gestionnaire.collectes}?${qs}`;
  };
  const goToLieu = (i: number) => {
    const l = blocs?.topLieux?.[i];
    if (!l) return;
    setCollecteFiltreLabel({ kind: 'lieu', id: l.lieu_id, label: l.lieu_nom });
    router.push(drillUrl('lieu', l.lieu_id));
  };
  const goToActeur = (i: number) => {
    const a = blocs?.topActeurs?.[i];
    if (!a) return;
    setCollecteFiltreLabel({ kind: 'traiteur', id: a.id, label: a.label });
    router.push(drillUrl('traiteur', a.id));
  };

  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    perFlux,
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

  return (
    <div className="space-y-6" data-testid="gestionnaire-dashboard">
      <PageHeader
        title="Dashboard"
        actions={
          <Button asChild>
            <a href={ROUTES.programmer.nouveau}>Programmer une collecte</a>
          </Button>
        }
      />

      <DashboardFilterBar
        storageKey="gestionnaire-dashboard"
        onChange={handleFilters}
        parcOptions={parcOptions}
      />
      {!loading && kpi && (
        <Text data-testid="dashboard-collectes-count">
          {kpi.nb_collectes} collecte{(kpi.nb_collectes ?? 0) > 1 ? 's' : ''}{' '}
          correspond{(kpi.nb_collectes ?? 0) > 1 ? 'ent' : ''}
        </Text>
      )}
      <ToggleTypeCollecte value={tab} onChange={setTab} />

      {erreur ? (
        // §10 §7 « Error » : une panne de chargement ne se lit jamais comme un
        // dashboard sans collecte.
        <ErrorState
          message="Impossible de charger le dashboard. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
          onRetry={recharger}
        />
      ) : loading ? (
        <LoadingState />
      ) : !kpi || kpi.nb_collectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (non cliquables, décision Val 2026-07-10) */}
          <CartesKpiGestionnaire
            type={tab}
            kpi={kpi}
            kpiPrev={kpiPrev}
            zdSeries={zdSeries}
            agSeries={agSeries}
          />

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-gestionnaire">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — Filtres du repère + radar kg/pax en UN seul bloc
              (retour Val R24b : filtres imbriqués dans la carte du benchmark). */}
          <BenchmarkRadar
            items={gaugeItems}
            filtersSlot={
              <BenchmarkFilterBar
                perimetre="rattache"
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

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      ) : (
        <>
          {/* Bloc 1 — KPIs Cockpit AG (non cliquables) */}
          <CartesKpiGestionnaire
            type={tab}
            kpi={kpi}
            kpiPrev={kpiPrev}
            zdSeries={zdSeries}
            agSeries={agSeries}
          />

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
            <Card variant="elevated" padding="lg" data-testid="bloc-pack-ag">
              <Heading level={3} weight="extrabold" className="mb-2">
                Mon pack Anti-Gaspi
              </Heading>
              <Text variant="body">
                Crédits restants :{' '}
                <strong className="tabular-nums">
                  {pack.credits_restants}
                </strong>{' '}
                / {pack.credits_initiaux}
              </Text>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {packEpuise && <Badge variant="error">Pack épuisé</Badge>}
                {packBas && (
                  <Badge variant="warning">Pack bientôt épuisé</Badge>
                )}
              </div>
              <Text className="mt-2">
                Contactez votre responsable Savr pour renouveler votre pack.
              </Text>
            </Card>
          )}

          {/* Bloc 6 lieux + Bloc 7 traiteurs */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div data-testid="bloc-6-top-lieux">
              <TopRankList
                title="Top 5 lieux"
                subtitle="Par repas donnés"
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

          {/* Bloc 8 — Export synthèse PDF */}
          <ExportSyntheseBloc filters={filters} tab={tab} />
        </>
      )}
    </div>
  );
}
