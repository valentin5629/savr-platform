import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { formatDateFr } from '@savr/shared/src/csv/index.js';

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
 * L'envoi Resend est best-effort ; en cas d'échec on RELÂCHE le claim (remet
 * `infos_acces_email_envoye_at` à NULL) pour re-tenter au prochain déclenchement.
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

const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
 * Évalue la complétude d'une collecte à contrôle d'accès et envoie l'email si
 * complet (idempotent, best-effort). Retourne `{ envoye }`.
 * NE throw JAMAIS : conçue pour être appelée en best-effort par les routes.
 */
export async function evaluerInfosAccesEtEnvoyer(
  supabase: AdminSupabase,
  collecteId: string,
): Promise<{ envoye: boolean }> {
  const { data, error } = await supabase.rpc(
    'fn_infos_acces_marquer_si_complet',
    { p_collecte_id: collecteId },
  );

  if (error) {
    logger.error('infos_acces.marquage_echec', {
      collecte_id: collecteId,
      error: error.message,
    });
    return { envoye: false };
  }
  if (!data) return { envoye: false }; // non requis / déjà envoyé / incomplet

  const payload = data as MarquagePayload;
  if (payload.erreur === 'destinataire_introuvable') {
    logger.warn('infos_acces.destinataire_introuvable', {
      collecte_id: collecteId,
    });
    return { envoye: false };
  }

  const to = payload.to ?? '';
  if (!to) return { envoye: false };

  const variables: Record<string, string> = {
    prenom: payload.prenom ?? '',
    evenement_nom: payload.evenement_nom ?? '',
    date_collecte: formatDateFr(payload.date_collecte),
    heure_collecte: formatHeure(payload.heure_collecte),
    lieu_nom: payload.lieu_nom ?? '',
    lieu_adresse: payload.lieu_adresse ?? '',
    chauffeurs_bloc: renderChauffeursBloc(payload.chauffeurs ?? []),
  };

  try {
    await sendEmail('infos_acces_collecte', to, variables, {
      entityType: 'collecte',
      entityId: collecteId,
    });
    return { envoye: true };
  } catch (e) {
    // Best-effort : on relâche le claim pour re-tenter au prochain déclenchement.
    logger.error('api.external.failed', {
      service: 'resend',
      endpoint: 'sendEmail',
      template: 'infos_acces_collecte',
      error: e instanceof Error ? e.message : String(e),
    });
    await supabase
      .from('collectes')
      .update({ infos_acces_email_envoye_at: null })
      .eq('id', collecteId);
    return { envoye: false };
  }
}
