/**
 * Interrupteur de la facturation sur la plateforme (décision Val 2026-10-22).
 *
 * Éteint pour le go-live : la facturation se fait hors plateforme. Éteint, il :
 * - masque aux clients (traiteur, agence, gestionnaire de lieux) leurs factures
 *   et le badge « collectes en attente de facturation » du traiteur ;
 * - retire de l'email récapitulatif de programmation la ligne du tarif ZD ;
 * - empêche le traitement de nuit de préparer des brouillons de facture.
 *
 * Il ne touche pas au back-office Admin (pages Factures, tarifs, packs), ni à
 * l'entité de facturation et son SIRET (requis pour l'attestation de don AG),
 * ni aux phrases qui disent au client comment Savr le facture.
 *
 * Rallumer = rendre `true`, après les préalables de la fiche de divergence
 * `M1.7_20261022_facturation-hors-plateforme-go-live` (date de départ du
 * traitement de nuit, numérotation, contrat Pennylane).
 */
export function facturationPlateformeActive(): boolean {
  return false;
}
