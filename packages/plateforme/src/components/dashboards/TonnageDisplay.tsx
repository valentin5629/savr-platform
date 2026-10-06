'use client';

import { SEUIL_TONNES_KG } from '@/lib/format';

interface TonnageDisplayProps {
  kg: number | null | undefined;
  className?: string;
}

/**
 * Affiche une valeur en kg ou tonnes, bascule à `SEUIL_TONNES_KG` = 10 000 kg
 * (§11, Q5 tranché 2026-10-06). 9 999 kg → "9 999 kg" ; 10 000 kg → "10 t"
 */
export function TonnageDisplay({ kg, className }: TonnageDisplayProps) {
  if (kg === null || kg === undefined) {
    return <span className={className}>—</span>;
  }

  if (kg >= SEUIL_TONNES_KG) {
    const tonnes = (kg / 1000).toLocaleString('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    return <span className={className}>{tonnes} t</span>;
  }

  return (
    <span className={className}>
      {kg.toLocaleString('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}{' '}
      kg
    </span>
  );
}
