'use client';

import { useEffect, useState, useCallback } from 'react';
import { Truck, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Transporteur {
  id: string;
  nom: string;
  ville: string;
  type_tms: string;
  contact_email: string;
  actif: boolean;
}

const TYPE_TMS_LABELS: Record<string, string> = {
  mts1: 'MTS-1',
  a_toutes: 'A Toutes!',
  autre: 'Autre',
};

const columns: Column<Transporteur>[] = [
  {
    key: 'nom',
    header: 'Nom',
    render: (row) => (
      <Link
        href={`/admin/transporteurs/${row.id}`}
        className="font-medium text-primary-700 hover:underline"
      >
        {row.nom}
      </Link>
    ),
  },
  { key: 'ville', header: 'Ville' },
  {
    key: 'type_tms',
    header: 'Type TMS',
    render: (row) => (
      <Badge variant="neutral">
        {TYPE_TMS_LABELS[row.type_tms] ?? row.type_tms}
      </Badge>
    ),
  },
  { key: 'contact_email', header: 'Contact' },
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

export default function TransporteursPage() {
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeTms, setTypeTms] = useState('');
  const [actif, setActif] = useState('true');
  const [page, setPage] = useState(1);

  const fetchTransporteurs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (actif) params.set('actif', actif);
    if (typeTms) params.set('type_tms', typeTms);
    if (q) params.set('q', q);
    const res = await fetch(`/api/v1/admin/transporteurs?${params}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Transporteur[];
        total: number;
      };
      setTransporteurs(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, actif, typeTms, q]);

  useEffect(() => {
    void fetchTransporteurs();
  }, [fetchTransporteurs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Transporteurs
          </h1>
        </div>
        <Link href="/admin/transporteurs/nouveau">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nouveau transporteur
          </Button>
        </Link>
      </div>

      <div className="flex gap-3 flex-wrap">
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
          value={typeTms}
          onChange={(e) => {
            setTypeTms(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tous les types</option>
          <option value="mts1">MTS-1</option>
          <option value="a_toutes">A Toutes!</option>
          <option value="autre">Autre</option>
        </select>
        <select
          className="border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
          value={actif}
          onChange={(e) => {
            setActif(e.target.value);
            setPage(1);
          }}
        >
          <option value="true">Actifs</option>
          <option value="false">Inactifs</option>
          <option value="">Tous</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : transporteurs.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Aucun transporteur"
          description="Créez le premier transporteur."
        />
      ) : (
        <DataTable
          columns={columns}
          data={transporteurs}
          keyExtractor={(row) => row.id}
          pagination={{ page, total, limit: 50, onPageChange: setPage }}
        />
      )}
    </div>
  );
}
