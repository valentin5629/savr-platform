'use client';

import { useEffect, useState, useCallback } from 'react';
import { Heart, Plus, Search, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { FilterBar } from '@/components/ui/filter-bar';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AssociationModal,
  type AssociationRecord,
} from '@/components/admin/association-modal';

// Ligne = enregistrement complet (l'API liste renvoie select('*')) + KPI dérivé →
// sert directement à préremplir la modale d'édition, sans re-fetch.
type Association = AssociationRecord & {
  // KPI dérivé (API liste) — collectes AG réalisées rattachées, 30 derniers jours.
  collectes_realisees_30j: number;
};

const columns: Column<Association>[] = [
  {
    key: 'nom',
    header: 'Nom',
    render: (row) => (
      <span className="font-medium text-savr-neutral-900">{row.nom}</span>
    ),
  },
  {
    key: 'adresse',
    header: 'Adresse',
    render: (row) => (
      <div>
        <div className="text-savr-neutral-800">{row.adresse}</div>
        <div className="text-xs text-savr-neutral-500">
          {row.ville} ({row.region})
        </div>
      </div>
    ),
  },
  {
    key: 'capacite_max_beneficiaires',
    header: 'Capacité max',
    render: (row) =>
      row.capacite_max_beneficiaires ?? (
        <span className="text-savr-neutral-400">—</span>
      ),
  },
  {
    key: 'collectes_realisees_30j',
    header: 'Collectes (30 j)',
    render: (row) => (
      <span className="font-medium tabular-nums">
        {row.collectes_realisees_30j}
      </span>
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

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Association | null>(null);

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

  function openEdit(row: Association) {
    setEditing(row);
    setModalOpen(true);
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  const columnsWithActions: Column<Association>[] = [
    ...columns,
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
          <Heart className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Associations
          </h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle association
        </Button>
      </div>

      <FilterBar data-testid="associations-filtres">
        <FormField label="Recherche" htmlFor="associations-recherche">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400" />
            <Input
              id="associations-recherche"
              className="pl-9"
              placeholder="Rechercher…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </FormField>
        <FormField label="Statut" htmlFor="associations-statut">
          <Combobox
            id="associations-statut"
            icon={null}
            placeholder="Toutes"
            options={[
              { value: 'true', label: 'Actives' },
              { value: 'false', label: 'Inactives' },
              { value: '', label: 'Toutes' },
            ]}
            value={actif}
            onChange={(v) => {
              setActif(v);
              setPage(1);
            }}
          />
        </FormField>
      </FilterBar>

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
        <>
          <DataTable
            columns={columnsWithActions}
            data={associations}
            keyExtractor={(row) => row.id}
            onRowClick={openEdit}
          />
          {total > 50 && (
            <div className="flex items-center justify-between gap-2 pt-3 text-sm">
              <span className="text-savr-neutral-500">
                {total} association{total > 1 ? 's' : ''}
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

      <AssociationModal
        open={modalOpen}
        association={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void fetchAssociations()}
      />
    </div>
  );
}
