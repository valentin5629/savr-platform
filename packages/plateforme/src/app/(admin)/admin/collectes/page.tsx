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

// Chips prédéfinis Programmées (§06.06 §3) — `key` = valeur du paramètre `chip`.
const CHIPS_PROGRAMMEES = [
  { key: '', label: 'Toutes' },
  { key: 'non_transmises', label: 'Non transmises au TMS' },
  { key: 'attente_prestataire', label: 'En attente prestataire' },
  { key: 'dirty_tms', label: 'Modifiées sans renvoi TMS' },
  { key: 'ag_attente_attribution', label: 'AG en attente attribution' },
  { key: 'zd_48h', label: 'ZD 48 h' },
  { key: 'ag_48h', label: 'AG 48 h' },
];

// Filtres rapides Historique — mappés sur type / statuts (pas de chip serveur).
const CHIPS_HISTORIQUE = [
  { key: '', label: 'Toutes' },
  { key: 'ag', label: 'Anti-Gaspi' },
  { key: 'zd', label: 'Zéro Déchet' },
  { key: 'annulee', label: 'Annulées' },
];

type Tab = 'programmees' | 'historique';

// KPI « à dispatcher » cliquable (Programmées) — filtre par type.
function KpiTile({
  type,
  count,
  active,
  onClick,
}: {
  type: 'anti_gaspi' | 'zero_dechet';
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const ag = type === 'anti_gaspi';
  const Icone = ag ? UtensilsCrossed : Leaf;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-4 rounded-savr-lg border bg-savr-white px-5 py-4 text-left shadow-savr-sm transition-[border-color,box-shadow,transform] duration-[120ms] hover:-translate-y-px hover:border-savr-primary-200 hover:shadow-savr-md ${
        active
          ? 'border-savr-primary-700 shadow-[0_0_0_1px_var(--color-savr-primary-700)]'
          : 'border-savr-neutral-200'
      }`}
    >
      <span
        className={`grid h-[46px] w-[46px] place-items-center rounded-savr-md ${
          ag
            ? 'bg-savr-warning-subtle text-savr-warning-strong'
            : 'bg-savr-success-subtle text-savr-success-strong'
        }`}
      >
        <Icone className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <div className="text-3xl font-extrabold leading-none tracking-tight text-savr-neutral-900 tabular-nums">
          {count}
        </div>
        <div className="mt-1 text-sm font-bold text-savr-neutral-800">
          {ag ? 'AG' : 'ZD'} à dispatcher
        </div>
        <div className="text-xs font-semibold text-savr-neutral-500">
          validées transporteur
        </div>
      </div>
      <ArrowRight className="ml-auto h-5 w-5 text-savr-neutral-300" />
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
  const [quickFilter, setQuickFilter] = useState('');
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

  const chips = tab === 'programmees' ? CHIPS_PROGRAMMEES : CHIPS_HISTORIQUE;
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
          <Link href="/admin/collectes/nouvelle">
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

      {/* Segment Programmées / Historique */}
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

      {/* KPI « à dispatcher » (Programmées uniquement) */}
      {tab === 'programmees' && (
        <div className="grid gap-3.5 sm:max-w-[660px] sm:grid-cols-2">
          <KpiTile
            type="anti_gaspi"
            count={chipCounts.ag_a_dispatcher ?? 0}
            active={!quickFilter && type === 'anti_gaspi'}
            onClick={() => {
              setQuickFilter('');
              setType((t) => (t === 'anti_gaspi' ? '' : 'anti_gaspi'));
              setPage(1);
            }}
          />
          <KpiTile
            type="zero_dechet"
            count={chipCounts.zd_a_dispatcher ?? 0}
            active={!quickFilter && type === 'zero_dechet'}
            onClick={() => {
              setQuickFilter('');
              setType((t) => (t === 'zero_dechet' ? '' : 'zero_dechet'));
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
