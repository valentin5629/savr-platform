'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapPin, Plus, Search, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHero } from '@/components/ui/page-hero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { LieuModal } from '@/components/admin/lieu-modal';

interface Lieu {
  id: string;
  nom: string;
  ville: string;
  code_postal: string;
  gestionnaire_nom: string | null;
  acces_office: string | null;
  stationnement: string | null;
  type_vehicule_max: string;
  capacite_maximum: number | null;
  controle_acces_requis_default: boolean;
  reference_citeo: boolean;
  actif: boolean;
}

// Enums §04 / §06.06 §7 — difficulté d'accès (accès office + stationnement) et
// hiérarchie véhicule. Rendus en libellés lisibles + pastilles couleur (maquette).
const DIFFICULTE_LABEL: Record<string, string> = {
  facile: 'Facile',
  difficile: 'Difficile',
  tres_difficile: 'Très difficile',
};
const DIFFICULTE_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
  facile: 'success',
  difficile: 'warning',
  tres_difficile: 'error',
};
const VEHICULE_LABEL: Record<string, string> = {
  velo_cargo: 'Vélo cargo',
  camionnette: 'Camionnette',
  fourgon: 'Fourgon',
  vul: 'VUL',
  poids_lourd: 'Poids lourd',
};

const Vide = () => <span className="text-savr-neutral-400">—</span>;

function DifficulteCell({ value }: { value: string | null }) {
  if (!value) return <Vide />;
  return (
    <Badge variant={DIFFICULTE_VARIANT[value] ?? 'neutral'} dot={false}>
      {DIFFICULTE_LABEL[value] ?? value}
    </Badge>
  );
}

export default function LieuxPage() {
  const [lieux, setLieux] = useState<Lieu[]>([]);
  const [total, setTotal] = useState(0);
  const [nbReferentiel, setNbReferentiel] = useState<number | null>(null);
  const [nbModifs, setNbModifs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [actif, setActif] = useState('true');
  const [tab, setTab] = useState<'referentiel' | 'modifs'>('referentiel');
  const [page, setPage] = useState(1);
  const [normalisingId, setNormalisingId] = useState<string | null>(null);

  // Modale création/édition — point unique (remplace les pages nouveau/[id]).
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setModalOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setModalOpen(true);
  };

  const fetchLieux = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (tab === 'modifs') {
      params.set('worklist', 'modifs');
    } else {
      if (actif) params.set('actif', actif); // '' = Tous → filtre omis
      if (q) params.set('q', q);
    }
    const res = await fetch(`/api/v1/admin/lieux?${params}`);
    if (res.ok) {
      const json = (await res.json()) as { data: Lieu[]; total: number };
      setLieux(json.data);
      setTotal(json.total);
      if (tab === 'referentiel') setNbReferentiel(json.total);
    }
    setLoading(false);
  }, [page, actif, q, tab]);

  useEffect(() => {
    void fetchLieux();
  }, [fetchLieux]);

  // Compteur worklist modifs (indépendant de l'onglet actif)
  const refreshNbModifs = useCallback(() => {
    fetch('/api/v1/admin/lieux?worklist=modifs')
      .then((r) => r.json())
      .then((j: { total: number }) => setNbModifs(j.total))
      .catch(() => void 0);
  }, []);
  useEffect(() => {
    refreshNbModifs();
  }, [refreshNbModifs]);

  // Deep-link ?edit={id} (alerte « modif signalée » → entiteHref) : ouvre la modale
  // directement sur le lieu ciblé, puis nettoie l'URL (pas de réouverture au refresh).
  useEffect(() => {
    const editId = new URLSearchParams(window.location.search).get('edit');
    if (editId) {
      openEdit(editId);
      window.history.replaceState(null, '', '/admin/lieux');
    }
  }, []);

  // Normalisation inline d'un lieu saisi manuellement (§06.06 §7 « Normaliser »).
  const handleNormaliser = async (id: string) => {
    setNormalisingId(id);
    const res = await fetch(`/api/v1/admin/lieux/${id}/normaliser`, {
      method: 'POST',
    });
    if (res.ok) await fetchLieux();
    setNormalisingId(null);
  };

  const columns: Column<Lieu>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (row) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row.id);
            }}
            className="text-left font-medium text-savr-primary-700 hover:underline"
          >
            {row.nom}
          </button>
          {row.reference_citeo && (
            <Badge variant="info" dot={false}>
              Citeo
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'ville',
      header: 'Ville',
      render: (row) => row.ville || <Vide />,
    },
    {
      key: 'gestionnaire_nom',
      header: 'Gestionnaire',
      render: (row) => row.gestionnaire_nom ?? <Vide />,
    },
    {
      key: 'acces_office',
      header: 'Accès office',
      render: (row) => <DifficulteCell value={row.acces_office} />,
    },
    {
      key: 'stationnement',
      header: 'Stationnement',
      render: (row) => <DifficulteCell value={row.stationnement} />,
    },
    {
      key: 'type_vehicule_max',
      header: 'Véhicule max',
      render: (row) =>
        row.type_vehicule_max ? (
          <Badge variant="neutral" dot={false}>
            {VEHICULE_LABEL[row.type_vehicule_max] ?? row.type_vehicule_max}
          </Badge>
        ) : (
          <Vide />
        ),
    },
    {
      key: 'capacite_maximum',
      header: 'Capacité max',
      render: (row) =>
        row.capacite_maximum != null ? String(row.capacite_maximum) : <Vide />,
    },
    {
      key: 'controle_acces_requis_default',
      header: 'Contrôle accès',
      render: (row) =>
        row.controle_acces_requis_default ? (
          <Badge variant="warning">Requis</Badge>
        ) : (
          <Vide />
        ),
    },
    {
      key: 'actif',
      header: 'Statut',
      render: (row) =>
        row.actif ? (
          <Badge variant="success">Actif</Badge>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="action">À normaliser</Badge>
            <Button
              size="sm"
              variant="accent"
              disabled={normalisingId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                void handleNormaliser(row.id);
              }}
            >
              {normalisingId === row.id ? 'En cours…' : 'Normaliser'}
            </Button>
          </div>
        ),
    },
    {
      key: '_open',
      header: '',
      render: (row) => (
        <button
          type="button"
          aria-label={`Ouvrir la fiche ${row.nom}`}
          onClick={(e) => {
            e.stopPropagation();
            openEdit(row.id);
          }}
          className="inline-flex text-savr-neutral-400 hover:text-savr-primary-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const listeVide =
    tab === 'modifs' ? (
      <EmptyState
        icon={<MapPin className="h-8 w-8" />}
        title="Aucune modification signalée"
        description="Les lieux dont une collecte récente diffère de la fiche officielle apparaîtront ici."
      />
    ) : (
      <EmptyState
        icon={<MapPin className="h-8 w-8" />}
        title="Aucun lieu"
        description="Créez le premier lieu ou modifiez vos filtres."
      />
    );

  const tableau = loading ? (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  ) : lieux.length === 0 ? (
    listeVide
  ) : (
    <>
      <DataTable
        columns={columns}
        data={lieux}
        keyExtractor={(row) => row.id}
        onRowClick={(row) => openEdit(row.id)}
      />
      {total > 50 && (
        <div className="flex items-center justify-between gap-2 pt-3 text-sm">
          <span className="text-savr-neutral-500">
            {total} lieu{total > 1 ? 'x' : ''}
          </span>
          <Pagination
            page={page}
            pageCount={Math.ceil(total / 50)}
            onPageChange={setPage}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHero
        icon={<MapPin className="h-6 w-6 text-savr-primary-200" />}
        title="Lieux"
        subtitle="Référentiel lieux d'événements · normalisation des lieux saisis manuellement"
        actions={
          <Button variant="accent" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Nouveau lieu
          </Button>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'referentiel' | 'modifs');
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="referentiel">
            Référentiel{nbReferentiel !== null ? ` (${nbReferentiel})` : ''}
          </TabsTrigger>
          <TabsTrigger value="modifs">
            Modifs signalées{nbModifs > 0 ? ` (${nbModifs})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="referentiel" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-savr-neutral-400" />
              <input
                aria-label="Rechercher un lieu"
                className="w-full pl-9 pr-3 py-2 border border-savr-neutral-300 rounded-savr-md text-sm focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
                placeholder="Rechercher…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label="Filtrer par statut"
              className="border border-savr-neutral-300 rounded-savr-md px-3 py-2 text-sm"
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
          {tableau}
        </TabsContent>

        <TabsContent value="modifs" className="space-y-4">
          {tableau}
        </TabsContent>
      </Tabs>

      <LieuModal
        open={modalOpen}
        lieuId={editingId}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          void fetchLieux();
          refreshNbModifs();
        }}
      />
    </div>
  );
}
