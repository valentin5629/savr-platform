'use client';

import { useMemo } from 'react';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { libelleDateHeure } from '@/lib/format-date-collecte';

export interface HistoriqueCollecte {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  lieu_nom?: string | null;
}

// Historique des collectes d'une fiche (lieu, traiteur) — même Data Table que
// les listes Collectes (décision Val 2026-09-28). Liste courte déjà complète
// (12 mois) : tri côté client, plus récentes d'abord.
export function HistoriqueCollectesTable({
  rows,
  showLieu = false,
}: {
  rows: HistoriqueCollecte[];
  /** Colonne « Lieu » (fiche traiteur : collectes sur plusieurs lieux). */
  showLieu?: boolean;
}) {
  const colonnes = useMemo<ColumnDef<HistoriqueCollecte, unknown>[]>(() => {
    const lieu: ColumnDef<HistoriqueCollecte, unknown> = {
      id: 'lieu',
      header: 'Lieu',
      accessorFn: (c) => c.lieu_nom ?? '',
      cell: ({ row: { original: c } }) => c.lieu_nom ?? <CelluleVide />,
    };
    return [
      {
        id: 'date',
        header: 'Date',
        enableHiding: false,
        accessorFn: (c) => c.date_collecte ?? '',
        cell: ({ row: { original: c } }) =>
          c.date_collecte ? (
            <span className="whitespace-nowrap font-semibold tabular-nums">
              {libelleDateHeure(c.date_collecte.slice(0, 10), null)}
            </span>
          ) : (
            <CelluleVide />
          ),
      },
      ...(showLieu ? [lieu] : []),
      {
        id: 'type',
        header: 'Type',
        accessorFn: (c) => c.type,
        cell: ({ row: { original: c } }) => <TypeCollecteBadge type={c.type} />,
      },
      {
        id: 'statut',
        header: 'Statut',
        accessorFn: (c) => c.statut,
        cell: ({ row: { original: c } }) => (
          <CollecteStatutBadge statut={c.statut} />
        ),
      },
    ];
  }, [showLieu]);

  return (
    <DataGrid
      columnsToggle={false}
      columns={colonnes}
      data={rows}
      getRowId={(c) => c.id}
      initialSorting={[{ id: 'date', desc: true }]}
    />
  );
}
