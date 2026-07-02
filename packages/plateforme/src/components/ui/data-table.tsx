'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

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
  className?: string;
  /** Classe CSS appliquée par ligne (ex. surlignage criticité). */
  rowClassName?: (row: T) => string;
  pagination?: {
    page: number;
    total: number;
    limit: number;
    onPageChange: (page: number) => void;
  };
}

function DataTable<T>({
  columns,
  data,
  loading = false,
  keyExtractor,
  onSort,
  sortKey,
  sortDirection,
  className,
  rowClassName,
}: DataTableProps<T>) {
  const handleSort = (key: string) => {
    if (!onSort) return;
    const next: 'asc' | 'desc' =
      sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc';
    onSort(key, next);
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey !== colKey)
      return (
        <ChevronsUpDown
          className="h-3.5 w-3.5 text-savr-neutral-400"
          aria-hidden="true"
        />
      );
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
    );
  };

  if (loading) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Desktop : tableau ≥ 640px */}
      <div className={cn('hidden sm:block w-full overflow-x-auto', className)}>
        <table className="w-full text-sm" role="grid">
          <thead>
            <tr className="border-b border-savr-neutral-200">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  scope="col"
                  className={cn(
                    'h-11 px-4 text-left text-xs font-semibold text-savr-neutral-600 select-none',
                    col.sortable &&
                      onSort &&
                      'cursor-pointer hover:text-savr-neutral-900',
                  )}
                  onClick={
                    col.sortable ? () => handleSort(String(col.key)) : undefined
                  }
                  aria-sort={
                    sortKey === String(col.key)
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && <SortIcon colKey={String(col.key)} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={keyExtractor(row)}
                className={cn(
                  'border-b border-savr-neutral-100 hover:bg-savr-neutral-50 transition-colors',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className="px-4 py-4 align-middle text-savr-neutral-800"
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[String(col.key)] ??
                            '',
                        )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile < 640px : cards verticales */}
      <div className={cn('sm:hidden space-y-2', className)}>
        {data.map((row) => (
          <div
            key={keyExtractor(row)}
            className={cn(
              'bg-savr-white border border-savr-neutral-200 rounded-savr-md p-4 space-y-2',
              rowClassName?.(row),
            )}
          >
            {columns.map((col) => (
              <div
                key={String(col.key)}
                className="flex justify-between gap-2 text-sm"
              >
                <span className="font-medium text-savr-neutral-600 shrink-0">
                  {col.header}
                </span>
                <span className="text-savr-neutral-900 text-right">
                  {col.render
                    ? col.render(row)
                    : String(
                        (row as Record<string, unknown>)[String(col.key)] ?? '',
                      )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export { DataTable };
