'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { MapPin, Plus, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { Badge } from '@/components/ui/badge';
import { PageHero } from '@/components/ui/page-hero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { LieuModal } from '@/components/admin/lieu-modal';
import { CelluleVide } from '@/components/ui/data-grid';
import { TextLink } from '@/components/ui/text-link';
import { IconButton } from '@/components/ui/icon-button';

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

function DifficulteCell({ value }: { value: string | null }) {
  if (!value) return <CelluleVide />;
  return (
    <Badge variant={DIFFICULTE_VARIANT[value] ?? 'neutral'} dot={false}>
      {DIFFICULTE_LABEL[value] ?? value}
    </Badge>
  );
}

// Filtres de la liste, miroir dans l'URL (R-UI-4a) : statut à choix
// multiple, « Actifs » pré-coché, case « Tous » = sélection vide = aucun
// filtre (décision Val 2026-09-30) ; `tab` = onglet Référentiel / Modifs
// signalées. Tri serveur (cf. lib/tri-liste), retour page 1 à chaque
// changement.
const FILTRES = {
  q: texte(''),
  actif: liste(['true']),
  tab: navigation(texte('referentiel')),
  page: navigation(entier(1, 1)),
  tri: navigation(texte('nom')),
  ordre: navigation(texte('asc')),
};

export default function LieuxPage() {
  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  const tab = f.tab === 'modifs' ? 'modifs' : 'referentiel';
  const url = useMemo(() => {
    const params = new URLSearchParams({
      page: String(f.page),
      tri: f.tri,
      ordre: f.ordre,
    });
    if (tab === 'modifs') {
      params.set('worklist', 'modifs');
    } else {
      const actif = valeurUnique(f.actif);
      if (actif) params.set('actif', actif);
      if (f.q) params.set('q', f.q);
    }
    return `/api/v1/admin/lieux?${params}`;
  }, [f, tab]);
  const {
    data: lieux,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<Lieu>(url);
  const [nbReferentiel, setNbReferentiel] = useState<number | null>(null);
  const [nbModifs, setNbModifs] = useState(0);
  // Libellé de l'onglet Référentiel : total du référentiel (mis à jour quand
  // cet onglet est chargé).
  useEffect(() => {
    if (tab === 'referentiel' && !loading && !erreur) setNbReferentiel(total);
  }, [tab, loading, erreur, total]);
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
    const res = await fetch(
      `/api/v1/admin/lieux/${encodeURIComponent(id)}/normaliser`,
      {
        method: 'POST',
      },
    );
    if (res.ok) recharger();
    setNormalisingId(null);
  };

  const columns: Column<Lieu>[] = [
    {
      key: 'nom',
      sortable: true,
      header: 'Nom',
      render: (row) => (
        // Largeur minimale : sans elle, 9 colonnes se partagent la largeur et
        // un nom comme « Adresse libre — Lyon » passait sur 3 lignes (retour
        // Val 2026-09-28).
        <div className="flex min-w-[220px] items-center gap-2">
          <TextLink
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row.id);
            }}
            className="text-left font-medium"
          >
            {row.nom}
          </TextLink>
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
      sortable: true,
      header: 'Ville',
      render: (row) => row.ville || <CelluleVide />,
    },
    {
      key: 'gestionnaire_nom',
      header: 'Gestionnaire',
      render: (row) => row.gestionnaire_nom ?? <CelluleVide />,
    },
    {
      key: 'acces_office',
      sortable: true,
      header: 'Accès office',
      render: (row) => <DifficulteCell value={row.acces_office} />,
    },
    {
      key: 'stationnement',
      sortable: true,
      header: 'Stationnement',
      render: (row) => <DifficulteCell value={row.stationnement} />,
    },
    {
      key: 'type_vehicule_max',
      sortable: true,
      header: 'Véhicule max',
      render: (row) =>
        row.type_vehicule_max ? (
          <Badge variant="neutral" dot={false}>
            {VEHICULE_LABEL[row.type_vehicule_max] ?? row.type_vehicule_max}
          </Badge>
        ) : (
          <CelluleVide />
        ),
    },
    {
      key: 'capacite_maximum',
      sortable: true,
      header: 'Capacité max',
      render: (row) =>
        row.capacite_maximum != null ? (
          String(row.capacite_maximum)
        ) : (
          <CelluleVide />
        ),
    },
    {
      key: 'controle_acces_requis_default',
      sortable: true,
      header: 'Contrôle accès',
      render: (row) =>
        row.controle_acces_requis_default ? (
          <Badge variant="warning">Requis</Badge>
        ) : (
          <CelluleVide />
        ),
    },
    {
      key: 'actif',
      sortable: true,
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
              onClick={(e) => {
                e.stopPropagation();
                void handleNormaliser(row.id);
              }}
              loading={normalisingId === row.id}
              loadingText="En cours…"
            >
              Normaliser
            </Button>
          </div>
        ),
    },
    {
      key: '_open',
      header: '',
      render: (row) => (
        <IconButton
          size="sm"
          aria-label={`Ouvrir la fiche ${row.nom}`}
          onClick={(e) => {
            e.stopPropagation();
            openEdit(row.id);
          }}
        >
          <ChevronRight />
        </IconButton>
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

  const tableau = (
    <>
      <DataTable
        columns={columns}
        data={lieux}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={listeVide}
        onSort={(cle, ordre) => set({ tri: cle, ordre })}
        sortKey={f.tri}
        sortDirection={f.ordre as 'asc' | 'desc'}
        onRowClick={(row) => openEdit(row.id)}
      />
      <ListFooter
        total={total}
        page={f.page}
        onPageChange={(page) => set({ page })}
      />
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
            <Plus />
            Nouveau lieu
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => set({ tab: v })}>
        <TabsList>
          <TabsTrigger value="referentiel">
            Référentiel{nbReferentiel !== null ? ` (${nbReferentiel})` : ''}
          </TabsTrigger>
          <TabsTrigger value="modifs">
            Modifs signalées{nbModifs > 0 ? ` (${nbModifs})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="referentiel" className="space-y-4">
          <FilterBar
            data-testid="lieux-filtres"
            count={`${total} lieu${total > 1 ? 'x' : ''}`}
            actif={filtresActifs}
            onReset={reset}
          >
            <FiltreRecherche
              id="lieux-recherche"
              placeholder="Rechercher un lieu…"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
            />
            <FiltreCoches
              label="Statut"
              testid="lieux-statut"
              options={[
                { id: 'true', nom: 'Actifs' },
                { id: 'false', nom: 'Inactifs' },
              ]}
              selected={f.actif}
              onChange={(ids) => set({ actif: ids })}
            />
          </FilterBar>
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
          recharger();
          refreshNbModifs();
        }}
      />
    </div>
  );
}
