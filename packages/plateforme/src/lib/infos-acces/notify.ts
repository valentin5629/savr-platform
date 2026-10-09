import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  sendEmail,
  type SendEmailStatut,
} from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateFr } from '@savr/shared/src/csv/index.js';
import { cloreAlerteInfosAcces, TEMPLATE_INFOS_ACCES } from './suivi-email.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Infos d'accès chauffeur — évaluation de complétude + envoi de l'email récap.
 *
 * Décision Val 2026-07-15 (réintroduction V1 d'un workflow descopé Q10 M05) :
 * pour toute collecte `controle_acces_requis`, dès que TOUTES ses tournées ont
 * nom + téléphone chauffeur, on envoie UN email récapitulatif au programmateur
 * (`evenements.created_by`) listant tous les chauffeurs (multi-camions → 1 email).
 *
 * Le claim (stamp `infos_acces_email_envoye_at`) + la lecture des données sont
 * atomiques côté DB (`fn_infos_acces_marquer_si_complet`, lock FOR UPDATE de la
 * collecte) → garde anti-double-envoi même si poll et saisie Admin concourent.
 * Le claim est posé AVANT l'envoi ; ce qu'il devient dépend de l'issue :
 *   · email accepté par Resend → claim conservé ;
 *   · email refusé pour l'instant (ligne `emails_envoyes` en échec) → claim
 *     conservé : le worker de retry porte l'envoi, le relâcher ici laisserait
 *     partir un second email. Il est retiré plus tard si l'échec devient
 *     définitif (`suivi-email.ts`) ;
 *   · rien n'est parti et rien ne le reprendra (template inactif, variable
 *     manquante, hors production sans redirection, exception) → claim RELÂCHÉ
 *     (`infos_acces_email_envoye_at` remis à NULL) pour re-tenter au prochain
 *     déclenchement.
 *
 * Appelée après la saisie Admin (PATCH fiche collecte). En V1 MTS-1 n'expose pas
 * le téléphone chauffeur (as-built §6) → la complétude n'est atteinte que via la
 * saisie Admin ; le poll ne fait que peupler nom + plaque.
 */
export interface InfosAccesChauffeur {
  rang: number;
  chauffeur_nom: string | null;
  chauffeur_telephone: string | null;
  plaque: string | null;
  accompagnant_nom: string | null;
  accompagnant_telephone: string | null;
}

interface MarquagePayload {
  erreur?: string;
  to?: string;
  prenom?: string | null;
  evenement_nom?: string | null;
  date_collecte?: string | null;
  heure_collecte?: string | null;
  lieu_nom?: string | null;
  lieu_adresse?: string | null;
  chauffeurs?: InfosAccesChauffeur[];
}

// 'HH:MM:SS' → 'HH:MM'.
const formatHeure = (h: string | null | undefined): string =>
  h ? h.slice(0, 5) : '';

/** Bloc HTML récapitulatif par tournée (interpolate() ne sait pas boucler). */
export function renderChauffeursBloc(
  chauffeurs: InfosAccesChauffeur[],
): string {
  const multi = chauffeurs.length > 1;
  const items = chauffeurs
    .map((c) => {
      const titre = multi ? `<p><strong>Camion ${c.rang}</strong></p>` : '';
      const lignes: string[] = [];
      const nom = c.chauffeur_nom ? escapeHtml(c.chauffeur_nom) : '—';
      const tel = c.chauffeur_telephone
        ? escapeHtml(c.chauffeur_telephone)
        : '—';
      lignes.push(`<li>Chauffeur : ${nom} — ${tel}</li>`);
      if (c.plaque) lignes.push(`<li>Plaque : ${escapeHtml(c.plaque)}</li>`);
      if (c.accompagnant_nom) {
        const aNom = escapeHtml(c.accompagnant_nom);
        const aTel = c.accompagnant_telephone
          ? ` — ${escapeHtml(c.accompagnant_telephone)}`
          : '';
        lignes.push(`<li>Accompagnant : ${aNom}${aTel}</li>`);
      }
      return `${titre}<ul>${lignes.join('')}</ul>`;
    })
    .join('');
  return items;
}

/**
 * Issue de l'évaluation, pour le message affiché à l'Admin :
 *   'envoye'      — email accepté par Resend ;
 *   'en_reprise'  — email refusé pour l'instant, une nouvelle tentative suivra ;
 *   'non_envoye'  — un envoi était dû mais rien n'est parti (et rien ne le reprendra) ;
 *   'sans_objet'  — rien à envoyer (non requis, incomplet, déjà envoyé, erreur de lecture).
 */
export type IssueInfosAcces =
  | 'envoye'
  | 'en_reprise'
  | 'non_envoye'
  | 'sans_objet';

export interface EvaluationInfosAcces {
  /** Vrai seulement si l'email a réellement été accepté par Resend. */
  envoye: boolean;
  issue: IssueInfosAcces;
}

const SANS_OBJET: EvaluationInfosAcces = { envoye: false, issue: 'sans_objet' };
const NON_ENVOYE: EvaluationInfosAcces = { envoye: false, issue: 'non_envoye' };

async function relacherClaim(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<void> {
  const { error } = await supabase
    .from('collectes')
    .update({ infos_acces_email_envoye_at: null })
    .eq('id', collecteId);
  if (error) {
    // Claim resté posé sans email : l'écran lit `emails_envoyes`, mais la tuile
    // « Infos accès à envoyer » ne verra plus la collecte.
    logger.error('infos_acces.claim_non_relache', {
      collecte_id: collecteId,
      error_code: (error as { code?: string }).code ?? 'UNKNOWN',
    });
  }
}

/**
 * Évalue la complétude d'une collecte à contrôle d'accès et envoie l'email si
 * complet (idempotent, best-effort). Retourne `{ envoye, issue }`.
 * NE throw JAMAIS : conçue pour être appelée en best-effort par les routes.
 */
export async function evaluerInfosAccesEtEnvoyer(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<EvaluationInfosAcces> {
  const { data, error } = await supabase.rpc(
    'fn_infos_acces_marquer_si_complet',
    { p_collecte_id: collecteId },
  );

  if (error) {
    logger.error('infos_acces.marquage_echec', {
      collecte_id: collecteId,
      error: error.message,
    });
    return SANS_OBJET;
  }
  if (!data) return SANS_OBJET; // non requis / déjà envoyé / incomplet

  const payload = data as MarquagePayload;
  if (payload.erreur === 'destinataire_introuvable') {
    logger.warn('infos_acces.destinataire_introuvable', {
      collecte_id: collecteId,
    });
    return NON_ENVOYE;
  }

  const to = payload.to ?? '';
  if (!to) {
    await relacherClaim(supabase, collecteId);
    return NON_ENVOYE;
  }

  const variables: Record<string, string> = {
    prenom: payload.prenom ?? '',
    evenement_nom: payload.evenement_nom ?? '',
    date_collecte: formatDateFr(payload.date_collecte),
    heure_collecte: formatHeure(payload.heure_collecte),
    lieu_nom: payload.lieu_nom ?? '',
    lieu_adresse: payload.lieu_adresse ?? '',
    chauffeurs_bloc: renderChauffeursBloc(payload.chauffeurs ?? []),
  };

  let statut: SendEmailStatut;
  try {
    ({ statut } = await sendEmail(TEMPLATE_INFOS_ACCES, to, variables, {
      entityType: 'collecte',
      entityId: collecteId,
    }));
  } catch (e) {
    // Best-effort : on relâche le claim pour re-tenter au prochain déclenchement.
    logger.error('api.external.failed', {
      service: 'resend',
      endpoint: 'sendEmail',
      template: TEMPLATE_INFOS_ACCES,
      error: e instanceof Error ? e.message : String(e),
    });
    await relacherClaim(supabase, collecteId);
    return NON_ENVOYE;
  }

  if (statut === 'retrying') {
    // Claim conservé : le worker de retry porte l'envoi.
    return { envoye: false, issue: 'en_reprise' };
  }
  if (statut === 'dropped') {
    await relacherClaim(supabase, collecteId);
    return NON_ENVOYE;
  }

  // Parti : une alerte « non remis » ouverte pour cette collecte n'a plus d'objet.
  const alerteErr = await cloreAlerteInfosAcces(supabase, collecteId);
  if (alerteErr) {
    logger.error('infos_acces.alerte_non_close', {
      collecte_id: collecteId,
      error_code: alerteErr.code ?? 'UNKNOWN',
    });
  }
  return { envoye: true, issue: 'envoye' };
}
