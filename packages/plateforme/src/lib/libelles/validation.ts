/**
 * Messages d'erreur de champ des formulaires (R-UI-5 F10) — gabarits uniques
 * des messages « X obligatoire », « X : n chiffres », « X : n caractères
 * minimum ». Le libellé du champ reste celui de l'écran (« Téléphone » côté
 * transporteur, « Numéro de contact » côté association) : seul le gabarit est
 * partagé.
 *
 * Hors gabarit, volontairement non migrés (les aligner changerait le texte
 * affiché — à arbitrer) : formulations « X requis(e) » et phrases impératives
 * du signup (« Saisissez une adresse email valide. »).
 *
 * Arbitrage Q8 OUVERT (zod + react-hook-form vs validateurs maison) : ces
 * gabarits ne présument pas du mécanisme de validation qui les appellera.
 */

/** « Nom obligatoire » ; `precision` est accolée après un espace. */
export function messageObligatoire(champ: string, precision?: string): string {
  return precision
    ? `${champ} obligatoire ${precision}`
    : `${champ} obligatoire`;
}

/** « SIREN : 9 chiffres ». */
export function messageNbChiffres(champ: string, nb: number): string {
  return `${champ} : ${nb} chiffres`;
}

/** « Description … : 30 caractères minimum ». */
export function messageLongueurMin(champ: string, min: number): string {
  return `${champ} : ${min} caractères minimum`;
}

/** « Au moins un type de véhicule » (sélection multiple obligatoire). */
export function messageAuMoinsUn(element: string): string {
  return `Au moins un ${element}`;
}

export const MESSAGE_FORMAT_SIREN = messageNbChiffres('SIREN', 9);
export const MESSAGE_FORMAT_SIRET = messageNbChiffres('SIRET', 14);
