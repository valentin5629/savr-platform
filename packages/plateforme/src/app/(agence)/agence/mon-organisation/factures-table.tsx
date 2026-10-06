'use client';

import { fmtEuro } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import { Badge } from '@/components/ui/badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { Text } from '@/components/ui/text';
import {
  FacturesFiltresBar,
  FILTRES_FACTURES,
  filtrerFactures,
} from '@/components/facture/factures-filtres-bar';
import { useFiltresUrl } from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';

export interface FactureAgence {
  id: string;
  numero_facture: string | null;
  type: string | null;
  statut: string;
  montant_ttc: number | null;
  date_emission: string | null;
  date_echeance: string | null;
}

// Factures de l'agence — Data Table commune, ordre de la route (émission
// décroissante). Pas de tri de colonne (iso-rendu).
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

// Liste chargée par la route `/api/v1/agence/factures` (toutes les factures
// non brouillon, RLS org-scoped — plus de `.limit(20)` côté page, R-UI-4b
// D10), filtrée côté client avec les MÊMES filtres que le traiteur (la route
// agence n'accepte que `statut` / `type` à valeur unique — reliquat).
export function FacturesAgenceTable() {
  const { valeurs: f, set, reset, actif } = useFiltresUrl(FILTRES_FACTURES);
  const {
    data: factures,
    loading,
    erreur,
    recharger,
  } = useListePaginee<FactureAgence>('/api/v1/agence/factures');
  const visibles = filtrerFactures(factures, f);
  return (
    <>
      <FacturesFiltresBar
        className="mb-4"
        value={f}
        set={set}
        actif={actif}
        onReset={reset}
        count={visibles.length}
      />
      <DataGrid
        columnsToggle={false}
        columns={COLONNES}
        data={visibles}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        getRowId={(f) => f.id}
        empty={<Text>Aucune facture.</Text>}
      />
    </>
  );
}
