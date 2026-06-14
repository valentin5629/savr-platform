// Mapping MTS-1 customerOrderStatus → statut_tms Savr (§08 §3bis.6)
// + dérive statut collecte (miroir du trigger fn_sync_statut_collecte_from_tms).
// Utilisé par le polling adapter M1.5b.

export type Mts1OrderStatus =
  | 'QUOTE'
  | 'DRAFT'
  | 'PLANNED'
  | 'VALIDATED'
  | 'IN_PROGRESSION'
  | 'OK'
  | 'PARTIAL'
  | 'ARCHIVED'
  | 'CANCELED'
  | 'KO';

export type StatutTmsEnum =
  | 'non_envoye'
  | 'a_attribuer'
  | 'attribuee_en_attente_acceptation'
  | 'acceptee'
  | 'en_attente_execution'
  | 'rejetee_par_prestataire'
  | 'annulee_par_traiteur'
  | 'rejetee_par_tms';

export type CollecteStatutEnum =
  | 'brouillon'
  | 'programmee'
  | 'validee'
  | 'en_cours'
  | 'realisee'
  | 'realisee_sans_collecte'
  | 'cloturee'
  | 'annulation_demandee'
  | 'annulee';

/** Statuts MTS-1 terminaux — agrégation déclenchée quand TOUS les tours y sont. */
export const MTS1_TERMINAL_STATUSES: ReadonlySet<Mts1OrderStatus> = new Set([
  'OK',
  'PARTIAL',
  'CANCELED',
  'KO',
]);

/** Statuts MTS-1 avec pesées disponibles (collecte partiellement ou totalement réalisée). */
export const MTS1_SUCCESS_STATUSES: ReadonlySet<Mts1OrderStatus> = new Set([
  'OK',
  'PARTIAL',
]);

/** Statuts MTS-1 indiquant un refus ou annulation transporteur. */
export const MTS1_REJECTION_STATUSES: ReadonlySet<Mts1OrderStatus> = new Set([
  'CANCELED',
  'KO',
]);

/**
 * Mappe le statut MTS-1 d'une commande vers statut_tms Savr (§08 §3bis.6).
 *
 * @param customerOrderStatus - statut de la commande MTS-1
 * @param tourDispatchAccepted - true si tour.status.dispatch === 'ACCEPTED' (signal positif explicite)
 */
export function mapMts1ToStatutTms(
  customerOrderStatus: Mts1OrderStatus,
  tourDispatchAccepted: boolean,
): StatutTmsEnum {
  if (MTS1_REJECTION_STATUSES.has(customerOrderStatus)) {
    return 'rejetee_par_prestataire';
  }
  if (
    (customerOrderStatus === 'PLANNED' ||
      customerOrderStatus === 'VALIDATED') &&
    tourDispatchAccepted
  ) {
    return 'acceptee';
  }
  if (
    customerOrderStatus === 'PLANNED' ||
    customerOrderStatus === 'VALIDATED'
  ) {
    // Dispatché mais pas encore accepté
    return 'attribuee_en_attente_acceptation';
  }
  if (customerOrderStatus === 'IN_PROGRESSION') {
    // Commande en cours — statut_tms reste 'acceptee' ; 'en_cours' collecte via M1.5c
    return 'acceptee';
  }
  if (MTS1_SUCCESS_STATUSES.has(customerOrderStatus)) {
    // Terminal avec pesées — statut 'realisee' posé par agrégation M1.5c
    return 'acceptee';
  }
  // DRAFT, QUOTE, ARCHIVED — avant tout dispatch
  return 'attribuee_en_attente_acceptation';
}

/**
 * Reflète fn_sync_statut_collecte_from_tms (trigger DB).
 * Retourne le nouveau statut dérivé, ou null si pas de transition.
 *
 * Les transitions en_cours et realisee sont gérées par M1.5c (agrégation terminale),
 * pas par ce trigger.
 */
export function deriveStatutFromStatutTms(
  statutTms: StatutTmsEnum,
  currentStatut: CollecteStatutEnum,
): CollecteStatutEnum | null {
  if (
    (statutTms === 'acceptee' || statutTms === 'en_attente_execution') &&
    currentStatut === 'programmee'
  ) {
    return 'validee';
  }
  if (
    (statutTms === 'non_envoye' ||
      statutTms === 'a_attribuer' ||
      statutTms === 'attribuee_en_attente_acceptation') &&
    currentStatut === 'validee'
  ) {
    return 'programmee';
  }
  return null;
}
