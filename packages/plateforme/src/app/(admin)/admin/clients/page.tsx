'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Organisation {
  id: string;
  raison_sociale: string;
  type: string;
  siret: string | null;
  actif: boolean;
  nb_users: number;
  nb_collectes_zd_12m: number;
  nb_collectes_ag_12m: number;
}

const TYPE_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire lieux',
  client_organisateur: 'Client organisateur',
};

const columns: Column<Organisation>[] = [
  {
    key: 'raison_sociale',
    header: 'Nom',
    render: (row) => (
      <a
        href={`/admin/clients/${row.id}`}
        className="font-medium text-primary-700 hover:underline"
      >
        {row.raison_sociale}
      </a>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge variant="neutral">{TYPE_LABELS[row.type] ?? row.type}</Badge>
    ),
  },
  {
    key: 'siret',
    header: 'SIREN/SIRET',
    render: (row) => (
      <span className="font-mono text-sm">{row.siret ?? '—'}</span>
    ),
  },
  { key: 'nb_users', header: 'Users' },
  { key: 'nb_collectes_zd_12m', header: 'ZD 12m' },
  { key: 'nb_collectes_ag_12m', header: 'AG 12m' },
  {
    key: 'actif',
    header: 'Statut',
    render: (row) =>
      row.actif ? (
        <Badge variant="success">Actif</Badge>
      ) : (
        <Badge variant="neutral">Inactif</Badge>
      ),
  },
];

export default function ClientsPage() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [actifFilter, setActifFilter] = useState('');

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    if (actifFilter) params.set('actif', actifFilter);

    const res = await fetch(`/api/v1/admin/organisations?${params.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Organisation[];
        total: number;
      };
      setOrgs(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [typeFilter, actifFilter]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  const filtered = search
    ? orgs.filter((o) =>
        o.raison_sociale.toLowerCase().includes(search.toLowerCase()),
      )
    : orgs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary-950">Clients</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {total} organisation{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/admin/clients/nouveau">
          <Button>
            <Plus className="w-4 h-4" />
            Nouvelle organisation
          </Button>
        </Link>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">Tous les types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={actifFilter}
          onChange={(e) => setActifFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">Tous les statuts</option>
          <option value="true">Actifs</option>
          <option value="false">Inactifs</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="Aucune organisation"
          description={
            search
              ? 'Aucun résultat pour cette recherche.'
              : 'Créez la première organisation.'
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
        />
      )}
    </div>
  );
}
