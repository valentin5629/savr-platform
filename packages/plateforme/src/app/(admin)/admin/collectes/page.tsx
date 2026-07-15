'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Truck,
  Plus,
  UtensilsCrossed,
  Leaf,
  ArrowRight,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  IdCard,
  FileWarning,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';
import { PageHero } from '@/components/ui/page-hero';
import { FilterChips } from '@/components/ui/filter-chips';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CollecteCard,
  groupBySemaine,
  type CollecteRow,
} from '@/components/ui/collecte-card';
import { statutCollecteDisplay } from '@/lib/statut-collecte-labels';

// Onglets = preset du filtre `statuts` (à venir vs terminaux), via l'API existante.
const STATUTS_PROGRAMMEES = ['programmee', 'validee', 'en_cours'];
const STATUTS_HISTORIQUE = [
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'rejetee_par_prestataire',
];

// Catalogue des chips Programmées (§06.06 §3) — `key` = valeur du paramètre `chip`.
// Inclut des chips MASQUÉS de la rangée par défaut mais conservés comme cibles de
// drill-down depuis le Dashboard Admin (?chip=…, cartes Bloc 1). Prédicats : lib/collectes-chips.
const CHIPS_PROGRAMMEES_CATALOGUE = [
  { key: '', label: 'Toutes' },
  { key: 'non_transmises_zd', label: 'Non transmises ZD' },
  { key: 'non_transmises_ag', label: 'Non transmises AG' },
  { key: 'attente_prestataire', label: 'En attente prestataire' },
  { key: 'dirty_tms', label: 'Modifiées sans renvoi TMS' },
  { key: 'ag_attente_attribution', label: 'AG en attente attribution' },
  { key: 'zd_48h', label: 'ZD 48 h' },
  { key: 'ag_48h', label: 'AG 48 h' },
];

// Chips masqués de la rangée par défaut (décision Val 2026-07-15) : ils restent des
// cibles de drill-down Dashboard Admin et ne s'affichent que s'ils sont le filtre
// actif à l'arrivée (sinon la liste serait filtrée sans indicateur visible).
const CHIPS_PROGRAMMEES_MASQUES = new Set([
  'non_transmises_zd',
  'non_transmises_ag',
  'zd_48h',
  'ag_48h',
]);

const CHIPS_PROGRAMMEES = CHIPS_PROGRAMMEES_CATALOGUE.filter(
  (c) => !CHIPS_PROGRAMMEES_MASQUES.has(c.key),
);

// Filtres rapides Historique — mappés sur type / statuts (pas de chip serveur).
const CHIPS_HISTORIQUE = [
  { key: '', label: 'Toutes' },
  { key: 'ag', label: 'Anti-Gaspi' },
  { key: 'zd', label: 'Zéro Déchet' },
  { key: 'annulee', label: 'Annulées' },
];

type Tab = 'programmees' | 'historique';

type KpiTone = 'warning' | 'success' | 'info' | 'error';

const KPI_TONE: Record<KpiTone, string> = {
  warning: 'bg-savr-warning-subtle text-savr-warning-strong',
  success: 'bg-savr-success-subtle text-savr-success-strong',
  info: 'bg-savr-info-subtle text-savr-info-strong',
  error: 'bg-savr-error-subtle text-savr-error-strong',
};

// Tuile KPI de tête de la liste Collectes. Statique (indicateur pur) quand
// `onClick` est absent ; sinon bouton-filtre cliquable (aria-pressed + flèche
// de drill-down), état actif encadré comme les chips.
function KpiTile({
  icon: Icone,
  count,
  label,
  sublabel,
  tone,
  active,
  onClick,
}: {
  icon: LucideIcon;
  count: number;
  label: string;
  sublabel: string;
  tone: KpiTone;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={`grid h-[46px] w-[46px] shrink-0 place-items-center rounded-savr-md ${KPI_TONE[tone]}`}
      >
        <Icone className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-3xl font-extrabold leading-none tracking-tight text-savr-neutral-900 tabular-nums">
          {count}
        </div>
        <div className="mt-1 text-sm font-bold text-savr-neutral-800">
          {label}
        </div>
        <div className="text-xs font-semibold text-savr-neutral-500">
          {sublabel}
        </div>
      </div>
      {onClick && (
        <ArrowRight className="ml-auto h-5 w-5 shrink-0 text-savr-neutral-300" />
      )}
    </>
  );
  const shell =
    'flex items-center gap-4 rounded-savr-lg border bg-savr-white px-5 py-4 text-left shadow-savr-sm';
  if (!onClick) {
    return <div className={`${shell} border-savr-neutral-200`}>{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${shell} transition-[border-color,box-shadow,transform] duration-[120ms] hover:-translate-y-px hover:border-savr-primary-200 hover:shadow-savr-md ${
        active
          ? 'border-savr-primary-700 shadow-[0_0_0_1px_var(--color-savr-primary-700)]'
          : 'border-savr-neutral-200'
      }`}
    >
      {body}
    </button>
  );
}

export default function CollectesPage() {
  const router = useRouter();
  const params = useSearchParams();
  // Drill-down depuis les Top listes du Dashboard Client Admin (miroir exact) :
  // lieu / traiteur (OPÉRATIONNEL, décision Val R24c) + type + statut + période.
  const drillLieu = params.get('lieu');
  const drillTraiteur = params.get('traiteur');
  // Drill-down depuis les cartes-actions du Dashboard Admin (Bloc 1) : chip
  // prédéfini « Programmées » pré-sélectionné à l'arrivée (miroir exact du compteur).
  const drillChip = params.get('chip');
  const drillType = params.get('type');
  const drillStatut = params.get('statut');
  const drillFrom = params.get('from');
  const drillTo = params.get('to');
  // Périmètre d'organisations propagé par le drill-down (miroir exact du chiffre
  // du dashboard, borné au même périmètre). Figé au montage (getAll = nouveau
  // tableau à chaque render → capté en state pour rester stable dans les deps).
  const [perimetreOrgIds, setPerimetreOrgIds] = useState<string[]>(() =>
    params.getAll('perimetre'),
  );
  const hasDrill = !!(drillLieu || drillTraiteur);

  const [tab, setTab] = useState<Tab>(hasDrill ? 'historique' : 'programmees');
  const [collectes, setCollectes] = useState<CollecteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Filtre rapide de l'onglet actif : chip Programmées OU filtre Historique.
  // Pré-sélectionné depuis le drill-down Dashboard Admin (`?chip=`) s'il désigne
  // un chip « Programmées » connu → la liste s'ouvre déjà filtrée + chip actif.
  const [quickFilter, setQuickFilter] = useState(
    drillChip && CHIPS_PROGRAMMEES_CATALOGUE.some((c) => c.key === drillChip)
      ? drillChip
      : '',
  );
  const [type, setType] = useState(drillType ?? '');
  const [traiteurId, setTraiteurId] = useState(drillTraiteur ?? '');
  const [lieuId, setLieuId] = useState(drillLieu ?? '');
  const [from, setFrom] = useState(drillFrom ?? '');
  const [to, setTo] = useState(drillTo ?? '');
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Statut (multi-sélection, §06.06 §3) : scopé aux valeurs valides de l'onglet
  // actif ; vide = preset de l'onglet. Info incomplète / rapport non consulté :
  // booléens indépendants de l'onglet.
  const [statutsSel, setStatutsSel] = useState<string[]>(
    drillStatut ? [drillStatut] : [],
  );
  // Libellé humain du filtre de drill-down (lieu / traiteur), lu du sessionStorage
  // posé par le dashboard (fallback null → chip générique).
  const [drillLabel] = useState<string | null>(() => {
    if (drillLieu) return readCollecteFiltreLabel('lieu', drillLieu);
    if (drillTraiteur)
      return readCollecteFiltreLabel('traiteur', drillTraiteur);
    return null;
  });
  const [drillActive, setDrillActive] = useState(hasDrill);
  const [infoIncomplete, setInfoIncomplete] = useState(false);
  // « Plaques à envoyer » = contrôle d'accès requis (KPI de tête cliquable).
  const [controleAcces, setControleAcces] = useState(false);
  const [rapportNonConsulte, setRapportNonConsulte] = useState(false);
  const [page, setPage] = useState(1);
  const [traiteurs, setTraiteurs] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [lieux, setLieux] = useState<{ id: string; label: string }[]>([]);
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({});

  // Compteurs chips + KPI « à dispatcher » — chargés une fois au montage.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/admin/collectes/chip-counts')
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: unknown) => {
        if (!cancelled && j && typeof j === 'object') {
          setChipCounts(j as Record<string, number>);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Listes complètes (traiteurs + lieux) pour les menus déroulants.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const trAll: { id: string; label: string }[] = [];
      for (let p = 1; p <= 20; p++) {
        const res = await fetch(
          `/api/v1/admin/organisations?type=traiteur&page=${p}`,
        );
        if (!res.ok) break;
        const j = (await res.json()) as {
          data: { id: string; raison_sociale: string }[];
          limit?: number;
        };
        trAll.push(
          ...j.data.map((o) => ({ id: o.id, label: o.raison_sociale })),
        );
        if (j.data.length < (j.limit ?? 50)) break;
      }
      if (!cancelled)
        setTraiteurs(trAll.sort((a, b) => a.label.localeCompare(b.label)));

      const lxAll: { id: string; label: string }[] = [];
      for (let p = 1; p <= 40; p++) {
        const res = await fetch(`/api/v1/admin/lieux?page=${p}`);
        if (!res.ok) break;
        const j = (await res.json()) as {
          data: { id: string; nom: string; ville: string | null }[];
        };
        lxAll.push(
          ...j.data.map((l) => ({
            id: l.id,
            label: l.ville ? `${l.nom} — ${l.ville}` : l.nom,
          })),
        );
        if (j.data.length < 50) break;
      }
      if (!cancelled)
        setLieux(lxAll.sort((a, b) => a.label.localeCompare(b.label)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchCollectes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });

    if (tab === 'programmees') {
      if (quickFilter) {
        // Chemin chip serveur (les chips sont tous à portée « Programmées »).
        params.set('chip', quickFilter);
      } else {
        params.set(
          'statuts',
          statutsSel.length > 0
            ? statutsSel.join(',')
            : STATUTS_PROGRAMMEES.join(','),
        );
        if (type) params.set('type', type);
      }
    } else {
      // Historique : preset terminaux, raffiné par le filtre rapide.
      if (quickFilter === 'annulee') {
        params.set('statuts', 'annulee,rejetee_par_prestataire');
      } else {
        params.set(
          'statuts',
          statutsSel.length > 0
            ? statutsSel.join(',')
            : STATUTS_HISTORIQUE.join(','),
        );
        if (quickFilter === 'ag') params.set('type', 'anti_gaspi');
        else if (quickFilter === 'zd') params.set('type', 'zero_dechet');
        else if (type) params.set('type', type);
      }
    }

    // Filtres avancés (communs, hors chemin chip Programmées).
    if (!(tab === 'programmees' && quickFilter)) {
      // « Traiteur » = traiteur OPÉRATIONNEL (décision Val R24c) → miroir exact du
      // Top 5 traiteurs des dashboards (agrégé par traiteur_operationnel).
      if (traiteurId) params.set('traiteur_operationnel_id', traiteurId);
      if (lieuId) params.set('lieu_id', lieuId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      // Périmètre d'organisations du drill-down (miroir exact du chiffre borné).
      for (const id of perimetreOrgIds)
        params.append('perimetre_org_ids[]', id);
      if (infoIncomplete) params.set('info_incomplete', 'true');
      if (controleAcces) params.set('controle_acces', 'true');
      if (rapportNonConsulte) params.set('rapport_non_consulte', 'true');
    }

    const res = await fetch(`/api/v1/admin/collectes?${params}`);
    if (res.ok) {
      const json = (await res.json()) as { data: CollecteRow[]; total: number };
      setCollectes(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [
    tab,
    page,
    quickFilter,
    type,
    statutsSel,
    traiteurId,
    lieuId,
    from,
    to,
    perimetreOrgIds,
    infoIncomplete,
    controleAcces,
    rapportNonConsulte,
  ]);

  useEffect(() => {
    void fetchCollectes();
  }, [fetchCollectes]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setQuickFilter('');
    setType('');
    setStatutsSel([]);
    setPage(1);
  };

  const toggleStatut = (s: string) => {
    setStatutsSel((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
    setPage(1);
  };

  // Recherche texte = filtre côté client sur la page chargée (traiteur, lieu,
  // ville, client, adresse) — l'API n'expose pas de recherche plein-texte.
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return collectes;
    return collectes.filter((c) => {
      const l = c.evenements.lieux;
      const hay = [
        c.evenements.organisations.raison_sociale,
        l.nom,
        l.ville,
        l.adresse_acces,
        c.evenements.client_organisateur?.raison_sociale,
        c.evenements.nom_client_organisateur,
        c.transporteur_nom,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [collectes, search]);

  const semaines = useMemo(
    () => groupBySemaine(visibles, tab === 'programmees' ? 'asc' : 'desc'),
    [visibles, tab],
  );

  // Rangée de chips : masqués retirés par défaut ; si le filtre actif EST un chip
  // masqué (drill-down dashboard), on le rajoute pour rendre son état actif visible.
  const chips =
    tab === 'programmees'
      ? quickFilter && CHIPS_PROGRAMMEES_MASQUES.has(quickFilter)
        ? [
            ...CHIPS_PROGRAMMEES,
            ...CHIPS_PROGRAMMEES_CATALOGUE.filter((c) => c.key === quickFilter),
          ]
        : CHIPS_PROGRAMMEES
      : CHIPS_HISTORIQUE;
  const totalPages = Math.max(1, Math.ceil(total / 50));

  // Efface le filtre de drill-down (lieu / traiteur venu du dashboard) → liste nue.
  const clearDrill = () => {
    setDrillActive(false);
    setTraiteurId('');
    setLieuId('');
    setType('');
    setStatutsSel([]);
    setFrom('');
    setTo('');
    setPerimetreOrgIds([]);
    setPage(1);
    router.replace('/admin/collectes');
  };
  const drillScope =
    drillActive && drillStatut === 'cloturee'
      ? `clôturées${
          periodeCourte(from, to) ? ` · ${periodeCourte(from, to)}` : ''
        }`
      : undefined;

  return (
    <div className="space-y-5">
      <PageHero
        icon={<Truck className="h-6 w-6 text-savr-primary-200" />}
        title="Collectes"
        subtitle="Liste unifiée Zéro Déchet + Anti-Gaspi · cliquez une carte pour ouvrir la fiche"
        actions={
          <Link href="/programmer/nouveau">
            <Button variant="accent">
              <Plus className="h-4 w-4" />
              Programmer une collecte
            </Button>
          </Link>
        }
      />

      {/* Filtre actif venu d'un drill-down du dashboard (Top listes). */}
      {drillActive && (
        <CollecteFiltreActif
          label={
            drillLabel ??
            (drillTraiteur ? 'Traiteur sélectionné' : 'Lieu sélectionné')
          }
          scope={drillScope}
          onClear={clearDrill}
        />
      )}

      {/* Segment Programmées / Historique + filtre par type (AG / ZD) */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Vue collectes"
          className="inline-flex rounded-savr-full border border-savr-neutral-200 bg-savr-white p-1 shadow-savr-sm"
        >
          {(
            [
              ['programmees', 'Programmées'],
              ['historique', 'Historique'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => changeTab(key)}
              className={`rounded-savr-full px-5 py-2 text-sm font-bold transition-colors duration-[120ms] ${
                tab === key
                  ? 'bg-savr-primary-700 text-savr-white'
                  : 'text-savr-neutral-500 hover:text-savr-primary-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filtre par type — s'applique à l'onglet actif (re-clic = tout type). */}
        <div
          role="group"
          aria-label="Filtrer par type"
          className="inline-flex rounded-savr-full border border-savr-neutral-200 bg-savr-white p-1 shadow-savr-sm"
        >
          {(
            [
              ['anti_gaspi', 'Anti-Gaspi', UtensilsCrossed],
              ['zero_dechet', 'Zéro Déchet', Leaf],
            ] as [string, string, LucideIcon][]
          ).map(([val, label, Icone]) => {
            const actif = !quickFilter && type === val;
            return (
              <button
                key={val}
                type="button"
                aria-pressed={actif}
                onClick={() => {
                  setQuickFilter('');
                  setType((t) => (t === val ? '' : val));
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-savr-full px-4 py-2 text-sm font-bold transition-colors duration-[120ms] ${
                  actif
                    ? 'bg-savr-primary-700 text-savr-white'
                    : 'text-savr-neutral-500 hover:text-savr-primary-700'
                }`}
              >
                <Icone className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI de tête (Programmées uniquement) : volumes à venir + files d'action.
          « à venir » = date_collecte ≥ aujourd'hui (décision Val 2026-07-15). */}
      {tab === 'programmees' && (
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
          {/* Ligne 1 : volumes à venir + plaque à récupérer (décision Val) */}
          <KpiTile
            icon={UtensilsCrossed}
            count={chipCounts.ag_a_venir ?? 0}
            label="AG à venir"
            sublabel="collectes à venir"
            tone="warning"
          />
          <KpiTile
            icon={Leaf}
            count={chipCounts.zd_a_venir ?? 0}
            label="ZD à venir"
            sublabel="collectes à venir"
            tone="success"
          />
          <KpiTile
            icon={IdCard}
            count={chipCounts.controle_acces_a_envoyer ?? 0}
            label="Plaque à récupérer"
            sublabel="contrôle d'accès requis"
            tone="info"
            active={!quickFilter && controleAcces}
            onClick={() => {
              setQuickFilter('');
              setControleAcces((v) => !v);
              setPage(1);
            }}
          />
          {/* Ligne 2 : files d'action à dispatcher + infos à récupérer */}
          <KpiTile
            icon={UtensilsCrossed}
            count={chipCounts.ag_a_dispatcher ?? 0}
            label="AG à dispatcher"
            sublabel="validées transporteur"
            tone="warning"
            active={!quickFilter && type === 'anti_gaspi'}
            onClick={() => {
              setQuickFilter('');
              setType((t) => (t === 'anti_gaspi' ? '' : 'anti_gaspi'));
              setPage(1);
            }}
          />
          <KpiTile
            icon={Leaf}
            count={chipCounts.zd_a_dispatcher ?? 0}
            label="ZD à dispatcher"
            sublabel="validées transporteur"
            tone="success"
            active={!quickFilter && type === 'zero_dechet'}
            onClick={() => {
              setQuickFilter('');
              setType((t) => (t === 'zero_dechet' ? '' : 'zero_dechet'));
              setPage(1);
            }}
          />
          <KpiTile
            icon={FileWarning}
            count={chipCounts.infos_a_recuperer ?? 0}
            label="Infos à récupérer"
            sublabel="infos traiteur manquantes"
            tone="warning"
            active={!quickFilter && infoIncomplete}
            onClick={() => {
              setQuickFilter('');
              setInfoIncomplete((v) => !v);
              setPage(1);
            }}
          />
        </div>
      )}

      {/* Filtres rapides + recherche + avancés */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips
          chips={chips.map((c) =>
            tab === 'programmees' && c.key
              ? { ...c, count: chipCounts[c.key] }
              : c,
          )}
          activeKey={quickFilter}
          ariaLabel="Filtres rapides"
          className="flex-1"
          onSelect={(key) => {
            setQuickFilter(key);
            setType('');
            setPage(1);
          }}
        />
        <label className="flex h-9 min-w-[190px] items-center gap-2 rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-savr-neutral-400">
          <Search className="h-4 w-4 shrink-0" />
          <input
            aria-label="Rechercher"
            placeholder="Traiteur, lieu, ville…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-savr-neutral-800 outline-none"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => setShowAdvanced((v) => !v)}
          className="h-9"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtres avancés
        </Button>
      </div>

      {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-savr-neutral-700">
              Type
            </label>
            <select
              aria-label="Filtrer par type"
              className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous types</option>
              <option value="zero_dechet">Zéro Déchet</option>
              <option value="anti_gaspi">Anti-Gaspi</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-savr-neutral-700">
              Traiteur
            </label>
            <select
              aria-label="Filtrer par traiteur"
              className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm"
              value={traiteurId}
              onChange={(e) => {
                setTraiteurId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous les traiteurs</option>
              {traiteurs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-savr-neutral-700">
              Lieu
            </label>
            <select
              aria-label="Filtrer par lieu"
              className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm"
              value={lieuId}
              onChange={(e) => {
                setLieuId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tous les lieux</option>
              {lieux.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-bold text-savr-neutral-700">
                Du
              </label>
              <input
                type="date"
                aria-label="Date de début"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-bold text-savr-neutral-700">
                Au
              </label>
              <input
                type="date"
                aria-label="Date de fin"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 text-sm"
              />
            </div>
          </div>

          {/* Statut — multi-sélection scopée aux valeurs de l'onglet actif */}
          <div className="sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-xs font-bold text-savr-neutral-700">
              Statut
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(tab === 'programmees'
                ? STATUTS_PROGRAMMEES
                : STATUTS_HISTORIQUE
              ).map((s) => {
                const active = statutsSel.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStatut(s)}
                    className={`rounded-savr-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
                        : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-600 hover:border-savr-primary-300'
                    }`}
                  >
                    {statutCollecteDisplay(s, 'admin').label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Booléens */}
          <div className="flex flex-wrap gap-4 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
              <input
                type="checkbox"
                checked={infoIncomplete}
                onChange={(e) => {
                  setInfoIncomplete(e.target.checked);
                  setPage(1);
                }}
              />
              Info incomplète
            </label>
            <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
              <input
                type="checkbox"
                checked={rapportNonConsulte}
                onChange={(e) => {
                  setRapportNonConsulte(e.target.checked);
                  setPage(1);
                }}
              />
              Rapport non consulté
            </label>
          </div>
        </div>
      )}

      {/* Liste par semaine */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-[86px] w-full rounded-savr-lg" />
          ))}
        </div>
      ) : semaines.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Aucune collecte"
          description="Aucune collecte ne correspond à ce filtre."
        />
      ) : (
        <div className="space-y-6">
          {semaines.map((sem) => (
            <section key={sem.key} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-savr-neutral-500">
                  {sem.label}
                </h2>
                <span className="rounded-savr-full bg-savr-neutral-100 px-2 py-0.5 text-[11px] font-extrabold text-savr-neutral-500 tabular-nums">
                  {sem.items.length}
                </span>
                <span className="h-px flex-1 bg-savr-neutral-200" />
              </div>
              <div className="space-y-3">
                {sem.items.map((c) => (
                  <CollecteCard key={c.id} collecte={c} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm text-savr-neutral-500">
          <span>
            {total} collecte{total > 1 ? 's' : ''}
            {search
              ? ` · ${visibles.length} affichée${visibles.length > 1 ? 's' : ''}`
              : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Page précédente"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="grid h-9 w-9 place-items-center rounded-savr-md border border-savr-neutral-200 bg-savr-white text-savr-neutral-600 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold tabular-nums text-savr-neutral-600">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              aria-label="Page suivante"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="grid h-9 w-9 place-items-center rounded-savr-md border border-savr-neutral-200 bg-savr-white text-savr-neutral-600 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
