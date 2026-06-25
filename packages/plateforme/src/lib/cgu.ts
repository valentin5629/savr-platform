/**
 * Version courante du texte des CGU acceptée à la création du compte.
 *
 * Écrite dans `plateforme.users.cgu_version` au signup (preuve opposable :
 * CGU Savr V1 — Art. 11 « le Contrat prend effet à la création du Compte, qui
 * vaut acceptation » + Art. 22 « convention sur la preuve »). Source du texte :
 * `specs/cdc/01 - Cahier des charges App/CGU Savr V1 - Draft.md` (V1, 2026-04-28).
 *
 * À incrémenter UNIQUEMENT si le texte des CGU change : les comptes créés après
 * la bascule porteront la nouvelle valeur ; les comptes existants ne sont PAS
 * re-consentis rétroactivement (le CDC ne prévoit pas de ré-acceptation par
 * version en V1 — cf. R6/BL-P0-04).
 */
export const CGU_VERSION_COURANTE = 'v1';
