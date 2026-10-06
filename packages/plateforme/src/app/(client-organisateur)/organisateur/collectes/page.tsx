'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { fmtPct } from '@/lib/format';
import { Suspense, useMemo } from 'react';
import { Download, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { type CollecteType } from '@/components/dashboards/index.js';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import {
  CollecteFiltresBar,
  FILTRES_COLLECTE_VIDES,
  type CollecteFiltresOptions,
} from '@/components/collecte/collecte-filtres-bar';
import { navigation, texte, useFiltresUrl } from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { Text } from '@/components/ui/text';

interface Lieu {
  nom: string;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  pax: number | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
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

// Colonnes de la Data Table (tri côté client : la route n'est pas paginée).
// La colonne résultat dépend de l'onglet : taux de recyclage ZD, repas AG.
function colonnes(isZd: boolean): ColumnDef<CollecteRow, unknown>[] {
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
      accessorFn: (c) => one(c.evenements)?.pax ?? -1,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) =>
        one(c.evenements)?.pax ?? <CelluleVide />,
    },
    isZd
      ? {
          id: 'recyclage',
          header: 'Recyclage',
          accessorFn: (c) => c.taux_recyclage ?? -1,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: c } }) =>
            c.taux_recyclage != null ? (
              fmtPct(c.taux_recyclage)
            ) : (
              <CelluleVide />
            ),
        }
      : {
          id: 'repas',
          header: 'Repas',
          accessorFn: (c) => c.repas_donnes ?? -1,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: c } }) => c.repas_donnes ?? <CelluleVide />,
        },
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
  type: navigation(texte('zero_dechet')),
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
  const tab: CollecteType =
    f.type === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';

  // Paramètres partagés avec l'export CSV (§12 « l'export respecte les filtres
  // actifs »).
  const qs = useMemo(() => {
    const usp = new URLSearchParams({ type: tab });
    if (f.from) usp.set('from', f.from);
    if (f.to) usp.set('to', f.to);
    return usp.toString();
  }, [tab, f.from, f.to]);
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

  const isZd = tab === 'zero_dechet';
  const cols = useMemo(() => colonnes(isZd), [isZd]);

  function exportCsv() {
    window.open(`/api/v1/exports/collectes?${qs}`);
  }

  return (
    <div className="space-y-5">
      <PageHero
        icon={<Truck className="h-6 w-6 text-savr-primary-200" />}
        title="Mes collectes"
        subtitle="Collectes de vos événements, en lecture seule"
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download />
            Exporter CSV
          </Button>
        }
      />

      {/* Barre de filtres DS (D10 : la même que traiteur / agence) : type
          ZD / AG en en-tête, « Période », compteur et réinitialisation. */}
      <CollecteFiltresBar
        toggle={
          <ToggleTypeCollecte value={tab} onChange={(t) => set({ type: t })} />
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

      <DataGrid
        key={tab}
        data-testid="collectes-table"
        columns={cols}
        data={rows}
        getRowId={(c) => c.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        initialSorting={[{ id: 'date', desc: true }]}
        empty={
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
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
