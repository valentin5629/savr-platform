/**
 * Formatteurs FR partagés des graphes « Cockpit » (R24). Format fr-FR, chiffres
 * en tabular-nums côté rendu. Source unique pour barres / donut / jauges / KPI.
 */

import { fmtDec, fmtInt, SEUIL_TONNES_KG } from '@/lib/format';

// Entier / décimal fr : source unique `lib/format` (R-UI-0), ré-exportés ici
// pour les graphes Cockpit.
export { fmtDec, fmtInt };

// Les ex-homonymes sans unité `fmtEuro` / `fmtPct` (0 usage) ont été retirés en
// R-UI-6b : la source unique est `lib/format` (`fmtEuro` avec €, `fmtPct` avec %).

/**
 * Masse : rend une valeur en kg → { value, unit }, bascule kg→t au-delà de
 * `SEUIL_TONNES_KG` = 10 000 kg (règle §11). Ex. 48 600 → { '48,6', 't' } ; 840 → { '840', 'kg' }.
 */
export function fmtMasse(kg: number): { value: string; unit: 't' | 'kg' } {
  if (kg >= SEUIL_TONNES_KG) return { value: fmtDec(kg / 1000, 1), unit: 't' };
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
