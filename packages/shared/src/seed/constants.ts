// Constantes partagées entre les scripts de seed.
// Réferentiel (types_evenements, flux_dechets, parametres_*, grilles, packs,
// email_templates, domaines_email_publics) = déjà seedé par les migrations
// (bloc8 + ajouts par lot) + auth ; les scripts de seed le RELISENT par clé
// naturelle, jamais ils ne le réinsèrent.

export const SEED_REF_DATE = '2026-06-01';
export const SEED_PASSWORD = 'SavrTest2026!';
export const SEED_EMAIL_DOMAIN = 'savr-test.local';
// Ref dev hard-codée — garde-fou prod
export const DEV_PROJECT_REF = 'nvbyuajdvtuezcvyxtkd';

// Codes des templates email actifs seedés en migrations (bloc8 + ajouts par lot).
// Documentaire — référence emails_envoyes.template_code (pas de FK) ; la DB fait
// foi. Maintenu additivement par lot (dé-stalé R22f : bloc8 ne couvrait que les 19
// premiers ; les ajouts M1.2/M2.3/M3.1/R16a/R17/R19 + les 4 R22f manquaient).
export const EMAIL_TEMPLATE_CODES = [
  // ── bloc8 (20260611171642) ──
  'bienvenue_organisation',
  'verification_email',
  'reset_password', // R23c BL-P3-11 : aligné slug CDC §06.02 (ex reinitialisation_mot_de_passe)
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
  // ── ajouts par lot ──
  'collecte_programmee', // M1.2 (récap programmeur)
  'ag_attribution_association', // M2.3
  'ag_attribution_transporteur', // M2.3
  'ag_a_toutes_indispo', // M2.3
  'admin_demande_renouvellement_pack', // M3.1
  'admin_demande_annulation', // M3.1
  'admin_incident_collecte', // R16a
  'admin_demande_ajout_lieu', // R17
  'admin_modification_collecte_traiteur', // R19
  // ── R22f (BL-P2-22) — tiers / conditionnels ──
  'collecte_programmee_tiers',
  'collecte_modifiee_tiers',
  'admin_collecte_annulee',
  'admin_pack_ag_etat',
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
