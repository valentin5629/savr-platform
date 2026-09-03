'use client';

import { useEffect, useState, useCallback } from 'react';
import { Truck, Plus, Search, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TransporteurModal,
  type TransporteurRecord,
} from '@/components/admin/transporteur-modal';

// Ligne = enregistrement complet (l'API liste renvoie select('*')) → sert
// directement à préremplir la modale d'édition, sans re-fetch.
type Transporteur = TransporteurRecord;

const TYPE_TMS_LABELS: Record<string, string> = {
  mts1: 'MTS-1',
  a_toutes: 'A Toutes!',
  autre: 'Autre',
  par_mail: 'Par mail',
  par_telephone: 'Par téléphone',
};

const TYPE_VEHICULE_LABELS: Record<string, string> = {
  velo_cargo: 'Vélo cargo',
  camionnette: 'Camionnette',
  fourgon: 'Fourgon',
  vul: 'VUL',
  poids_lourd: 'Poids lourd',
};

const TYPE_COLLECTE_LABELS: Record<string, string> = {
  anti_gaspi: 'AG',
  zero_dechet: 'ZD',
};

export default function TransporteursPage() {
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeTms, setTypeTms] = useState('');
  const [actif, setActif] = useState('true');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transporteur | null>(null);

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

  function openEdit(row: Transporteur) {
    setEditing(row);
    setModalOpen(true);
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  const columns: Column<Transporteur>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (row) => (
        <div>
          <div className="font-medium text-savr-neutral-900">{row.nom}</div>
          <div className="text-xs text-savr-neutral-500">
            {row.contact_nom}
            {row.contact_telephone ? ` · ${row.contact_telephone}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'ville', header: 'Ville' },
    {
      key: 'types_vehicules',
      header: 'Véhicule(s)',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.types_vehicules && row.types_vehicules.length > 0 ? (
            row.types_vehicules.map((v) => (
              <Badge key={v} variant="neutral" dot={false}>
                {TYPE_VEHICULE_LABELS[v] ?? v}
              </Badge>
            ))
          ) : (
            <span className="text-savr-neutral-400">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'type_tms',
      header: 'Type TMS',
      render: (row) => (
        <Badge variant="neutral" dot={false}>
          {TYPE_TMS_LABELS[row.type_tms] ?? row.type_tms}
        </Badge>
      ),
    },
    {
      key: 'types_collecte',
      header: 'Types collecte',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.types_collecte && row.types_collecte.length > 0 ? (
            row.types_collecte.map((t) => (
              <Badge
                key={t}
                variant={t === 'anti_gaspi' ? 'action' : 'primary'}
                dot={false}
              >
                {TYPE_COLLECTE_LABELS[t] ?? t}
              </Badge>
            ))
          ) : (
            <span className="text-savr-neutral-400">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'actif',
      header: 'Actif',
      render: (row) =>
        row.actif ? (
          <Badge variant="success">Actif</Badge>
        ) : (
          <Badge variant="neutral">Inactif</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Modifier ${row.nom}`}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Transporteurs
          </h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau transporteur
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-savr-neutral-400" />
          <input
            className="w-full pl-9 pr-3 py-2 border border-savr-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
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
          <option value="par_mail">Par mail</option>
          <option value="par_telephone">Par téléphone</option>
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
        <>
          <DataTable
            columns={columns}
            data={transporteurs}
            keyExtractor={(row) => row.id}
            onRowClick={openEdit}
          />
          {total > 50 && (
            <div className="flex items-center justify-between gap-2 pt-3 text-sm">
              <span className="text-savr-neutral-500">
                {total} transporteur{total > 1 ? 's' : ''}
              </span>
              <Pagination
                page={page}
                pageCount={Math.ceil(total / 50)}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}

      <TransporteurModal
        open={modalOpen}
        transporteur={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void fetchTransporteurs()}
      />
    </div>
  );
}
