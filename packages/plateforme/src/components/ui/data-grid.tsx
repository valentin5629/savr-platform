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
import {
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  ColumnsIcon,
} from '@/components/ui/icones';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
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
  /** Rendu quand `data` est vide (hors chargement) ; défaut « Aucun résultat. ». */
  empty?: React.ReactNode;
  /**
   * État Error §10 §7 (R-UI-4a, E4) : message + « Réessayer », rendu À LA
   * PLACE du tableau — une panne ne doit jamais se lire comme une liste vide.
   */
  erreur?: string | null;
  onRecharger?: () => void;
  /** Tri contrôlé (obligatoire avec `manualSorting`). */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Tri initial en mode non contrôlé. */
  initialSorting?: SortingState;
  manualSorting?: boolean;
  /** Colonnes masquées au départ (`{ id: false }`). */
  initialColumnVisibility?: VisibilityState;
  /**
   * Menu « Colonnes » (masquer / réafficher). Défaut `true` (décision Val
   * 2026-09-28) ; les petits blocs (dashboard, fiche, modale) passent
   * `columnsToggle={false}` (R-UI-4a, E6).
   */
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

// Hauteur de ligne constante (décision Val 2026-10-30) : la ligne fait 64 px
// quel que soit son contenu. Chaque cellule tient dans 48 px de haut (deux
// lignes de texte, ou un bouton de 44 px) et 16 rem de large ; au-delà, le
// contenu est coupé (« … » sur le texte), jamais renvoyé à la ligne, même
// dans un conteneur `flex-wrap`. `w-max` : la colonne prend la largeur du
// contenu (jusqu'à 16 rem) au lieu de l'écraser ; une colonne `text-right`
// garde son alignement. Chaque ligne de texte en bloc porte son « … ». Le
// `p-1 -m-1` laisse la place au contour de focus (2 px à 2 px du contrôle),
// que `overflow-hidden` couperait sinon. Quand quelque chose est coupé, le
// texte complet s'affiche au survol (`titreSiCoupe`). La carte mobile garde
// le retour à la ligne.
const LIGNE = 'h-16';
const CELLULE = 'py-2';
const CONTENU_CELLULE =
  '-m-1 w-max max-w-[16rem] max-h-14 overflow-hidden p-1 text-ellipsis [&_*]:whitespace-nowrap [&_.flex-wrap]:flex-nowrap [&_:is(div,p):not(.flex,.inline-flex)]:truncate [.text-right>&]:ml-auto [.text-center>&]:mx-auto';

// Pose, au survol, le texte complet de la cellule en infobulle si son contenu
// (ou un de ses éléments) est coupé. Une infobulle déjà posée par la colonne
// est conservée ; celle posée ici est recalculée à chaque survol (le contenu
// d'une ligne peut changer).
function titreSiCoupe(event: React.MouseEvent<HTMLDivElement>) {
  const cellule = event.currentTarget;
  const auto = cellule.dataset.titreAuto === '1';
  if (!auto && (cellule.title || cellule.querySelector('[title]'))) return;
  const coupe = [cellule, ...cellule.querySelectorAll('*')].some(
    (el) =>
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + 1,
  );
  if (coupe) {
    cellule.title = cellule.innerText.replace(/\s*\n+\s*/g, ' · ').trim();
    cellule.dataset.titreAuto = '1';
  } else if (auto) {
    cellule.removeAttribute('title');
    delete cellule.dataset.titreAuto;
  }
}

function SortIcon<T>({ column }: { column: Column<T, unknown> }) {
  const dir = column.getIsSorted();
  if (dir === 'asc') return <CaretUpIcon className="h-3.5 w-3.5" aria-hidden />;
  if (dir === 'desc')
    return <CaretDownIcon className="h-3.5 w-3.5" aria-hidden />;
  return (
    <CaretUpDownIcon
      className="h-3.5 w-3.5 text-savr-neutral-400"
      aria-hidden
    />
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
  empty = (
    <p className="py-8 text-center text-sm text-savr-neutral-500">
      Aucun résultat.
    </p>
  ),
  erreur = null,
  onRecharger,
  sorting: sortingProp,
  onSortingChange,
  initialSorting = [],
  manualSorting = false,
  initialColumnVisibility = {},
  // Menu « Colonnes » actif par défaut sur TOUS les tableaux (décision Val
  // 2026-09-28 : même format partout) ; `false` pour le retirer.
  columnsToggle = true,
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
    getRowId,
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

  // Une cellule `interactive` garde ses clics pour ses contrôles, sauf sur
  // un élément marqué `data-ouvre-ligne` (chevron de fin de ligne) : son clic
  // remonte à la ligne et ouvre la fiche.
  const stopIfInteractive =
    (interactive: boolean | undefined) => (e: React.SyntheticEvent) => {
      if (!interactive) return;
      const cible = e.target as Element | null;
      if (cible?.closest?.('[data-ouvre-ligne]')) return;
      e.stopPropagation();
    };

  // Colonnes proposées dans le menu : celles qui ont un titre visible. Une
  // colonne d'actions (titre `sr-only`) reste toujours affichée.
  const hideable = table
    .getAllLeafColumns()
    .filter(
      (c) =>
        c.getCanHide() &&
        typeof c.columnDef.header === 'string' &&
        c.columnDef.header !== '',
    );
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
      {!erreur && !loading && rows.length > 0 && (toolbar || columnsToggle) && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnsToggle && hideable.length > 0 && (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" className="h-11 sm:h-10">
                  <ColumnsIcon className="h-4 w-4" />
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

      {erreur ? (
        <ErrorState
          message={erreur}
          onRetry={onRecharger}
          data-testid={testId ? `${testId}-erreur` : undefined}
        />
      ) : loading ? (
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
                      LIGNE,
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
                            CELLULE,
                            meta?.stickyRight && STICKY_CELL,
                            meta?.className,
                          )}
                          onClick={stopIfInteractive(meta?.interactive)}
                          onKeyDown={stopIfInteractive(meta?.interactive)}
                        >
                          <div
                            className={CONTENU_CELLULE}
                            onMouseEnter={titreSiCoupe}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
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

// Cellule vide commune à toutes les listes : « — » atténué.
function CelluleVide() {
  return <span className="text-savr-neutral-400">—</span>;
}

export { CelluleVide, DataGrid };
export type { ColumnDef, SortingState } from '@tanstack/react-table';
