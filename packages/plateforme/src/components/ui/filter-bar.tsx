'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { BarreFiltres } from '@/components/ui/filtre-en-ligne';

// FilterBar — barre de filtres standard de toute page de liste (DS Claude
// Design « FilterBar » + règle 7 « Mise en page des formulaires et filtres »).
// Un seul bloc (fond blanc, bordure neutral-200, radius xl), de haut en bas :
//  1. en-tête : `tabs` (Tabs, changer de vue) à gauche, `toggle` (ToggleGroup,
//     filtre de type) à droite, séparés de la grille par une bordure ;
//  2. ligne de filtres : les `children` (filtres en ligne « Titre  valeur ▾ »,
//     `filtre-en-ligne`, décision Val 2026-09-30) dans le bandeau gris
//     `BarreFiltres`, « Réinitialiser les filtres » calé à droite (seulement
//     si `actif`) ;
//  3. pied : compteur de résultats.
// Le consommateur fournit les options, l'état, le compteur et la
// synchronisation avec l'URL.
export interface FilterBarProps {
  tabs?: React.ReactNode;
  toggle?: React.ReactNode;
  children?: React.ReactNode;
  /** Compteur de résultats (ex. « 16 collectes correspondent… »). */
  count?: React.ReactNode;
  /** Au moins un filtre posé : affiche « Réinitialiser les filtres ». */
  actif?: boolean;
  onReset?: () => void;
  className?: string;
  'data-testid'?: string;
}

function FilterBar({
  tabs,
  toggle,
  children,
  count,
  actif,
  onReset,
  className,
  'data-testid': testId,
}: FilterBarProps) {
  const avecEntete = Boolean(tabs || toggle);
  const avecPied = count !== undefined;
  return (
    <section
      aria-label="Filtres"
      data-testid={testId}
      className={cn(
        'rounded-savr-xl border border-savr-neutral-200 bg-savr-white px-6 pb-6 pt-4',
        className,
      )}
    >
      {avecEntete && (
        <div
          className={cn(
            'flex flex-wrap items-end justify-between gap-4 border-b border-savr-neutral-200',
            // Les onglets soulignés reposent sur la bordure de l'en-tête.
            '[&_[role=tablist]]:-mb-px [&_[role=tablist]]:border-b-0',
            children ? 'mb-4' : 'mb-0',
          )}
        >
          <div className="min-w-0">{tabs}</div>
          {toggle && <div className="pb-2">{toggle}</div>}
        </div>
      )}
      {children && (
        <BarreFiltres
          onReset={actif ? onReset : undefined}
          resetLabel="Réinitialiser les filtres"
          resetTestId={testId ? `${testId}-reset` : undefined}
        >
          {children}
        </BarreFiltres>
      )}
      {avecPied && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p
            className="text-sm text-savr-neutral-500"
            data-testid={testId ? `${testId}-count` : undefined}
          >
            {count}
          </p>
        </div>
      )}
    </section>
  );
}

export { FilterBar };
