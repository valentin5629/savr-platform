'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  EmptyDashboardState,
  ProchainesCollectesBloc,
  FLUX_ZD,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import type {
  FluxSeriePoint,
  RepasSeriePoint,
} from '@/components/dashboards/useEvolutionBlocs.js';
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
import {
  OrganisationSelector,
  type OrganisationOption,
} from './OrganisationSelector.js';

// Pastilles couleur des cartes KPI (palette data-viz DS §2.4, figée par sens —
// identique gestionnaire, dashboard répliqué).
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

interface ZdKpi {
  nb_collectes: number;
  tonnage_kg: number;
  taux_recyclage_pondere: number | null;
  kg_par_pax: number | null;
}
interface AgKpi {
  nb_collectes: number;
  nb_repas_donnes: number;
  pax_total: number;
  repas_par_pax: number | null;
}
interface LieuItem {
  lieu_id: string;
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}
interface ActeurItem {
  id: string;
  label: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}
interface AssociationItem {
  association_id: string;
  nom: string;
  ville: string | null;
  nb_collectes: number;
  repas_recus: number;
}
type Granularite = 'jour' | 'semaine' | 'mois';

interface AdminPayload {
  kpi: ZdKpi | AgKpi;
  kgParPaxParFlux: Record<string, number>;
  evolution: { granularite: Granularite; series: Record<string, unknown>[] };
  blocs: {
    topLieux: LieuItem[];
    topActeurs: ActeurItem[];
    acteurLabel: 'Traiteur';
    topAssociations: AssociationItem[] | null;
    prochaines: {
      id: string;
      evenement_id: string | null;
      date_collecte: string;
      heure_collecte: string | null;
      statut: string;
      evenement_nom: string | null;
      lieu_nom: string | null;
      traiteur_id: string | null;
      traiteur_nom: string | null;
    }[];
  };
}

const STORAGE_KEY = 'savr.dashboard-client.organisations';
const BENCHMARK_ENDPOINT = '/api/v1/admin/dashboard-client/benchmark';

/**
 * Dashboard Client (§06.06 §2) — vue Admin LECTURE SEULE répliquant le dashboard
 * gestionnaire (§06.05), agrégée sur le périmètre d'organisations sélectionné.
 * « Toutes les organisations » (défaut) = totalité des collectes Savr.
 * La sélection est persistée/restaurée via localStorage. Aucune écriture.
 *
 * R24c — Déclinaison Cockpit COMPLÈTE (retour Val « je ne vois pas les graphs ») :
 * KPIs KpiCockpitCard + évolution EvolutionZd/AgChart + donut TonnagesDonut +
 * jauges Cockpit BenchmarkBulletGauges + Top listes TopRankList (lieux / traiteurs /
 * associations) + prochaines collectes. LECTURE SEULE : aucune ligne cliquable,
 * aucune navigation, aucune action. Le périmètre cross-org est agrégé côté serveur
 * (service_role, scope organisation_ids[]) par /api/v1/admin/dashboard-client.
 */
export function DashboardClientView() {
  const [organisations, setOrganisations] = useState<OrganisationOption[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
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

  // Dashboard complet agrégé sur le périmètre (KPI + évolution + blocs + kg/pax flux).
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
      .then((j: { data?: AdminPayload }) => setPayload(j.data ?? null))
      .catch(() => setPayload(null))
      .finally(() => setLoading(false));
  }, [filters, tab, selectedOrgs]);

  // Repère parc benchmark (Bloc 3 ZD) — parc global anonymisé (k≥5), indépendant
  // du périmètre sélectionné. Chargé sur l'onglet ZD.
  useEffect(() => {
    if (tab !== 'zero_dechet') {
      setBenchmarkRows([]);
      return;
    }
    fetch(BENCHMARK_ENDPOINT)
      .then((r) => r.json())
      .then((j: { data?: BenchmarkRow[] }) =>
        setBenchmarkRows((j.data ?? []) as BenchmarkRow[]),
      )
      .catch(() => setBenchmarkRows([]));
  }, [tab]);

  const kpi = payload?.kpi ?? null;
  const isEmpty = !kpi || kpi.nb_collectes === 0;
  const zdKpi = tab === 'zero_dechet' ? (kpi as ZdKpi | null) : null;
  const agKpi = tab === 'anti_gaspi' ? (kpi as AgKpi | null) : null;
  const blocs = payload?.blocs;
  const granularite: Granularite = payload?.evolution?.granularite ?? 'mois';
  const zdSeries =
    tab === 'zero_dechet'
      ? ((payload?.evolution?.series ?? []) as unknown as FluxSeriePoint[])
      : [];
  const agSeries =
    tab === 'anti_gaspi'
      ? ((payload?.evolution?.series ?? []) as unknown as RepasSeriePoint[])
      : [];

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

  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    payload?.kgParPaxParFlux ?? {},
    aggregateBenchmarkPerFlux(benchmarkRows),
  );

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
      ) : tab === 'zero_dechet' && zdKpi ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (lecture seule, non cliquables) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(zdKpi.nb_collectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Tonnage collecté"
              value={fmtMasse(zdKpi.tonnage_kg ?? 0).value}
              unit={fmtMasse(zdKpi.tonnage_kg ?? 0).unit}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Taux de recyclage"
              value={
                zdKpi.taux_recyclage_pondere != null
                  ? fmtDec(zdKpi.taux_recyclage_pondere, 1)
                  : '—'
              }
              unit={zdKpi.taux_recyclage_pondere != null ? '%' : undefined}
              dotColor={DOT.green}
            />
            <KpiCockpitCard
              label="kg/pax moyen"
              value={
                zdKpi.kg_par_pax != null ? fmtDec(zdKpi.kg_par_pax, 2) : '—'
              }
              unit={zdKpi.kg_par_pax != null ? 'kg/pax' : undefined}
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution mensuelle ZD */}
          <div data-testid="bloc-2-dashboard-client">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — jauges Cockpit vs benchmark parc (anonymisé k≥5) */}
          <BenchmarkBulletGauges items={gaugeItems} />

          {/* Bloc 4 donut + Bloc 6 top lieux + Bloc 7 top traiteurs */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div data-testid="bloc-4-dashboard-client">
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
            <div data-testid="bloc-7-top-acteurs">
              <TopRankList
                title="Top 5 traiteurs"
                subtitle="Par nombre de collectes"
                items={withBars(topActeursItems)}
                showBar
              />
            </div>
          </div>

          {/* Bloc 5 — Prochaines collectes (lecture seule, sans lien) */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            showTraiteur
            hrefFor={() => undefined}
          />
        </>
      ) : agKpi ? (
        <>
          {/* Bloc 1 — KPIs Cockpit AG (lecture seule) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCockpitCard
              label="Nombre de collectes"
              value={fmtInt(agKpi.nb_collectes)}
              dotColor={DOT.navy}
            />
            <KpiCockpitCard
              label="Repas donnés"
              value={fmtInt(agKpi.nb_repas_donnes ?? 0)}
              dotColor={DOT.accent}
            />
            <KpiCockpitCard
              label="Pax cumulés"
              value={fmtInt(agKpi.pax_total ?? 0)}
              dotColor={DOT.navy2}
            />
            <KpiCockpitCard
              label="Repas/pax moyen"
              value={
                agKpi.repas_par_pax != null
                  ? fmtDec(agKpi.repas_par_pax, 2)
                  : '—'
              }
              dotColor={DOT.navy3}
            />
          </div>

          {/* Bloc 2 — Évolution Anti-Gaspi */}
          <div data-testid="bloc-2-dashboard-client">
            <EvolutionAgChart series={agSeries} granularite={granularite} />
          </div>

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

          {/* Bloc 7 — Top 5 traiteurs */}
          <div data-testid="bloc-7-top-acteurs">
            <TopRankList
              title="Top 5 traiteurs"
              subtitle="Par nombre de collectes"
              items={withBars(topActeursItems)}
              showBar
            />
          </div>

          {/* Bloc 5 — Prochaines collectes (lecture seule, sans lien) */}
          <ProchainesCollectesBloc
            items={blocs?.prochaines ?? []}
            showTraiteur
            hrefFor={() => undefined}
          />
        </>
      ) : (
        <EmptyDashboardState />
      )}
    </div>
  );
}
