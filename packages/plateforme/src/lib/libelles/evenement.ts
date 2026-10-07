/**
 * Statut consolidé d'un événement (décision F2 2026-06-07) — source unique
 * (R-UI-2 C13) : dérivation depuis les statuts de ses collectes. Consommé par
 * l'export CSV Événements (§12 §2). La liste Événements du gestionnaire, qui
 * en portait le filtre et le badge, est retirée (décision Val 2026-10-07).
 *
 *  · `Annulé`  = toutes les collectes `annulee` ;
 *  · `Terminé` = toutes terminales (`realisee`/`cloturee`/`annulee`) dont ≥ 1
 *    `realisee` ou `cloturee` ;
 *  · `En cours` = sinon (≥ 1 collecte non terminale, ou aucune collecte).
 *
 * Le statut consolidé est un LIBELLÉ (écrit tel quel dans le CSV), pas un enum
 * DB.
 */

export type StatutEvenementConsolide = 'En cours' | 'Terminé' | 'Annulé';

const TERMINAUX = new Set(['realisee', 'cloturee', 'annulee']);

/** Dérive le statut consolidé d'un événement depuis ses collectes. */
export function statutEvenementConsolide(
  collectes: readonly { statut: string }[],
): StatutEvenementConsolide {
  if (collectes.length === 0) return 'En cours';
  if (collectes.every((c) => c.statut === 'annulee')) return 'Annulé';
  const tousTerminaux = collectes.every((c) => TERMINAUX.has(c.statut));
  const auMoinsUnRealise = collectes.some(
    (c) => c.statut === 'realisee' || c.statut === 'cloturee',
  );
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}
