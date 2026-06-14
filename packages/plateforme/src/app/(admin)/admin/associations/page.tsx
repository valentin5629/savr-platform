'use client';

import { useEffect, useState, useCallback } from 'react';
import { Heart, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Association {
  id: string;
  nom: string;
  ville: string;
  region: string;
  contact_email: string;
  habilitee_attestation_fiscale: boolean;
  actif: boolean;
}

const columns: Column<Association>[] = [
  {
    key: 'nom',
    header: 'Nom',
    render: (row) => (
      <Link
        href={`/admin/associations/${row.id}`}
        className="font-medium text-primary-700 hover:underline"
      >
        {row.nom}
      </Link>
    ),
  },
  {
    key: 'ville',
    header: 'Ville',
    render: (row) => `${row.ville} (${row.region})`,
  },
  { key: 'contact_email', header: 'Contact' },
  {
    key: 'habilitee_attestation_fiscale',
    header: 'Habilitation 2041-GE',
    render: (row) =>
      row.habilitee_attestation_fiscale ? (
        <Badge variant="success">Oui</Badge>
      ) : (
        <span className="text-savr-neutral-400">—</span>
      ),
  },
  {
    key: 'actif',
    header: 'Statut',
    render: (row) =>
      row.actif ? (
        <Badge variant="success">Active</Badge>
      ) : (
        <Badge variant="neutral">Inactive</Badge>
      ),
  },
];

export default function AssociationsPage() {
  const [associations, setAssociations] = useState<Association[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [actif, setActif] = useState('true');
  const [page, setPage] = useState(1);

  const fetchAssociations = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), actif });
    if (q) params.set('q', q);
    const res = await fetch(`/api/v1/admin/associations?${params}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Association[];
        total: number;
      };
      setAssociations(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, actif, q]);

  useEffect(() => {
    void fetchAssociations();
  }, [fetchAssociations]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Heart className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Associations
          </h1>
        </div>
        <Link href="/admin/associations/nouvelle">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle association
          </Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-savr-neutral-400" />
          <input
            className="w-full pl-9 pr-3 py-2 border border-savr-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
          value={actif}
          onChange={(e) => {
            setActif(e.target.value);
            setPage(1);
          }}
        >
          <option value="true">Actives</option>
          <option value="false">Inactives</option>
          <option value="">Toutes</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : associations.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-8 w-8" />}
          title="Aucune association"
          description="Créez la première association."
        />
      ) : (
        <DataTable
          columns={columns}
          data={associations}
          keyExtractor={(row) => row.id}
          pagination={{ page, total, limit: 50, onPageChange: setPage }}
        />
      )}
    </div>
  );
}
