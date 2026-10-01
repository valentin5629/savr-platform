'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Truck, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TransporteurModal,
  type PrestataireOption,
  type TransporteurRecord,
} from '@/components/admin/transporteur-modal';
import type { Database } from '@savr/shared/src/database.types.js';

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

export default function TransporteursPage() {
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  // Filtres à choix multiple, case « Tous » = sélection vide (décision Val
  // 2026-09-30) ; « Actifs » reste pré-coché par défaut.
  const [typesTms, setTypesTms] = useState<string[]>([]);
  const [actifs, setActifs] = useState<string[]>(['true']);
  const [page, setPage] = useState(1);
  // Tri serveur de la Data Table (liste paginée) : envoyé à l'API, retour
  // en page 1 à chaque changement (cf. lib/tri-liste).
  const [tri, setTri] = useState<{ cle: string; ordre: 'asc' | 'desc' }>({
    cle: 'nom',
    ordre: 'asc',
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Transporteur | null>(null);
  const [prestataires, setPrestataires] = useState<PrestataireOption[] | null>(
    null,
  ); // null = non chargé ou en échec (≠ référentiel vide)

  // Numéro de la dernière requête : une réponse plus ancienne arrivée après
  // (cases cochées en rafale) est ignorée au lieu d'écraser la liste.
  const derniereRequete = useRef(0);

  const fetchTransporteurs = useCallback(async () => {
    const numero = ++derniereRequete.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    params.set('tri', tri.cle);
    params.set('ordre', tri.ordre);
    const actif = valeurUnique(actifs);
    if (actif) params.set('actif', actif);
    if (typesTms.length > 0) params.set('types_tms', typesTms.join(','));
    if (q) params.set('q', q);
    try {
      const res = await fetch(`/api/v1/admin/transporteurs?${params}`);
      const json = res.ok
        ? ((await res.json()) as { data: Transporteur[]; total: number })
        : null;
      if (numero !== derniereRequete.current || !json) return;
      setTransporteurs(json.data);
      setTotal(json.total);
    } finally {
      if (numero === derniereRequete.current) setLoading(false);
    }
  }, [page, actifs, typesTms, q, tri]);

  useEffect(() => {
    void fetchTransporteurs();
  }, [fetchTransporteurs]);

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
          <div className="text-xs text-savr-neutral-500">
            {row.contact_nom}
            {row.contact_telephone ? ` · ${row.contact_telephone}` : ''}
          </div>
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

      <FilterBar data-testid="transporteurs-filtres">
        <FiltreRecherche
          id="transporteurs-recherche"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <FiltreCoches
          label="Type"
          testid="transporteurs-type"
          options={Object.entries(TYPE_TMS_LABELS).map(([id, nom]) => ({
            id,
            nom,
          }))}
          selected={typesTms}
          onChange={(ids) => {
            setTypesTms(ids);
            setPage(1);
          }}
        />
        <FiltreCoches
          label="Statut"
          testid="transporteurs-statut"
          options={[
            { id: 'true', nom: 'Actifs' },
            { id: 'false', nom: 'Inactifs' },
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
        onSaved={() => {
          void fetchTransporteurs();
          // Un rattachement change les prestataires à griser.
          void fetchPrestataires();
        }}
        prestataires={prestataires}
      />
    </div>
  );
}
