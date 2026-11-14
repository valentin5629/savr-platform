'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
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
import { TAILLE_BOUTON_BARRE_TABLEAU } from '@/components/ui/bouton-export-csv';
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
    /**
     * Place dans la carte mobile (< 640 px) :
     *  - `titre` : ligne de tête, sans étiquette (défaut : la première colonne) ;
     *  - `pastille` : à droite du titre, sans étiquette (statut, type) ;
     *  - `principal` : ligne « étiquette  valeur » toujours visible ;
     *  - `secondaire` : ligne révélée par « Voir plus ».
     * Sans indication, les premières colonnes après le titre sont principales,
     * les suivantes secondaires (cf. `repartirCarte`). Une colonne d'actions
     * (sans titre) va toujours au pied de la carte.
     */
    carteMobile?: 'titre' | 'pastille' | 'principal' | 'secondaire';
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
// horizontal de page) : un titre, quelques lignes clés, le reste sous « Voir
// plus », les actions au pied (DS §8). Une ligne sans valeur n'est pas
// affichée (règle `[data-carte-ligne]` de globals.css).
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
  /** Actions à droite de la barre, juste avant « Colonnes » (ex. export CSV). */
  toolbarActions?: React.ReactNode;
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

// ── Carte mobile (< 640 px) ───────────────────────────────────────────────────
// Lignes « étiquette  valeur » montrées d'emblée quand la liste ne dit rien ;
// au-delà, les colonnes suivantes passent sous « Voir plus ». Une carte qui
// n'aurait qu'une ligne à révéler les montre toutes.
const LIGNES_CARTE = 4;

// Colonne d'actions : pas de titre visible (fonction `sr-only` ou chaîne vide).
function estColonneActions<T>(column: Column<T, unknown>): boolean {
  const h = column.columnDef.header;
  return typeof h !== 'string' || h === '';
}

interface CarteRepartie<T> {
  titre: Cell<T, unknown> | undefined;
  pastilles: Cell<T, unknown>[];
  principales: Cell<T, unknown>[];
  secondaires: Cell<T, unknown>[];
  actions: Cell<T, unknown>[];
}

// Range les cellules visibles d'une ligne dans les zones de la carte.
function repartirCarte<T>(cellules: Cell<T, unknown>[]): CarteRepartie<T> {
  const carte: CarteRepartie<T> = {
    titre: undefined,
    pastilles: [],
    principales: [],
    secondaires: [],
    actions: [],
  };
  const libres: Cell<T, unknown>[] = [];
  for (const cellule of cellules) {
    const meta = cellule.column.columnDef.meta;
    if (meta?.hideOnMobile) continue;
    const place = meta?.carteMobile;
    if (place === 'titre' && !carte.titre) carte.titre = cellule;
    else if (place === 'pastille') carte.pastilles.push(cellule);
    else if (place === 'principal') carte.principales.push(cellule);
    else if (place === 'secondaire') carte.secondaires.push(cellule);
    else if (estColonneActions(cellule.column)) carte.actions.push(cellule);
    else libres.push(cellule);
  }
  if (!carte.titre) carte.titre = libres.shift();
  // Colonnes sans indication : principales dans la limite de LIGNES_CARTE
  // (colonnes déjà déclarées principales comprises), secondaires ensuite.
  const place = Math.max(0, LIGNES_CARTE - carte.principales.length);
  const tout = libres.length <= place + 1 && carte.secondaires.length === 0;
  for (const [i, cellule] of libres.entries()) {
    if (tout || i < place) carte.principales.push(cellule);
    else carte.secondaires.push(cellule);
  }
  // Ordre des colonnes conservé dans chaque zone.
  const rang = new Map(cellules.map((c, i) => [c, i]));
  const parRang = (a: Cell<T, unknown>, b: Cell<T, unknown>) =>
    rang.get(a)! - rang.get(b)!;
  carte.principales.sort(parRang);
  carte.secondaires.sort(parRang);
  return carte;
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
  toolbarActions,
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
  // Cartes mobiles dont les lignes secondaires sont dépliées (« Voir plus »).
  const [cartesOuvertes, setCartesOuvertes] = React.useState<
    ReadonlySet<string>
  >(new Set());
  const basculerCarte = (id: string) =>
    setCartesOuvertes((avant) => {
      const apres = new Set(avant);
      if (!apres.delete(id)) apres.add(id);
      return apres;
    });

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
      {!erreur &&
        !loading &&
        rows.length > 0 &&
        (toolbar || toolbarActions || columnsToggle) && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">{toolbar}</div>
            {toolbarActions}
            {columnsToggle && hideable.length > 0 && (
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button
                    variant="secondary"
                    className={TAILLE_BOUTON_BARRE_TABLEAU}
                  >
                    <ColumnsIcon />
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
            {rows.map((row) => {
              const carte = repartirCarte(row.getVisibleCells());
              const ouverte = cartesOuvertes.has(row.id);
              const rendu = (cell: Cell<T, unknown>) =>
                flexRender(cell.column.columnDef.cell, cell.getContext());
              const ligne = (cell: Cell<T, unknown>, secondaire: boolean) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <div
                    key={cell.id}
                    data-carte-ligne={secondaire ? 'secondaire' : 'principale'}
                    className={cn(
                      'flex items-start justify-between gap-3',
                      secondaire && !ouverte && 'hidden',
                    )}
                    onClick={stopIfInteractive(meta?.interactive)}
                    onKeyDown={stopIfInteractive(meta?.interactive)}
                  >
                    <dt className="shrink-0 font-medium text-savr-neutral-500">
                      {headerLabel(cell.column)}
                    </dt>
                    <dd className="min-w-0 text-right text-savr-neutral-900">
                      {rendu(cell)}
                    </dd>
                  </div>
                );
              };
              return (
                <li
                  key={row.id}
                  {...rowProps(row)}
                  data-carte-liste
                  className={cn(
                    'rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4 text-sm',
                    onRowClick && 'cursor-pointer',
                    rowClassName?.(row.original),
                  )}
                >
                  {/* Tête : titre à gauche, pastilles (statut, type) à droite.
                      Les cellules alignées à droite pour l'ancienne carte sont
                      ramenées à gauche dans le titre. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    {carte.titre && (
                      <div
                        className="min-w-0 font-semibold text-savr-neutral-900 [&_.justify-end]:justify-start [&_.text-right]:text-left"
                        onClick={stopIfInteractive(
                          carte.titre.column.columnDef.meta?.interactive,
                        )}
                        onKeyDown={stopIfInteractive(
                          carte.titre.column.columnDef.meta?.interactive,
                        )}
                      >
                        <span className="sr-only">
                          {headerLabel(carte.titre.column)} :{' '}
                        </span>
                        {rendu(carte.titre)}
                      </div>
                    )}
                    {carte.pastilles.length > 0 && (
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {carte.pastilles.map((cell) => (
                          <div key={cell.id}>
                            <span className="sr-only">
                              {headerLabel(cell.column)} :{' '}
                            </span>
                            {rendu(cell)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {carte.principales.length + carte.secondaires.length > 0 && (
                    <dl className="mt-3 space-y-2 empty:hidden">
                      {carte.principales.map((cell) => ligne(cell, false))}
                      {carte.secondaires.map((cell) => ligne(cell, true))}
                    </dl>
                  )}
                  {(carte.secondaires.length > 0 ||
                    carte.actions.length > 0) && (
                    <div
                      data-carte-pied
                      className="-mb-2 mt-1 flex min-h-11 items-center justify-between gap-3 empty:hidden"
                    >
                      {carte.secondaires.length > 0 ? (
                        <button
                          type="button"
                          data-carte-voir-plus
                          aria-expanded={ouverte}
                          onClick={(e) => {
                            e.stopPropagation();
                            basculerCarte(row.id);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-savr-md px-2 text-sm font-semibold text-savr-primary-700 hover:bg-savr-primary-50"
                        >
                          {ouverte ? 'Voir moins' : 'Voir plus'}
                          <CaretDownIcon
                            className={cn(
                              'h-3.5 w-3.5 transition-transform duration-savr-fast',
                              ouverte && 'rotate-180',
                            )}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        <span />
                      )}
                      {carte.actions.map((cell) => (
                        <div
                          key={cell.id}
                          className="flex shrink-0 items-center"
                          onClick={stopIfInteractive(
                            cell.column.columnDef.meta?.interactive,
                          )}
                          onKeyDown={stopIfInteractive(
                            cell.column.columnDef.meta?.interactive,
                          )}
                        >
                          {rendu(cell)}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// Cellule vide commune à toutes les listes : « — » atténué.
// `data-cellule-vide` : la carte mobile n'affiche pas une ligne dont c'est la
// seule valeur (globals.css).
function CelluleVide() {
  return (
    <span data-cellule-vide className="text-savr-neutral-400">
      —
    </span>
  );
}

export { CelluleVide, DataGrid };
export type { ColumnDef, SortingState } from '@tanstack/react-table';
