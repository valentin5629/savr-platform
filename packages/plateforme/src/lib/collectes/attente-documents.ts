// Quand les documents d'une collecte sont attendus — fiche collecte Admin, Bloc 3
// « Documents » (§06.06). Sert tant qu'un document n'existe pas encore : l'écran
// affichait « Non encore généré » sans dire quand il le serait (question de Val en
// E2E, 2026-10-09). État calculé côté serveur, jamais par l'écran, comme la ligne
// de document de la fiche client (§06.04, `rapport_etat`).
//
// La chaîne est la même pour le bordereau, le rapport et l'attestation (§05, §12) :
// clôture automatique 24 h après la réalisation (embargo H+24), puis génération au
// traitement de nuit suivant.

import { jourParis } from '@savr/shared/src/temps/index.js';

/** Heure UTC du traitement de nuit des documents — cron `batch-pdf-j1` de vercel.json. */
const HEURE_UTC_TRAITEMENT_NUIT = 4;

const EMBARGO_MS = 24 * 3600 * 1000;

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

  // Premier traitement de nuit à partir de la fin de l'embargo.
  const finEmbargo = realisee.getTime() + EMBARGO_MS;
  const traitement = new Date(finEmbargo);
  traitement.setUTCHours(HEURE_UTC_TRAITEMENT_NUIT, 0, 0, 0);
  if (traitement.getTime() < finEmbargo) {
    traitement.setUTCDate(traitement.getUTCDate() + 1);
  }

  const jour = jourParis(traitement);
  return { etat: jourParis(maintenant) > jour ? 'en_retard' : 'attendu', jour };
}
