/**
 * Formatteurs FR des nombres affichés à l'écran — source unique (R-UI-0, B6/B7).
 *
 * Règle : aucun `toFixed()` ni concaténation « ${n} € » dans du JSX. Un nombre
 * affiché passe par ici (locale fr-FR : virgule décimale, espace fin insécable
 * comme séparateur de milliers, unité séparée par une espace insécable).
 *
 * Périmètre volontairement réduit (entiers, décimales, €, %, kg). Les règles
 * encore à arbitrer (seuil kg→t, graphie CO₂, pax) arrivent avec R-UI-6 ; les
 * graphes Cockpit gardent leurs variantes sans unité dans
 * `components/dashboards/charts/cockpit/fmt.ts` jusque-là.
 */

const NBSP = '\u00a0';

function nombre(n: number, d: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

/** Entier fr : « 18 700 ». */
export function fmtInt(n: number): string {
  return nombre(Math.round(n), 0);
}

/** Décimal fr à `d` décimales (défaut 1) : « 48,6 ». */
export function fmtDec(n: number, d = 1): string {
  return nombre(n, d);
}

/** Montant en euros, 2 décimales : « 1 234,50 € ». */
export function fmtEuro(n: number, d = 2): string {
  return `${nombre(n, d)}${NBSP}€`;
}

/** Pourcentage déjà exprimé sur 100 : « 48,6 % ». */
export function fmtPct(n: number, d = 1): string {
  return `${nombre(n, d)}${NBSP}%`;
}

/** Masse en kilogrammes, sans bascule en tonnes (arbitrage Q5 à venir) : « 840 kg ». */
export function fmtKg(n: number, d = 0): string {
  return `${nombre(n, d)}${NBSP}kg`;
}
