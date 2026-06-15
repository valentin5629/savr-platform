'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Facture {
  id: string;
  numero_facture: string | null;
  type: string;
  mode_facturation: string;
  statut: string;
  pennylane_statut: string | null;
  montant_ht: number;
  montant_ttc: number;
  devise: string;
  date_emission: string | null;
  date_echeance: string | null;
  date_paiement: string | null;
  organisations: { raison_sociale: string } | null;
  entites_facturation: { raison_sociale: string; siret: string | null } | null;
}

type BadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'action'
  | 'neutral'
  | 'primary';

const STATUT_LABELS: Record<string, { label: string; variant: BadgeVariant }> =
  {
    brouillon: { label: 'Brouillon', variant: 'neutral' },
    en_attente_pennylane: { label: 'En attente', variant: 'warning' },
    emise: { label: 'Émise', variant: 'info' },
    payee: { label: 'Payée', variant: 'success' },
    annulee: { label: 'Annulée', variant: 'error' },
  };

const TYPE_LABELS: Record<string, string> = {
  zero_dechet: 'ZD',
  collecte_antigaspi: 'AG',
  achat_pack_antigaspi: 'Pack',
  avoir: 'Avoir',
};

const FILTRES = [
  { key: '', label: 'Tout' },
  { key: 'brouillon', label: 'Brouillons' },
  { key: 'en_attente_pennylane', label: 'En attente Pennylane' },
  { key: 'emise', label: 'Émises' },
  { key: 'payee', label: 'Payées' },
];

const columns: Column<Facture>[] = [
  {
    key: 'numero_facture',
    header: 'Numéro',
    render: (row) => (
      <Link
        href={`/admin/factures/${row.id}`}
        className="font-medium text-primary-700 hover:underline"
      >
        {row.numero_facture ?? '— brouillon —'}
      </Link>
    ),
  },
  {
    key: 'organisations',
    header: 'Organisation',
    render: (row) => row.organisations?.raison_sociale ?? '—',
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => TYPE_LABELS[row.type] ?? row.type,
  },
  {
    key: 'statut',
    header: 'Statut',
    render: (row) => {
      const s = STATUT_LABELS[row.statut] ?? {
        label: row.statut,
        variant: 'neutral' as BadgeVariant,
      };
      const enRetard =
        row.statut === 'emise' &&
        row.date_echeance != null &&
        new Date(row.date_echeance) < new Date();
      return (
        <span className="flex items-center gap-1.5">
          <Badge variant={s.variant}>{s.label}</Badge>
          {enRetard && <Badge variant="error">En retard</Badge>}
        </span>
      );
    },
  },
  {
    key: 'montant_ttc',
    header: 'TTC',
    render: (row) =>
      new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: row.devise,
      }).format(row.montant_ttc),
  },
  {
    key: 'date_emission',
    header: 'Émission',
    render: (row) =>
      row.date_emission
        ? new Date(row.date_emission).toLocaleDateString('fr-FR')
        : '—',
  },
  {
    key: 'date_paiement',
    header: 'Paiement',
    render: (row) =>
      row.date_paiement
        ? new Date(row.date_paiement).toLocaleDateString('fr-FR')
        : '—',
  },
];

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const qs = filtre ? `?statut=${filtre}` : '';
    fetch(`/api/v1/admin/factures${qs}`)
      .then((r) => r.json())
      .then((d: { data: Facture[] }) => setFactures(d.data ?? []))
      .finally(() => setLoading(false));
  }, [filtre]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary-600" />
          <h1 className="text-2xl font-semibold">Factures</h1>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTRES.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltre(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filtre === f.key
                ? 'bg-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : factures.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="Aucune facture"
          description="Les brouillons apparaissent ici après le batch J+1."
        />
      ) : (
        <DataTable
          columns={columns}
          data={factures}
          keyExtractor={(row) => row.id}
        />
      )}
    </div>
  );
}
