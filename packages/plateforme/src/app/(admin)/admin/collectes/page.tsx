'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Truck,
  Plus,
  UtensilsCrossed,
  Leaf,
  ArrowRight,
  IdCard,
  FileWarning,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  ToggleTypeCollecte,
  type TypeCollecteFiltre,
} from '@/components/collecte/toggle-type-collecte';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';
import { PageHero } from '@/components/ui/page-hero';
import { FilterChips } from '@/components/ui/filter-chips';
import { EmptyState } from '@/components/ui/empty-state';
import { DataGrid, type SortingState } from '@/components/ui/data-grid';
import { ListFooter } from '@/components/ui/list-footer';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import {
  colonnesCollectesAdmin,
  estUrgente,
  urgentesEnTete,
  type CollecteRow,
} from '@/components/admin/collectes-table';
import { formatDateHeure } from '@/lib/format-date-collecte';
import { statutCollecteDisplay } from '@/lib/statut-collecte-labels';
import { CollecteDetailModal } from '@/components/admin/collecte-detail-modal';
import { Text } from '@/components/ui/text';

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
  { key: 'collectes_48h_non_validees', label: 'Collecte <48 h non validée' },
];

// Chips retirés de la rangée par défaut (décision Val 2026-07-15). Conservés au
// catalogue : ils ne s'affichent que s'ils sont le filtre actif (sinon la liste
// serait filtrée sans indicateur visible) — ce qui préserve les cibles de
// drill-down Dashboard Admin (non_transmises_zd/ag, zd_48h, ag_48h) et celles
// des tuiles « AG / ZD à dispatcher ».
const CHIPS_PROGRAMMEES_MASQUES = new Set([
  'non_transmises_zd',
  'non_transmises_ag',
  'zd_48h',
  'ag_48h',
  'collectes_48h_non_validees',
  'ag_attente_attribution',
]);

const CHIPS_PROGRAMMEES = CHIPS_PROGRAMMEES_CATALOGUE.filter(
  (c) => !CHIPS_PROGRAMMEES_MASQUES.has(c.key),
);

// Filtres rapides Historique — mappés sur les statuts (pas de chip serveur).
// Les anciennes pastilles Anti-Gaspi / Zéro Déchet sont retirées (R-UI-4b, D1) :
// le type se filtre par LE segmenté `ToggleTypeCollecte` de la FilterBar.
const CHIPS_HISTORIQUE = [
  { key: '', label: 'Toutes' },
  { key: 'annulee', label: 'Annulées' },
];

type Tab = 'programmees' | 'historique';

// Filtres de la liste, miroir dans l'URL (R-UI-4a, D6) : les mêmes clés que
// les liens de drill-down des dashboards (`?lieu=`, `?traiteur=`, `?chip=`,
// `?type=`, `?statut=`, `?from=`, `?to=`), en CSV pour les listes. `tab`,
// `chip` (pastille rapide), `page`, `tri`, `ordre` sont de la navigation :
// hors « Réinitialiser les filtres », qui n'efface que la barre (la pastille
// et les filtres se cumulent, décision Val 2026-09-30). `tri`/`ordre` vides =
// tri par défaut de l'onglet ; `tab` vide = Historique si drill-down, sinon
// Programmées. `tab` reste de la navigation (R-UI-4b, D2) : les onglets sont
// un changement de VUE (Tabs, DS règle 6), pas un filtre — « Réinitialiser les
// filtres » ne change pas de vue et l'onglet ne compte pas dans `actif`.
// `type` (R-UI-4b, D1) : UN seul contrôle, le segmenté `ToggleTypeCollecte`
// (`tous` = défaut, omis de l'URL ; `?type=zero_dechet` reste lisible).
const FILTRES = {
  tab: navigation(texte('')),
  chip: navigation(texte('')),
  type: texte('tous'),
  traiteur: liste(),
  lieu: liste(),
  statut: liste(),
  from: texte(''),
  to: texte(''),
  info_incomplete: texte(''),
  controle_acces: texte(''),
  rapport_non_consulte: texte(''),
  page: navigation(entier(1, 1)),
  tri: navigation(texte('')),
  ordre: navigation(texte('')),
};

// Tri par défaut de chaque onglet : les prochaines collectes d'abord pour
// « Programmées » (sinon la page 1 montrerait les plus lointaines), les plus
// récentes d'abord pour « Historique ».
const TRI_DEFAUT: Record<Tab, SortingState> = {
  programmees: [{ id: 'date', desc: false }],
  historique: [{ id: 'date', desc: true }],
};

// Toutes les colonnes du §06.06 §3 sont visibles par défaut (menu « Colonnes »
// pour en masquer). Seule exception : le statut TMS, sans état terminal, n'a
// pas d'objet dans l'Historique.
const COLONNES_MASQUEES: Record<Tab, Record<string, boolean>> = {
  programmees: {},
  historique: { statut_tms: false },
};

type KpiTone = 'warning' | 'success' | 'info' | 'error';

const KPI_TONE: Record<KpiTone, string> = {
  warning: 'bg-savr-warning-subtle text-savr-warning-strong',
  success: 'bg-savr-success-subtle text-savr-success-strong',
  info: 'bg-savr-info-subtle text-savr-info-strong',
  error: 'bg-savr-error-subtle text-savr-error-strong',
};

// Tuile KPI de tête de la liste Collectes : bouton-filtre cliquable
// (aria-pressed + flèche de drill-down), état actif encadré comme les chips.
// Gabarit compact (4 tuiles sur une ligne, décision Val 2026-10-01).
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
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-savr-lg border bg-savr-white px-4 py-3 text-left shadow-savr-sm transition-[border-color,box-shadow,transform] duration-savr-fast hover:-translate-y-px hover:border-savr-primary-200 hover:shadow-savr-md ${
        active
          ? 'border-savr-primary-700 shadow-[0_0_0_1px_var(--color-savr-primary-700)]'
          : 'border-savr-neutral-200'
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-savr-md ${KPI_TONE[tone]}`}
      >
        <Icone className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold leading-none tracking-tight text-savr-neutral-900 tabular-nums">
          {count}
        </div>
        <Text as="div" tone="strong" className="mt-1 font-bold leading-tight">
          {label}
        </Text>
        <Text as="div" variant="hint" className="font-semibold leading-tight">
          {sublabel}
        </Text>
      </div>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-savr-neutral-300" />
    </button>
  );
}

/** `base` restreint à la sélection de la barre (sélection vide = « Tous »). */
function intersection(base: string[], selection: string[]): string[] {
  return selection.length > 0
    ? base.filter((v) => selection.includes(v))
    : base;
}

export default function CollectesPage() {
  const router = useRouter();
  const params = useSearchParams();
  // Drill-down depuis les Top listes du Dashboard Client Admin (miroir exact) :
  // lieu / traiteur (OPÉRATIONNEL, décision Val R24c) + type + statut + période.
  // Identifiants figés au montage : ils servent à reconnaître le drill-down
  // dans les filtres (`drillActive` est DÉRIVÉ des valeurs de la barre, R-UI-4b
  // D10 : pas d'état séparé) — `useSearchParams` peut être resynchronisé par
  // Next après chaque écriture de l'URL par `useFiltresUrl`.
  const [{ drillLieu, drillTraiteur, drillStatut }] = useState(() => ({
    drillLieu: params.get('lieu'),
    drillTraiteur: params.get('traiteur'),
    // Drill-down depuis les cartes-actions du Dashboard Admin (Bloc 1) : chip
    // prédéfini « Programmées » pré-sélectionné à l'arrivée (miroir exact du compteur).
    drillStatut: params.get('statut'),
  }));
  // Périmètre d'organisations propagé par le drill-down (miroir exact du chiffre
  // du dashboard, borné au même périmètre). Figé au montage (getAll = nouveau
  // tableau à chaque render → capté en state pour rester stable dans les deps).
  const [perimetreOrgIds, setPerimetreOrgIds] = useState<string[]>(() =>
    params.getAll('perimetre'),
  );
  const hasDrill = !!(drillLieu || drillTraiteur);

  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  // Onglet : explicite dans l'URL, sinon Historique à l'arrivée d'un drill-down.
  const [tabDefaut] = useState<Tab>(hasDrill ? 'historique' : 'programmees');
  const tab: Tab =
    f.tab === 'historique' || f.tab === 'programmees' ? f.tab : tabDefaut;
  // Filtre rapide de l'onglet actif : chip Programmées OU filtre Historique.
  // Pré-sélectionné depuis le drill-down Dashboard Admin (`?chip=`) s'il désigne
  // un chip « Programmées » connu → la liste s'ouvre déjà filtrée + chip actif.
  const quickFilter =
    tab === 'programmees'
      ? CHIPS_PROGRAMMEES_CATALOGUE.some((c) => c.key === f.chip)
        ? f.chip
        : ''
      : CHIPS_HISTORIQUE.some((c) => c.key === f.chip)
        ? f.chip
        : '';
  // Type : UN seul contrôle (`ToggleTypeCollecte`, R-UI-4b D1) ; toute autre
  // valeur d'URL (ancien CSV `type=a,b`, valeur inconnue) = « Toutes ».
  const type: TypeCollecteFiltre =
    f.type === 'zero_dechet' || f.type === 'anti_gaspi' ? f.type : 'tous';
  // Traiteur / Lieu : choix multiple (décision Val 2026-09-30), vide =
  // « Tous ». Le drill-down (?type= / ?traiteur= / ?lieu=) pré-coche une valeur.
  const traiteurIds = f.traiteur;
  const lieuIds = f.lieu;
  const from = f.from;
  const to = f.to;
  // Statut (multi-sélection, §06.06 §3) : scopé aux valeurs valides de l'onglet
  // actif ; vide = preset de l'onglet. Info incomplète / rapport non consulté :
  // booléens indépendants de l'onglet.
  const statutsSel = f.statut;
  const infoIncomplete = f.info_incomplete === '1';
  const controleAcces = f.controle_acces === '1';
  const rapportNonConsulte = f.rapport_non_consulte === '1';
  const page = f.page;
  // Tri de la Data Table : explicite dans l'URL, sinon défaut de l'onglet.
  const sorting: SortingState = useMemo(
    () => (f.tri ? [{ id: f.tri, desc: f.ordre === 'desc' }] : TRI_DEFAUT[tab]),
    [f.tri, f.ordre, tab],
  );
  // Libellé humain du filtre de drill-down (lieu / traiteur), lu du sessionStorage
  // posé par le dashboard (fallback null → chip générique).
  const [drillLabel] = useState<string | null>(() => {
    if (drillLieu) return readCollecteFiltreLabel('lieu', drillLieu);
    if (drillTraiteur)
      return readCollecteFiltreLabel('traiteur', drillTraiteur);
    return null;
  });
  // Chip « Filtre actif » : dérivé des filtres — visible tant que le lieu /
  // traiteur du drill-down est encore sélectionné dans la barre (R-UI-4b, D10).
  const drillActive = drillLieu
    ? lieuIds.includes(drillLieu)
    : drillTraiteur
      ? traiteurIds.includes(drillTraiteur)
      : false;
  const [traiteurs, setTraiteurs] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [lieux, setLieux] = useState<{ id: string; label: string }[]>([]);
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({});

  // Compteurs chips + KPI « à dispatcher ». Chargés au montage ET rechargés à la
  // fermeture du panneau latéral (une action dans la fiche peut changer un compteur).
  const loadChipCounts = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/admin/collectes/chip-counts');
      if (!r.ok) return;
      const j: unknown = await r.json();
      if (j && typeof j === 'object') {
        setChipCounts(j as Record<string, number>);
      }
    } catch {
      // dégradation gracieuse : compteurs absents = tuiles à 0
    }
  }, []);

  useEffect(() => {
    void loadChipCounts();
  }, [loadChipCounts]);

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

  // URL de la liste (R-UI-4a : chargement, garde anti-réponse périmée et état
  // Error portés par `useListePaginee`). `null` = croisement vide (ex. pastille
  // Annulées + Statut Clôturée) : aucun appel, liste vide.
  const urlListe = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) });
    const tri = sorting[0];
    if (tri) {
      params.set('tri', tri.id);
      params.set('ordre', tri.desc ? 'desc' : 'asc');
    }

    // Pastille rapide ET filtres de la barre se cumulent (décision Val
    // 2026-09-30) : ce qui est affiché s'applique toujours. Sans filtre posé,
    // la liste reste le miroir exact du compteur de la pastille.
    if (tab === 'programmees') {
      if (quickFilter) {
        // Chemin chip serveur (les chips sont tous à portée « Programmées ») ;
        // le Statut ne raffine qu'avec une sélection explicite.
        params.set('chip', quickFilter);
        if (statutsSel.length > 0) params.set('statuts', statutsSel.join(','));
      } else {
        params.set(
          'statuts',
          statutsSel.length > 0
            ? statutsSel.join(',')
            : STATUTS_PROGRAMMEES.join(','),
        );
      }
    } else {
      // Historique : preset terminaux ; la pastille Annulées se croise avec le
      // Statut de la barre.
      const statutsEff = intersection(
        quickFilter === 'annulee'
          ? ['annulee', 'rejetee_par_prestataire']
          : STATUTS_HISTORIQUE,
        statutsSel,
      );
      if (statutsEff.length === 0) return null;
      params.set('statuts', statutsEff.join(','));
    }
    // Type (segmenté) : même paramètre CSV qu'avant, absent pour « Toutes ».
    if (type !== 'tous') params.set('types', type);

    // « Traiteur » = traiteur OPÉRATIONNEL (décision Val R24c) → miroir exact du
    // Top 5 traiteurs des dashboards (agrégé par traiteur_operationnel).
    if (traiteurIds.length > 0)
      params.set('traiteur_operationnel_ids', traiteurIds.join(','));
    if (lieuIds.length > 0) params.set('lieu_ids', lieuIds.join(','));
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    // Périmètre d'organisations du drill-down (miroir exact du chiffre borné).
    for (const id of perimetreOrgIds) params.append('perimetre_org_ids[]', id);
    if (infoIncomplete) params.set('info_incomplete', 'true');
    if (controleAcces) params.set('controle_acces', 'true');
    if (rapportNonConsulte) params.set('rapport_non_consulte', 'true');
    return `/api/v1/admin/collectes?${params}`;
  }, [
    tab,
    page,
    sorting,
    quickFilter,
    type,
    statutsSel,
    traiteurIds,
    lieuIds,
    from,
    to,
    perimetreOrgIds,
    infoIncomplete,
    controleAcces,
    rapportNonConsulte,
  ]);
  const {
    data: collectes,
    total,
    loading,
    erreur,
    recharger: fetchCollectes,
  } = useListePaginee<CollecteRow>(urlListe);

  // ── Pop-up centré (modale) — fiche collecte complète (ex-page [id]) ─────────
  // openId = état local, initialisé depuis l'URL (?collecte=<id>) → deep-links
  // (la route [id] redirige ici) + rafraîchissement rouvrent le panneau. On miroite
  // l'état dans l'URL via router.replace (pas push → pas de pollution d'historique)
  // pour rendre le panneau partageable/rechargeable.
  const [openId, setOpenId] = useState<string | null>(() =>
    params.get('collecte'),
  );

  const setCollecteParam = useCallback(
    (id: string | null) => {
      // Base = l'URL du document (les filtres y sont écrits par `useFiltresUrl`),
      // pas `useSearchParams` (figé à la dernière navigation Next).
      const sp = new URLSearchParams(
        typeof window === 'undefined'
          ? params.toString()
          : window.location.search,
      );
      if (id) sp.set('collecte', id);
      else sp.delete('collecte');
      const qs = sp.toString();
      router.replace(qs ? `/admin/collectes?${qs}` : '/admin/collectes');
    },
    [params, router],
  );

  const openCollecte = useCallback(
    (id: string) => {
      setOpenId(id);
      setCollecteParam(id);
    },
    [setCollecteParam],
  );

  const closeCollecte = useCallback(() => {
    setOpenId(null);
    setCollecteParam(null);
    // Une action dans la fiche (dispatch, forçage statut, pesées…) peut changer
    // la liste ou un compteur → on rafraîchit à la fermeture.
    fetchCollectes();
    void loadChipCounts();
  }, [setCollecteParam, fetchCollectes, loadChipCounts]);

  const changeTab = (next: Tab) => {
    set({ tab: next, chip: '', type: 'tous', statut: [], tri: '', ordre: '' });
  };

  // Tuile « AG / ZD à dispatcher » : pose (ou retire) le chip « Non transmises »
  // de son type. À l'activation, la tuile pilote le MÊME état `type` que le
  // segmenté (R-UI-4b, D1 : pas un 4e contrôle) et le remet à « Toutes » : le
  // chip porte déjà son type, et un autre type choisi viderait la liste alors
  // que la tuile affiche N (décision Val 2026-10-01). Les autres filtres de la
  // barre continuent de se cumuler.
  const basculerADispatcher = (
    chip: 'non_transmises_ag' | 'non_transmises_zd',
  ) => {
    const actif = quickFilter === chip;
    set(actif ? { chip: '' } : { chip, type: 'tous' });
  };

  // Urgences (AG à attribuer < 48h) en tête de page (§06.09 §1) — uniquement
  // sur le tri par date : un tri explicite sur une autre colonne est respecté.
  const lignes = useMemo(
    () => (sorting[0]?.id === 'date' ? urgentesEnTete(collectes) : collectes),
    [collectes, sorting],
  );

  const colonnes = useMemo(
    () => colonnesCollectesAdmin({ onOpen: openCollecte }),
    [openCollecte],
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
  // Efface le filtre de drill-down (lieu / traiteur venu du dashboard) → liste
  // nue : filtres au défaut (le chip « Filtre actif » s'éteint avec le lieu /
  // traiteur), périmètre d'organisations retiré de l'URL.
  const clearDrill = () => {
    setPerimetreOrgIds([]);
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      sp.delete('perimetre');
      const qs = sp.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}`,
      );
    }
    reset();
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
        subtitle="Liste unifiée Zéro Déchet + Anti-Gaspi · cliquez une ligne pour ouvrir la fiche"
        actions={
          <Button asChild variant="accent">
            <Link href="/programmer/nouveau">
              <Plus />
              Programmer une collecte
            </Link>
          </Button>
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

      {/* KPI de tête (Programmées uniquement) : 4 files d'action sur une ligne.
          Tuiles « AG / ZD à venir » retirées (décision Val 2026-10-01).
          Un clic sur « AG / ZD à dispatcher » pose le chip « Non transmises
          AG / ZD » et efface le filtre Type : la liste montre les collectes
          comptées (décisions Val 2026-10-01) ; un re-clic retire le chip. */}
      {tab === 'programmees' && (
        <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
          <KpiTile
            icon={UtensilsCrossed}
            count={chipCounts.ag_a_dispatcher ?? 0}
            label="AG à dispatcher"
            sublabel="validées transporteur"
            tone="warning"
            active={quickFilter === 'non_transmises_ag'}
            onClick={() => basculerADispatcher('non_transmises_ag')}
          />
          <KpiTile
            icon={Leaf}
            count={chipCounts.zd_a_dispatcher ?? 0}
            label="ZD à dispatcher"
            sublabel="validées transporteur"
            tone="success"
            active={quickFilter === 'non_transmises_zd'}
            onClick={() => basculerADispatcher('non_transmises_zd')}
          />
          <KpiTile
            icon={IdCard}
            count={chipCounts.controle_acces_a_envoyer ?? 0}
            label="Infos accès à envoyer"
            sublabel="chauffeur non communiqué"
            tone="info"
            active={controleAcces}
            onClick={() => set({ controle_acces: controleAcces ? '' : '1' })}
          />
          <KpiTile
            icon={FileWarning}
            count={chipCounts.infos_a_recuperer ?? 0}
            label="Infos à récupérer"
            sublabel="infos traiteur manquantes"
            tone="warning"
            active={infoIncomplete}
            onClick={() => set({ info_incomplete: infoIncomplete ? '' : '1' })}
          />
        </div>
      )}

      {/* Filtres rapides (pastilles à compteur, DS §5.7) */}
      <FilterChips
        chips={chips.map((c) =>
          tab === 'programmees' && c.key
            ? { ...c, count: chipCounts[c.key] }
            : c,
        )}
        activeKey={quickFilter}
        ariaLabel="Filtres rapides"
        onSelect={(key) => set({ chip: key })}
      />

      {/* Barre de filtres toujours visible — ni recherche libre ni repli
          « Filtres avancés » (décision Val 2026-09-30, §06.06 §3 « Filtres »).
          FilterBar complet (R-UI-4b, D5) : onglets Programmées / Historique
          (Tabs, changer de vue) + segmenté de type (ToggleGroup, filtrer) en
          en-tête, compteur en pied — seul emplacement du compteur. */}
      <FilterBar
        data-testid="collectes-filtres"
        tabs={
          <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
            <TabsList aria-label="Vue collectes">
              <TabsTrigger value="programmees">Programmées</TabsTrigger>
              <TabsTrigger value="historique">Historique</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        toggle={
          <ToggleTypeCollecte
            avecTous
            value={type}
            onChange={(t) => set({ type: t })}
            data-testid="collectes-filtre-type"
          />
        }
        count={`${total} collecte${total > 1 ? 's' : ''} correspond${
          total > 1 ? 'ent' : ''
        } à votre sélection`}
        actif={filtresActifs}
        // En drill-down, « Réinitialiser » retire aussi le chip et le périmètre
        // d'organisations (sinon le chip annoncerait un filtre qui ne s'applique plus).
        onReset={drillActive ? clearDrill : reset}
      >
        {/* Période en premier, puis filtres à choix multiple avec case
            « Tous » (décision Val 2026-09-30). */}
        <DateRangePicker
          titre="Période"
          id="collectes-filtre-periode"
          data-testid="collectes-filtre-periode"
          value={{ from, to }}
          onChange={(p) => set({ from: p.from, to: p.to })}
        />
        <FiltreCoches
          label="Traiteur"
          testid="collectes-filtre-traiteur"
          options={traiteurs.map((t) => ({ id: t.id, nom: t.label }))}
          selected={traiteurIds}
          onChange={(ids) => set({ traiteur: ids })}
        />
        <FiltreCoches
          label="Lieu"
          testid="collectes-filtre-lieu"
          options={lieux.map((l) => ({ id: l.id, nom: l.label }))}
          selected={lieuIds}
          onChange={(ids) => set({ lieu: ids })}
        />

        {/* Statut — multi-sélection scopée aux valeurs de l'onglet actif */}
        <FiltreCoches
          label="Statut"
          testid="collectes-filtre-statut"
          options={(tab === 'programmees'
            ? STATUTS_PROGRAMMEES
            : STATUTS_HISTORIQUE
          ).map((s) => ({
            id: s,
            nom: statutCollecteDisplay(s, 'admin').label,
          }))}
          selected={statutsSel}
          onChange={(ids) => set({ statut: ids })}
        />

        {/* Booléens — case DS (§6 Checkbox), cible 44px mobile */}
        <div className="flex flex-wrap gap-x-4 px-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-savr-neutral-700 sm:min-h-9">
            <Checkbox
              checked={infoIncomplete}
              onCheckedChange={(v) =>
                set({ info_incomplete: v === true ? '1' : '' })
              }
            />
            Info incomplète
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-savr-neutral-700 sm:min-h-9">
            <Checkbox
              checked={rapportNonConsulte}
              onCheckedChange={(v) =>
                set({ rapport_non_consulte: v === true ? '1' : '' })
              }
            />
            Rapport non consulté
          </label>
        </div>
      </FilterBar>

      <DataGrid
        key={tab}
        data-testid="collectes-table"
        columns={colonnes}
        data={lignes}
        getRowId={(c) => c.id}
        loading={loading}
        erreur={erreur}
        onRecharger={fetchCollectes}
        manualSorting
        sorting={sorting}
        onSortingChange={(next) => {
          const s = typeof next === 'function' ? next(sorting) : next;
          const t = s[0];
          set({ tri: t?.id ?? '', ordre: t ? (t.desc ? 'desc' : 'asc') : '' });
        }}
        initialColumnVisibility={COLONNES_MASQUEES[tab]}
        onRowClick={(c) => openCollecte(c.id)}
        rowLabel={(c) => {
          const { jour, heure } = formatDateHeure(
            c.date_collecte,
            c.heure_collecte,
          );
          return `Ouvrir la collecte du ${jour}${heure ? ` à ${heure}` : ''} — ${c.evenements.organisations.raison_sociale}`;
        }}
        rowClassName={(c) =>
          estUrgente(c)
            ? 'bg-savr-error-subtle hover:bg-savr-error-subtle'
            : undefined
        }
        empty={
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="Aucune collecte"
            description="Aucune collecte ne correspond à ce filtre."
          />
        }
      />

      <ListFooter
        total={total}
        page={page}
        onPageChange={(p) => set({ page: p })}
      />

      {/* Pop-up centré (modale) — fiche collecte complète (ex-page [id]).
          S'ouvre via ?collecte=<id> ; onClose retire le paramètre + rafraîchit. */}
      <CollecteDetailModal collecteId={openId} onClose={closeCollecte} />
    </div>
  );
}
