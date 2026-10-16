/**
 * Lien transporteur → prestataire logistique (pont V1
 * `transporteurs.prestataire_logistique_id`, décision Val 2026-06-25).
 *
 * Les adapters reconnaissent les tournées d'un provider par ce lien et par lui
 * seul (`prestatairesDuType`, #327). Il n'est plus choisi à l'écran : pour un
 * transporteur routé vers un adapter, la base crée la fiche prestataire du même
 * nom et pose le lien à l'insertion (trg_transporteur_prestataire_auto,
 * décision Val 2026-10-16).
 *
 * Le lien et le type sont posés à la création et JAMAIS modifiables ensuite
 * (arbitrage Val 2026-09-16) : garde en base `trg_transporteur_cols_immuables`,
 * quel que soit le chemin. Pour en changer, créer un nouveau transporteur.
 */

/** Colonnes refusées par le PATCH : posées à la création, jamais modifiées. */
export const COLONNES_IMMUABLES = [
  'type_tms',
  'prestataire_logistique_id',
] as const;
