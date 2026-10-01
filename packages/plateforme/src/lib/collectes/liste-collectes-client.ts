import { rapportReserveDonneurOrdre } from './fiche-client-types.js';

// Ligne brute renvoyée par les routes liste Collectes client (traiteur, agence) :
// embeds `collecte_flux` et `attributions_antgaspi` à agréger, `evenements` à
// lire pour les indicateurs.
type LigneBrute = {
  type: string;
  statut: string;
  evenements: unknown;
  collecte_flux?: { poids_reel_kg: number | null }[] | null;
  attributions_antgaspi?:
    | { volume_repas_realise: number | null }
    | { volume_repas_realise: number | null }[]
    | null;
} & Record<string, unknown>;

/**
 * Champs calculés de la liste Collectes client (§06.04 §3, repris à l'identique
 * par §06.11) — un seul calcul pour le traiteur et l'agence :
 *  - `programmee_par_tiers` : l'appelant est traiteur opérationnel d'un événement
 *    programmé par une autre organisation (toujours faux côté agence) ;
 *  - `rapport_reserve_donneur_ordre` : même règle que la fiche (D12) ;
 *  - résultats de la collecte réalisée — poids ZD (Σ `collecte_flux`) et repas AG
 *    (Σ `attributions_antgaspi`), mêmes sources que la fiche et les dashboards.
 * Les embeds bruts ne sont pas renvoyés au client (la liste n'en lit que les
 * agrégats ; `undefined` disparaît à la sérialisation JSON).
 */
export function enrichirLignesCollectes(
  data: unknown[] | null,
  organisationId: string,
) {
  return ((data ?? []) as LigneBrute[]).map((c) => {
    const evt = (
      Array.isArray(c.evenements) ? c.evenements[0] : c.evenements
    ) as
      | {
          organisation_id: string;
          traiteur_operationnel_organisation_id: string | null;
        }
      | undefined;
    const programmeeParTiers =
      evt?.traiteur_operationnel_organisation_id === organisationId &&
      evt?.organisation_id !== organisationId;
    const poidsTotalKg = (c.collecte_flux ?? []).reduce(
      (s, f) => s + (f.poids_reel_kg ?? 0),
      0,
    );
    // Attribution unique par collecte : somme défensive alignée sur les loaders
    // dashboards.
    const attrs = Array.isArray(c.attributions_antgaspi)
      ? c.attributions_antgaspi
      : c.attributions_antgaspi
        ? [c.attributions_antgaspi]
        : [];
    const nbRepasDonnes = attrs.reduce(
      (s, a) => s + (a.volume_repas_realise ?? 0),
      0,
    );
    return {
      ...c,
      collecte_flux: undefined,
      attributions_antgaspi: undefined,
      programmee_par_tiers: programmeeParTiers,
      // La liste n'offre pas un téléchargement que la route refuserait (404).
      rapport_reserve_donneur_ordre: rapportReserveDonneurOrdre(
        c,
        evt?.organisation_id,
        organisationId,
      ),
      poids_total_kg: poidsTotalKg,
      nb_repas_donnes: nbRepasDonnes,
    };
  });
}
