-- R19 / BL-P1-TRAIT-02 — colonne téléphone sur plateforme.users.
-- =============================================================================
-- CDC §06.04 §7 « Mon profil » : « Informations personnelles : prénom, nom,
-- email, téléphone ». La table `plateforme.users` n'avait aucune colonne
-- `telephone` (seule `organisations.telephone` existait) → GET/PATCH /api/me/profil
-- référençait une colonne fantôme (bug P0 transverse détecté en revue conformité).
-- Ajout backward-compatible (nullable, aucune valeur par défaut).
--
-- ⚠ Divergence DDL cible (garde-fou 1) : `plateforme.users.telephone` est absente
-- du DDL cible V2 gelé et de la liste fermée des colonnes V1-only de la Frontière
-- TMS-Ready. C'est une OMISSION du DDL cible (le CDC §06.04 §7 mandate ce champ) →
-- convergence V2 attendue. Tracée dans _Divergences/M3.1_20260705_users_telephone.md.
-- =============================================================================

ALTER TABLE plateforme.users
  ADD COLUMN IF NOT EXISTS telephone text;
