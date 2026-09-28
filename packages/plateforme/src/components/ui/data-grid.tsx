'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type RowData,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownCheckboxItem,
  DropdownContent,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Métadonnées de colonne propres à Savr (déclarées sur TanStack).
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Libellé humain : menu « Colonnes » et étiquette de la carte mobile. */
    label?: string;
    /** Classes ajoutées aux cellules (th + td) de la colonne. */
    className?: string;
    /** Cellule porteuse de contrôles (bouton, menu) : le clic ne remonte pas
     *  à la ligne, sinon il ouvrirait la fiche en plus de l'action. */
    interactive?: boolean;
    /** Masquée dans la carte mobile (< 640 px). */
    hideOnMobile?: boolean;
    /** Colonne fixée au bord droit pendant le défilement horizontal (ex.
     *  Actions) : l'action reste atteignable quand le tableau déborde. */
    stickyRight?: boolean;
  }
}

// DataGrid — Data Table shadcn/ui (TanStack Table v8) aux tokens Savr (§10 §6).
// Tri : côté client par défaut ; `manualSorting` quand la liste est paginée
// côté serveur (trier la seule page chargée donnerait un ordre faux sur
// l'ensemble — l'appelant renvoie alors `sorting` à son API).
// En dessous de 640 px, chaque ligne devient une carte (PWA, pas de scroll
// horizontal de page).
// ⚠ Une colonne n'est triable que si elle porte un `accessorFn` (règle
// TanStack), MÊME en `manualSorting` : sans lui, l'en-tête reste inerte.
interface DataGridProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  /** Rendu quand `data` est vide (hors chargement). */
  empty?: React.ReactNode;
  /** Tri contrôlé (obligatoire avec `manualSorting`). */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Tri initial en mode non contrôlé. */
  initialSorting?: SortingState;
  manualSorting?: boolean;
  /** Colonnes masquées au départ (`{ id: false }`). */
  initialColumnVisibility?: VisibilityState;
  /** Affiche le menu « Colonnes » (masquer / réafficher). */
  columnsToggle?: boolean;
  /** Contenu à gauche de la barre d'outils (compteur, filtres…). */
  toolbar?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Nom accessible de la ligne cliquable (lecteurs d'écran). */
  rowLabel?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  'data-testid'?: string;
}

// Colonne fixée à droite : fond opaque (le contenu défile dessous) qui suit le
// survol de la ligne, filet gauche pour marquer la séparation.
const STICKY_HEAD =
  'sticky right-0 z-[1] bg-savr-neutral-50 shadow-[inset_1px_0_0_var(--color-savr-neutral-200)]';
const STICKY_CELL =
  'sticky right-0 z-[1] bg-savr-white shadow-[inset_1px_0_0_var(--color-savr-neutral-100)] group-hover:bg-savr-neutral-50';

function SortIcon<T>({ column }: { column: Column<T, unknown> }) {
  const dir = column.getIsSorted();
  if (dir === 'asc') return <ChevronUp className="h-3.5 w-3.5" aria-hidden />;
  if (dir === 'desc')
    return <ChevronDown className="h-3.5 w-3.5" aria-hidden />;
  return (
    <ChevronsUpDown className="h-3.5 w-3.5 text-savr-neutral-400" aria-hidden />
  );
}

function headerLabel<T>(column: Column<T, unknown>): string {
  const h = column.columnDef.header;
  return (
    column.columnDef.meta?.label ?? (typeof h === 'string' ? h : column.id)
  );
}

function DataGrid<T>({
  columns,
  data,
  getRowId,
  loading = false,
  empty,
  sorting: sortingProp,
  onSortingChange,
  initialSorting = [],
  manualSorting = false,
  initialColumnVisibility = {},
  columnsToggle = false,
  toolbar,
  onRowClick,
  rowLabel,
  rowClassName,
  className,
  'data-testid': testId,
}: DataGridProps<T>) {
  const [sortingLocal, setSortingLocal] =
    React.useState<SortingState>(initialSorting);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility);
  const sorting = sortingProp ?? sortingLocal;

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => getRowId(row),
    state: { sorting, columnVisibility },
    onSortingChange: onSortingChange ?? setSortingLocal,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
  });

  /**
   * Active une ligne au clavier (DS §10 « navigation complète au clavier »),
   * parité avec DataTable. Pas de `role="button"` sur la ligne : les cellules
   * `interactive` portent leurs propres contrôles, et un contrôle imbriqué
   * dans un contrôle est invalide. La garde `target === currentTarget` évite
   * la double activation par le keydown remonté d'un bouton interne.
   * Le focus ring DS vient de `*:focus-visible` (@layer base) ; seul l'offset
   * est rentré dans la ligne desktop (le conteneur `overflow-x-auto` rognerait
   * un offset positif). Ne jamais poser `outline-none` ici.
   */
  const onRowKeyDown =
    (row: T) => (event: React.KeyboardEvent<HTMLElement>) => {
      if (!onRowClick) return;
      if (event.target !== event.currentTarget) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onRowClick(row);
    };

  const stopIfInteractive =
    (interactive: boolean | undefined) => (e: React.SyntheticEvent) => {
      if (interactive) e.stopPropagation();
    };

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const rows = table.getRowModel().rows;

  const rowProps = (row: Row<T>) =>
    onRowClick
      ? {
          onClick: () => onRowClick(row.original),
          onKeyDown: onRowKeyDown(row.original),
          tabIndex: 0,
          'aria-label': rowLabel?.(row.original),
        }
      : {};

  return (
    <div className={cn('space-y-3', className)} data-testid={testId}>
      {(toolbar || columnsToggle) && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnsToggle && hideable.length > 0 && (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" className="h-11 sm:h-10">
                  <Columns3 className="h-4 w-4" />
                  Colonnes
                </Button>
              </DropdownTrigger>
              <DropdownContent align="end" className="min-w-[12rem]">
                <DropdownLabel>Colonnes affichées</DropdownLabel>
                <DropdownSeparator />
                {hideable.map((column) => (
                  <DropdownCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(v) => column.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {headerLabel(column)}
                  </DropdownCheckboxItem>
                ))}
              </DropdownContent>
            </Dropdown>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-savr-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        empty
      ) : (
        <>
          {/* ≥ 640 px : tableau */}
          <div className="hidden overflow-hidden rounded-savr-lg border border-savr-neutral-200 bg-savr-white shadow-savr-sm sm:block">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((header) => {
                      const col = header.column;
                      const sortable = col.getCanSort();
                      const dir = col.getIsSorted();
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            col.columnDef.meta?.stickyRight && STICKY_HEAD,
                            col.columnDef.meta?.className,
                          )}
                          aria-sort={
                            sortable
                              ? dir === 'asc'
                                ? 'ascending'
                                : dir === 'desc'
                                  ? 'descending'
                                  : 'none'
                              : undefined
                          }
                        >
                          {header.isPlaceholder ? null : sortable ? (
                            <button
                              type="button"
                              onClick={col.getToggleSortingHandler()}
                              className="-mx-1 inline-flex items-center gap-1 rounded-savr-sm px-1 py-1 uppercase hover:text-savr-neutral-900"
                            >
                              {flexRender(
                                col.columnDef.header,
                                header.getContext(),
                              )}
                              <SortIcon column={col} />
                            </button>
                          ) : (
                            flexRender(
                              col.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    {...rowProps(row)}
                    className={cn(
                      'group',
                      onRowClick &&
                        'cursor-pointer focus-visible:-outline-offset-2',
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            meta?.stickyRight && STICKY_CELL,
                            meta?.className,
                          )}
                          onClick={stopIfInteractive(meta?.interactive)}
                          onKeyDown={stopIfInteractive(meta?.interactive)}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* < 640 px : cartes */}
          <ul className="space-y-2 sm:hidden">
            {rows.map((row) => (
              <li
                key={row.id}
                {...rowProps(row)}
                className={cn(
                  'space-y-2 rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4',
                  onRowClick && 'cursor-pointer',
                  rowClassName?.(row.original),
                )}
              >
                {row
                  .getVisibleCells()
                  .filter((c) => !c.column.columnDef.meta?.hideOnMobile)
                  .map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <div
                        key={cell.id}
                        className="flex items-start justify-between gap-3 text-sm"
                        onClick={stopIfInteractive(meta?.interactive)}
                        onKeyDown={stopIfInteractive(meta?.interactive)}
                      >
                        <span className="shrink-0 font-medium text-savr-neutral-500">
                          {headerLabel(cell.column)}
                        </span>
                        <span className="min-w-0 text-right text-savr-neutral-900">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </span>
                      </div>
                    );
                  })}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export { DataGrid };
export type { ColumnDef, SortingState } from '@tanstack/react-table';
