/**
 * Formatteurs FR partagés des graphes « Cockpit » (R24). Format fr-FR, chiffres
 * en tabular-nums côté rendu. Source unique pour barres / donut / jauges / KPI.
 */

import { fmtDec, fmtInt } from '@/lib/format';

// Entier / décimal fr : source unique `lib/format` (R-UI-0), ré-exportés ici
// pour les graphes Cockpit.
export { fmtDec, fmtInt };

/** Euro fr : « 14 820 » (l'unité € est rendue à part par l'appelant). */
export function fmtEuro(n: number, d = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

/** Pourcentage fr : « 78,4 ». */
export function fmtPct(n: number, d = 1): string {
  return fmtDec(n, d);
}

/**
 * Masse : rend une valeur en kg → { value, unit }, bascule kg→t au-delà de
 * 10 000 kg (règle §11). Ex. 48 600 → { '48,6', 't' } ; 840 → { '840', 'kg' }.
 */
export function fmtMasse(kg: number): { value: string; unit: 't' | 'kg' } {
  if (kg >= 10_000) return { value: fmtDec(kg / 1000, 1), unit: 't' };
  return { value: fmtInt(kg), unit: 'kg' };
}

/** Initiales d'un nom : « Pavillon Gabriel » → « PG » (2 lettres max). */
export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('');
}
