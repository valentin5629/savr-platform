// Quand les documents d'une collecte sont attendus — fiche collecte Admin, Bloc 3
// « Documents » (§06.06). Sert tant qu'un document n'existe pas encore : l'écran
// affichait « Non encore généré » sans dire quand il le serait (question de Val en
// E2E, 2026-10-09). État calculé côté serveur, jamais par l'écran, comme la ligne
// de document de la fiche client (§06.04, `rapport_etat`).
//
// La chaîne est la même pour le bordereau, le rapport et l'attestation (§05, §12) :
// clôture automatique 24 h après la réalisation (embargo H+24), puis génération au
// traitement de nuit suivant.
//
// La clôture est faite par un cron HORAIRE (cloture-embargo, à chaque heure pile),
// le traitement de nuit ne prend que les collectes déjà clôturées, et à 04:00 UTC
// les deux partent ensemble, dans un ordre non garanti. Une collecte dont l'embargo
// finit après 03:00 UTC n'est donc sûrement clôturée qu'au passage de 04:00 : elle
// est annoncée pour la nuit suivante, jamais pour un traitement qui peut la manquer.

import { jourParis } from '@savr/shared/src/temps/index.js';

/** Heure UTC du traitement de nuit des documents — cron `batch-pdf-j1` de vercel.json. */
const HEURE_UTC_TRAITEMENT_NUIT = 4;

const EMBARGO_MS = 24 * 3600 * 1000;

/** Pas du cron de clôture : au pire, la clôture suit la fin de l'embargo d'une heure. */
const PAS_CLOTURE_MS = 3600 * 1000;

export type AttenteDocuments =
  /** Collecte pas encore réalisée : rien n'est daté. */
  | { etat: 'apres_collecte' }
  /** Traitement de nuit à venir, ou du jour : `jour` = sa date à Paris (AAAA-MM-JJ). */
  | { etat: 'attendu'; jour: string }
  /** Ce traitement de nuit est passé depuis au moins un jour. */
  | { etat: 'en_retard'; jour: string };

/**
 * Null quand il n'y a rien à annoncer : collecte hors du parcours qui mène à un
 * document daté (annulée, rejetée, sans collecte…) ou réalisée sans horodatage.
 */
export function attenteDocuments(
  collecte: { statut: string; realisee_at: string | null },
  maintenant: Date = new Date(),
): AttenteDocuments | null {
  if (['programmee', 'validee', 'en_cours'].includes(collecte.statut)) {
    return { etat: 'apres_collecte' };
  }
  if (collecte.statut !== 'realisee' && collecte.statut !== 'cloturee') {
    return null;
  }
  const realisee = collecte.realisee_at ? new Date(collecte.realisee_at) : null;
  if (!realisee || Number.isNaN(realisee.getTime())) return null;

  // Premier traitement de nuit auquel la collecte est sûrement déjà clôturée.
  const clotureAuPlusTard = realisee.getTime() + EMBARGO_MS + PAS_CLOTURE_MS;
  const traitement = new Date(clotureAuPlusTard);
  traitement.setUTCHours(HEURE_UTC_TRAITEMENT_NUIT, 0, 0, 0);
  if (traitement.getTime() < clotureAuPlusTard) {
    traitement.setUTCDate(traitement.getUTCDate() + 1);
  }

  const jour = jourParis(traitement);
  return { etat: jourParis(maintenant) > jour ? 'en_retard' : 'attendu', jour };
}
