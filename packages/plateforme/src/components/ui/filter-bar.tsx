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
// synchronisation avec l'URL (`useFiltresUrl`). Règle R-UI-4b (D5) : toute
// liste = FilterBar complet (count + actif + onReset obligatoires) ; les
// barres de dashboard (`DashboardFilterBar`, `BenchmarkFilterBar`, Revenus
// admin) sont bâties dessus avec `surface` (page / encart) et `count={null}`.
export interface FilterBarProps {
  tabs?: React.ReactNode;
  toggle?: React.ReactNode;
  /** Amorce en tête de la ligne de filtres (ex. « Comparer avec »). */
  intro?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Compteur de résultats (ex. « 16 collectes correspondent… »), SEUL
   * emplacement du compteur d'une liste (R-UI-4b, D5 : ni en-tête de page, ni
   * barre d'outils de grille, ni pied). `null` = pas de pied, réservé aux
   * barres de dashboard (pas de liste à compter).
   */
  count: Exclude<React.ReactNode, undefined>;
  /** Au moins un filtre posé : affiche « Réinitialiser les filtres ». */
  actif: boolean;
  /** Remise au défaut de tous les filtres (obligatoire : toute liste se réinitialise). */
  onReset: () => void;
  /**
   * Support de la barre (R-UI-4b, D5 façon C) :
   *  - 'carte' (défaut) : la barre EST une carte blanche bordée, bandeau gris
   *    dedans — toute page de liste ;
   *  - 'page' : posée sur le fond de page, sans carte ni padding, le bandeau
   *    passe en blanc bordé (`BarreFiltres surface="page"`) — bandeau des
   *    dashboards ;
   *  - 'encart' : bandeau gris seul, posé dans une carte existante (filtres
   *    benchmark dans la carte des jauges).
   */
  surface?: 'carte' | 'page' | 'encart';
  /** `data-testid` du bouton de reset ; défaut `${data-testid}-reset`. */
  resetTestId?: string;
  className?: string;
  'data-testid'?: string;
}

function FilterBar({
  tabs,
  toggle,
  intro,
  children,
  count,
  actif,
  onReset,
  surface = 'carte',
  resetTestId,
  className,
  'data-testid': testId,
}: FilterBarProps) {
  const avecEntete = Boolean(tabs || toggle);
  const avecPied = count !== null && count !== undefined;
  return (
    <section
      aria-label="Filtres"
      data-testid={testId}
      className={cn(
        surface === 'carte' &&
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
          intro={intro}
          surface={surface === 'page' ? 'page' : 'carte'}
          onReset={actif ? onReset : undefined}
          resetLabel="Réinitialiser les filtres"
          resetTestId={resetTestId ?? (testId ? `${testId}-reset` : undefined)}
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
