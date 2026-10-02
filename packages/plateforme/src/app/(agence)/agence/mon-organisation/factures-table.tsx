'use client';

import { fmtEuro } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import { Badge } from '@/components/ui/badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { Text } from '@/components/ui/text';

export interface FactureAgence {
  id: string;
  numero_facture: string | null;
  statut: string;
  montant_ttc: number | null;
  date_emission: string | null;
  date_echeance: string | null;
}

// Factures de l'agence — Data Table commune. Pas de tri : la page ne charge
// que les 20 dernières factures (`.limit(20)`), trier ce seul extrait laisserait
// croire à un ordre sur toutes les factures. Ordre de la requête (émission
// décroissante).
const COLONNES: ColumnDef<FactureAgence, unknown>[] = [
  {
    id: 'numero',
    header: 'Numéro',
    cell: ({ row: { original: f } }) => f.numero_facture ?? '—',
  },
  {
    id: 'emission',
    header: 'Émission',
    cell: ({ row: { original: f } }) => f.date_emission ?? '—',
  },
  {
    id: 'echeance',
    header: 'Échéance',
    cell: ({ row: { original: f } }) => f.date_echeance ?? '—',
  },
  {
    id: 'montant',
    header: 'Montant TTC',
    meta: { className: 'tabular-nums' },
    cell: ({ row: { original: f } }) =>
      f.montant_ttc != null ? fmtEuro(f.montant_ttc) : '—',
  },
  {
    id: 'statut',
    header: 'Statut',
    cell: ({ row: { original: f } }) => (
      <Badge variant="neutral">{libelleStatutFacture(f.statut)}</Badge>
    ),
  },
];

export function FacturesAgenceTable({
  factures,
}: {
  factures: FactureAgence[];
}) {
  return (
    <DataGrid
      columnsToggle={false}
      columns={COLONNES}
      data={factures}
      getRowId={(f) => f.id}
      empty={<Text>Aucune facture.</Text>}
    />
  );
}
