import type { DashboardFilters } from './DashboardFilterBar.js';
import type { ParcFilterOptions } from './ParcMultiSelects.js';

/**
 * Ajoute les filtres de la barre globale (hors période) aux paramètres d'un
 * appel de dashboard, sous les noms que lisent les routes (`lieu_ids[]`,
 * `traiteur_ids[]`, `client_noms[]`, `type_evenement_ids[]`, `taille_evenements[]`).
 * Un filtre vide n'écrit rien.
 */
export function ajouterFiltresGlobaux(
  qs: URLSearchParams,
  filters: DashboardFilters | null,
): URLSearchParams {
  if (!filters) return qs;
  const listes: [string, string[] | undefined][] = [
    ['lieu_ids[]', filters.lieu_ids],
    ['traiteur_ids[]', filters.traiteur_ids],
    ['client_noms[]', filters.client_noms],
    ['type_evenement_ids[]', filters.type_evenement_ids],
    ['taille_evenements[]', filters.taille_evenement_codes],
  ];
  for (const [nom, valeurs] of listes)
    for (const v of valeurs ?? []) qs.append(nom, v);
  return qs;
}

/**
 * Réponse d'une route d'options de la barre. Une réponse sans la forme attendue
 * (route en échec, réseau coupé) donne des listes vides : la barre retire alors
 * les lieux, clients, traiteurs et types mémorisés, au lieu de les appliquer
 * sans case visible pour les décocher.
 */
export function optionsBarreValides(data: unknown): ParcFilterOptions {
  const d = data as Partial<ParcFilterOptions> | null | undefined;
  return d && Array.isArray(d.lieux) && Array.isArray(d.types)
    ? (d as ParcFilterOptions)
    : { lieux: [], types: [] };
}
