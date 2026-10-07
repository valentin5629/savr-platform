'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Pagination } from '@/components/ui/pagination';
import { Combobox } from '@/components/ui/combobox';
import { DEFAULT_PAGE_SIZE, nombreDePages } from '@/lib/pagination';

// ListFooter — pied d'une liste paginée (R-UI-4a, E2) : pagination à droite,
// taille de page facultative (registre). Avant : 3 habillages et 3 seuils
// d'affichage recopiés sous 8 tableaux + une pagination maison.
// Le COMPTEUR de résultats n'est pas ici : il vit dans `FilterBar.count`
// (un seul emplacement, D5). Rien n'est rendu quand il n'y a qu'une page et
// pas de choix de taille.
export interface ListFooterProps {
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  /** Taille de page (défaut `DEFAULT_PAGE_SIZE`). */
  taillePage?: number;
  /** Choix de taille de page (registre) : options et rappel. */
  taillesPage?: readonly number[];
  onTaillePageChange?: (taille: number) => void;
  className?: string;
  'data-testid'?: string;
}

function ListFooter({
  total,
  page,
  onPageChange,
  taillePage = DEFAULT_PAGE_SIZE,
  taillesPage,
  onTaillePageChange,
  className,
  'data-testid': testId,
}: ListFooterProps) {
  const pageCount = nombreDePages(total, taillePage);
  const avecTaille = Boolean(taillesPage && onTaillePageChange);
  if (pageCount <= 1 && !avecTaille) return null;
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 pt-3 text-sm',
        className,
      )}
    >
      {avecTaille && (
        <Combobox
          titre="Par page"
          aria-label="Lignes par page"
          icon={null}
          searchable={false}
          options={taillesPage!.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          value={String(taillePage)}
          onChange={(v) => {
            if (v) onTaillePageChange!(Number(v));
          }}
        />
      )}
      {pageCount > 1 && (
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

export { ListFooter };
