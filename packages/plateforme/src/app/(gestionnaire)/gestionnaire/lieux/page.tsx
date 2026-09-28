'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, TriangleAlert } from 'lucide-react';
import { PageHero } from '@/components/ui/page-hero';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';

interface LieuRow {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  type_vehicule_max: string | null;
  capacite_maximum: number | null;
  actif: boolean;
  nb_collectes_12m: number;
  tonnage_12m_kg: number;
}

export default function GestionnaireLieuxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<LieuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  const charger = useCallback(() => {
    setLoading(true);
    setErreur(false);
    fetch('/api/v1/gestionnaire/lieux')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setRows((j.data ?? []) as LieuRow[]))
      // §10 §7 « Error » : un échec de chargement ne doit jamais se lire comme
      // une liste vide — sans ce catch, une 500 affichait « Aucun lieu associé ».
      .catch(() => setErreur(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // Colonnes §06.05 §3 : Nom, Adresse, Capacité, Collectes 12 m, Tonnage ZD 12 m.
  const columns: Column<LieuRow>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (l) => (
        <span className="font-semibold text-savr-neutral-900">{l.nom}</span>
      ),
    },
    {
      key: 'adresse',
      header: 'Adresse',
      render: (l) => (
        <div>
          <div>{l.adresse_acces ?? '—'}</div>
          <div className="text-xs text-savr-neutral-500">
            {[l.code_postal, l.ville].filter(Boolean).join(' ')}
          </div>
        </div>
      ),
    },
    {
      key: 'capacite_maximum',
      header: 'Capacité',
      render: (l) =>
        l.capacite_maximum != null ? `${l.capacite_maximum} pers.` : '—',
    },
    {
      key: 'nb_collectes_12m',
      header: 'Collectes 12 m',
      render: (l) => l.nb_collectes_12m,
    },
    {
      key: 'tonnage_12m_kg',
      header: 'Tonnage ZD 12 m',
      render: (l) =>
        l.tonnage_12m_kg > 0 ? `${l.tonnage_12m_kg.toFixed(0)} kg` : '—',
    },
  ];

  const contenu = erreur ? (
    <EmptyState
      icon={<TriangleAlert className="h-8 w-8" />}
      title="Impossible de charger vos lieux"
      description="Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
      action={{ label: 'Réessayer', onClick: charger }}
    />
  ) : !loading && rows.length === 0 ? (
    <EmptyState
      icon={<MapPin className="h-8 w-8" />}
      title="Aucun lieu associé"
      description="Les lieux rattachés à votre organisation apparaîtront ici."
    />
  ) : (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      keyExtractor={(row) => row.id}
      onRowClick={(row) => router.push(`/gestionnaire/lieux/${row.id}`)}
    />
  );

  return (
    <div className="space-y-5">
      <PageHero
        icon={<MapPin className="h-6 w-6 text-savr-primary-200" />}
        title="Lieux"
        subtitle={
          loading || erreur
            ? undefined
            : `${rows.length} lieu${rows.length > 1 ? 'x' : ''} rattaché${rows.length > 1 ? 's' : ''} à votre organisation`
        }
      />

      <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-2 sm:p-4">
        {contenu}
      </div>
    </div>
  );
}
