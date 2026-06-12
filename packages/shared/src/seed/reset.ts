/**
 * Reset des données de seed (dev only).
 *
 * On TRUNCATE uniquement les tables « métier » seedées par les scripts.
 * Le référentiel posé par les migrations (types_evenements, flux_dechets,
 * parametres_*, grilles_tarifaires_zd, tarifs_zero_dechet, tarifs_packs_ag,
 * email_templates, domaines_email_publics) est PRÉSERVÉ.
 *
 * CASCADE couvre les tables enfants éventuellement omises.
 */

import type pg from 'pg';

const BUSINESS_TABLES = [
  // ordre indifférent grâce à CASCADE ; on liste les parents métier.
  'plateforme.organisations',
  'plateforme.users',
  'plateforme.entites_facturation',
  'plateforme.lieux',
  'plateforme.organisations_lieux',
  'plateforme.organisations_domaines_email',
  'plateforme.contacts_traiteurs',
  'plateforme.associations',
  'plateforme.transporteurs',
  'plateforme.tarifs_negocie',
  'plateforme.packs_antgaspi',
  'plateforme.evenements',
  'plateforme.collectes',
  'plateforme.collecte_flux',
  'plateforme.attributions_antgaspi',
  'plateforme.config_auto_accept_ag',
  'plateforme.tournees',
  'plateforme.collecte_tournees',
  'plateforme.pesees_tournees',
  'plateforme.factures',
  'plateforme.factures_collectes',
  'plateforme.sequences_facturation',
  'plateforme.bordereaux_savr',
  'plateforme.attestations_don',
  'plateforme.rapports_rse',
  'plateforme.exports_registre',
  'plateforme.documents_generaux_savr',
  'plateforme.outbox_events',
  'plateforme.emails_envoyes',
  'plateforme.audit_log',
  'plateforme.integrations_logs',
  'plateforme.integrations_inbox',
  'plateforme.jobs_pdf',
  'plateforme.coefficients_perte_labo',
  'shared.fichiers',
  'shared.prestataires',
];

export async function resetBusinessData(client: pg.Client): Promise<void> {
  await client.query(
    `TRUNCATE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
