// ─── Formats de saisie partagés (R-UI-5 F9) ─────────────────────────────────
//
// Source unique des expressions de FORMAT utilisées à la fois par les écrans de
// la Plateforme et par les routes API. Module pur, sans dépendance : importable
// côté navigateur comme côté serveur.
//
// Contrat : chaque prédicat teste la valeur TELLE QUELLE. La normalisation reste
// à l'appelant, parce qu'elle diffère d'un site à l'autre et que la fusionner
// changerait ce qui est accepté :
//   - SIREN : les modales admin testent la saisie trimée ; les routes
//     `/admin/associations` testent le body brut ;
//   - SIRET : `isValidSiretFormat` (shared/api/siret) et la route agence
//     `shadow/[id]/siret` trimment les bords ; `normaliserSiretOrganisation`
//     (plateforme/lib/siret-organisation) retire TOUS les blancs ;
//   - email / téléphone : `lib/identite-signup` trimme les bords.
// Champ vide = facultatif ou obligatoire : décidé par l'appelant aussi.
//
// Arbitrage Q8 OUVERT (zod + react-hook-form vs validateurs maison) : ce module
// ne fournit que des formats — ni schéma, ni hook de formulaire.
//
// Pas de drapeau `g`/`y` : `.test()` reste sans état (`lastIndex` jamais lu).

/** SIREN : exactement 9 chiffres ASCII (`\d` = [0-9] en ECMAScript). */
export const REGEX_SIREN = /^\d{9}$/;

/** SIRET : exactement 14 chiffres ASCII (9 SIREN + 5 NIC). */
export const REGEX_SIRET = /^\d{14}$/;

/**
 * Email : volontairement permissif (une adresse valide ne doit jamais être
 * refusée) — une partie locale, un « @ », un domaine et un TLD, sans espace.
 * Format seul : l'unicité est garantie par GoTrue.
 */
export const REGEX_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Téléphone FR : numéro national à 10 chiffres commençant par 0 suivi de 1-9,
 * ou forme internationale +33 / 0033 (avec ou sans « (0) »). Séparateurs usuels
 * (espace, point, tiret) tolérés.
 */
export const REGEX_TELEPHONE_FR =
  /^(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}$/;

export function estSiren(valeur: string): boolean {
  return REGEX_SIREN.test(valeur);
}

export function estSiret(valeur: string): boolean {
  return REGEX_SIRET.test(valeur);
}

export function estEmail(valeur: string): boolean {
  return REGEX_EMAIL.test(valeur);
}

export function estTelephoneFr(valeur: string): boolean {
  return REGEX_TELEPHONE_FR.test(valeur);
}
