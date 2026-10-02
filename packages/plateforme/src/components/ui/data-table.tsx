'use client';

import * as React from 'react';
import {
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';

// DataTable — API historique (colonnes `key`/`header`/`render`) conservée pour
// ses écrans, rendue par la Data Table commune DataGrid (shadcn/TanStack,
// décision Val 2026-09-28 : « dès qu'il y a une liste, je la veux à ce
// format »). Même rendu, même clavier, même carte mobile que les listes
// Collectes ; le TRI garde exactement le comportement de chaque écran :
// Seules les colonnes marquées `sortable: true` sont triables :
//  - `onSort` fourni → tri piloté par l'écran (souvent serveur), inchangé ;
//  - `clientSort` → tri dans le navigateur sur la valeur brute `row[key]`, à
//    réserver aux listes COMPLÈTES (jamais sur une liste paginée : on ne
//    trierait que la page affichée) ;
//  - sinon → pas de tri (l'ancien rendu montrait l'icône sans réagir).

export interface Column<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  keyExtractor: (row: T) => string;
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  /** Tri dans le navigateur des colonnes `sortable` (liste complète
   *  uniquement). */
  clientSort?: boolean;
  className?: string;
  /** Rend chaque ligne cliquable (navigation vers le détail). */
  onRowClick?: (row: T) => void;
  /** Transmis à DataGrid (R-UI-4a, E4/E6). */
  empty?: React.ReactNode;
  erreur?: string | null;
  onRecharger?: () => void;
  columnsToggle?: boolean;
  toolbar?: React.ReactNode;
}

function valeur<T>(row: T, key: Column<T>['key']): unknown {
  return (row as Record<string, unknown>)[String(key)];
}

function DataTable<T>({
  columns,
  data,
  loading = false,
  keyExtractor,
  onSort,
  sortKey,
  sortDirection,
  clientSort = false,
  className,
  onRowClick,
  empty,
  erreur,
  onRecharger,
  columnsToggle,
  toolbar,
}: DataTableProps<T>) {
  const tri = Boolean(onSort) || clientSort;

  const defs = React.useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((col) => ({
        id: String(col.key),
        header: col.header,
        accessorFn: (row: T) => {
          const v = valeur(row, col.key);
          return v == null ? '' : v;
        },
        enableSorting: tri && col.sortable === true,
        // Colonne sans titre (actions) : jamais masquable, elle n'aurait pas de
        // libellé dans le menu « Colonnes ».
        enableHiding: col.header !== '',
        // Colonne d'actions (sans titre) : fixée au bord droit quand le tableau
        // déborde, comme la liste Collectes — l'action reste atteignable.
        meta: col.header === '' ? { stickyRight: true } : undefined,
        cell: ({ row }) =>
          col.render
            ? col.render(row.original)
            : String(valeur(row.original, col.key) ?? ''),
      })),
    [columns, tri],
  );

  const sorting: SortingState | undefined =
    onSort && sortKey
      ? [{ id: sortKey, desc: sortDirection === 'desc' }]
      : undefined;

  return (
    <DataGrid
      columns={defs}
      data={data}
      getRowId={keyExtractor}
      loading={loading}
      className={className}
      onRowClick={onRowClick}
      empty={empty}
      erreur={erreur}
      onRecharger={onRecharger}
      columnsToggle={columnsToggle}
      toolbar={toolbar}
      {...(onSort
        ? {
            manualSorting: true,
            sorting: sorting ?? [],
            onSortingChange: (updater) => {
              const next =
                typeof updater === 'function'
                  ? updater(sorting ?? [])
                  : updater;
              const s = next[0];
              if (s) onSort(s.id, s.desc ? 'desc' : 'asc');
            },
          }
        : {})}
    />
  );
}

export { DataTable };
