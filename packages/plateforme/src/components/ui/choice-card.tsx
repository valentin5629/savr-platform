'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Carte sélectionnable (R-UI-7) : remplace les <button> « carte » recodés —
// tuiles KPI filtrantes (Admin collectes), recommandations d'attribution AG,
// options radio de la fiche collecte Admin, liste des templates d'e-mail.
// Sélection = bordure primary-700 + fond primary-50 ; le contenu et la mise en
// page restent au consommateur (`className`, enfants).
export interface ChoiceCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
  /**
   * `pressed` (défaut) : bascule autonome, `aria-pressed`.
   * `radio` : option d'un parent `role="radiogroup"`, `role="radio"` + `aria-checked`
   * (le parent gère le focus itinérant via `tabIndex`).
   */
  mode?: 'pressed' | 'radio';
}

const ChoiceCard = React.forwardRef<HTMLButtonElement, ChoiceCardProps>(
  (
    { selected, mode = 'pressed', className, type = 'button', ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      {...(mode === 'radio'
        ? { role: 'radio', 'aria-checked': selected }
        : { 'aria-pressed': selected })}
      className={cn(
        'rounded-savr-md border text-left transition-colors duration-savr-fast ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-savr-primary-700 bg-savr-primary-50'
          : 'border-savr-neutral-200 bg-savr-white hover:border-savr-neutral-300',
        className,
      )}
      {...props}
    />
  ),
);
ChoiceCard.displayName = 'ChoiceCard';

export { ChoiceCard };
