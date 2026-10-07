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
-- Garde-fou 1 : colonne absente de §04 et du DDL cible V2 (dérivé non régénéré).
-- Divergence tracée dans _Divergences/BOA-LOGISTIQUE_20261001.md. Classement
-- tranché par Val (2026-10-01) : colonne V1-only, dormante en V2 (comme
-- nb_camions_demande, liste fermée du garde-fou 1) — à ajouter à cette liste
-- lors du prochain patch du Vault ; volontairement hors
-- v1-divergences-allowlist.txt (dérivé), signalée par le gate schema-vs-cible en
-- mode rapport d'ici là.
-- Aucune policy RLS modifiée (colonne couverte par les policies de `collectes` ;
-- écritures déjà fermées à authenticated depuis 20260915160000).
-- Ordre de déploiement : le worker lit la colonne par une requête TOLÉRANTE
-- (colonne absente → null + warn), la fiche par select('*') — le code peut donc
-- partir avant ou après cette migration sans mettre d'event en DLQ.
--
-- ROLLBACK (additif, aucune donnée existante touchée) : retirer la colonne
-- `type_vehicule_souhaite` (opération inverse de l'ADD COLUMN ci-dessous) dans
-- une migration ULTÉRIEURE dédiée, après 1 release sans usage (CLAUDE.md §2).
-- Ordre : 1) retirer du code l'écriture (route attributions-ag/[collecteId]/valider)
-- et la lecture (outbox-worker.ts) ; 2) puis la colonne. Aucun index, FK, vue ni
-- trigger ne la référence ; les valeurs perdues sont un choix Admin ressaisissable.
-- SQL de rollback volontairement non littéral : le garde CI anti-destructif est
-- un grep textuel qui ne distingue pas commentaire et code.
-- =============================================================================

ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS type_vehicule_souhaite plateforme.type_vehicule;

COMMENT ON COLUMN plateforme.collectes.type_vehicule_souhaite IS
  'Type de véhicule souhaité par l''Admin à l''attribution (AG). Transmis au prestataire dans le canal libre des adapters (commentaire de commande). Nullable = non précisé. Décision Val 2026-10-01.';
