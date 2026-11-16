import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  sendEmail,
  type SendEmailStatut,
} from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateFr } from '@savr/shared/src/csv/index.js';
import { decalerJour } from '@savr/shared/src/temps/index.js';
import { cloreAlerteInfosAcces, TEMPLATE_INFOS_ACCES } from './suivi-email.js';
import { adresseLieu } from '@/lib/notifications/traiteur-operationnel.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Infos d'accès chauffeur — évaluation de complétude + envoi de l'email récap.
 *
 * Décision Val 2026-07-15 (réintroduction V1 d'un workflow descopé Q10 M05) :
 * pour toute collecte `controle_acces_requis`, dès que TOUTES ses tournées ont
 * nom + plaque (à défaut de plaque, téléphone — vélo cargo) — Val 2026-11-16 —, on envoie UN email récapitulatif au programmateur
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
 * Appelée après la saisie Admin (PATCH fiche collecte), le webhook du
 * transporteur vélo et le passage qui suit la relève (`envoyerInfosAccesCompletes`).
 * MTS-1 n'expose pas le téléphone chauffeur : nom + plaque suffisent (Val
 * 2026-11-16), la relève les peuple.
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
      // Téléphone seulement s'il est connu : MTS-1 ne le fournit pas, l'email
      // part sur nom + plaque (décision Val 2026-11-16).
      const tel = c.chauffeur_telephone?.trim()
        ? ` — ${escapeHtml(c.chauffeur_telephone)}`
        : '';
      lignes.push(`<li>Chauffeur : ${nom}${tel}</li>`);
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

  const chauffeurs = payload.chauffeurs ?? [];
  // Textes saisis interpolés tels quels dans le HTML du gabarit : échappés ici.
  const variables: Record<string, string> = {
    prenom: escapeHtml(payload.prenom ?? ''),
    evenement_nom: escapeHtml(payload.evenement_nom ?? ''),
    date_collecte: formatDateFr(payload.date_collecte),
    heure_collecte: formatHeure(payload.heure_collecte),
    lieu_nom: escapeHtml(payload.lieu_nom ?? ''),
    lieu_adresse: escapeHtml(
      (await adresseComplete(supabase, collecteId)) ??
        payload.lieu_adresse ??
        '',
    ),
    chauffeurs_bloc: renderChauffeursBloc(chauffeurs),
    // Phrase d'introduction au singulier ou au pluriel selon le nombre de
    // camions (Val 2026-11-16) : le moteur n'a pas de {{else}}, d'où deux
    // conditions exclusives.
    un_chauffeur: chauffeurs.length > 1 ? '' : 'true',
    plusieurs_chauffeurs: chauffeurs.length > 1 ? 'true' : '',
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

/**
 * Adresse du lieu avec code postal et ville (revue des emails, Val 2026-10-29) :
 * la fonction SQL ne rend que l'adresse d'accès. null si illisible : l'email
 * garde alors l'adresse d'accès seule.
 */
async function adresseComplete(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('collectes')
      .select(
        'evenement:evenements!inner(lieu:lieux!lieu_id(adresse_acces, code_postal, ville))',
      )
      .eq('id', collecteId)
      .maybeSingle();
    const evt = un((data as { evenement?: unknown } | null)?.evenement) as
      | { lieu?: unknown }
      | undefined;
    const lieu = un(evt?.lieu) as
      | {
          adresse_acces?: string | null;
          code_postal?: string | null;
          ville?: string | null;
        }
      | undefined;
    return lieu ? adresseLieu(lieu) || null : null;
  } catch {
    return null;
  }
}

const un = <T>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : (v ?? undefined);

// Collectes encore à réaliser, seules à recevoir l'email (une collecte réalisée
// ou annulée n'a plus d'accès à préparer).
const STATUTS_A_VENIR = ['programmee', 'validee', 'en_cours'];
// Fenêtre du passage : de J à J+7 (jour de Paris). Le chauffeur est désigné
// dans les derniers jours avant la collecte ; une collecte plus lointaine est
// évaluée quand elle entre dans la fenêtre, ou par la saisie Admin.
const FENETRE_JOURS = 7;
// Plafond de lecture : bien au-delà du volume d'une semaine (≈ 40 collectes en
// An 1), pour qu'une file de collectes incomplètes ne cache jamais une
// collecte complète plus lointaine.
const MAX_CANDIDATES = 500;
// Budget du passage : la relève vit sous la limite de 60 s de sa fonction.
// Passé ce délai, plus aucune collecte n'est commencée ; le reste attend le
// passage suivant (un email réservé est toujours envoyé jusqu'au bout).
const BUDGET_MS = 25_000;

/**
 * Passe des emails « Accès chauffeur » après la relève des transporteurs
 * (décision Val 2026-11-16) : le chauffeur et la plaque arrivent de MTS-1 par
 * la relève, sans saisie Admin, et rien ne déclenchait alors l'email. Chaque
 * collecte à contrôle d'accès, de J à J+7 et sans email réservé est évaluée ;
 * la fonction SQL ne réserve et ne renvoie de quoi écrire que si tous ses
 * camions sont complets, sous verrou de la collecte (jamais deux emails). Une
 * collecte incomplète ne coûte qu'un appel à la base.
 */
export async function envoyerInfosAccesCompletes(
  supabase: AdminSupabase,
  aujourdhui: string,
  maintenant: () => number = Date.now,
): Promise<{ evaluees: number; envoyes: number }> {
  const echeance = maintenant() + BUDGET_MS;
  const { data, error } = await supabase
    .from('collectes')
    .select('id')
    .eq('controle_acces_requis', true)
    .is('infos_acces_email_envoye_at', null)
    .in('statut', STATUTS_A_VENIR)
    .gte('date_collecte', aujourdhui)
    .lte('date_collecte', decalerJour(aujourdhui, FENETRE_JOURS))
    .order('date_collecte', { ascending: true })
    .limit(MAX_CANDIDATES);
  if (error) {
    logger.error('infos_acces.passage_lecture_echec', {
      error_code: (error as { code?: string }).code ?? 'UNKNOWN',
    });
    return { evaluees: 0, envoyes: 0 };
  }
  let evaluees = 0;
  let envoyes = 0;
  for (const { id } of (data ?? []) as Array<{ id: string }>) {
    if (maintenant() > echeance) break;
    evaluees++;
    const { envoye } = await evaluerInfosAccesEtEnvoyer(supabase, id);
    if (envoye) envoyes++;
  }
  return { evaluees, envoyes };
}
