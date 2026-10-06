/**
 * Formatteurs FR des nombres affichés à l'écran — source unique (R-UI-0, B6/B7).
 *
 * Règle : aucun `toFixed()` ni concaténation « ${n} € » dans du JSX. Un nombre
 * affiché passe par ici (locale fr-FR : virgule décimale, espace fin insécable
 * comme séparateur de milliers, unité séparée par une espace insécable).
 *
 * Périmètre : entiers, décimales, €, montants en devise, %, kg, pax (R-UI-6b,
 * J2 : plus aucun `Intl.NumberFormat` local ni concaténation « ${n} € / % / kg »
 * dans l'app). Seuil kg→t : `SEUIL_TONNES_KG` (Q5 tranché 2026-10-06 : 10 000 kg,
 * CDC §11) ; graphie CO₂ : « kg CO₂e » / « t CO₂e » (Q6 tranché 2026-10-06).
 */

/** Seuil de bascule kg → t des masses affichées (CDC §11 : à partir de 10 000 kg). */
export const SEUIL_TONNES_KG = 10_000;

const NBSP = '\u00a0';

/** Unité CO₂ (Q6 : « kg CO₂e » / « t CO₂e », espace insécable : ne se coupe jamais). */
export function uniteCo2(unite: 'kg' | 't'): string {
  return `${unite}${NBSP}CO₂e`;
}
export const UNITE_KG_CO2E = uniteCo2('kg');

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

/** Masse en kilogrammes, sans bascule en tonnes (voir `fmtMasse` pour la bascule) : « 840 kg ». */
export function fmtKg(n: number, d = 0): string {
  return `${nombre(n, d)}${NBSP}kg`;
}

/** Masse saisie (pesée) : décimale affichée seulement si elle existe : « 12 kg », « 12,5 kg ». */
export function fmtKgAuto(n: number): string {
  const v = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n);
  return `${v}${NBSP}kg`;
}

/** Montant dans la devise de la facture : « 1 234,50 € » (EUR = fmtEuro ; autre devise = Intl). */
export function fmtMontant(n: number, devise: string): string {
  if (!devise || devise === 'EUR') return fmtEuro(n);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: devise,
  }).format(n);
}

/** Convives : « 4 300 pax ». */
export function fmtPax(n: number): string {
  return `${fmtInt(n)}${NBSP}pax`;
}

/**
 * Masse avec bascule kg → t à `SEUIL_TONNES_KG` (CDC §11) : { value, unit }.
 * Tonnes à 0-1 décimale (scénario 11-12 : 10 000 kg → « 10 t ») ;
 * ex. 48 600 → { '48,6', 't' } ; 840 → { '840', 'kg' }.
 */
export function fmtMasse(kg: number): { value: string; unit: 't' | 'kg' } {
  if (kg >= SEUIL_TONNES_KG) {
    const t = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(kg / 1000);
    return { value: t, unit: 't' };
  }
  return { value: fmtInt(kg), unit: 'kg' };
}
