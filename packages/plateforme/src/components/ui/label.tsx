'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Label — deux recettes (R-UI-5, F1) :
//  · `field` (défaut, §5.5) : libellé AU-DESSUS d'un champ, text-sm poids 600
//    neutral-700. Recette de `FormField`.
//  · `choice` : libellé d'une case à cocher, d'un bouton radio ou d'un Switch,
//    À CÔTÉ du contrôle (poids normal, curseur main). La mise en page (flex,
//    gap, hauteur 44 px…) reste à l'appelant via `className`.
// `required` (F7) : marqueur obligatoire unique de l'app = astérisque seul,
// jamais « (obligatoire) » dans le libellé.
const RECETTE = {
  field: 'block text-sm font-semibold text-savr-neutral-700 mb-1.5',
  choice: 'cursor-pointer text-sm text-savr-neutral-700',
} as const;

export type LabelVariant = keyof typeof RECETTE;

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  variant?: LabelVariant;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, variant = 'field', children, ...props }, ref) => (
    <label ref={ref} className={cn(RECETTE[variant], className)} {...props}>
      {children}
      {required && <span className="text-savr-error ml-0.5">*</span>}
    </label>
  ),
);
Label.displayName = 'Label';

export { Label };
