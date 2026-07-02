-- R17b (décision Val 2026-07-02) — Type de TMS : ajouter « par mail » et « par
-- téléphone » (transporteurs hors TMS, validation de course MANUELLE par l'Admin).
-- On CONSERVE 'autre' (rétro-compat) — décision Val « garder Autre + ajouter les 2 ».
--
-- ⚠ Migration ISOLÉE : ALTER TYPE ... ADD VALUE ne peut pas être suivi, dans la
-- même transaction, d'un usage de la nouvelle valeur. Les fonctions qui routent
-- sur type_tms (dispatch R5) sont mises à jour dans une migration ULTÉRIEURE
-- (20260702020200), donc après le commit de celle-ci.

-- NB : l'enum a été renommé `type_tms_enum` → `type_tms` (convergence noms cible,
-- migration 20260623100000). Le nom courant est `plateforme.type_tms`.
ALTER TYPE plateforme.type_tms ADD VALUE IF NOT EXISTS 'par_mail';
ALTER TYPE plateforme.type_tms ADD VALUE IF NOT EXISTS 'par_telephone';
