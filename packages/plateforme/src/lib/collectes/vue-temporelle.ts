import {
  decalerJour,
  formatHeureParis,
  jourParis,
} from '@savr/shared/src/temps/index.js';

// Vues de la page Collectes de TOUS les espaces (décision Val 2026-10-19) :
// « Collectes à venir » et « Collectes passées » remplacent les onglets par
// état « Programmées / Historique ». Une collecte y est rangée par son CRÉNEAU
// (date + heure de collecte, heure de Paris), quel que soit son statut : à
// 15h16, une collecte de 15h15 est passée, une de 15h16 encore à venir
// (décision Val 2026-11-03). Chaque vue s'ouvre de la plus proche à la plus
// lointaine : date croissante à venir, décroissante dans le passé.
// La page Événements du gestionnaire garde le rangement au jour, sur la date
// de l'événement (décision Val 2026-10-20) : aujourd'hui y reste « à venir ».

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
 * `jourPartage` (listes Collectes) : aujourd'hui appartient aux deux vues, la
 * route le partage à la minute (`vue` + `creneauDeLaVue`). Sans lui (liste
 * Événements), aujourd'hui reste « à venir ».
 */
export function periodeDeLaVue(
  vue: VueCollectes,
  periode: { from: string; to: string },
  aujourdhui: string = jourParis(),
  { jourPartage = false }: { jourPartage?: boolean } = {},
): { from: string; to: string } {
  if (vue === 'a_venir') {
    return {
      from: periode.from > aujourdhui ? periode.from : aujourdhui,
      to: periode.to,
    };
  }
  const borne = jourPartage ? aujourdhui : decalerJour(aujourdhui, -1);
  return {
    from: periode.from,
    to: periode.to && periode.to < borne ? periode.to : borne,
  };
}

/**
 * Filtre PostgREST (`.or()`) qui range une collecte dans sa vue selon son
 * créneau, à la minute près (heure de Paris) : « à venir » = créneau à
 * maintenant ou après (minute en cours comprise), « passées » = avant. Calculé
 * par la route, sur son horloge, à chaque lecture.
 */
export function creneauDeLaVue(vue: VueCollectes, now: Date): string {
  const jour = jourParis(now);
  const minute = formatHeureParis(now);
  return vue === 'a_venir'
    ? `date_collecte.gt.${jour},and(date_collecte.eq.${jour},heure_collecte.gte.${minute})`
    : `date_collecte.lt.${jour},and(date_collecte.eq.${jour},heure_collecte.lt.${minute})`;
}
