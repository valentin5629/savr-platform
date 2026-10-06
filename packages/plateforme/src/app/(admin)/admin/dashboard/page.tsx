'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ListFooter } from '@/components/ui/list-footer';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { RevenusHistogramme } from '@/components/dashboards/index.js';
// Librairie data-viz « Cockpit » (R24) — importée EN DIRECT (hors barrel
// components/dashboards → aucun impact sur le gate orphan-components).
import { StatCard } from '@/components/ui/stat-card';
import { ChartCard } from '@/components/dashboards/charts/cockpit/ChartCard';
import { fmtInt } from '@/components/dashboards/charts/cockpit/fmt';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { OPS_DOT } from '@/components/dashboards/charts/cockpit/palette';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/ui/empty-state';
import { fmtEuro } from '@/lib/format';

interface KpiData {
  non_transmises_zd: number;
  non_transmises_ag: number;
  attente_prestataire: number;
  dirty_tms: number;
  collectes_48h_non_validees: number;
}

interface RevenusRow {
  organisation_id: string;
  raison_sociale: string;
  type_organisation: string;
  type_label: string;
  nb_zd: number;
  montant_zd_ht: number;
  nb_ag: number;
  montant_ag_ht: number;
  montant_total: number;
}

function euro(v: number): string {
  return fmtEuro(v);
}

// Badge d'état d'un KPI d'alerte : action requise si > 0, « À jour » sinon.
function badgeAlerte(
  v: number,
  variantActif: 'warning' | 'error',
  labelActif: string,
) {
  return v > 0 ? (
    <Badge variant={variantActif}>{labelActif}</Badge>
  ) : (
    <Badge variant="success">À jour</Badge>
  );
}

// Badge d'état d'un KPI de veille (échéances 48 h, attente prestataire) : bleu info
// si > 0, neutre sinon — pas d'alarme, juste un repère de charge à venir.
function badgeVeille(v: number, labelActif: string) {
  return v > 0 ? (
    <Badge variant="info">{labelActif}</Badge>
  ) : (
    <Badge variant="neutral">Aucune</Badge>
  );
}

// Période par défaut du bloc Revenus : 12 derniers mois glissants, alignés au 1er du
// mois (12 buckets pleins pour l'histogramme — §06.06 l.76 / §11 l.38, décision Val
// 2026-07-18 réaffirmée 2026-09-30 : ne correspond à aucun raccourci, le déclencheur
// affiche des dates ; le plan R-UI-4b D8 proposait l'inverse → arbitrage Val, PR #481).
// Cette MÊME fenêtre pilote l'histogramme ET le tableau (filtre unique) ;
// « Réinitialiser les filtres » y revient.
function defaultPeriode(): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => jourParis(d);
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)),
    to: iso(now),
  };
}

/** Période ≠ défaut : « Réinitialiser les filtres » visible. */
function periodePosee(p: { from: string; to: string }): boolean {
  const d = defaultPeriode();
  return p.from !== d.from || p.to !== d.to;
}

const revenusColumns: Column<RevenusRow>[] = [
  { key: 'raison_sociale', header: 'Organisation', sortable: true },
  {
    key: 'type_organisation',
    header: 'Type',
    sortable: true,
    render: (r) => r.type_label,
  },
  { key: 'nb_zd', header: 'Nb ZD', sortable: true },
  {
    key: 'montant_zd_ht',
    header: 'CA ZD HT',
    sortable: true,
    render: (r) => <span className="font-medium">{euro(r.montant_zd_ht)}</span>,
  },
  { key: 'nb_ag', header: 'Nb AG', sortable: true },
  {
    key: 'montant_ag_ht',
    header: 'CA AG HT',
    sortable: true,
    render: (r) => <span className="font-medium">{euro(r.montant_ag_ht)}</span>,
  },
  {
    key: 'montant_total',
    header: 'Total HT',
    sortable: true,
    render: (r) => (
      <span className="font-semibold text-savr-neutral-900">
        {euro(r.montant_total)}
      </span>
    ),
  },
];

export default function DashboardAdminPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [loadingKpi, setLoadingKpi] = useState(true);

  // Filtre de période UNIQUE — pilote l'histogramme ET le tableau (revue E2E Val
  // 2026-07-18). Défaut = 12 derniers mois glissants.
  const [periode, setPeriode] = useState(defaultPeriode);
  const [sortKey, setSortKey] = useState<string>('montant_total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch('/api/v1/admin/dashboard/kpi')
      .then((r) => r.json())
      .then((d: KpiData) => setKpi(d))
      .finally(() => setLoadingKpi(false));
  }, []);

  // Tableau Revenus par organisation : liste paginée serveur (convention de tri
  // unique `tri`/`ordre`, R-UI-4a), garde anti-réponse périmée + état Error
  // portés par `useListePaginee`.
  const revenusUrl = useMemo(
    () =>
      `/api/v1/admin/dashboard/revenus-organisations?${new URLSearchParams({
        from: periode.from,
        to: periode.to,
        tri: sortKey,
        ordre: sortDir,
        page: String(page),
      })}`,
    [periode, sortKey, sortDir, page],
  );
  const {
    data: revenus,
    total,
    loading: loadingRevenus,
    erreur: erreurRevenus,
    recharger: rechargerRevenus,
  } = useListePaginee<RevenusRow>(revenusUrl);

  const handleSort = (key: string, direction: 'asc' | 'desc') => {
    setSortKey(key);
    setSortDir(direction);
    setPage(1);
  };

  // Édition manuelle de la période (DateRangePicker, au clic « Appliquer »).
  const setPeriodeManuelle = (p: { from: string; to: string }) => {
    // « Effacer » (période vide) = retour au défaut, comme les autres
    // dashboards : la route ne remplace pas une borne vide par son défaut.
    setPeriode(p.from && p.to ? p : defaultPeriode());
    setPage(1);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-savr-primary-700" />
        <Heading level={1} weight="extrabold" tight>
          Dashboard Admin
        </Heading>
      </div>

      {/* Bloc 1 — KPIs opérationnels (rangée cockpit R24) */}
      <section>
        <Heading level={2} tone="muted" className="mb-4">
          Suivi opérationnel
        </Heading>
        {loadingKpi ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-savr-lg" />
            ))}
          </div>
        ) : kpi ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {/* Chaque carte est un lien vers la liste Collectes filtrée sur le
                MÊME prédicat que le compteur (miroir exact, §11 §1.1) — chip
                partagé lib/collectes-chips. */}
            <StatCard
              reserveTwoLineLabel
              label="Non transmises ZD"
              value={fmtInt(kpi.non_transmises_zd)}
              href="/admin/collectes?chip=non_transmises_zd"
              dotColor={
                kpi.non_transmises_zd > 0 ? OPS_DOT.warn : OPS_DOT.success
              }
              footer={badgeAlerte(
                kpi.non_transmises_zd,
                'warning',
                'À traiter',
              )}
            />
            <StatCard
              reserveTwoLineLabel
              label="Non transmises AG"
              value={fmtInt(kpi.non_transmises_ag)}
              href="/admin/collectes?chip=non_transmises_ag"
              dotColor={
                kpi.non_transmises_ag > 0 ? OPS_DOT.warn : OPS_DOT.success
              }
              footer={badgeAlerte(
                kpi.non_transmises_ag,
                'warning',
                'À traiter',
              )}
            />
            <StatCard
              reserveTwoLineLabel
              label="Attente prestataire"
              value={fmtInt(kpi.attente_prestataire)}
              href="/admin/collectes?chip=attente_prestataire"
              dotColor={
                kpi.attente_prestataire > 0 ? OPS_DOT.info : OPS_DOT.neutral
              }
              footer={badgeVeille(kpi.attente_prestataire, 'En cours')}
            />
            <StatCard
              reserveTwoLineLabel
              label="Dirty TMS"
              value={fmtInt(kpi.dirty_tms)}
              href="/admin/collectes?chip=dirty_tms"
              dotColor={kpi.dirty_tms > 0 ? OPS_DOT.error : OPS_DOT.success}
              footer={badgeAlerte(kpi.dirty_tms, 'error', 'À resynchroniser')}
            />
            {/* Fusion ZD 48h + AG 48h (revue E2E Val 2026-07-15) : collectes ZD/AG
                dans 48 h non validées par le prestataire (inclut les non transmises). */}
            <StatCard
              reserveTwoLineLabel
              label="Collecte <48h non validée"
              value={fmtInt(kpi.collectes_48h_non_validees)}
              href="/admin/collectes?chip=collectes_48h_non_validees"
              dotColor={
                kpi.collectes_48h_non_validees > 0
                  ? OPS_DOT.warn
                  : OPS_DOT.success
              }
              footer={badgeAlerte(
                kpi.collectes_48h_non_validees,
                'warning',
                'À valider',
              )}
            />
          </div>
        ) : null}
      </section>

      {/* Bloc 2 — Revenus (histogramme + tableau par organisation, filtre commun) */}
      <section className="space-y-4">
        <Heading level={2} tone="muted">
          Revenus
        </Heading>

        {/* Filtre de période COMMUN — pilote le graphe ET le tableau (revue E2E Val
            2026-07-18). Un seul filtre « Période » en ligne (décision Val
            2026-09-30) dans la barre standard des dashboards (`FilterBar
            surface="page"`, R-UI-4b D5 façon C : pas de liste à compter →
            `count={null}`) ; « Réinitialiser les filtres » (retour au défaut 12
            mois) seulement si la période en diffère. */}
        <FilterBar
          surface="page"
          data-testid="revenus-orgs-controls"
          count={null}
          actif={periodePosee(periode)}
          onReset={() => {
            setPeriode(defaultPeriode());
            setPage(1);
          }}
          resetTestId="revenus-reinitialiser"
        >
          <DateRangePicker
            titre="Période"
            id="revenus-periode"
            data-testid="revenus-periode"
            value={periode}
            onChange={setPeriodeManuelle}
          />
        </FilterBar>

        {/* Graphe (50 %) + tableau (50 %) sur la même ligne ≥ lg (revue E2E Val
            2026-07-18) — empilés en dessous. `items-start` : chaque colonne garde
            sa hauteur propre, pas d'étirement du graphe sur la hauteur du tableau. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          {/* Histogramme — MÊME fenêtre de période que le tableau (filtre commun). */}
          <ChartCard>
            <RevenusHistogramme from={periode.from} to={periode.to} />
          </ChartCard>

          {/* Colonne « Revenus par organisation » — titre DANS la carte, comme
              l'histogramme (ChartCard) : les deux cartes et leurs titres partent
              de la même ligne (revue E2E Val 2026-09-28). */}
          <div>
            <Card variant="elevated" className="overflow-hidden">
              {/* Titre du bloc tableau (revue E2E Val 2026-07-15). */}
              <Heading
                level={3}
                weight="extrabold"
                className="px-6 pb-4 pt-6 tracking-[-0.01em]"
              >
                Revenu par organisation
              </Heading>
              <DataTable
                columnsToggle={false}
                columns={revenusColumns}
                data={revenus}
                keyExtractor={(row) => row.organisation_id}
                loading={loadingRevenus}
                erreur={erreurRevenus}
                onRecharger={rechargerRevenus}
                empty={
                  <EmptyState
                    size="inline"
                    title="Aucune donnée sur la période."
                    className="p-6"
                  />
                }
                toolbar={
                  !loadingRevenus && total > 0 ? (
                    <Text as="span" className="px-6">
                      {total} organisation{total > 1 ? 's' : ''}
                    </Text>
                  ) : null
                }
                onSort={handleSort}
                sortKey={sortKey}
                sortDirection={sortDir}
                className="px-6 pb-6"
              />
              <ListFooter
                total={total}
                page={page}
                onPageChange={setPage}
                className="border-t border-savr-neutral-100 px-3 pb-3"
              />
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
