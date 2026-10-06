/**
 * Statut consolidé d'un événement (§06.05 gestionnaire de lieux, décision F2
 * 2026-06-07) — source unique (R-UI-2 C13) : dérivation depuis les statuts de
 * ses collectes, libellés, options du filtre et variante de badge. Consommé par
 * l'API liste, l'export CSV et la barre de filtres « Événements ».
 *
 *  · `Annulé`  = toutes les collectes `annulee` ;
 *  · `Terminé` = toutes terminales (`realisee`/`cloturee`/`annulee`) dont ≥ 1
 *    `realisee` ou `cloturee` ;
 *  · `En cours` = sinon (≥ 1 collecte non terminale, ou aucune collecte).
 *
 * Le statut consolidé est un LIBELLÉ (valeur échangée telle quelle par l'API,
 * le filtre `statut_consolide[]` et le CSV), pas un enum DB.
 */
import type { VarianteBadge } from './types';

/** Valeurs du statut consolidé, dans l'ordre du filtre. */
export const STATUTS_EVENEMENT_CONSOLIDES = [
  'En cours',
  'Terminé',
  'Annulé',
] as const;

export type StatutEvenementConsolide =
  (typeof STATUTS_EVENEMENT_CONSOLIDES)[number];

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

/** Options du filtre « Statut consolidé » (id = libellé échangé par l'API). */
export const OPTIONS_STATUT_EVENEMENT: { id: string; nom: string }[] =
  STATUTS_EVENEMENT_CONSOLIDES.map((s) => ({ id: s, nom: s }));

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
