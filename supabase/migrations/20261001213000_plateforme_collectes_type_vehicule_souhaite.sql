-- =============================================================================
-- plateforme.collectes.type_vehicule_souhaite — véhicule demandé par l'Admin
-- =============================================================================
-- Décision Val 2026-10-01 (revue écran fiche collecte AG, onglet Logistique) :
-- l'attribution AG est intégrée à la fiche et l'Admin y choisit, à côté du
-- nombre de véhicules (`nb_camions_demande`, existant), le TYPE de véhicule
-- souhaité. Aucune colonne ne portait cette information : elle n'était ni
-- stockée ni transmise au prestataire.
--
-- Wire V1 : aucune des deux API prestataires n'expose de champ natif « type de
-- véhicule » dans son payload de commande (l'une ne porte un gabarit que par un
-- article ZD, l'autre fixe le service vélo/camion par la branche de l'algo).
-- La valeur part donc dans le canal libre routé vers les deux adapters
-- (`logistique_provider`), composé UNE fois par
-- `composerInformationsSupplementaires` (garde-fou 2), comme les informations
-- d'accès (arbitrage Val 2026-09-15). N véhicules = N commandes identiques
-- (1 dispatch par rang).
--
-- Même enum que `lieux.type_vehicule_max` et `tournees.type_vehicule`
-- (plateforme.type_vehicule : velo_cargo, camionnette, fourgon, vul, poids_lourd).
-- Nullable : une collecte programmée sans précision reste valide (backward-compatible).
-- Colonne V1-only : à tracer dans _Divergences/ (BOA-LOGISTIQUE_20261001) et à
-- reporter au DDL cible V2 lors de la prochaine régénération.
-- Aucune policy RLS modifiée (colonne couverte par les policies de `collectes`).
-- =============================================================================

ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS type_vehicule_souhaite plateforme.type_vehicule;

COMMENT ON COLUMN plateforme.collectes.type_vehicule_souhaite IS
  'Type de véhicule souhaité par l''Admin à l''attribution (AG). Transmis au prestataire dans le canal libre des adapters (commentaire de commande). Nullable = non précisé. Décision Val 2026-10-01.';
