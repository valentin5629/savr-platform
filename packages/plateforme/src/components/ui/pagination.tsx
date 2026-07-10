'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Pagination — navigation entre pages d'un tableau (§10 §6 « Pagination »).
// COMPOSANT présentationnel réutilisable : il émet `onPageChange`, il ne câble
// AUCUN tri/pagination serveur (ça reste au ressort de l'appelant, cf. BL-P3-07).
// Cibles tactiles 44px sur mobile (§8/§10), focus ring hérité (levier #4).
interface PaginationProps {
  /** Page courante (1-indexée). */
  page: number;
  /** Nombre total de pages (≥ 1). */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Nombre de pages numérotées autour de la courante. Défaut 1. */
  siblingCount?: number;
  className?: string;
}

/** Construit la liste de pages à afficher, avec ellipses ('…'). */
function buildRange(
  page: number,
  pageCount: number,
  siblingCount: number,
): (number | 'ellipsis')[] {
  const total = Math.max(1, pageCount);
  const first = 1;
  const last = total;
  const start = Math.max(first, page - siblingCount);
  const end = Math.min(last, page + siblingCount);
  const range: (number | 'ellipsis')[] = [];
  if (start > first) {
    range.push(first);
    if (start > first + 1) range.push('ellipsis');
  }
  for (let p = start; p <= end; p++) range.push(p);
  if (end < last) {
    if (end < last - 1) range.push('ellipsis');
    range.push(last);
  }
  return range;
}

const cellBase =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-savr-md px-3 text-sm font-semibold transition-colors sm:h-9 sm:min-w-9';

const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  ({ page, pageCount, onPageChange, siblingCount = 1, className }, ref) => {
    const total = Math.max(1, pageCount);
    const current = Math.min(Math.max(1, page), total);
    const range = buildRange(current, total, siblingCount);
    return (
      <nav
        ref={ref}
        aria-label="Pagination"
        className={cn('flex items-center gap-1', className)}
      >
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Page précédente"
          className={cn(
            cellBase,
            'text-savr-neutral-600 hover:bg-savr-neutral-100 disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        {range.map((item, i) =>
          item === 'ellipsis' ? (
            <span
              key={`e-${i}`}
              aria-hidden="true"
              className="inline-flex h-11 min-w-11 items-center justify-center text-sm text-savr-neutral-400 sm:h-9 sm:min-w-9"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === current ? 'page' : undefined}
              aria-label={`Page ${item}`}
              className={cn(
                cellBase,
                item === current
                  ? 'bg-savr-primary-700 text-savr-white'
                  : 'text-savr-neutral-600 hover:bg-savr-neutral-100',
              )}
            >
              {item}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= total}
          aria-label="Page suivante"
          className={cn(
            cellBase,
            'text-savr-neutral-600 hover:bg-savr-neutral-100 disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </nav>
    );
  },
);
Pagination.displayName = 'Pagination';

export { Pagination };
