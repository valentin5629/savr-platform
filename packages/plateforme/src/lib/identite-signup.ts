// Contraintes de format des champs d'identité collectés à l'inscription
// (CDC §05 §8 « Étape 1 — Inscription », tableau des champs obligatoires) :
//   email      → format email valide (l'unicité, elle, est garantie par GoTrue) ;
//   prenom/nom → 2 caractères minimum ;
//   telephone  → format FR ;
//   poste      → obligatoire, 100 caractères maximum (Val 2026-11-01 ; borne
//                aussi tenue par la table, chk_users_poste_borne).
//
// Un seul jeu de règles, partagé par l'écran /signup et par la route
// `POST /api/auth/signup`. L'écran s'en sert pour refuser AVANT le réseau ; la
// route s'en sert parce qu'elle est publique et qu'une validation seulement
// côté navigateur se contourne avec un `curl`.
//
// Les regex vivent dans `@savr/shared/src/validation` (R-UI-5 F9) ; le trim des
// bords reste propre à ce module.

import { estEmail, estTelephoneFr } from '@savr/shared/src/validation/index.js';

/** Longueur minimale de `prenom` et `nom` (CDC §05 §8 : « 2 caractères min »). */
export const NOM_MIN_LENGTH = 2;

/** Longueur maximale de `poste` (champ libre, sans effet sur les droits). */
export const POSTE_MAX_LENGTH = 100;

/** Poste : non vide une fois trimé, 100 caractères maximum (en points de code,
 * comme le `char_length` de la contrainte de table). */
export function isValidPoste(poste: string): boolean {
  const longueur = Array.from(poste.trim()).length;
  return longueur > 0 && longueur <= POSTE_MAX_LENGTH;
}

export function isValidEmailFormat(email: string): boolean {
  // Volontairement permissif (une adresse valide ne doit jamais être refusée) :
  // on exige une partie locale, un « @ », un domaine et un TLD, sans espace.
  return estEmail(email.trim());
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
  return estTelephoneFr(telephone.trim());
}
