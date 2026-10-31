import * as React from 'react';
import { cn } from '@/lib/utils';

// Croix « + » du logo Savr, dessinée en formes vectorielles pour rester nette
// à toute taille, et animée en quarts de tour (classe `savr-croix-chargement`,
// globals.css). Décorative : le libellé « Chargement… » est porté par le
// conteneur qui l'affiche.
//
// Géométrie (repère centré, unité = demi-largeur d'un bras = 47) : carré
// central de 94, bras de 99 depuis le centre terminés par un demi-cercle.
// Orange = bras haut + centre + bras droit ; bleu = bras gauche et bras bas.
const BRAS_HAUT_DROIT =
  'M-47 47V-99A47 47 0 0 1 47 -99V-47H99A47 47 0 0 1 99 47Z';
const BRAS_GAUCHE = 'M-47 -47H-99A47 47 0 0 0 -99 47H-47Z';
const BRAS_BAS = 'M-47 47V99A47 47 0 0 0 47 99V47Z';

export function SavrCroixChargement({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 320"
      aria-hidden="true"
      className={cn('h-14 w-14', className)}
      data-testid="savr-croix-chargement"
    >
      <g className="savr-croix-chargement">
        <g transform="translate(160 160)">
          <path fill="var(--color-savr-accent-500)" d={BRAS_HAUT_DROIT} />
          <path fill="var(--color-savr-primary-700)" d={BRAS_GAUCHE} />
          <path fill="var(--color-savr-primary-700)" d={BRAS_BAS} />
        </g>
      </g>
    </svg>
  );
}
