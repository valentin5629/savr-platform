/**
 * Reset des données de seed (dev only).
 *
 * On TRUNCATE uniquement les tables « métier » seedées par les scripts.
 * Le référentiel posé par les migrations (types_evenements, flux_dechets,
 * parametres_*, grilles_tarifaires_zd, tarifs_zero_dechet, tarifs_packs_ag,
 * email_templates, domaines_email_publics) est PRÉSERVÉ.
 *
 * CASCADE couvre les tables enfants éventuellement omises.
 *
 * POURQUOI LA GARDE D'IMMUABILITÉ EST NEUTRALISÉE LE TEMPS DU RESET
 * ------------------------------------------------------------------
 * `plateforme.audit_log` est append-only (§07/06 Audit trail) : depuis les
 * migrations 20260921200000 et 20260921210000, un trigger refuse UPDATE,
 * DELETE et vidage de table. Le reset ci-dessous s'y heurtait donc —
 * `42501 plateforme.audit_log est append-only` — et `pnpm seed:minimal` /
 * `seed:demo` échouait à sa toute première instruction.
 *
 * Retirer `audit_log` de la liste ne suffit PAS : elle porte deux FK vers
 * `plateforme.users` (`audit_log_user_id_fkey`, `audit_log_impersonator_id_fkey`),
 * donc le CASCADE sur `users` la ramène de toute façon — mesuré, même 42501.
 *
 * La garde est donc désactivée explicitement, puis RÉACTIVÉE, autour du seul
 * vidage. Trois raisons pour que ce soit sûr :
 *   • `assertDev()` (voir `index.ts`) bloque déjà tout seed hors du projet dev :
 *     ce chemin est inatteignable en production ;
 *   • le tout est dans UNE transaction — si le vidage échoue, le ROLLBACK
 *     annule aussi la désactivation, la garde ne reste jamais ouverte ;
 *   • c'est un geste explicite, visible en revue, là où une exemption de rôle
 *     posée dans le trigger lui-même aurait rouvert le chemin à toute
 *     l'application (`current_user` vaut `postgres` dans n'importe quelle
 *     fonction `SECURITY DEFINER`).
 *
 * Le trigger est un trigger d'INSTRUCTION : PostgreSQL ne le clone pas sur les
 * partitions, chacune porte le sien. D'où la boucle sur `pg_trigger` plutôt
 * qu'un `ALTER TABLE` sur le seul parent. La boucle est aussi ce qui rend ce
 * code insensible à l'ajout d'une partition annuelle, et no-op tant que la
 * migration n'est pas appliquée.
 *
 * Couverture, en deux morceaux dont aucun ne suffit seul :
 *   • `seed-reset-audit-log.test.ts` — prouve que c'est bien cette séquence qui
 *     est émise, et que la réactivation n'est pas sautée quand le vidage échoue ;
 *   • `supabase/tests/SECU__audit_log_immuable.test.sql` T14 — prouve en base
 *     que la séquence vide réellement la table ET que la garde mord de nouveau
 *     après. Le test unitaire ne touche pas la base ; le pgTAP ne verrait pas
 *     une réécriture de ce fichier.
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

/** Nom du trigger posé par la migration 20260921210000. */
export const GARDE_AUDIT_LOG = 'trg_audit_log_vidage_interdit';

/**
 * `ENABLE` / `DISABLE` de la garde sur le parent et sur chaque partition.
 * Exporté pour que le test puisse asserter sur le SQL réellement émis plutôt
 * que sur une copie.
 */
export function sqlGardeAuditLog(action: 'ENABLE' | 'DISABLE'): string {
  return `
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tg.tgrelid::regclass AS tbl
          FROM pg_trigger tg
         WHERE tg.tgname = '${GARDE_AUDIT_LOG}' AND NOT tg.tgisinternal
      LOOP
        EXECUTE format('ALTER TABLE %s ${action} TRIGGER ${GARDE_AUDIT_LOG}', r.tbl);
      END LOOP;
    END $$;
  `;
}

/** Le vidage lui-même. Exporté pour la même raison. */
export function sqlVidageTablesMetier(): string {
  return `TRUNCATE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`;
}

export async function resetBusinessData(client: pg.Client): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sqlGardeAuditLog('DISABLE'));
    await client.query(sqlVidageTablesMetier());
    await client.query(sqlGardeAuditLog('ENABLE'));
    await client.query('COMMIT');
  } catch (err) {
    // Annule aussi la désactivation : la garde ne peut pas rester ouverte.
    await client.query('ROLLBACK');
    throw err;
  }
}
