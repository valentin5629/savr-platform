'use client';

interface TonnageDisplayProps {
  kg: number | null | undefined;
  className?: string;
}

/**
 * Affiche une valeur en kg ou tonnes selon seuil automatique 1 000 kg (§11 §8).
 * 999 kg → "999 kg" ; 1 000 kg → "1 t"
 */
export function TonnageDisplay({ kg, className }: TonnageDisplayProps) {
  if (kg === null || kg === undefined) {
    return <span className={className}>—</span>;
  }

  if (kg >= 1000) {
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
