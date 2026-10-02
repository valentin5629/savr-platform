'use client';

import { libelleTypePack } from '@/lib/libelles/pack';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { ImpersonationLauncher } from '@/components/ui/impersonation-launcher';
import { PageHero } from '@/components/ui/page-hero';
import {
  OrganisationModal,
  TYPE_ORGANISATION_LABELS,
} from '@/components/admin/organisation-modal';

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
      <a
        href={`/admin/clients/${row.id}`}
        className="flex items-center gap-3 font-medium text-savr-primary-700 hover:underline"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-savr-full bg-savr-primary-100 text-xs font-bold text-savr-primary-700"
          aria-hidden="true"
        >
          {initiales(row.raison_sociale)}
        </span>
        {row.raison_sociale}
      </a>
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

export default function ClientsPage() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Filtres à choix multiple, case « Tous » = sélection vide (décision Val
  // 2026-09-30, divergence M0.8_20260930_filtres-choix-multiple-tous).
  const [types, setTypes] = useState<string[]>([]);
  const [actifs, setActifs] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // Liste paginée côté serveur (50 par page) : recherche, tri et page sont
  // envoyés à l'API. Avant, seule la 1re page était chargée et la recherche
  // filtrait ces 50 lignes → les organisations suivantes étaient invisibles.
  const [page, setPage] = useState(1);
  const [tri, setTri] = useState<{ cle: string; ordre: 'asc' | 'desc' }>({
    cle: 'raison_sociale',
    ordre: 'asc',
  });
  // Recherche envoyée après une courte pause de frappe (pas un appel par touche).
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Numéro de la dernière requête : une réponse plus ancienne arrivée après
  // (cases cochées en rafale) est ignorée au lieu d'écraser la liste.
  const derniereRequete = useRef(0);

  const fetchOrgs = useCallback(async () => {
    const numero = ++derniereRequete.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (types.length > 0) params.set('types', types.join(','));
    const actif = valeurUnique(actifs);
    if (actif) params.set('actif', actif);
    if (q) params.set('q', q);
    params.set('tri', tri.cle);
    params.set('ordre', tri.ordre);

    try {
      const res = await fetch(
        `/api/v1/admin/organisations?${params.toString()}`,
      );
      const json = res.ok
        ? ((await res.json()) as { data: Organisation[]; total: number })
        : null;
      if (numero !== derniereRequete.current || !json) return;
      setOrgs(json.data);
      setTotal(json.total);
    } finally {
      if (numero === derniereRequete.current) setLoading(false);
    }
  }, [types, actifs, q, tri, page]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

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
      <FilterBar data-testid="clients-filtres">
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
          selected={types}
          onChange={(ids) => {
            setTypes(ids);
            setPage(1);
          }}
        />
        <FiltreCoches
          label="Statut"
          testid="clients-statut"
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
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="Aucune organisation"
          description={
            search
              ? 'Aucun résultat pour cette recherche.'
              : 'Créez la première organisation.'
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={orgs}
            keyExtractor={(row) => row.id}
            onSort={(cle, ordre) => {
              setTri({ cle, ordre });
              setPage(1);
            }}
            sortKey={tri.cle}
            sortDirection={tri.ordre}
          />
          {total > 50 && (
            <Pagination
              page={page}
              pageCount={Math.ceil(total / 50)}
              onPageChange={setPage}
              className="justify-end"
            />
          )}
        </>
      )}

      <OrganisationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void fetchOrgs()}
      />
    </div>
  );
}
