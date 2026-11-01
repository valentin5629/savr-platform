'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { fmtPct } from '@/lib/format';
import { Suspense, useMemo } from 'react';
import { ClipboardTextIcon, TruckIcon } from '@/components/ui/icones';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { BoutonExportCsv } from '@/components/ui/bouton-export-csv';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import {
  ToggleTypeCollecte,
  type TypeCollecteFiltre,
} from '@/components/collecte/toggle-type-collecte';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { OngletsVueCollectes } from '@/components/collecte/onglets-vue-collectes';
import {
  lireVueCollectes,
  periodeDeLaVue,
  triDateDescendant,
} from '@/lib/collectes/vue-temporelle';
import { jourParis } from '@savr/shared/src/temps/index.js';
import {
  CollecteFiltresBar,
  FILTRES_COLLECTE_VIDES,
  type CollecteFiltresOptions,
} from '@/components/collecte/collecte-filtres-bar';
import { navigation, texte, useFiltresUrl } from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { Text } from '@/components/ui/text';
import { LIBELLE_SANS_EXCEDENT } from '@/lib/statut-collecte-labels';

interface Lieu {
  nom: string;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  // Pax de LA collecte (décision Val 2026-10-20).
  pax?: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  traiteur_nom: string | null;
  repas_donnes: number | null;
  evenements: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Colonne résultat d'une ligne : taux de recyclage ZD, repas AG. Collecte AG
// sans excédent : la mention, jamais « 0 » — c'est un résultat, pas un statut
// (décision Val 2026-10-09).
function recyclage(c: CollecteRow) {
  return c.taux_recyclage != null ? fmtPct(c.taux_recyclage) : <CelluleVide />;
}
function repas(c: CollecteRow) {
  return c.statut === 'realisee_sans_collecte'
    ? LIBELLE_SANS_EXCEDENT
    : (c.repas_donnes ?? <CelluleVide />);
}

// Colonnes de la Data Table (tri côté client : la route n'est pas paginée).
// La colonne résultat dépend du type choisi : « Recyclage » en ZD, « Repas » en
// AG ; sur « Toutes », une colonne Type (picto ZD / AG) et une colonne
// « Résultats » qui suit le type de chaque ligne (décision Val 2026-10-31).
function colonnes(type: TypeCollecteFiltre): ColumnDef<CollecteRow, unknown>[] {
  const resultat: ColumnDef<CollecteRow, unknown> =
    type === 'zero_dechet'
      ? {
          id: 'recyclage',
          header: 'Recyclage',
          accessorFn: (c) => c.taux_recyclage ?? -1,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: c } }) => recyclage(c),
        }
      : type === 'anti_gaspi'
        ? {
            id: 'repas',
            header: 'Repas',
            accessorFn: (c) => c.repas_donnes ?? -1,
            meta: { className: 'text-right tabular-nums' },
            cell: ({ row: { original: c } }) => repas(c),
          }
        : {
            id: 'resultats',
            header: 'Résultats',
            meta: { className: 'text-right tabular-nums' },
            cell: ({ row: { original: c } }) => {
              if (c.type === 'zero_dechet') return recyclage(c);
              const r = repas(c);
              return typeof r === 'number' ? `${r} repas` : r;
            },
          };
  const colonneType: ColumnDef<CollecteRow, unknown> = {
    id: 'type',
    header: 'Type',
    accessorFn: (c) => c.type,
    meta: { className: 'w-[1%] whitespace-nowrap' },
    cell: ({ row: { original: c } }) => <TypeCollecteBadge type={c.type} />,
  };
  return [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (c) => `${c.date_collecte} ${c.heure_collecte ?? ''}`,
      cell: ({ row: { original: c } }) => (
        <span className="whitespace-nowrap font-semibold tabular-nums">
          {libelleDateHeure(c.date_collecte, c.heure_collecte)}
        </span>
      ),
    },
    ...(type === 'tous' ? [colonneType] : []),
    {
      id: 'evenement',
      header: 'Événement',
      accessorFn: (c) => one(c.evenements)?.nom_evenement ?? '',
      cell: ({ row: { original: c } }) =>
        one(c.evenements)?.nom_evenement ?? <CelluleVide />,
    },
    {
      id: 'lieu',
      header: 'Lieu',
      accessorFn: (c) => one(one(c.evenements)?.lieux ?? null)?.nom ?? '',
      cell: ({ row: { original: c } }) => {
        const lieu = one(one(c.evenements)?.lieux ?? null);
        if (!lieu) return <CelluleVide />;
        return (
          <div className="min-w-0">
            <div className="font-medium">{lieu.nom}</div>
            <Text as="div" variant="hint">
              {[lieu.code_postal, lieu.ville].filter(Boolean).join(' ')}
            </Text>
          </div>
        );
      },
    },
    {
      id: 'traiteur',
      header: 'Traiteur',
      accessorFn: (c) => c.traiteur_nom ?? '',
      cell: ({ row: { original: c } }) => c.traiteur_nom ?? <CelluleVide />,
    },
    {
      id: 'pax',
      header: 'Pax',
      accessorFn: (c) => c.pax ?? -1,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) => c.pax ?? <CelluleVide />,
    },
    resultat,
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (c) => c.statut,
      cell: ({ row: { original: c } }) => (
        <CollecteStatutBadge statut={c.statut} />
      ),
    },
  ];
}

// Filtres de la liste, miroir de l'URL (R-UI-4b, D6/D10). La route
// `organisateur/collectes` n'accepte que `type` + période : la barre n'expose
// donc que « Période » (aucun filtre inventé). `type` est un axe de vue
// (colonnes différentes) : hors « Réinitialiser les filtres », hors `actif`.
const FILTRES = {
  // Vue à venir (défaut) / passées, rangée par date (décision Val 2026-10-19).
  onglet: navigation(texte('')),
  // Vide = « Toutes », par défaut comme la liste Événements (Val 2026-10-31).
  type: navigation(texte('')),
  from: texte(),
  to: texte(),
};
const OPTIONS_BARRE: CollecteFiltresOptions = {
  lieux: [],
  clients: [],
  programmateurs: [],
};

// §11 §7 — Liste des événements/collectes du client organisateur, lecture seule.
// Pas de bouton « Programmer » (rôle jamais self-service), pas de fiche éditable.
function CollectesContent() {
  const { valeurs: f, set, reset, actif } = useFiltresUrl(FILTRES);
  const tab: TypeCollecteFiltre =
    f.type === 'zero_dechet' || f.type === 'anti_gaspi' ? f.type : 'tous';
  const vue = lireVueCollectes(f.onglet) ?? 'a_venir';
  // Jour lu à chaque rendu (page restée ouverte passé minuit).
  const aujourdhui = jourParis();

  // Paramètres partagés avec l'export CSV (§12 « l'export respecte les filtres
  // actifs ») ; la période de la barre est bornée à la vue.
  const qs = useMemo(() => {
    const usp = new URLSearchParams();
    if (tab !== 'tous') usp.set('type', tab);
    const periode = periodeDeLaVue(vue, { from: f.from, to: f.to }, aujourdhui);
    if (periode.from) usp.set('from', periode.from);
    if (periode.to) usp.set('to', periode.to);
    return usp.toString();
  }, [tab, vue, aujourdhui, f.from, f.to]);
  // Liste non paginée (la route ne l'est pas) : garde anti-réponse périmée et
  // état Error portés par `useListePaginee`.
  const {
    data: rows,
    loading,
    erreur,
    recharger,
  } = useListePaginee<CollecteRow>(`/api/v1/organisateur/collectes?${qs}`, {
    extraire: (j) => {
      const data = ((j as { data?: CollecteRow[] }).data ??
        []) as CollecteRow[];
      return { data, total: data.length };
    },
    messageErreur: 'Le chargement des collectes a échoué.',
  });

  const cols = useMemo(() => colonnes(tab), [tab]);

  function exportCsv() {
    window.open(`/api/v1/exports/collectes?${qs}`);
  }

  return (
    <div className="space-y-5">
      <PageHero
        icon={<ClipboardTextIcon className="h-6 w-6" />}
        title="Mes collectes"
        subtitle="Collectes de vos événements, en lecture seule"
      />

      {/* Barre de filtres DS (D10 : la même que traiteur / agence) : vues
          à venir / passées et type ZD / AG en en-tête, « Période », compteur
          et réinitialisation. */}
      <CollecteFiltresBar
        tabs={
          <OngletsVueCollectes
            value={vue}
            onChange={(v) => set({ onglet: v })}
          />
        }
        toggle={
          <ToggleTypeCollecte
            avecTous
            value={tab}
            onChange={(t) => set({ type: t === 'tous' ? '' : t })}
          />
        }
        statutsOnglet={[]}
        filtres={{
          statut: false,
          lieu: false,
          client: false,
          infoIncomplete: false,
          programmeePar: false,
        }}
        options={OPTIONS_BARRE}
        value={{ ...FILTRES_COLLECTE_VIDES, from: f.from, to: f.to }}
        onChange={(v) => set({ from: v.from, to: v.to })}
        actif={actif}
        onReset={reset}
        resultats={rows.length}
      />

      {/* Tri par défaut : la plus proche d'aujourd'hui d'abord. */}
      <DataGrid
        toolbarActions={<BoutonExportCsv onClick={exportCsv} />}
        key={`${tab}-${vue}`}
        data-testid="collectes-table"
        columns={cols}
        data={rows}
        getRowId={(c) => c.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        initialSorting={[{ id: 'date', desc: triDateDescendant(vue) }]}
        empty={
          <EmptyState
            icon={<TruckIcon className="h-8 w-8" />}
            title="Aucune collecte"
            description="Aucune collecte sur la période sélectionnée."
          />
        }
      />
    </div>
  );
}

export default function ClientOrganisateurCollectesPage() {
  return (
    <Suspense fallback={<LoadingState className="p-4" />}>
      <CollectesContent />
    </Suspense>
  );
}
