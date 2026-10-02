'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Truck, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { compteurResultats } from '@/lib/compteur-resultats';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ListFooter } from '@/components/ui/list-footer';
import { EmptyState } from '@/components/ui/empty-state';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import {
  TransporteurModal,
  type PrestataireOption,
  type TransporteurRecord,
} from '@/components/admin/transporteur-modal';
import type { Database } from '@savr/shared/src/database.types.js';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';

// Ligne = enregistrement complet (l'API liste renvoie select('*')) → sert
// directement à préremplir la modale d'édition, sans re-fetch.
type Transporteur = TransporteurRecord;

// Clés = enum DB type_tms complet (`satisfies`) : le filtre Type en tire ses
// options, un renommage d'enum casse la compilation.
const TYPE_TMS_LABELS: Record<string, string> = {
  mts1: 'MTS-1',
  a_toutes: 'A Toutes!',
  autre: 'Autre',
  par_mail: 'Par mail',
  par_telephone: 'Par téléphone',
} satisfies Record<Database['plateforme']['Enums']['type_tms'], string>;

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

// Filtres de la liste, miroir dans l'URL (R-UI-4a) : choix multiple, case
// « Tous » = sélection vide (décision Val 2026-09-30), « Actifs » pré-coché.
// Tri serveur de la Data Table (cf. lib/tri-liste), retour page 1 à chaque
// changement de filtre ou de tri.
const FILTRES = {
  q: texte(''),
  types_tms: liste(),
  actif: liste(['true']),
  page: navigation(entier(1, 1)),
  tri: navigation(texte('nom')),
  ordre: navigation(texte('asc')),
};

export default function TransporteursPage() {
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
    const actif = valeurUnique(f.actif);
    if (actif) params.set('actif', actif);
    if (f.types_tms.length > 0) params.set('types_tms', f.types_tms.join(','));
    if (f.q) params.set('q', f.q);
    return `/api/v1/admin/transporteurs?${params}`;
  }, [f]);
  const {
    data: transporteurs,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<Transporteur>(url);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transporteur | null>(null);
  const [prestataires, setPrestataires] = useState<PrestataireOption[] | null>(
    null,
  ); // null = non chargé ou en échec (≠ référentiel vide)

  const fetchPrestataires = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/prestataires');
      if (!res.ok) return;
      const json = (await res.json()) as { data: PrestataireOption[] };
      setPrestataires(json.data);
    } catch {
      // Réseau : la modale signale la liste indisponible (prestataires null).
    }
  }, []);

  useEffect(() => {
    void fetchPrestataires();
  }, [fetchPrestataires]);

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
      sortable: true,
      header: 'Nom',
      render: (row) => (
        <div>
          <div className="font-medium text-savr-neutral-900">{row.nom}</div>
          <Text as="div" variant="hint">
            {row.contact_nom}
            {row.contact_telephone ? ` · ${row.contact_telephone}` : ''}
          </Text>
        </div>
      ),
    },
    { key: 'ville', sortable: true, header: 'Ville' },
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
      sortable: true,
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
      sortable: true,
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
        title="Transporteurs"
        tone="neutral"
        icon={<Truck className="h-6 w-6 text-savr-neutral-600" />}
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Nouveau transporteur
          </Button>
        }
      />

      <FilterBar
        data-testid="transporteurs-filtres"
        count={compteurResultats(total, 'transporteur', 'transporteurs')}
        actif={filtresActifs}
        onReset={reset}
      >
        <FiltreRecherche
          id="transporteurs-recherche"
          value={f.q}
          onValueChange={(q) => set({ q })}
        />
        <FiltreCoches
          label="Type"
          testid="transporteurs-type"
          options={Object.entries(TYPE_TMS_LABELS).map(([id, nom]) => ({
            id,
            nom,
          }))}
          selected={f.types_tms}
          onChange={(ids) => set({ types_tms: ids })}
        />
        <FiltreCoches
          label="Statut"
          testid="transporteurs-statut"
          options={[
            { id: 'true', nom: 'Actifs' },
            { id: 'false', nom: 'Inactifs' },
          ]}
          selected={f.actif}
          onChange={(ids) => set({ actif: ids })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={transporteurs}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="Aucun transporteur"
            description="Créez le premier transporteur."
          />
        }
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

      <TransporteurModal
        open={modalOpen}
        transporteur={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          recharger();
          // Un rattachement change les prestataires à griser.
          void fetchPrestataires();
        }}
        prestataires={prestataires}
      />
    </div>
  );
}
