/**
 * Statut consolidé d'un événement (décision F2 2026-06-07) — source unique
 * (R-UI-2 C13) : dérivation depuis les statuts de ses collectes, et variante de
 * son badge. Consommé par l'export CSV Événements (§12 §2) et par les écrans
 * Événements du gestionnaire (liste + fiche), remis par Val le 2026-10-18 —
 * sans le filtre « Statut consolidé », que l'arbitrage C3 du 2026-10-07 a
 * abandonné.
 *
 *  · `Annulé`  = toutes les collectes `annulee` ;
 *  · `Terminé` = toutes terminales (`realisee`/`cloturee`/
 *    `realisee_sans_collecte`/`annulee`) dont ≥ 1 réalisée (`realisee`,
 *    `cloturee` ou `realisee_sans_collecte`) ;
 *  · `En cours` = sinon (≥ 1 collecte non terminale, ou aucune collecte).
 *
 * `realisee_sans_collecte` (AG sans excédent, lue « Réalisée » à l'écran) compte
 * comme réalisée depuis la décision Val du 2026-10-18 : sans elle, un événement
 * dont la collecte AG était sans excédent restait « En cours » pour toujours.
 *
 * Le statut consolidé est un LIBELLÉ (écrit tel quel dans le CSV), pas un enum
 * DB.
 */
import type { VarianteBadge } from './types';

export type StatutEvenementConsolide = 'En cours' | 'Terminé' | 'Annulé';

const REALISEES = new Set(['realisee', 'cloturee', 'realisee_sans_collecte']);
const TERMINAUX = new Set([...REALISEES, 'annulee']);

/** Dérive le statut consolidé d'un événement depuis ses collectes. */
export function statutEvenementConsolide(
  collectes: readonly { statut: string }[],
): StatutEvenementConsolide {
  if (collectes.length === 0) return 'En cours';
  if (collectes.every((c) => c.statut === 'annulee')) return 'Annulé';
  const tousTerminaux = collectes.every((c) => TERMINAUX.has(c.statut));
  const auMoinsUnRealise = collectes.some((c) => REALISEES.has(c.statut));
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}

const VARIANTE: Record<StatutEvenementConsolide, VarianteBadge> = {
  'En cours': 'info',
  Terminé: 'success',
  Annulé: 'neutral',
};

/** Variante de badge du statut consolidé (inconnu → `info`, comme « En cours »). */
export function variantStatutEvenement(
  statut: string | null | undefined,
): VarianteBadge {
  return VARIANTE[statut as StatutEvenementConsolide] ?? 'info';
}
