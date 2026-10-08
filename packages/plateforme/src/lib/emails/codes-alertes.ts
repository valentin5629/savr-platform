// Codes des alertes in-app (`alertes_admin`) ouvertes quand un email n'arrive
// pas. Module pur : importé par les émetteurs (serveur) et par la présentation
// de l'écran Alertes (client), qui en tire la sévérité.

/** Email définitivement perdu, tous templates (§08 §6, décision Val 2026-10-08). */
export const CODE_ALERTE_EMAIL_NON_REMIS = 'email_echec_definitif';

/** Email « infos d'accès chauffeur » non parvenu au programmateur. */
export const CODE_ALERTE_INFOS_ACCES_NON_REMISES =
  'infos_acces_email_non_remis';
