'use client';

import { useState, useMemo } from 'react';
import { Heart, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ListFooter } from '@/components/ui/list-footer';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { EmptyState } from '@/components/ui/empty-state';
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

// Filtres de la liste, miroir dans l'URL (R-UI-4a) : statut à choix
// multiple, « Actives » pré-cochée, case « Toutes » = sélection vide = aucun
// filtre (décision Val 2026-09-30). Tri serveur (cf. lib/tri-liste), retour
// page 1 à chaque changement.
const FILTRES = {
  q: texte(''),
  actif: liste(['true']),
  page: navigation(entier(1)),
  tri: navigation(texte('nom')),
  ordre: navigation(texte('asc')),
};

export default function AssociationsPage() {
  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  const url = useMemo(() => {
    const params = new URLSearchParams({
      page: String(f.page),
      tri: f.tri,
      ordre: f.ordre,
    });
    // Sans valeur unique cochée, AUCUN paramètre `actif` : l'ancien `actif=`
    // vide (« Toutes ») était lu `false` par la route → inactives seules.
    const actif = valeurUnique(f.actif);
    if (actif) params.set('actif', actif);
    if (f.q) params.set('q', f.q);
    return `/api/v1/admin/associations?${params}`;
  }, [f]);
  const {
    data: associations,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<Association>(url);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Association | null>(null);

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

      <FilterBar
        data-testid="associations-filtres"
        count={`${total} association${total > 1 ? 's' : ''}`}
        actif={filtresActifs}
        onReset={reset}
      >
        <FiltreRecherche
          id="associations-recherche"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
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
          selected={f.actif}
          onChange={(ids) => set({ actif: ids })}
        />
      </FilterBar>

      <DataTable
        columns={columnsWithActions}
        data={associations}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<Heart className="h-8 w-8" />}
            title="Aucune association"
            description="Créez la première association."
          />
        }
        columnsToggle
        onSort={(cle, ordre) => set({ tri: cle, ordre })}
        sortKey={f.tri}
        sortDirection={f.ordre as 'asc' | 'desc'}
        onRowClick={openEdit}
      />
      <ListFooter
        total={total}
        page={f.page}
        onPageChange={(page) => set({ page })}
      />

      <AssociationModal
        open={modalOpen}
        association={editing}
        onClose={() => setModalOpen(false)}
        onSaved={recharger}
      />
    </div>
  );
}
