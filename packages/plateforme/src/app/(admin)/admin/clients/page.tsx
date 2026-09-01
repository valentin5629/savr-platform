'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ImpersonationLauncher } from '@/components/ui/impersonation-launcher';
import { PageHero } from '@/components/ui/page-hero';

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

const TYPE_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire lieux',
  client_organisateur: 'Client organisateur',
};

// Libellé compact du type de pack pour la colonne (ex. pack_30 → « Pack 30 »).
const PACK_LABELS: Record<string, string> = {
  unitaire: 'Unitaire',
  pack_10: 'Pack 10',
  pack_30: 'Pack 30',
  pack_60: 'Pack 60',
  personnalise: 'Pack perso',
};

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
    header: 'Type',
    render: (row) => (
      <Badge variant="neutral">{TYPE_LABELS[row.type] ?? row.type}</Badge>
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
      const label = PACK_LABELS[type_pack] ?? type_pack;
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
  const [typeFilter, setTypeFilter] = useState('');
  const [actifFilter, setActifFilter] = useState('');

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    if (actifFilter) params.set('actif', actifFilter);

    const res = await fetch(`/api/v1/admin/organisations?${params.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Organisation[];
        total: number;
      };
      setOrgs(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [typeFilter, actifFilter]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  const filtered = search
    ? orgs.filter((o) =>
        o.raison_sociale.toLowerCase().includes(search.toLowerCase()),
      )
    : orgs;

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
          <Link href="/admin/clients/nouveau">
            <Button variant="accent">
              <Plus className="w-4 h-4" />
              Créer une organisation
            </Button>
          </Link>
        }
      />

      {/* Impersonation (admin_savr uniquement — le composant se masque sinon) */}
      <ImpersonationLauncher />

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
        >
          <option value="">Tous les types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={actifFilter}
          onChange={(e) => setActifFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
        >
          <option value="">Tous les statuts</option>
          <option value="true">Actifs</option>
          <option value="false">Inactifs</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
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
        <DataTable
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
        />
      )}
    </div>
  );
}
