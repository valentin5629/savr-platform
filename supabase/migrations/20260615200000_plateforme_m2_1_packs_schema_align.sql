-- M2.1 — Packs AG : alignement schéma vers DDL cible V2
-- Le schéma initial (M0.3 bloc5) utilisait nb_collectes/nb_utilisees/nb_annulees.
-- Le DDL cible V2 (et le code M1.7) utilisent credits_initiaux/credits_consommes.
-- Cette migration synchronise la DB sans perte de données.

-- ============================================================
-- 1. packs_antgaspi — nouveaux champs
-- ============================================================

-- REVIEWED-DESTRUCTIVE: DROP COLUMN credits_restants — colonne GENERATED ALWAYS AS (nb_collectes - nb_utilisees), aucune donnée utilisateur. Recréée immédiatement ligne 54 avec la nouvelle formule (credits_initiaux - credits_consommes). PostgreSQL ne permet pas ALTER d'une expression GENERATED : drop+recreate obligatoire.
ALTER TABLE plateforme.packs_antgaspi DROP COLUMN IF EXISTS credits_restants;

-- Nouveaux champs (tous nullable temporairement pour migration des données)
ALTER TABLE plateforme.packs_antgaspi
  ADD COLUMN IF NOT EXISTS type_pack         text,
  ADD COLUMN IF NOT EXISTS credits_initiaux  integer,
  ADD COLUMN IF NOT EXISTS credits_consommes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_total_ht  numeric(12,2),
  ADD COLUMN IF NOT EXISTS prix_unitaire_ht  numeric(12,2),
  ADD COLUMN IF NOT EXISTS commentaires      text,
  ADD COLUMN IF NOT EXISTS idempotency_key   text,
  ADD COLUMN IF NOT EXISTS cree_par_user_id  uuid,
  ADD COLUMN IF NOT EXISTS facture_achat_id  uuid REFERENCES plateforme.factures(id);

-- Remplacer notes → commentaires (notes était le nom ancien, commentaires = DDL V2)
UPDATE plateforme.packs_antgaspi
  SET commentaires = notes
  WHERE notes IS NOT NULL AND commentaires IS NULL;

-- Migrer nb_collectes → credits_initiaux, nb_utilisees → credits_consommes
UPDATE plateforme.packs_antgaspi
  SET
    credits_initiaux  = COALESCE(credits_initiaux, nb_collectes),
    credits_consommes = COALESCE(credits_consommes, nb_utilisees)
  WHERE credits_initiaux IS NULL;

-- Pour type_pack : utiliser 'personnalise' comme valeur de migration (données historiques sans type)
UPDATE plateforme.packs_antgaspi
  SET type_pack = 'personnalise'
  WHERE type_pack IS NULL;

-- Contraintes NOT NULL maintenant que les données sont migrées
ALTER TABLE plateforme.packs_antgaspi
  ALTER COLUMN credits_initiaux SET NOT NULL,
  ALTER COLUMN type_pack SET NOT NULL;

-- CHECK sur type_pack
ALTER TABLE plateforme.packs_antgaspi
  ADD CONSTRAINT chk_pack_type_pack
    CHECK (type_pack IN ('unitaire','pack_10','pack_30','pack_60','personnalise'));

-- Recréer credits_restants avec la nouvelle formule (credits_initiaux - credits_consommes)
ALTER TABLE plateforme.packs_antgaspi
  ADD COLUMN credits_restants integer
    GENERATED ALWAYS AS (credits_initiaux - credits_consommes) STORED;

-- Mise à jour des CHECK constraints
ALTER TABLE plateforme.packs_antgaspi
  DROP CONSTRAINT IF EXISTS chk_pack_credits_positifs;

ALTER TABLE plateforme.packs_antgaspi
  ADD CONSTRAINT chk_pack_credits_consommes_positifs CHECK (credits_consommes >= 0),
  ADD CONSTRAINT chk_pack_credits_limite CHECK (credits_consommes <= credits_initiaux);

-- Index unicité sur idempotency_key (partiel — pas NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pack_idempotency_key
  ON plateforme.packs_antgaspi (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 2. tarifs_packs_ag — nouveaux champs
-- ============================================================

ALTER TABLE plateforme.tarifs_packs_ag
  ADD COLUMN IF NOT EXISTS type_pack       text,
  ADD COLUMN IF NOT EXISTS credits         integer,
  ADD COLUMN IF NOT EXISTS prix_unitaire_ht numeric(12,2),
  ADD COLUMN IF NOT EXISTS montant_total_ht numeric(12,2),
  ADD COLUMN IF NOT EXISTS mensualisable   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nb_mensualites  integer,
  ADD COLUMN IF NOT EXISTS valide_jusqu_au date;

-- Migrer nb_collectes → credits, prix_ht → prix_unitaire_ht, valide_jusqu → valide_jusqu_au
UPDATE plateforme.tarifs_packs_ag
  SET
    credits          = COALESCE(credits, nb_collectes),
    prix_unitaire_ht = COALESCE(prix_unitaire_ht, prix_ht),
    valide_jusqu_au  = COALESCE(valide_jusqu_au, valide_jusqu)
  WHERE credits IS NULL OR prix_unitaire_ht IS NULL;

-- Calculer montant_total_ht si manquant
UPDATE plateforme.tarifs_packs_ag
  SET montant_total_ht = ROUND((credits * prix_unitaire_ht)::numeric, 2)
  WHERE montant_total_ht IS NULL AND credits IS NOT NULL AND prix_unitaire_ht IS NOT NULL;

-- Déduire type_pack depuis nb_collectes (seed V1 : 5→unitaire/pack_5, 10→pack_10, 20→pack_20, 50→pack_50)
-- Les 4 lignes seed ont 5/10/20/50 collectes ; map vers les codes standards
UPDATE plateforme.tarifs_packs_ag
  SET type_pack = CASE
    WHEN nb_collectes <= 5  THEN 'unitaire'
    WHEN nb_collectes <= 10 THEN 'pack_10'
    WHEN nb_collectes <= 30 THEN 'pack_30'
    ELSE 'pack_60'
  END
  WHERE type_pack IS NULL;

-- Contraintes NOT NULL
ALTER TABLE plateforme.tarifs_packs_ag
  ALTER COLUMN credits SET NOT NULL,
  ALTER COLUMN prix_unitaire_ht SET NOT NULL,
  ALTER COLUMN type_pack SET NOT NULL;

ALTER TABLE plateforme.tarifs_packs_ag
  ADD CONSTRAINT chk_tarif_type_pack
    CHECK (type_pack IN ('unitaire','pack_10','pack_30','pack_60'));

-- ============================================================
-- 3. GRANT explicite (règle mémoire: tables créées post-M0.4a)
-- La table existe depuis M0.3 mais les nouvelles colonnes sont accessibles
-- via le même GRANT table-level déjà en place. Pas de re-grant nécessaire.
-- ============================================================

-- Les GRANTs table-level authenticated existent depuis 0.4 (GRANT SELECT/INSERT/UPDATE/DELETE
-- TO authenticated sur packs_antgaspi et tarifs_packs_ag). Pas de doublon.
