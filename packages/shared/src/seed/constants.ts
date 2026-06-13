// Constantes partagées entre les scripts de seed.
// Réferentiel (types_evenements, flux_dechets, parametres_*, grilles, packs,
// 19 email_templates, domaines_email_publics) = déjà seedé par la migration
// bloc8 + auth ; les scripts de seed le RELISENT par clé naturelle, jamais
// ils ne le réinsèrent.

export const SEED_REF_DATE = '2026-06-01';
export const SEED_PASSWORD = 'SavrTest2026!';
export const SEED_EMAIL_DOMAIN = 'savr-test.local';
// Ref dev hard-codée — garde-fou prod
export const DEV_PROJECT_REF = 'nvbyuajdvtuezcvyxtkd';

// Codes des 19 templates email actifs seedés par la migration (bloc8).
// Référencés par emails_envoyes.template_code (pas de FK, cohérence seed).
export const EMAIL_TEMPLATE_CODES = [
  'bienvenue_organisation',
  'verification_email',
  'reinitialisation_mot_de_passe',
  'invitation_utilisateur',
  'confirmation_collecte',
  'rappel_collecte_j3',
  'annulation_collecte',
  'collecte_realisee',
  'bordereau_disponible',
  'attestation_don_disponible',
  'facture_emise',
  'avoir_emis',
  'facture_relance_j15',
  'pack_ag_active',
  'alerte_ops_collecte_non_transmise',
  'alerte_ops_pesee_anormale',
  'attribution_association',
  'attribution_transporteur',
  'siret_verification_echec',
] as const;

// Téléphones fictifs : +33 6 99 99 XX XX (range de test, jamais réel).
export function fakePhone(n: number): string {
  const x = String(n % 100).padStart(2, '0');
  const y = String(Math.floor(n / 100) % 100).padStart(2, '0');
  return `+33 6 99 99 ${y} ${x}`;
}

// Email de test déterministe par slug — toujours @savr-test.local.
export function seedEmail(slug: string): string {
  return `${slug.replace(/_/g, '.')}@${SEED_EMAIL_DOMAIN}`;
}
