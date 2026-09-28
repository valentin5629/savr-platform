'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Download, Truck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import {
  CollecteTypeTabs,
  type CollecteType,
} from '@/components/dashboards/index.js';

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

const TIRET = <span className="text-savr-neutral-400">—</span>;

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
        one(c.evenements)?.nom_evenement ?? TIRET,
    },
    {
      id: 'lieu',
      header: 'Lieu',
      accessorFn: (c) => one(one(c.evenements)?.lieux ?? null)?.nom ?? '',
      cell: ({ row: { original: c } }) => {
        const lieu = one(one(c.evenements)?.lieux ?? null);
        if (!lieu) return TIRET;
        return (
          <div className="min-w-0">
            <div className="font-medium">{lieu.nom}</div>
            <div className="text-xs text-savr-neutral-500">
              {[lieu.code_postal, lieu.ville].filter(Boolean).join(' ')}
            </div>
          </div>
        );
      },
    },
    {
      id: 'traiteur',
      header: 'Traiteur',
      accessorFn: (c) => c.traiteur_nom ?? '',
      cell: ({ row: { original: c } }) => c.traiteur_nom ?? TIRET,
    },
    {
      id: 'pax',
      header: 'Pax',
      accessorFn: (c) => one(c.evenements)?.pax ?? -1,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) => one(c.evenements)?.pax ?? TIRET,
    },
    isZd
      ? {
          id: 'recyclage',
          header: 'Recyclage',
          accessorFn: (c) => c.taux_recyclage ?? -1,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: c } }) =>
            c.taux_recyclage != null
              ? `${c.taux_recyclage.toFixed(1)} %`
              : TIRET,
        }
      : {
          id: 'repas',
          header: 'Repas',
          accessorFn: (c) => c.repas_donnes ?? -1,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: c } }) => c.repas_donnes ?? TIRET,
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

// §11 §7 — Liste des événements/collectes du client organisateur, lecture seule.
// Pas de bouton « Programmer » (rôle jamais self-service), pas de fiche éditable.
function CollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [tab, setTab] = useState<CollecteType>(initialTab);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/v1/organisateur/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [tab, params]);

  function changeTab(t: CollecteType) {
    setTab(t);
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.set('type', t);
    router.replace(`/organisateur/collectes?${usp}`);
  }

  const isZd = tab === 'zero_dechet';
  const cols = useMemo(() => colonnes(isZd), [isZd]);

  function exportCsv() {
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
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
            <Download className="h-4 w-4" />
            Exporter CSV
          </Button>
        }
      />

      <CollecteTypeTabs value={tab} onChange={changeTab} />

      <DataGrid
        key={tab}
        data-testid="collectes-table"
        columns={cols}
        data={rows}
        getRowId={(c) => c.id}
        loading={loading}
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
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <CollectesContent />
    </Suspense>
  );
}
