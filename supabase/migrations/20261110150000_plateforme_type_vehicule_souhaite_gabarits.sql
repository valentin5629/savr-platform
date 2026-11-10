-- =============================================================================
-- plateforme.type_vehicule : trois gabarits ajoutés pour le véhicule souhaité
-- =============================================================================
-- Décision Val 2026-11-10 (revue écran fiche collecte Admin, onglet Logistique) :
-- le menu « Type de véhicule souhaité » propose Vélo cargo, Camion frigo,
-- Camion 16 m³ et Camion 20 m³, et le type part chez le transporteur dès un
-- véhicule, en ZD comme en AG (commentaire de commande, infos-acces.ts).
--
-- Ajout seul : aucune valeur retirée (des lieux, transporteurs, tournées et
-- collectes portent les anciennes). Les trois valeurs se placent après
-- `poids_lourd` : l'ordre de l'enum sert d'échelle de taille à l'algorithme AG
-- (véhicule du transporteur ≤ `lieux.type_vehicule_max`), et ni les lieux ni les
-- transporteurs ne peuvent les recevoir (leurs menus gardent les cinq gabarits
-- d'origine) : l'algorithme ne les rencontre pas.
--
-- Garde-fou 1 : valeurs absentes du DDL cible V2 (§04). Divergence tracée dans
-- _Divergences/BOA-LOGISTIQUE_20261110.md.
--
-- ADD VALUE : la nouvelle valeur ne peut pas servir dans la même transaction
-- (PG 55P04) ; cette migration ne fait que l'ajouter.
--
-- ROLLBACK : PostgreSQL ne retire pas une valeur d'enum. Sans usage, les valeurs
-- restent inertes ; l'application cesse de les proposer en retirant les options
-- de `champs-besoin-vehicule.tsx`.
-- =============================================================================

ALTER TYPE plateforme.type_vehicule ADD VALUE IF NOT EXISTS 'camion_frigo';
ALTER TYPE plateforme.type_vehicule ADD VALUE IF NOT EXISTS 'camion_16m3';
ALTER TYPE plateforme.type_vehicule ADD VALUE IF NOT EXISTS 'camion_20m3';
