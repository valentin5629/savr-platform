'use client';

import { Button } from '@/components/ui/button';
import { DownloadSimpleIcon } from '@/components/ui/icones';

/**
 * Taille commune de « Exporter CSV » et « Colonnes » (barre des tableaux) :
 * 25 % plus petits que le bouton standard sur ordinateur (hauteur 30 px au
 * lieu de 40, texte 11 px, icône 12 px), décision Val 2026-10-31. Sur mobile,
 * la cible tactile de 44 px est gardée (DS §8).
 */
export const TAILLE_BOUTON_BARRE_TABLEAU =
  'h-11 sm:h-[30px] sm:px-3 sm:text-[11px] sm:gap-1.5 sm:[&>svg]:h-3 sm:[&>svg]:w-3';

/**
 * Bouton « Exporter CSV » des listes : posé dans la barre du tableau, à gauche
 * de « Colonnes », avec la même taille que lui (décision Val 2026-10-30).
 */
export function BoutonExportCsv({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="secondary"
      className={TAILLE_BOUTON_BARRE_TABLEAU}
      onClick={onClick}
      disabled={disabled}
    >
      <DownloadSimpleIcon />
      Exporter CSV
    </Button>
  );
}
