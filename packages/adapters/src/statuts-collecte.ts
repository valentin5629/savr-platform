import type { Database } from '../../shared/src/database.types.js';

type CollecteStatut = Database['plateforme']['Enums']['collecte_statut'];

/**
 * États terminaux d'une collecte (CDC §05 « machine à états » : `realisee` /
 * `realisee_sans_collecte` sont terminaux, `cloturee` les suit ; `annulee` et
 * `rejetee_par_prestataire` sont des fins de vie). Une collecte dans l'un de ces
 * états n'a plus de commande à mettre à jour chez un transporteur.
 *
 * `realisee_sans_collecte` (AG « aucun repas ») est le plus facile à oublier :
 * sans lui, une collecte du jour déjà close recevait un PUT d'adresse E5.
 * Typée sur l'enum DB : une faute de frappe ne compile pas.
 */
export const STATUTS_COLLECTE_TERMINAUX = [
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'rejetee_par_prestataire',
] as const satisfies readonly CollecteStatut[];

/** Liste au format PostgREST, pour `.not('statut', 'in', …)`. */
export const FILTRE_STATUTS_COLLECTE_TERMINAUX = `(${STATUTS_COLLECTE_TERMINAUX.join(',')})`;

/**
 * États d'une collecte en cours d'exécution chez le transporteur : les seuls où
 * un statut remonté au polling peut encore s'écrire sur la collecte. Une collecte
 * annulée, en demande d'annulation (arbitrage Val 2026-09-17) ou dans un état
 * terminal n'est pas requalifiée par un ordre qui arrive après coup. Même liste
 * que la garde SQL de `fn_agreger_terminal_collecte`.
 */
export const STATUTS_COLLECTE_EN_EXECUTION = [
  'programmee',
  'validee',
  'en_cours',
] as const satisfies readonly CollecteStatut[];
