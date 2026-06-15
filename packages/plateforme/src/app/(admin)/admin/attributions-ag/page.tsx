'use client';

import { useEffect, useState, useCallback } from 'react';
import { Leaf, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface CollectePending {
  id: string;
  date_collecte: string;
  heure_collecte: string;
  volume_estime_repas: number | null;
  statut: string;
  evenements: {
    nom_evenement: string | null;
    pax: number;
    organisations: { raison_sociale: string };
    lieux: { nom: string; ville: string; code_postal: string };
  };
}

const columnsPending: Column<CollectePending>[] = [
  {
    key: 'date_collecte',
    header: 'Date collecte',
    render: (row) => (
      <Link
        href={`/admin/attributions-ag/${row.id}`}
        className="font-medium text-primary-700 hover:underline"
      >
        {new Date(row.date_collecte).toLocaleDateString('fr-FR')} à{' '}
        {row.heure_collecte.slice(0, 5)}
      </Link>
    ),
  },
  {
    key: 'evenements',
    header: 'Événement',
    render: (row) => row.evenements?.nom_evenement ?? '—',
  },
  {
    key: 'pax',
    header: 'PAX',
    render: (row) => row.evenements?.pax ?? '—',
  },
  {
    key: 'volume_estime_repas',
    header: 'Volume estimé',
    render: (row) =>
      row.volume_estime_repas != null
        ? `${row.volume_estime_repas} repas`
        : '—',
  },
  {
    key: 'organisation',
    header: 'Traiteur',
    render: (row) => row.evenements?.organisations?.raison_sociale ?? '—',
  },
  {
    key: 'lieu',
    header: 'Lieu',
    render: (row) =>
      row.evenements?.lieux
        ? `${row.evenements.lieux.ville} (${row.evenements.lieux.code_postal})`
        : '—',
  },
  {
    key: 'action',
    header: '',
    render: (row) => (
      <Link
        href={`/admin/attributions-ag/${row.id}`}
        className="text-sm text-primary-600 hover:underline"
      >
        Attribuer →
      </Link>
    ),
  },
];

export default function AttributionsAgPage() {
  const [pending, setPending] = useState<CollectePending[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/attributions-ag/pending');
      if (!res.ok) throw new Error("Erreur chargement file d'attente");
      const json = (await res.json()) as {
        data: CollectePending[];
        total: number;
      };
      setPending(json.data);
      setTotal(json.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Leaf className="h-6 w-6 text-green-600" />
        <div>
          <h1 className="text-xl font-semibold text-savr-neutral-900">
            Attributions Anti-Gaspi
          </h1>
          <p className="text-sm text-savr-neutral-500">
            File d'attente — collectes AG en attente d'attribution
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-savr-neutral-500">
        <Clock className="h-4 w-4" />
        {loading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <span>
            <strong>{total}</strong> collecte{total !== 1 ? 's' : ''} en attente
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-green-500" />}
          title="File vide"
          description="Aucune collecte AG en attente d'attribution."
        />
      ) : (
        <DataTable
          columns={columnsPending}
          data={pending}
          keyExtractor={(r) => r.id}
        />
      )}

      <div className="flex gap-3 text-sm">
        <Link
          href="/admin/parametres/algo-ag"
          className="text-primary-600 hover:underline"
        >
          Paramètres algorithme →
        </Link>
        <Link
          href="/admin/parametres/auto-accept"
          className="text-primary-600 hover:underline"
        >
          Configuration auto-accept →
        </Link>
      </div>
    </div>
  );
}
