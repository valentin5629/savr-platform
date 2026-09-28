'use client';

import { Suspense, useEffect, useState } from 'react';
import { Download, Plus, Truck } from 'lucide-react';
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
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  realisee_at: string | null;
  evenements: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function rapportDisponible(realiseeAt: string | null): boolean {
  if (!realiseeAt) return false;
  return Date.now() - new Date(realiseeAt).getTime() >= 24 * 3600 * 1000;
}

const TIRET = <span className="text-savr-neutral-400">—</span>;

// Colonnes de la Data Table (tri côté client : la route n'est pas paginée).
const COLONNES: ColumnDef<CollecteRow, unknown>[] = [
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
            {[lieu.adresse_acces, lieu.code_postal, lieu.ville]
              .filter(Boolean)
              .join(' ')}
          </div>
        </div>
      );
    },
  },
  {
    id: 'client',
    header: 'Client',
    accessorFn: (c) => one(c.evenements)?.nom_client_organisateur ?? '',
    cell: ({ row: { original: c } }) =>
      one(c.evenements)?.nom_client_organisateur ?? TIRET,
  },
  {
    id: 'pax',
    header: 'Pax',
    accessorFn: (c) => one(c.evenements)?.pax ?? -1,
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row: { original: c } }) => one(c.evenements)?.pax ?? TIRET,
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (c) => c.statut,
    cell: ({ row: { original: c } }) => (
      <CollecteStatutBadge statut={c.statut} />
    ),
  },
  {
    id: 'rapport',
    header: 'Rapport',
    accessorFn: (c) => (rapportDisponible(c.realisee_at) ? 1 : 0),
    cell: ({ row: { original: c } }) =>
      rapportDisponible(c.realisee_at) ? (
        <span className="font-semibold text-savr-primary-700">Disponible</span>
      ) : (
        <span className="text-savr-neutral-400">À venir</span>
      ),
  },
];

function CollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [tab, setTab] = useState<CollecteType>(initialTab);
  // Drill-down « Top 5 lieux » du dashboard agence → filtre sur le lieu.
  const lieuFiltre = params.get('lieu');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    const statut = params.get('statut');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (statut) qs.set('statut', statut);
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    fetch(`/api/v1/agence/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [tab, params, lieuFiltre]);

  useEffect(() => {
    setFiltreLabel(
      lieuFiltre ? readCollecteFiltreLabel('lieu', lieuFiltre) : null,
    );
  }, [lieuFiltre]);

  function changeTab(t: CollecteType) {
    setTab(t);
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.set('type', t);
    router.replace(`/agence/collectes?${usp}`);
  }
  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    ['lieu', 'statut', 'from', 'to'].forEach((k) => usp.delete(k));
    router.replace(`/agence/collectes?${usp}`);
  }

  const lieuNomDesRows = (() => {
    const evt = one(rows[0]?.evenements ?? null);
    const lieu = one(evt?.lieux ?? null);
    return lieu?.nom ?? null;
  })();
  const chipLabel = lieuFiltre
    ? `Lieu : ${filtreLabel ?? lieuNomDesRows ?? 'lieu sélectionné'}`
    : null;
  const chipScope = (() => {
    const parts: string[] = [];
    if (params.get('statut') === 'cloturee') parts.push('clôturées');
    const per = periodeCourte(params.get('from'), params.get('to'));
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

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
        title="Collectes"
        subtitle="Collectes de vos événements · cliquez une ligne pour ouvrir la fiche"
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              Exporter CSV
            </Button>
            <Button variant="accent" asChild>
              <a href={`/programmer/nouveau?type=${tab}`}>
                <Plus className="h-4 w-4" />
                Programmer un événement
              </a>
            </Button>
          </>
        }
      />

      <CollecteTypeTabs value={tab} onChange={changeTab} />

      {chipLabel && (
        <CollecteFiltreActif
          label={chipLabel}
          scope={chipScope}
          onClear={clearFiltre}
        />
      )}

      <DataGrid
        data-testid="collectes-table"
        columns={COLONNES}
        data={rows}
        getRowId={(c) => c.id}
        loading={loading}
        initialSorting={[{ id: 'date', desc: true }]}
        onRowClick={(c) => router.push(`/agence/collectes/${c.id}`)}
        rowLabel={(c) =>
          `Ouvrir la collecte du ${libelleDateHeure(c.date_collecte, c.heure_collecte)}`
        }
        empty={
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="Aucune collecte"
            description="Aucune collecte ne correspond à ce filtre."
          />
        }
      />
    </div>
  );
}

export default function AgenceCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <CollectesContent />
    </Suspense>
  );
}
