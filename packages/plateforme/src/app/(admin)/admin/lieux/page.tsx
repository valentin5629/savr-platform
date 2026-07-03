'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapPin, Plus, Search, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Lieu {
  id: string;
  nom: string;
  adresse_acces: string;
  ville: string;
  code_postal: string;
  capacite_maximum: number | null;
  controle_acces_requis_default: boolean;
  actif: boolean;
}

// Colonnes liste (décision Val 2026-07-02) : Nom · Adresse · Capacité max ·
// Contrôle accès · Statut. Le reste (véhicule max, Citeo, gestionnaire…) est dans
// la fiche lieu.
const columns: Column<Lieu>[] = [
  {
    key: 'nom',
    header: 'Nom',
    render: (row) => (
      <Link
        href={`/admin/lieux/${row.id}`}
        className="font-medium text-savr-primary-700 hover:underline"
      >
        {row.nom}
      </Link>
    ),
  },
  {
    key: 'adresse_acces',
    header: 'Adresse',
    render: (row) => `${row.adresse_acces}, ${row.code_postal} ${row.ville}`,
  },
  {
    key: 'capacite_maximum',
    header: 'Capacité max',
    render: (row) =>
      row.capacite_maximum != null ? (
        String(row.capacite_maximum)
      ) : (
        <span className="text-savr-neutral-400">—</span>
      ),
  },
  {
    key: 'controle_acces_requis_default',
    header: 'Contrôle accès',
    render: (row) =>
      row.controle_acces_requis_default ? (
        <Badge variant="warning">Requis</Badge>
      ) : (
        <span className="text-savr-neutral-400">—</span>
      ),
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

export default function LieuxPage() {
  const [lieux, setLieux] = useState<Lieu[]>([]);
  const [total, setTotal] = useState(0);
  const [nbModifs, setNbModifs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [actif, setActif] = useState('true');
  const [worklist, setWorklist] = useState(false);
  const [page, setPage] = useState(1);

  const fetchLieux = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), actif });
    if (q) params.set('q', q);
    if (worklist) params.set('worklist', 'modifs');
    const res = await fetch(`/api/v1/admin/lieux?${params}`);
    if (res.ok) {
      const json = (await res.json()) as { data: Lieu[]; total: number };
      setLieux(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, actif, q, worklist]);

  useEffect(() => {
    void fetchLieux();
  }, [fetchLieux]);

  // Compteur worklist modifs
  useEffect(() => {
    fetch('/api/v1/admin/lieux?worklist=modifs')
      .then((r) => r.json())
      .then((j: { total: number }) => setNbModifs(j.total))
      .catch(() => void 0);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">Lieux</h1>
          {nbModifs > 0 && (
            <Badge variant="warning" className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {nbModifs} modif{nbModifs > 1 ? 's' : ''} signalée
              {nbModifs > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Link href="/admin/lieux/nouveau">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nouveau lieu
          </Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-savr-neutral-400" />
          <input
            className="w-full pl-9 pr-3 py-2 border border-savr-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
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
        <Button
          variant={worklist ? 'primary' : 'secondary'}
          onClick={() => {
            setWorklist(!worklist);
            setPage(1);
          }}
        >
          <AlertCircle className="h-4 w-4 mr-2" />
          Worklist modifs
          {nbModifs > 0 && (
            <span className="ml-1 bg-savr-warning-500 text-white text-xs rounded-full px-1.5 py-0.5">
              {nbModifs}
            </span>
          )}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : lieux.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8" />}
          title="Aucun lieu"
          description="Créez le premier lieu ou modifiez vos filtres."
        />
      ) : (
        <DataTable
          columns={columns}
          data={lieux}
          keyExtractor={(row) => row.id}
          pagination={{ page, total, limit: 50, onPageChange: setPage }}
        />
      )}
    </div>
  );
}
