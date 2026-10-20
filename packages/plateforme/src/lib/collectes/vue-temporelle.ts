import { decalerJour, jourParis } from '@savr/shared/src/temps/index.js';

// Vues de la page Collectes de TOUS les espaces (décision Val 2026-10-19) :
// « Collectes à venir » et « Collectes passées » remplacent les onglets par
// état « Programmées / Historique ». Une collecte y est rangée par sa DATE de
// collecte, quel que soit son statut : aujourd'hui compte dans « à venir »
// (jour parisien). Chaque vue s'ouvre de la plus proche à la plus lointaine :
// date croissante à venir, décroissante dans le passé. Même règle sur la page
// Événements du gestionnaire, sur la date de l'événement (décision Val
// 2026-10-20).

export type VueCollectes = 'a_venir' | 'passees';

/**
 * Valeur d'URL → vue, `null` si absente ou inconnue. Les liens d'avant (emails,
 * favoris, drill-downs) portent encore `programmees` / `historique`.
 */
export function lireVueCollectes(
  valeur: string | null | undefined,
): VueCollectes | null {
  if (valeur === 'a_venir' || valeur === 'programmees') return 'a_venir';
  if (valeur === 'passees' || valeur === 'historique') return 'passees';
  return null;
}

/** Tri par défaut de la vue : la collecte la plus proche d'aujourd'hui d'abord. */
export function triDateDescendant(vue: VueCollectes): boolean {
  return vue === 'passees';
}

/**
 * Période envoyée à la liste et à l'export : celle choisie dans la barre
 * (« YYYY-MM-DD », '' = non bornée), restreinte à la vue. Un croisement vide
 * (période passée vue « à venir ») donne `from > to` : aucune ligne.
 */
export function periodeDeLaVue(
  vue: VueCollectes,
  periode: { from: string; to: string },
  aujourdhui: string = jourParis(),
): { from: string; to: string } {
  if (vue === 'a_venir') {
    return {
      from: periode.from > aujourdhui ? periode.from : aujourdhui,
      to: periode.to,
    };
  }
  const hier = decalerJour(aujourdhui, -1);
  return {
    from: periode.from,
    to: periode.to && periode.to < hier ? periode.to : hier,
  };
}
