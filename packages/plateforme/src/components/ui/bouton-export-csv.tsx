'use client';

import { Button } from '@/components/ui/button';
import { DownloadSimpleIcon } from '@/components/ui/icones';

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
      className="h-11 sm:h-10"
      onClick={onClick}
      disabled={disabled}
    >
      <DownloadSimpleIcon className="h-4 w-4" />
      Exporter CSV
    </Button>
  );
}
