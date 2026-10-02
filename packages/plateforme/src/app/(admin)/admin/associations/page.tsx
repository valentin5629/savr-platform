'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Heart, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AssociationModal,
  type AssociationRecord,
} from '@/components/admin/association-modal';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';

// Ligne = enregistrement complet (l'API liste renvoie select('*')) + KPI dérivé →
// sert directement à préremplir la modale d'édition, sans re-fetch.
type Association = AssociationRecord & {
  // KPI dérivé (API liste) — collectes AG réalisées rattachées, 30 derniers jours.
  collectes_realisees_30j: number;
};

const columns: Column<Association>[] = [
  {
    key: 'nom',
    sortable: true,
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
        <Text as="div" variant="hint">
          {row.ville} ({row.region})
        </Text>
      </div>
    ),
  },
  {
    key: 'capacite_max_beneficiaires',
    sortable: true,
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
  // Statut à choix multiple, « Actives » pré-cochée par défaut ; case
  // « Toutes » = sélection vide = aucun filtre (décision Val 2026-09-30).
  const [actifs, setActifs] = useState<string[]>(['true']);
  const [page, setPage] = useState(1);
  // Tri serveur de la Data Table (liste paginée) : envoyé à l'API, retour
  // en page 1 à chaque changement (cf. lib/tri-liste).
  const [tri, setTri] = useState<{ cle: string; ordre: 'asc' | 'desc' }>({
    cle: 'nom',
    ordre: 'asc',
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Association | null>(null);

  // Numéro de la dernière requête : une réponse plus ancienne arrivée après
  // (cases cochées en rafale) est ignorée au lieu d'écraser la liste.
  const derniereRequete = useRef(0);

  const fetchAssociations = useCallback(async () => {
    const numero = ++derniereRequete.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    // Sans valeur unique cochée, AUCUN paramètre `actif` : l'ancien `actif=`
    // vide (« Toutes ») était lu `false` par la route → inactives seules.
    const actif = valeurUnique(actifs);
    if (actif) params.set('actif', actif);
    params.set('tri', tri.cle);
    params.set('ordre', tri.ordre);
    if (q) params.set('q', q);
    try {
      const res = await fetch(`/api/v1/admin/associations?${params}`);
      const json = res.ok
        ? ((await res.json()) as { data: Association[]; total: number })
        : null;
      if (numero !== derniereRequete.current || !json) return;
      setAssociations(json.data);
      setTotal(json.total);
    } finally {
      if (numero === derniereRequete.current) setLoading(false);
    }
  }, [page, actifs, q, tri]);

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
          <IconButton
            size="sm"
            aria-label={`Modifier ${row.nom}`}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row);
            }}
          >
            <Pencil />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Associations"
        tone="neutral"
        icon={<Heart className="h-6 w-6 text-savr-neutral-600" />}
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Nouvelle association
          </Button>
        }
      />

      <FilterBar data-testid="associations-filtres">
        <FiltreRecherche
          id="associations-recherche"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <FiltreCoches
          label="Statut"
          testid="associations-statut"
          libelleVide="Toutes"
          libelleTous="Toutes"
          options={[
            { id: 'true', nom: 'Actives' },
            { id: 'false', nom: 'Inactives' },
          ]}
          selected={actifs}
          onChange={(ids) => {
            setActifs(ids);
            setPage(1);
          }}
        />
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
            onSort={(cle, ordre) => {
              setTri({ cle, ordre });
              setPage(1);
            }}
            sortKey={tri.cle}
            sortDirection={tri.ordre}
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
