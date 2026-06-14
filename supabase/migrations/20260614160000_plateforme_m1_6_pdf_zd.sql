-- Migration M1.6 — Génération PDF ZD
-- Aligne jobs_pdf avec V2, étend bordereaux_savr + rapports_rse,
-- ajoute les enums manquants, la numérotation BSAV, la table alertes_admin.

-- ============================================================
-- 1. Nouveaux enums
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.genere_par AS ENUM ('automatique','manuel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.bordereau_statut AS ENUM ('brouillon','emis','corrige','annule');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (ADD VALUE déplacés dans 20260614155900 — doivent être dans une tx séparée)

-- ============================================================
-- 2. Aligner jobs_pdf avec V2
-- ============================================================

-- Renommages colonnes (aucun code existant ne les référence)
ALTER TABLE plateforme.jobs_pdf RENAME COLUMN tentatives         TO attempts;
ALTER TABLE plateforme.jobs_pdf RENAME COLUMN prochaine_tentative_at TO next_retry_at;
ALTER TABLE plateforme.jobs_pdf RENAME COLUMN resultat_fichier_id TO fichier_id;
ALTER TABLE plateforme.jobs_pdf RENAME COLUMN erreur_detail      TO last_error;

-- Payload JSON pour les données du template PDF
ALTER TABLE plateforme.jobs_pdf ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';

-- ============================================================
-- 3. Étendre bordereaux_savr (colonnes manquantes vs V2)
-- ============================================================

-- Conversion du statut : document_statut_enum → bordereau_statut
ALTER TABLE plateforme.bordereaux_savr DROP COLUMN IF EXISTS statut;
ALTER TABLE plateforme.bordereaux_savr
  ADD COLUMN statut plateforme.bordereau_statut NOT NULL DEFAULT 'brouillon';

-- Colonnes snapshot (nullable : toujours renseignées par le batch INSERT)
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS numero                          text UNIQUE;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS date_emission                   date;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS date_collecte                   date;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS producteur_entite_facturation_id uuid REFERENCES plateforme.entites_facturation(id);
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS producteur_raison_sociale       text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS producteur_siret                text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS producteur_adresse              text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS transporteur_nom                text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS transporteur_siret              text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS exutoire_nom                    text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS exutoire_adresse                text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS exutoire_siret                  text;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS detail_flux                     jsonb;
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS poids_total_kg                  numeric(10,3);
ALTER TABLE plateforme.bordereaux_savr ADD COLUMN IF NOT EXISTS version                         integer NOT NULL DEFAULT 1;

-- ============================================================
-- 4. Étendre rapports_rse
-- ============================================================

ALTER TABLE plateforme.rapports_rse ADD COLUMN IF NOT EXISTS genere_par plateforme.genere_par;

-- ============================================================
-- 5. Table alertes_admin (V1-only : in-app alerts pour Admin)
-- Pas de TMS.alertes en V1. Sera mergé ou remplacé en V2.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.alertes_admin (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  titre       text        NOT NULL,
  message     text,
  entity_type text,
  entity_id   uuid,
  statut      text        NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','resolue')),
  resolue_at  timestamptz,
  resolue_par_user_id uuid REFERENCES plateforme.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alertes_admin_ouverte
  ON plateforme.alertes_admin (code, entity_type, entity_id)
  WHERE statut = 'ouverte';

ALTER TABLE plateforme.alertes_admin ENABLE ROW LEVEL SECURITY;

-- Admin voit tout, peut résoudre (JWT claim pour éviter le JOIN récursif sur users)
CREATE POLICY aa_admin ON plateforme.alertes_admin
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'role') = 'admin_savr')
  WITH CHECK ((auth.jwt() ->> 'role') = 'admin_savr');

-- ============================================================
-- 6. Mettre à jour la vue ops jobs_pdf (colonnes renommées)
-- ============================================================

-- DROP nécessaire : CREATE OR REPLACE VIEW ne peut pas renommer les colonnes
DROP VIEW IF EXISTS plateforme.v_ops_jobs_pdf;
CREATE VIEW plateforme.v_ops_jobs_pdf AS
SELECT
  COUNT(*) FILTER (WHERE statut IN ('pending','queued'))   AS nb_pending,
  COUNT(*) FILTER (WHERE statut = 'failed')                AS nb_failed,
  COUNT(*) FILTER (WHERE statut = 'dead')                  AS nb_dead,
  MAX(attempts) FILTER (WHERE statut IN ('failed','dead')) AS max_attempts,
  MIN(created_at) FILTER (WHERE statut IN ('pending','queued','failed')) AS plus_ancien_at
FROM plateforme.jobs_pdf;

-- ============================================================
-- 7. Fonction gapless numérotation bordereau BSAV-YYYY-NNNNN
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.f_next_numero_bordereau(
  p_annee smallint DEFAULT EXTRACT(YEAR FROM now())::smallint
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier)
  VALUES ('BSAV', p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier    = plateforme.sequences_facturation.dernier + 1,
        updated_at = now()
  RETURNING dernier INTO v_next;

  RETURN 'BSAV-' || p_annee::text || '-' || LPAD(v_next::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.f_next_numero_bordereau TO service_role;

-- ============================================================
-- 8. Fonction helper : insérer une alerte_admin dédupliquée
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.f_upsert_alerte_admin(
  p_code        text,
  p_titre       text,
  p_message     text,
  p_entity_type text,
  p_entity_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Pas de doublon : si une alerte ouverte identique existe, skip
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.alertes_admin
    WHERE code        = p_code
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id
      AND statut      = 'ouverte'
  ) THEN
    INSERT INTO plateforme.alertes_admin (code, titre, message, entity_type, entity_id)
    VALUES (p_code, p_titre, p_message, p_entity_type, p_entity_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.f_upsert_alerte_admin TO service_role;

-- ============================================================
-- 9. Index supplémentaires
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_bordereaux_savr_collecte_statut
  ON plateforme.bordereaux_savr (collecte_id, statut);

CREATE INDEX IF NOT EXISTS idx_rapports_rse_collecte_disponible
  ON plateforme.rapports_rse (collecte_id, disponible_a);

-- Anti-double-queue : un seul job actif par (entité, type_document)
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_pdf_anti_dupe
  ON plateforme.jobs_pdf (entity_type, entity_id, type_document)
  WHERE statut IN ('pending', 'processing');
