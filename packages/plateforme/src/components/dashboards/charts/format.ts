import type { Granularite } from './types.js';

/** Étiquette d'axe X selon la granularité (§06.04 Bloc 2). */
export function formatPeriode(periode: string, g: Granularite): string {
  const d = new Date(`${periode.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periode;
  if (g === 'mois') {
    return d.toLocaleDateString('fr-FR', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  }
  // jour / semaine → jj/mm (la semaine = lundi de la semaine)
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

/** Formatage kg / t avec bascule automatique au-delà de 10 000 kg (§06.04 Bloc 2). */
export function formatMasse(kg: number, useTonnes: boolean): string {
  if (useTonnes) {
    return `${(kg / 1000).toLocaleString('fr-FR', {
      maximumFractionDigits: 1,
    })} t`;
  }
  return `${Math.round(kg).toLocaleString('fr-FR')} kg`;
}

export function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString('fr-FR')} kg`;
}
