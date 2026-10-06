import * as React from 'react';
import { cn } from '@/lib/utils';

// FormGrid — grille de champs d'un formulaire de saisie (R-UI-5, F3 ; DS §5.5
// règle 4 « grille 3 colonnes max, gap 16px » + §8 « Formulaires : champs
// pleine largeur » sous 640 px). UNE seule recette responsive : 1 colonne en
// mobile, `cols` colonnes dès `sm` (640 px, frontière mobile/tablette §8).
// Remplace les 9 recettes `grid grid-cols-2 gap-4` / `md:grid-cols-2` /
// `sm:grid-cols-2 gap-3`… recopiées. Un enfant qui doit couvrir la ligne
// entière prend `sm:col-span-2` (ou `sm:col-span-3`), jamais `col-span-2` nu
// (qui créerait une colonne implicite en mobile).
const COLONNES = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
} as const;

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nombre de colonnes à partir de 640 px (2 par défaut, 3 max — §5.5). */
  cols?: keyof typeof COLONNES;
}

const FormGrid = React.forwardRef<HTMLDivElement, FormGridProps>(
  ({ cols = 2, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('grid grid-cols-1 gap-4', COLONNES[cols], className)}
      {...props}
    />
  ),
);
FormGrid.displayName = 'FormGrid';

export { FormGrid };
