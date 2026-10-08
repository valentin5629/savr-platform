import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Ce qu'il est réellement advenu de l'email récapitulatif de programmation
 * (`collecte_programmee`), lu dans `emails_envoyes` — pour que l'écran de
 * confirmation ne dise « envoyé » que si c'est vrai (décision Val 2026-10-08).
 *
 *   'envoye'     — accepté par Resend ;
 *   'en_reprise' — refusé pour l'instant, le worker de retry réessaie ;
 *   'non_envoye' — rien n'est parti et rien ne repartira : 4 tentatives épuisées,
 *                  refus de la messagerie du destinataire, ou aucune ligne
 *                  d'envoi (destinataire non résolu, template inactif, variable
 *                  manquante, hors production sans redirection).
 *
 * `null` = état inconnu (lecture en erreur, statut que ce suivi ne connaît pas) :
 * l'écran n'affirme alors rien.
 *
 * Limites connues :
 *   - un email accepté par Resend dont la ligne d'historique n'a pas pu être
 *     écrite se lit ici « non envoyé » — sans ligne, rien ne prouve l'envoi ;
 *   - un email remis puis signalé comme indésirable par son destinataire passe
 *     en `bounced` : à une nouvelle visite, il se lit « non envoyé » ;
 *   - le worker de retry saute un template devenu inactif : la ligne reste
 *     « en reprise » sans jamais repartir ;
 *   - le dernier envoi fait foi : si le récapitulatif d'origine est perdu et que
 *     celui d'une collecte ajoutée ensuite part, l'événement se lit « envoyé ».
 */
export type EtatRecapEmail = 'envoye' | 'en_reprise' | 'non_envoye';

// Ce que l'envoi écrit dans `emails_envoyes` et que ce suivi relit : `recap-email.ts`
// prend ces deux valeurs ici, pour que l'écriture et la lecture ne divergent pas.
export const TEMPLATE_RECAP_PROGRAMMATION = 'collecte_programmee';
export const ENTITE_RECAP_PROGRAMMATION = 'evenement';
// Envoi initial + 3 reprises (§08 §4) : à la 4e tentative en échec, plus rien ne repart.
const TENTATIVES_MAX = 4;

export interface DernierEmailRecap {
  statut: string;
  tentative_numero: number;
}

export function deriverEtatRecapEmail(
  dernier: DernierEmailRecap | null,
): EtatRecapEmail | null {
  if (!dernier) return 'non_envoye';
  switch (dernier.statut) {
    case 'sent':
    case 'delivered':
      return 'envoye';
    case 'failed':
      return dernier.tentative_numero >= TENTATIVES_MAX
        ? 'non_envoye'
        : 'en_reprise';
    case 'bounced':
      return 'non_envoye';
    default:
      return null;
  }
}

/**
 * État du dernier email récapitulatif de l'événement (le plus récent fait foi).
 * À n'appeler qu'une fois l'événement trouvé dans le périmètre de l'appelant :
 * cette lecture ne cloisonne rien elle-même.
 */
export async function lireEtatRecapEmail(
  supabase: AdminSupabase,
  evenementId: string,
): Promise<EtatRecapEmail | null> {
  // Ni `destinataire` ni `erreur` : `emails_envoyes` est fermée aux rôles clients
  // (§09 A2bis, PII). Seul l'état dérivé sort d'ici.
  const { data, error } = await supabase
    .from('emails_envoyes')
    .select('statut, tentative_numero')
    .eq('template_code', TEMPLATE_RECAP_PROGRAMMATION)
    .eq('entity_type', ENTITE_RECAP_PROGRAMMATION)
    .eq('entity_id', evenementId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error('programmation.recap_email.suivi_illisible', {
      evenement_id: evenementId,
      error_code: (error as { code?: string }).code ?? 'UNKNOWN',
    });
    return null;
  }
  return deriverEtatRecapEmail((data as DernierEmailRecap | null) ?? null);
}
