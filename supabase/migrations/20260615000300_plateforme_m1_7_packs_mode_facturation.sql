-- M1.7 fix : ajouter mode_facturation à packs_antgaspi
-- Colonne présente dans le DDL cible V2 (schema_cible_v2.sql).
-- Utilisée par le batch J+1 pour éviter de créer des brouillons FAG
-- pour les packs en mode globale_achat (couvert par le FPK).

ALTER TABLE plateforme.packs_antgaspi
  ADD COLUMN IF NOT EXISTS mode_facturation text
    NOT NULL DEFAULT 'par_collecte'
    CHECK (mode_facturation IN ('globale_achat', 'par_collecte'));
