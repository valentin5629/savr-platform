-- Ajout colonne organisations.mode_facturation_zd (migration manquante).
-- Spec : §04 Data Model — colonne décidée par Val 2026-06-14, DDL fournie, mais la
--        migration n'avait jamais été écrite (le batch brouillons J+1 la lit déjà :
--        packages/plateforme/src/lib/facturation/batch-brouillons.ts).
-- Sémantique : préférence de facturation ZD par organisation programmante —
--   `par_collecte` (défaut) = 1 brouillon par collecte ZD cloturée ;
--   `mensuelle`            = collectes ZD du mois agrégées en 1 brouillon mensuel.
-- Backward-compatible : ADD COLUMN NOT NULL DEFAULT (les orgas existantes héritent
--   de `par_collecte`). Pas de nouvelle policy RLS ni GRANT (colonne sur table existante).

DO $$ BEGIN
  CREATE TYPE plateforme.mode_facturation_zd_enum AS ENUM ('par_collecte', 'mensuelle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE plateforme.organisations
  ADD COLUMN IF NOT EXISTS mode_facturation_zd plateforme.mode_facturation_zd_enum
    NOT NULL DEFAULT 'par_collecte';
