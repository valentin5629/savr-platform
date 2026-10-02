'use client';

import { libelleTypePack } from '@/lib/libelles/pack';
import { useEffect, useState, useMemo } from 'react';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ListFooter } from '@/components/ui/list-footer';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { ImpersonationLauncher } from '@/components/ui/impersonation-launcher';
import { PageHero } from '@/components/ui/page-hero';
import {
  OrganisationModal,
  TYPE_ORGANISATION_LABELS,
} from '@/components/admin/organisation-modal';
import { TextLink } from '@/components/ui/text-link';

interface PackActif {
  type_pack: string;
  credits_restants: number;
}

interface Organisation {
  id: string;
  raison_sociale: string;
  type: string;
  siret: string | null;
  actif: boolean;
  nb_users: number;
  nb_collectes_zd_12m: number;
  nb_collectes_ag_12m: number;
  pack_actif: PackActif | null;
}

// Seuil « crédits faibles » aligné sur le bandeau d'alerte de la fiche (< 5).
const PACK_CREDITS_FAIBLES = 5;

// Initiales pour l'avatar (2 premières lettres significatives de la raison sociale).
function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0]!.slice(0, 2).toUpperCase();
  return (mots[0]![0]! + mots[mots.length - 1]![0]!).toUpperCase();
}

const columns: Column<Organisation>[] = [
  {
    key: 'raison_sociale',
    sortable: true,
    header: 'Nom',
    render: (row) => (
      <TextLink
        href={`/admin/clients/${row.id}`}
        className="flex gap-3 font-medium"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-savr-full bg-savr-primary-100 text-xs font-bold text-savr-primary-700"
          aria-hidden="true"
        >
          {initiales(row.raison_sociale)}
        </span>
        {row.raison_sociale}
      </TextLink>
    ),
  },
  {
    key: 'type',
    sortable: true,
    header: 'Type',
    render: (row) => (
      <Badge variant="neutral">
        {TYPE_ORGANISATION_LABELS[row.type] ?? row.type}
      </Badge>
    ),
  },
  { key: 'nb_users', header: 'Users' },
  { key: 'nb_collectes_zd_12m', header: 'ZD 12 mois' }, // gitleaks:allow
  { key: 'nb_collectes_ag_12m', header: 'AG 12 mois' }, // gitleaks:allow
  {
    key: 'pack_actif',
    header: 'Pack actif',
    render: (row) => {
      if (!row.pack_actif)
        return <span className="text-savr-neutral-400">—</span>;
      const { type_pack, credits_restants } = row.pack_actif;
      const label = libelleTypePack(type_pack);
      return (
        <Badge
          variant={
            credits_restants < PACK_CREDITS_FAIBLES ? 'error' : 'success'
          }
        >
          {label} · {credits_restants} restant
          {credits_restants !== 1 ? 's' : ''}
        </Badge>
      );
    },
  },
  {
    key: 'actif',
    sortable: true,
    header: 'Statut',
    render: (row) =>
      row.actif ? (
        <Badge variant="success">Actif</Badge>
      ) : (
        <Badge variant="neutral">Inactif</Badge>
      ),
  },
];

// Filtres de la liste, miroir dans l'URL (R-UI-4a) : choix multiple, case
// « Tous » = sélection vide (décision Val 2026-09-30, divergence
// M0.8_20260930_filtres-choix-multiple-tous). Liste paginée côté serveur :
// recherche, tri et page sont envoyés à l'API (avant, seule la 1re page était
// chargée et la recherche filtrait ces 50 lignes).
const FILTRES = {
  q: texte(''),
  types: liste(),
  actif: liste(),
  page: navigation(entier(1)),
  tri: navigation(texte('raison_sociale')),
  ordre: navigation(texte('asc')),
};

export default function ClientsPage() {
  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  const [modalOpen, setModalOpen] = useState(false);
  // Recherche envoyée après une courte pause de frappe (pas un appel par touche).
  const [search, setSearch] = useState(f.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== f.q) set({ q: search.trim() });
    }, 300);
    return () => clearTimeout(t);
    // `f.q` ne sert qu'à éviter un `set` redondant au montage.
  }, [search]);
  const url = useMemo(() => {
    const params = new URLSearchParams({ page: String(f.page) });
    if (f.types.length > 0) params.set('types', f.types.join(','));
    const actif = valeurUnique(f.actif);
    if (actif) params.set('actif', actif);
    if (f.q) params.set('q', f.q);
    params.set('tri', f.tri);
    params.set('ordre', f.ordre);
    return `/api/v1/admin/organisations?${params.toString()}`;
  }, [f]);
  const {
    data: orgs,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<Organisation>(url);

  return (
    <div className="space-y-6">
      {/* Bandeau d'en-tête — composant DS PageHero (§10 §5.6, aplat primary-700) */}
      <PageHero
        title="Clients"
        subtitle={
          loading
            ? 'Chargement…'
            : `${total} organisation${total !== 1 ? 's' : ''}`
        }
        actions={
          // admin_savr ET ops_savr (§06.06 + matrice ops §09) : le layout
          // (admin) et requireStaff bornent déjà aux 2 rôles staff.
          <Button variant="accent" onClick={() => setModalOpen(true)}>
            <Plus />
            Nouvelle organisation
          </Button>
        }
      />

      {/* Impersonation (admin_savr uniquement — le composant se masque sinon) */}
      <ImpersonationLauncher />

      {/* Filtres */}
      <FilterBar
        data-testid="clients-filtres"
        count={`${total} organisation${total !== 1 ? 's' : ''}`}
        actif={filtresActifs}
        onReset={() => {
          setSearch('');
          reset();
        }}
      >
        <FiltreRecherche
          id="clients-recherche"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FiltreCoches
          label="Type"
          testid="clients-type"
          options={Object.entries(TYPE_ORGANISATION_LABELS).map(
            ([id, nom]) => ({
              id,
              nom,
            }),
          )}
          selected={f.types}
          onChange={(ids) => set({ types: ids })}
        />
        <FiltreCoches
          label="Statut"
          testid="clients-statut"
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
        data={orgs}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<Building2 />}
            title="Aucune organisation"
            description={
              search
                ? 'Aucun résultat pour cette recherche.'
                : 'Créez la première organisation.'
            }
          />
        }
        onSort={(cle, ordre) => set({ tri: cle, ordre })}
        sortKey={f.tri}
        sortDirection={f.ordre as 'asc' | 'desc'}
      />
      <ListFooter
        total={total}
        page={f.page}
        onPageChange={(page) => set({ page })}
      />

      <OrganisationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={recharger}
      />
    </div>
  );
}
