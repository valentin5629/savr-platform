// Contraintes de format des champs d'identité collectés à l'inscription
// (CDC §05 §8 « Étape 1 — Inscription », tableau des champs obligatoires) :
//   email      → format email valide (l'unicité, elle, est garantie par GoTrue) ;
//   prenom/nom → 2 caractères minimum ;
//   telephone  → format FR.
//
// Un seul jeu de règles, partagé par l'écran /signup et par la route
// `POST /api/auth/signup`. L'écran s'en sert pour refuser AVANT le réseau ; la
// route s'en sert parce qu'elle est publique et qu'une validation seulement
// côté navigateur se contourne avec un `curl`.

/** Longueur minimale de `prenom` et `nom` (CDC §05 §8 : « 2 caractères min »). */
export const NOM_MIN_LENGTH = 2;

export function isValidEmailFormat(email: string): boolean {
  const v = email.trim();
  // Volontairement permissif (une adresse valide ne doit jamais être refusée) :
  // on exige une partie locale, un « @ », un domaine et un TLD, sans espace.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v);
}

export function isValidNomOuPrenom(valeur: string): boolean {
  return valeur.trim().length >= NOM_MIN_LENGTH;
}

/**
 * Téléphone FR : numéro national à 10 chiffres commençant par 0 suivi de 1-9,
 * ou forme internationale +33 / 0033 (avec ou sans « (0) »). Les séparateurs
 * usuels (espace, point, tiret) sont tolérés — les gens les écrivent.
 */
export function isValidTelephoneFr(telephone: string): boolean {
  const v = telephone.trim();
  return /^(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:[\s.-]?\d{2}){4}$/.test(
    v,
  );
}
