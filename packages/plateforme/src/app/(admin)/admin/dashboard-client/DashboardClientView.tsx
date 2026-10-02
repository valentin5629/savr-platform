'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { setCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';
import {
  DashboardFilterBar,
  EmptyDashboardState,
  FLUX_ZD,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import type {
  FluxSeriePoint,
  RepasSeriePoint,
} from '@/components/dashboards/useEvolutionBlocs.js';
// Librairie data-viz « Cockpit » (R24) — importée en direct (hors barrel).
import { StatCard } from '@/components/ui/stat-card';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import {
  Co2MethodePanel,
  type Co2FluxFactor,
} from '@/components/dashboards/charts/cockpit/Co2MethodePanel';
import { Co2MethodePanelAg } from '@/components/dashboards/charts/cockpit/Co2MethodePanelAg';
import {
  fmtInt,
  fmtDec,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import {
  benchmarkItems,
  co2Equivalences,
  FACTEURS_CO2_DEFAUT,
  previousWindow,
  sparkFromSeries,
  variationPct,
  type Co2Totals,
  type FacteursCo2,
} from '@/lib/dashboards/cockpit-derive';
import {
  BenchmarkFilterBar,
  type BenchmarkFilters,
} from '@/components/dashboards/BenchmarkFilterBar.js';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Info } from 'lucide-react';
import {
  OrganisationSelector,
  type OrganisationOption,
} from './OrganisationSelector.js';
import { KPI_DOT } from '@/components/dashboards/charts/cockpit/palette';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { fmtPct } from '@/lib/format';

// Variables de la modale « méthode CO₂ » renvoyées par l'endpoint admin.
interface Co2Methode {
  forfait: { km: number; fe_camion: number };
  flux: Co2FluxFactor[];
  ag?: { facteur_par_repas: number; source: string | null };
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` (affichage FR de la période analysée). */
function frDate(iso?: string): string {
  return iso ? iso.split('-').reverse().join('/') : '—';
}

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
  co2: Co2Totals;
  facteursCo2: FacteursCo2;
  co2Methode: Co2Methode;
  blocs: {
    topLieux: LieuItem[];
    topActeurs: ActeurItem[];
    acteurLabel: 'Traiteur';
    topAssociations: AssociationItem[] | null;
  };
}

const STORAGE_KEY = 'savr.dashboard-client.organisations';
const BENCHMARK_ENDPOINT = '/api/v1/admin/dashboard-client/benchmark';
const BENCHMARK_FILTRES_ENDPOINT = `${BENCHMARK_ENDPOINT}/filtres`;

// Ligne de référence du radar (réponse de BENCHMARK_ENDPOINT).
interface ReferenceRadar {
  kgParPaxParFlux: Record<string, number>;
  nbCollectes: number;
  periode: { debut: string; fin: string };
}

/** Paramètres de requête de la ligne de référence (CSV, vides omis). */
function benchmarkQuery(f: BenchmarkFilters): string {
  const p = new URLSearchParams();
  if (f.traiteur_ids.length) p.set('traiteur_ids', f.traiteur_ids.join(','));
  if (f.lieu_ids.length) p.set('lieu_ids', f.lieu_ids.join(','));
  if (f.type_evenement_ids.length)
    p.set('type_evenement_ids', f.type_evenement_ids.join(','));
  if (f.taille_evenement_codes.length)
    p.set('taille_evenement_codes', f.taille_evenement_codes.join(','));
  return p.toString();
}

/**
 * Dashboard Client (§06.06 §2) — vue Admin LECTURE SEULE répliquant le dashboard
 * gestionnaire (§06.05), agrégée sur le périmètre d'organisations sélectionné.
 * « Toutes les organisations » (défaut) = totalité des collectes Savr.
 * La sélection est persistée/restaurée via localStorage. Aucune écriture.
 *
 * R24c — Déclinaison Cockpit COMPLÈTE (retour Val « je ne vois pas les graphs ») :
 * KPIs StatCard (dont CO₂ évité → modale) + évolution EvolutionZd/AgChart +
 * donut TonnagesDonut + radar Cockpit BenchmarkRadar + Top listes
 * TopRankList (lieux / traiteurs / associations). LECTURE
 * SEULE au sens DONNÉES (aucune écriture, aucune action métier) ; les Top lieux /
 * traiteurs sont cliquables → drill-down vers /admin/collectes filtrée (miroir
 * exact, retour Val R24c ; « traiteur » = traiteur OPÉRATIONNEL). Le périmètre
 * cross-org est agrégé côté serveur (service_role) par /api/v1/admin/dashboard-client.
 */
export function DashboardClientView() {
  const router = useRouter();
  const [organisations, setOrganisations] = useState<OrganisationOption[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  // Même périmètre, période précédente équivalente (N-1) — variation des cartes
  // KPI (§06.05 l.136, dont le Dashboard Client est la reprise exacte §06.06 §2).
  const [payloadPrev, setPayloadPrev] = useState<AdminPayload | null>(null);
  // Ligne de référence du radar + filtres « Comparer avec » (émis par la barre
  // au montage, puis à chaque changement).
  const [reference, setReference] = useState<ReferenceRadar | null>(null);
  // Référence injoignable (403/500/réseau) : dit, pas muet (axes « n/d » seuls).
  const [referenceErreur, setReferenceErreur] = useState(false);
  const [benchFilters, setBenchFilters] = useState<BenchmarkFilters | null>(
    null,
  );
  // Au remontage, la barre repart de `initialFilters` (le MÊME objet) et le
  // ré-émet : setState identique = pas de rendu, pas de re-fetch.
  const [loading, setLoading] = useState(true);
  // Modales « Impact carbone » (méthode de calcul) — ZD et AG distinctes.
  const [co2ModalOpen, setCo2ModalOpen] = useState(false);
  const [co2AgModalOpen, setCo2AgModalOpen] = useState(false);
  const hydrated = useRef(false);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);

  // Liste des organisations pour le sélecteur.
  useEffect(() => {
    fetch('/api/v1/admin/dashboard-client/organisations')
      .then((r) => r.json())
      .then((j: { data?: OrganisationOption[] }) => {
        const liste = j.data ?? [];
        setOrganisations(liste);
        // Une sélection mémorisée d'une organisation disparue filtrerait en
        // silence (aucun filtre ne l'affiche) → retirée dès la liste connue.
        if (liste.length > 0) {
          const ids = new Set(liste.map((o) => o.id));
          setSelectedOrgs((sel) =>
            sel.every((id) => ids.has(id))
              ? sel
              : sel.filter((id) => ids.has(id)),
          );
        }
      })
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

    const fenetrePrev = previousWindow(filters.from, filters.to);
    const qsPrev = new URLSearchParams(qs);
    if (fenetrePrev) {
      qsPrev.set('from', fenetrePrev.from);
      qsPrev.set('to', fenetrePrev.to);
    }
    const lire = (q: URLSearchParams): Promise<AdminPayload | null> =>
      fetch(`/api/v1/admin/dashboard-client?${q.toString()}`)
        .then((r) => r.json())
        .then((j: { data?: AdminPayload }) => j.data ?? null);
    // Une réponse d'un périmètre déjà remplacé (cases cochées en rafale) est
    // ignorée au lieu d'écraser la plus récente.
    let perimee = false;
    Promise.all([
      lire(qs),
      // N-1 non bloquant : un échec ne masque que les variations.
      fenetrePrev ? lire(qsPrev).catch(() => null) : Promise.resolve(null),
    ])
      .then(([courant, precedent]) => {
        if (perimee) return;
        setPayload(courant);
        setPayloadPrev(precedent);
      })
      .catch(() => {
        if (perimee) return;
        setPayload(null);
        setPayloadPrev(null);
      })
      .finally(() => {
        if (!perimee) setLoading(false);
      });
    return () => {
      perimee = true;
    };
  }, [filters, tab, selectedOrgs]);

  // Ligne de référence du radar (Bloc 3 ZD) — « Moyenne parc » paramétrable par
  // l'encart « Comparer avec » (décision Val 2026-10-02) : parc entier par défaut,
  // ou le périmètre des filtres (ex. un autre traiteur), sans k-anonymat côté
  // Admin. Indépendante du périmètre sélectionné (ligne « Vous »). Onglet ZD seul.
  useEffect(() => {
    // Référence vidée dès le changement de filtres : la légende et les valeurs
    // affichées décrivent toujours la même sélection (pas d'état mixte).
    setReference(null);
    setReferenceErreur(false);
    if (tab !== 'zero_dechet' || !benchFilters) return;
    const qs = benchmarkQuery(benchFilters);
    let perimee = false;
    fetch(qs ? `${BENCHMARK_ENDPOINT}?${qs}` : BENCHMARK_ENDPOINT)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((j: { data?: ReferenceRadar }) => {
        if (perimee) return;
        if (j.data?.kgParPaxParFlux) setReference(j.data);
        else setReferenceErreur(true);
      })
      .catch(() => {
        if (!perimee) setReferenceErreur(true);
      });
    return () => {
      perimee = true;
    };
  }, [tab, benchFilters]);

  const kpi = payload?.kpi ?? null;
  const isEmpty = !kpi || kpi.nb_collectes === 0;
  const zdKpi = tab === 'zero_dechet' ? (kpi as ZdKpi | null) : null;
  const agKpi = tab === 'anti_gaspi' ? (kpi as AgKpi | null) : null;
  const kpiPrev = payloadPrev?.kpi ?? null;
  const zdPrev = tab === 'zero_dechet' ? (kpiPrev as ZdKpi | null) : null;
  const agPrev = tab === 'anti_gaspi' ? (kpiPrev as AgKpi | null) : null;
  const co2PrevKg = payloadPrev?.co2?.eviteKg ?? 0;
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

  const gaugeItems = benchmarkItems(
    FLUX_ZD.map((f) => ({ code: f.code, label: f.label })),
    payload?.kgParPaxParFlux ?? {},
    reference?.kgParPaxParFlux ?? {},
  );
  // Référence « ciblée » dès qu'un lieu ou un traiteur est filtré : la ligne ne
  // décrit plus la moyenne du parc mais le périmètre comparé.
  const referenceCiblee =
    !!benchFilters &&
    (benchFilters.traiteur_ids.length > 0 || benchFilters.lieu_ids.length > 0);
  const referenceLabel = referenceCiblee ? 'Périmètre comparé' : 'Moyenne parc';
  const nbRef = reference?.nbCollectes ?? 0;

  // Drill-down Top listes → /admin/collectes filtrée (miroir EXACT du chiffre :
  // type + statut cloturee + période + MÊME périmètre d'organisations sélectionné).
  // Le « traiteur » = traiteur OPÉRATIONNEL (décision Val R24c) → param `traiteur`
  // mappé à traiteur_operationnel côté liste. Le périmètre (`perimetre`, N ids) est
  // propagé pour que le chiffre du Top 5 (borné au périmètre) = la liste (sinon on
  // renverrait un sur-ensemble, tous programmateurs confondus).
  const perimetreQs = selectedOrgs.map((id) => `&perimetre=${id}`).join('');
  const drillScope = `type=${tab}&statut=cloturee${
    filters ? `&from=${filters.from}&to=${filters.to}` : ''
  }${perimetreQs}`;
  const goToLieu = (i: number) => {
    const l = blocs?.topLieux?.[i];
    if (!l) return;
    setCollecteFiltreLabel({ kind: 'lieu', id: l.lieu_id, label: l.lieu_nom });
    router.push(`/admin/collectes?lieu=${l.lieu_id}&${drillScope}`);
  };
  const goToTraiteur = (i: number) => {
    const a = blocs?.topActeurs?.[i];
    if (!a) return;
    setCollecteFiltreLabel({ kind: 'traiteur', id: a.id, label: a.label });
    router.push(`/admin/collectes?traiteur=${a.id}&${drillScope}`);
  };

  // ── CO₂ évité (5e carte KPI + modale « Impact carbone ») ─────────────────────
  const co2 = payload?.co2 ?? {
    eviteKg: 0,
    induitKg: 0,
    netKg: 0,
    energieKwh: 0,
  };
  const facteursCo2 = payload?.facteursCo2 ?? FACTEURS_CO2_DEFAUT;
  const co2Methode = payload?.co2Methode;
  const co2Masse = fmtMasse(co2.eviteKg);
  const equivalences = co2Equivalences(co2, facteursCo2);
  const periodeFrom = filters?.from;
  const periodeTo = filters?.to;
  const nbCollectes = kpi?.nb_collectes ?? 0;

  return (
    <div className="space-y-6" data-testid="dashboard-client">
      <PageHeader
        title="Dashboard Client"
        tone="neutral"
        icon={<Eye className="h-6 w-6 text-savr-neutral-600" />}
        actions={
          <Badge variant="info" data-testid="lecture-seule-badge">
            Lecture seule
          </Badge>
        }
      />

      {/* Même barre que la liste Collectes (décision Val 2026-09-30) :
          Période puis organisations par type ; « Réinitialiser » rétablit
          aussi toutes les organisations (§06.06 §2). */}
      <DashboardFilterBar
        storageKey="savr.dashboard-client.filters"
        onChange={handleFilters}
        onReset={() => setSelectedOrgs([])}
        enCarte
      >
        <OrganisationSelector
          organisations={organisations}
          selected={selectedOrgs}
          onChange={setSelectedOrgs}
        />
      </DashboardFilterBar>

      <div className="flex justify-end">
        <ToggleTypeCollecte value={tab} onChange={setTab} />
      </div>

      {loading ? (
        <Text>Chargement…</Text>
      ) : isEmpty ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' && zdKpi ? (
        <>
          {/* Bloc 1 — KPIs Cockpit (5 cartes ZD, lecture seule ; seule la carte
              CO₂ ouvre une modale d'info — pas une navigation). */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Nombre de collectes"
              value={fmtInt(zdKpi.nb_collectes)}
              dotColor={KPI_DOT.navy}
              variationPct={variationPct(
                zdKpi.nb_collectes,
                zdPrev?.nb_collectes ?? 0,
              )}
              sparkPoints={sparkFromSeries(zdSeries, (p) => p.nb_collectes)}
            />
            <StatCard
              label="Tonnage collecté"
              value={fmtMasse(zdKpi.tonnage_kg ?? 0).value}
              unit={fmtMasse(zdKpi.tonnage_kg ?? 0).unit}
              dotColor={KPI_DOT.navy2}
              variationPct={variationPct(
                zdKpi.tonnage_kg ?? 0,
                zdPrev?.tonnage_kg ?? 0,
              )}
              sparkPoints={sparkFromSeries(zdSeries, (p) => p.tonnage_total)}
            />
            <StatCard
              label="Taux de recyclage"
              value={
                zdKpi.taux_recyclage_pondere != null
                  ? fmtDec(zdKpi.taux_recyclage_pondere, 1)
                  : '—'
              }
              unit={zdKpi.taux_recyclage_pondere != null ? '%' : undefined}
              dotColor={KPI_DOT.green}
              variationPct={variationPct(
                zdKpi.taux_recyclage_pondere ?? 0,
                zdPrev?.taux_recyclage_pondere ?? 0,
              )}
              sparkPoints={sparkFromSeries(zdSeries, (p) => p.taux_recyclage)}
              sparkColor={KPI_DOT.green}
            />
            {/* kg/pax : sparkline seule, pas de variation (sens « plus bas =
                mieux », §06.05 l.136). */}
            <StatCard
              label="kg/pax moyen"
              value={
                zdKpi.kg_par_pax != null ? fmtDec(zdKpi.kg_par_pax, 2) : '—'
              }
              unit={zdKpi.kg_par_pax != null ? 'kg/pax' : undefined}
              dotColor={KPI_DOT.navy3}
              sparkPoints={sparkFromSeries(zdSeries, (p) =>
                p.pax ? p.tonnage_total / p.pax : 0,
              )}
            />
            <StatCard
              label="CO₂ évité"
              value={co2Masse.value}
              unit={`${co2Masse.unit} CO₂e`}
              dotColor={KPI_DOT.green}
              variationPct={variationPct(co2.eviteKg, co2PrevKg)}
              sparkPoints={sparkFromSeries(zdSeries, (p) => p.co2_evite_kg)}
              sparkColor={KPI_DOT.green}
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

          {/* Modale « Impact carbone » ZD — héros CO₂ + méthode de calcul. */}
          <Modal
            open={co2ModalOpen}
            onClose={() => setCo2ModalOpen(false)}
            title="Détail de l'impact carbone"
            wide
          >
            <div className="space-y-5">
              <Text size="xs-plus">
                Période analysée :{' '}
                <span className="font-semibold text-savr-neutral-700">
                  du {frDate(periodeFrom)} au {frDate(periodeTo)}
                </span>{' '}
                · {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''} clôturée
                {nbCollectes > 1 ? 's' : ''} Zéro Déchet
              </Text>
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
          <div data-testid="bloc-2-dashboard-client">
            <EvolutionZdChart series={zdSeries} granularite={granularite} />
          </div>

          {/* Bloc 3 ZD — radar Cockpit : périmètre sélectionné (« Vous ») vs
              ligne de référence paramétrable (encart « Comparer avec », sans
              k-anonymat côté Admin — décision Val 2026-10-02). */}
          <BenchmarkRadar
            items={gaugeItems}
            title={
              referenceCiblee
                ? 'Intensité par flux · kg/pax vs périmètre comparé'
                : undefined
            }
            subtitle="Indice : référence = 100 (parc Savr entier, ou périmètre des filtres « Comparer avec »). À l'intérieur du repère, le périmètre sélectionné produit moins que la référence."
            referenceLabel={referenceLabel}
            referenceCourt={referenceCiblee ? 'Comparé' : 'Parc'}
            filtersSlot={
              <div className="space-y-2">
                <BenchmarkFilterBar
                  onChange={setBenchFilters}
                  filtresEndpoint={BENCHMARK_FILTRES_ENDPOINT}
                  avertissementComparaisonSoi={false}
                  // Le bloc ZD se démonte pendant « Chargement… » (changement de
                  // périmètre/période) : la barre repart de la dernière sélection.
                  initialFilters={benchFilters ?? undefined}
                />
                {reference && (
                  <Text
                    as="p"
                    variant="hint"
                    size="2xs"
                    data-testid="benchmark-reference-echantillon"
                  >
                    Référence : {fmtInt(nbRef)} collecte{nbRef > 1 ? 's' : ''}{' '}
                    clôturée{nbRef > 1 ? 's' : ''} Zéro Déchet du{' '}
                    {frDate(reference.periode.debut)} au{' '}
                    {frDate(reference.periode.fin)}, sans seuil d'anonymisation
                    (vue Admin).
                  </Text>
                )}
                {referenceErreur && (
                  <Text
                    as="p"
                    size="2xs"
                    className="text-savr-error"
                    data-testid="benchmark-reference-erreur"
                  >
                    Référence indisponible pour le moment : les écarts ne
                    peuvent pas être calculés.
                  </Text>
                )}
              </div>
            }
          />

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
                onItemClick={goToLieu}
                showBar
              />
            </div>
            <div data-testid="bloc-7-top-acteurs">
              <TopRankList
                title="Top 5 traiteurs"
                subtitle="Par nombre de collectes"
                items={withBars(topActeursItems)}
                onItemClick={goToTraiteur}
                showBar
              />
            </div>
          </div>
        </>
      ) : agKpi ? (
        <>
          {/* Bloc 1 — KPIs Cockpit AG (5 cartes, lecture seule ; CO₂ → modale) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Nombre de collectes"
              value={fmtInt(agKpi.nb_collectes)}
              dotColor={KPI_DOT.navy}
              variationPct={variationPct(
                agKpi.nb_collectes,
                agPrev?.nb_collectes ?? 0,
              )}
              sparkPoints={sparkFromSeries(agSeries, (p) => p.nb_collectes)}
            />
            <StatCard
              label="Repas donnés"
              value={fmtInt(agKpi.nb_repas_donnes ?? 0)}
              dotColor={KPI_DOT.accent}
              variationPct={variationPct(
                agKpi.nb_repas_donnes ?? 0,
                agPrev?.nb_repas_donnes ?? 0,
              )}
              sparkPoints={sparkFromSeries(agSeries, (p) => p.repas_donnes)}
              sparkColor={KPI_DOT.accent}
            />
            <StatCard
              label="Pax cumulés"
              value={fmtInt(agKpi.pax_total ?? 0)}
              dotColor={KPI_DOT.navy2}
              variationPct={variationPct(
                agKpi.pax_total ?? 0,
                agPrev?.pax_total ?? 0,
              )}
              sparkPoints={sparkFromSeries(agSeries, (p) => p.pax)}
            />
            <StatCard
              label="Repas/pax moyen"
              value={
                agKpi.repas_par_pax != null
                  ? fmtDec(agKpi.repas_par_pax, 2)
                  : '—'
              }
              dotColor={KPI_DOT.navy3}
              sparkPoints={sparkFromSeries(agSeries, (p) => p.ratio)}
            />
            <StatCard
              label="CO₂ évité"
              value={co2Masse.value}
              unit={`${co2Masse.unit} CO₂e`}
              dotColor={KPI_DOT.green}
              variationPct={variationPct(co2.eviteKg, co2PrevKg)}
              sparkPoints={sparkFromSeries(agSeries, (p) => p.co2_evite_kg)}
              sparkColor={KPI_DOT.green}
              onClick={
                co2.eviteKg > 0 ? () => setCo2AgModalOpen(true) : undefined
              }
              headerRight={
                co2.eviteKg > 0 ? (
                  <Info aria-hidden className="h-4 w-4 text-savr-neutral-400" />
                ) : undefined
              }
            />
          </div>

          {/* Modale « Impact carbone » AG — héros allégé (évité seul) + méthode
              par repas (facteur FAO × repas donnés). */}
          <Modal
            open={co2AgModalOpen}
            onClose={() => setCo2AgModalOpen(false)}
            title="Détail de l'impact carbone"
            wide
          >
            <div className="space-y-5">
              <Text size="xs-plus">
                Période analysée :{' '}
                <span className="font-semibold text-savr-neutral-700">
                  du {frDate(periodeFrom)} au {frDate(periodeTo)}
                </span>{' '}
                · {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''} clôturée
                {nbCollectes > 1 ? 's' : ''} Anti-Gaspi
              </Text>
              <Co2HeroCard
                variant="ag"
                eviteKg={co2.eviteKg}
                equivalences={{
                  kmVoiture: equivalences.kmVoiture,
                  repasBoeuf: equivalences.repasBoeuf,
                }}
              />
              <Co2MethodePanelAg
                facteurParRepas={co2Methode?.ag?.facteur_par_repas ?? 2.5}
                source={co2Methode?.ag?.source ?? null}
                repasDonnes={agKpi.nb_repas_donnes ?? 0}
                eviteKg={co2.eviteKg}
                equivalences={facteursCo2}
              />
            </div>
          </Modal>

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
                onItemClick={goToLieu}
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
              onItemClick={goToTraiteur}
              showBar
            />
          </div>
        </>
      ) : (
        <EmptyDashboardState />
      )}
    </div>
  );
}
