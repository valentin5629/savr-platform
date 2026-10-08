import type { EmailTranche } from '@savr/shared/src/email/index.js';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { CODE_ALERTE_EMAIL_NON_REMIS } from '@/lib/emails/codes-alertes.js';
import {
  TEMPLATE_INFOS_ACCES,
  signalerInfosAccesNonRemises,
} from '@/lib/infos-acces/suivi-email.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;
type ErreurDb = { code?: string; message: string };

/**
 * Suites d'un email définitivement perdu (§08 §6 : « échec après les 3 retries →
 * notification Admin Savr » ; décision Val 2026-10-08, C1).
 *
 * « Perdu » = plus aucune tentative automatique ne partira :
 *   · 'tentatives_epuisees' — 4e tentative en échec (worker de retry) ;
 *   · 'adresse_refusee'     — Resend avait accepté l'email, la messagerie du
 *                             destinataire l'a refusé (webhook, jamais repris).
 *
 * Le canal est l'écran Alertes du back-office (`alertes_admin`), comme pour les
 * PDF (`pdf_job_dead`) et Pennylane (`pennylane_echec_final`) — jamais Slack
 * (§07/03 §3 : une alerte fonctionnelle reste in-app).
 */
export type MotifEmailPerdu = 'tentatives_epuisees' | 'adresse_refusee';

export async function traiterEmailPerdu(
  supabase: AdminSupabase,
  email: EmailTranche,
  motif: MotifEmailPerdu,
): Promise<ErreurDb | null> {
  // Infos d'accès chauffeur : suites propres (tampon retiré, alerte dédiée
  // pointant la fiche collecte, où l'email se renvoie).
  if (
    email.template_code === TEMPLATE_INFOS_ACCES &&
    email.entity_type === 'collecte' &&
    email.entity_id
  ) {
    return signalerInfosAccesNonRemises(supabase, email.entity_id, email.id);
  }

  // L'adresse figure dans le message : sans elle l'alerte ne dit pas qui
  // prévenir. Même audience que `emails_envoyes` — `alertes_admin` n'est lue que
  // par admin_savr (policy aa_admin, routes en requireAdmin).
  const constat =
    motif === 'adresse_refusee'
      ? 'a été refusé par la messagerie du destinataire (adresse invalide, boîte pleine ou signalement comme indésirable)'
      : 'n’a pas pu être envoyé après 4 tentatives';
  const aUneEntite = !!email.entity_type && !!email.entity_id;
  const { error } = await supabase.rpc('f_upsert_alerte_admin', {
    p_code: CODE_ALERTE_EMAIL_NON_REMIS,
    p_titre: 'Email non remis',
    p_message: `L’email « ${email.template_code} » destiné à ${email.destinataire} ${constat}. Prévenez le destinataire par un autre moyen.`,
    // L'entité métier quand l'envoi en porte une (lien vers la fiche) ; sinon
    // la ligne d'envoi elle-même, pour que deux emails perdus restent deux alertes.
    p_entity_type: aUneEntite ? email.entity_type : 'emails_envoyes',
    p_entity_id: aUneEntite ? email.entity_id : email.id,
  });
  return error ?? null;
}
