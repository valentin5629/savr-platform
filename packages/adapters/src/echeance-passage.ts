// Échéance d'un ordre réservé — borne le passage du worker DANS LE CODE.
//
// Pourquoi : le reaper re-queue une réservation dès que son bail est expiré, et
// le passage suivant la reprend. Si le premier passage vit encore à ce
// moment-là, deux passages parlent au prestataire pour le même ordre — et le
// prestataire est présumé non idempotent. On comptait sur `maxDuration = 60`
// pour tuer le passage avant la fin du bail (120 s) ; mesuré le 2026-10-12 sur
// des aperçus Vercel (Fluid Compute) : une tâche hors délai a continué alors
// qu'une autre invocation tenait le même processus ; un serveur local
// n'applique aucune limite.
//
// Deux règles, tenues ici, pour un ordre réservé à l'instant T (pris AVANT la
// requête de réservation, donc jamais après le début du bail en base) :
//   1. aucun appel au prestataire ne DÉMARRE après T + bail − 40 s. Les
//      clients HTTP abandonnent un appel resté 30 s sans réponse : démarré à
//      temps, il a reçu ses en-têtes de réponse ou a été abandonné au plus
//      tard à T + bail − 10 s, tant que le processus tourne ;
//   2. aucune écriture de résultat n'est LANCÉE sur l'ordre après
//      T + bail − 5 s. Passé ce point l'ordre ne nous appartient plus de façon
//      sûre : on le laisse au reaper, qui le remettra en file avec
//      réconciliation obligatoire.
//
// Seules des durées écoulées sur l'horloge du passage comptent : un décalage
// constant avec l'horloge de la base est sans effet. L'horloge murale est
// voulue : un processus gelé puis réveillé est supposé voir le temps écoulé et
// ne plus rien démarrer (non mesuré sur Vercel). Non couverts : un recul de
// l'horloge murale (plus de 40 s pour un appel, plus de 5 s pour une écriture),
// la lecture du corps d'une réponse, un appel en vol pendant un gel, et les
// écritures en base que fait l'adapter entre deux appels.

import { AsyncLocalStorage } from 'node:async_hooks';

import { LogistiqueTransientError } from './index.js';

/** Bail de réservation d'un ordre, passé tel quel aux fonctions de réservation. */
export const BAIL_RESERVATION_MS = 120_000;

/** Plus longue attente d'une réponse du prestataire (30 s) + 10 s de garde. */
export const MARGE_APPEL_MS = 40_000;

/** Garde avant la fin du bail pour lancer l'écriture d'un résultat : le temps de cette écriture. */
export const MARGE_ECRITURE_MS = 5_000;

const contexte = new AsyncLocalStorage<{ echeance: number }>();

/** Échéance d'un ordre réservé à `reserveA` (instant d'AVANT la requête de réservation). */
export function echeanceOrdre(reserveA: number): number {
  return reserveA + BAIL_RESERVATION_MS - MARGE_APPEL_MS;
}

/** Dernier instant où l'écriture du résultat d'un ordre réservé à `reserveA` peut être lancée. */
export function limiteEcriture(reserveA: number): number {
  return reserveA + BAIL_RESERVATION_MS - MARGE_ECRITURE_MS;
}

/** Exécute `fn` : tout appel au prestataire qu'elle déclenche est borné par `echeance`. */
export function avecEcheance<T>(
  echeance: number,
  fn: () => Promise<T>,
): Promise<T> {
  return contexte.run({ echeance }, fn);
}

/**
 * À appeler juste avant chaque requête HTTP vers un prestataire. Hors d'un
 * passage du worker (relève entrante, healthcheck), aucune échéance : sans effet.
 * Échéance atteinte : l'appel n'est PAS démarré — erreur PASSAGÈRE. Rien n'est
 * parti, et chaque appel précédent de cet ordre a rendu son résultat : pour
 * l'adapter, c'est la situation d'un 503 sur cet appel. L'ordre repart par les
 * paliers habituels, sans réconciliation (elle n'est due qu'à un appel dont
 * l'issue est inconnue).
 */
export function verifierEcheance(appel: string): void {
  const courant = contexte.getStore();
  if (courant && Date.now() >= courant.echeance) {
    throw new LogistiqueTransientError(
      `Échéance du passage atteinte : ${appel} non démarré`,
    );
  }
}
