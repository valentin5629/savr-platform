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
//  - `onSort` fourni → tri piloté par l'écran (souvent serveur), inchangé ;
//  - `clientSort` → tri dans le navigateur, à réserver aux listes COMPLÈTES
//    (jamais sur une liste paginée : on ne trierait que la page affichée) ;
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
  /** Tri dans le navigateur sur les colonnes à valeur simple (liste complète
   *  uniquement). */
  clientSort?: boolean;
  className?: string;
  /** Classe CSS appliquée par ligne (ex. surlignage criticité). */
  rowClassName?: (row: T) => string;
  /** Rend chaque ligne cliquable (navigation vers le détail). */
  onRowClick?: (row: T) => void;
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
  rowClassName,
  onRowClick,
}: DataTableProps<T>) {
  // Colonnes triables en mode client : celles dont la valeur est simple
  // (texte, nombre, booléen) — une colonne d'actions ou d'objet n'a pas
  // d'ordre naturel.
  const triables = React.useMemo(() => {
    if (onSort)
      return new Set(
        columns.filter((c) => c.sortable).map((c) => String(c.key)),
      );
    if (!clientSort) return new Set<string>();
    return new Set(
      columns
        .filter((c) =>
          data.some((r) =>
            ['string', 'number', 'boolean'].includes(typeof valeur(r, c.key)),
          ),
        )
        .map((c) => String(c.key)),
    );
  }, [columns, data, onSort, clientSort]);

  const defs = React.useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((col) => ({
        id: String(col.key),
        header: col.header,
        accessorFn: (row: T) => {
          const v = valeur(row, col.key);
          return v == null ? '' : v;
        },
        enableSorting: triables.has(String(col.key)),
        cell: ({ row }) =>
          col.render
            ? col.render(row.original)
            : String(valeur(row.original, col.key) ?? ''),
      })),
    [columns, triables],
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
      rowClassName={rowClassName}
      onRowClick={onRowClick}
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
