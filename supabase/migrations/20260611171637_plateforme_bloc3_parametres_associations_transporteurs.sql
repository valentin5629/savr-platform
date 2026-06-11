-- Module 0.3 — Bloc 3 : Paramètres, Associations, Transporteurs
-- parametres_taux_recyclage + history, parametres_facteurs_co2 + history,
-- parametres_mix_emballages + history, parametres_co2_divers,
-- parametres_facteurs_co2_ag + history, parametres_algo,
-- coefficients_perte_labo, associations, transporteurs
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 3
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.code_filiere_recyclage_enum AS ENUM (
    'verre', 'carton', 'biodechet', 'emballage'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.code_flux_co2_enum AS ENUM (
    'verre', 'carton', 'biodechet', 'emballage', 'dechet_residuel'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.code_materiau_emballage_enum AS ENUM (
    'carton_papier', 'pet', 'pehd', 'acier', 'alu', 'briques', 'autres'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.type_tms_enum AS ENUM ('mts1', 'a_toutes', 'autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- plateforme.parametres_taux_recyclage
-- Taux de captation par filière ZD (4 lignes V1).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_taux_recyclage (
  id              uuid                                    PRIMARY KEY DEFAULT gen_random_uuid(),
  code_filiere    plateforme.code_filiere_recyclage_enum  NOT NULL UNIQUE,
  nom_filiere     text                                    NOT NULL,
  taux_captation  decimal(5,4)                            NOT NULL
                    CHECK (taux_captation >= 0 AND taux_captation <= 1),
  prestataire     text,
  source_donnee   text,
  commentaire     text,
  actif           boolean                                 NOT NULL DEFAULT true,
  date_maj        timestamptz                             NOT NULL DEFAULT now(),
  created_at      timestamptz                             NOT NULL DEFAULT now(),
  updated_at      timestamptz                             NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_taux_recyclage ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.parametres_taux_recyclage_history
-- Audit trail des modifications de taux de captation.
-- Insertion uniquement via trigger DB.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_taux_recyclage_history (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id          uuid         NOT NULL REFERENCES plateforme.parametres_taux_recyclage(id),
  code_filiere          plateforme.code_filiere_recyclage_enum NOT NULL,
  taux_captation_avant  decimal(5,4) NOT NULL,
  taux_captation_apres  decimal(5,4) NOT NULL,
  prestataire_avant     text,
  prestataire_apres     text,
  source_donnee_avant   text,
  source_donnee_apres   text,
  commentaire_modif     text         NOT NULL,
  modifie_par           uuid         NOT NULL REFERENCES plateforme.users(id),
  modifie_le            timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ptr_history_parametre
  ON plateforme.parametres_taux_recyclage_history (parametre_id);

ALTER TABLE plateforme.parametres_taux_recyclage_history ENABLE ROW LEVEL SECURITY;

-- Trigger audit taux recyclage
CREATE OR REPLACE FUNCTION plateforme.fn_audit_taux_recyclage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.taux_captation IS DISTINCT FROM NEW.taux_captation
    OR OLD.prestataire IS DISTINCT FROM NEW.prestataire
    OR OLD.source_donnee IS DISTINCT FROM NEW.source_donnee) THEN
    INSERT INTO plateforme.parametres_taux_recyclage_history (
      parametre_id, code_filiere,
      taux_captation_avant, taux_captation_apres,
      prestataire_avant, prestataire_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.code_filiere,
      OLD.taux_captation, NEW.taux_captation,
      OLD.prestataire, NEW.prestataire,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = auth.uid()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_taux_recyclage
  AFTER UPDATE ON plateforme.parametres_taux_recyclage
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_taux_recyclage();

-- ============================================================
-- plateforme.parametres_facteurs_co2
-- Facteurs d'émission CO₂ par flux ZD (5 lignes V1).
-- Ligne 'emballage' maintenue par trigger depuis parametres_mix_emballages.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_facteurs_co2 (
  id                            uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  code_flux                     plateforme.code_flux_co2_enum   NOT NULL UNIQUE,
  nom_flux                      text                            NOT NULL,
  fe_induit_kg_t                decimal(8,2)                    NOT NULL CHECK (fe_induit_kg_t >= 0),
  fe_evite_kg_t                 decimal(8,2)                    NOT NULL CHECK (fe_evite_kg_t >= 0),
  energie_primaire_evitee_kwh_t decimal(10,2)                   NOT NULL DEFAULT 0,
  source_donnee                 text,
  commentaire                   text,
  actif                         boolean                         NOT NULL DEFAULT true,
  date_maj                      timestamptz                     NOT NULL DEFAULT now(),
  created_at                    timestamptz                     NOT NULL DEFAULT now(),
  updated_at                    timestamptz                     NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_facteurs_co2 ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.parametres_facteurs_co2_history
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_facteurs_co2_history (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id        uuid         NOT NULL REFERENCES plateforme.parametres_facteurs_co2(id),
  code_flux           plateforme.code_flux_co2_enum NOT NULL,
  fe_induit_avant     decimal(8,2) NOT NULL,
  fe_induit_apres     decimal(8,2) NOT NULL,
  fe_evite_avant      decimal(8,2) NOT NULL,
  fe_evite_apres      decimal(8,2) NOT NULL,
  energie_avant       decimal(10,2),
  energie_apres       decimal(10,2),
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif   text         NOT NULL,
  modifie_par         uuid         NOT NULL REFERENCES plateforme.users(id),
  modifie_le          timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfc_history_parametre
  ON plateforme.parametres_facteurs_co2_history (parametre_id);

ALTER TABLE plateforme.parametres_facteurs_co2_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION plateforme.fn_audit_facteurs_co2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.fe_induit_kg_t IS DISTINCT FROM NEW.fe_induit_kg_t
    OR OLD.fe_evite_kg_t IS DISTINCT FROM NEW.fe_evite_kg_t
    OR OLD.energie_primaire_evitee_kwh_t IS DISTINCT FROM NEW.energie_primaire_evitee_kwh_t) THEN
    INSERT INTO plateforme.parametres_facteurs_co2_history (
      parametre_id, code_flux,
      fe_induit_avant, fe_induit_apres,
      fe_evite_avant, fe_evite_apres,
      energie_avant, energie_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.code_flux,
      OLD.fe_induit_kg_t, NEW.fe_induit_kg_t,
      OLD.fe_evite_kg_t, NEW.fe_evite_kg_t,
      OLD.energie_primaire_evitee_kwh_t, NEW.energie_primaire_evitee_kwh_t,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = auth.uid()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_facteurs_co2
  AFTER UPDATE ON plateforme.parametres_facteurs_co2
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_facteurs_co2();

-- ============================================================
-- plateforme.parametres_mix_emballages
-- Composition du flux emballages par matériau (7 lignes V1).
-- Trigger : recalcule la ligne 'emballage' de parametres_facteurs_co2.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_mix_emballages (
  id              uuid                                      PRIMARY KEY DEFAULT gen_random_uuid(),
  code_materiau   plateforme.code_materiau_emballage_enum   NOT NULL UNIQUE,
  nom_materiau    text                                      NOT NULL,
  part_pct        decimal(5,2)                              NOT NULL
                    CHECK (part_pct >= 0 AND part_pct <= 100),
  fe_induit_kg_t  decimal(8,2)                              NOT NULL CHECK (fe_induit_kg_t >= 0),
  fe_evite_kg_t   decimal(8,2)                              NOT NULL CHECK (fe_evite_kg_t >= 0),
  source_donnee   text,
  commentaire     text,
  actif           boolean                                   NOT NULL DEFAULT true,
  date_maj        timestamptz                               NOT NULL DEFAULT now(),
  created_at      timestamptz                               NOT NULL DEFAULT now(),
  updated_at      timestamptz                               NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_mix_emballages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.parametres_mix_emballages_history
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_mix_emballages_history (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id        uuid         NOT NULL REFERENCES plateforme.parametres_mix_emballages(id),
  code_materiau       plateforme.code_materiau_emballage_enum NOT NULL,
  part_pct_avant      decimal(5,2) NOT NULL,
  part_pct_apres      decimal(5,2) NOT NULL,
  fe_induit_avant     decimal(8,2) NOT NULL,
  fe_induit_apres     decimal(8,2) NOT NULL,
  fe_evite_avant      decimal(8,2) NOT NULL,
  fe_evite_apres      decimal(8,2) NOT NULL,
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif   text         NOT NULL,
  modifie_par         uuid         NOT NULL REFERENCES plateforme.users(id),
  modifie_le          timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_mix_emballages_history ENABLE ROW LEVEL SECURITY;

-- Trigger validation : Σ part_pct (actifs) doit = 100 (tolérance 0.05)
CREATE OR REPLACE FUNCTION plateforme.fn_validate_mix_emballages()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total decimal;
BEGIN
  SELECT COALESCE(SUM(part_pct), 0)
    INTO total
    FROM plateforme.parametres_mix_emballages
    WHERE actif = true
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  total := total + CASE WHEN NEW.actif THEN NEW.part_pct ELSE 0 END;
  IF ABS(total - 100) > 0.05 THEN
    RAISE EXCEPTION 'La somme des parts du mix emballages doit être 100 %% (actuelle : %)', total;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_mix_emballages
  BEFORE INSERT OR UPDATE ON plateforme.parametres_mix_emballages
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_validate_mix_emballages();

-- Trigger recalcul FE emballage dans parametres_facteurs_co2
CREATE OR REPLACE FUNCTION plateforme.fn_recompute_emballage_fe()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_induit decimal(8,2);
  new_evite  decimal(8,2);
BEGIN
  SELECT
    ROUND(SUM(part_pct / 100.0 * fe_induit_kg_t), 2),
    ROUND(SUM(part_pct / 100.0 * fe_evite_kg_t), 2)
  INTO new_induit, new_evite
  FROM plateforme.parametres_mix_emballages
  WHERE actif = true;

  UPDATE plateforme.parametres_facteurs_co2
  SET fe_induit_kg_t = COALESCE(new_induit, 0),
      fe_evite_kg_t  = COALESCE(new_evite, 0),
      updated_at     = now()
  WHERE code_flux = 'emballage';

  -- Insérer history si les FE ont changé (le trigger fn_audit_facteurs_co2 s'en charge)
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recompute_emballage_fe
  AFTER INSERT OR UPDATE OR DELETE ON plateforme.parametres_mix_emballages
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_recompute_emballage_fe();

-- ============================================================
-- plateforme.parametres_co2_divers
-- Clé-valeur : forfait collecte + équivalences pédagogiques.
-- Audité via audit_log (pas de table history dédiée — sobriété).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_co2_divers (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  cle           text         NOT NULL UNIQUE,
  valeur        decimal(12,4) NOT NULL,
  unite         text         NOT NULL,
  description   text         NOT NULL,
  source_donnee text,
  valide_par    uuid         REFERENCES plateforme.users(id),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_co2_divers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.parametres_facteurs_co2_ag
-- Facteur CO₂ évité par repas donné AG (1 ligne V1 : 2.5 kgCO₂e/repas FAO).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_facteurs_co2_ag (
  id                               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  cle                              text         NOT NULL UNIQUE,
  facteur_co2_evite_par_repas_kg   decimal(8,4) NOT NULL CHECK (facteur_co2_evite_par_repas_kg >= 0),
  source_donnee                    text,
  commentaire                      text,
  actif                            boolean      NOT NULL DEFAULT true,
  date_maj                         timestamptz  NOT NULL DEFAULT now(),
  created_at                       timestamptz  NOT NULL DEFAULT now(),
  updated_at                       timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_facteurs_co2_ag ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.parametres_facteurs_co2_ag_history
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_facteurs_co2_ag_history (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id        uuid         NOT NULL REFERENCES plateforme.parametres_facteurs_co2_ag(id),
  facteur_avant       decimal(8,4) NOT NULL,
  facteur_apres       decimal(8,4) NOT NULL,
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif   text         NOT NULL,
  modifie_par         uuid         NOT NULL REFERENCES plateforme.users(id),
  modifie_le          timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_facteurs_co2_ag_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION plateforme.fn_audit_facteurs_co2_ag()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.facteur_co2_evite_par_repas_kg IS DISTINCT FROM NEW.facteur_co2_evite_par_repas_kg THEN
    INSERT INTO plateforme.parametres_facteurs_co2_ag_history (
      parametre_id, facteur_avant, facteur_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.facteur_co2_evite_par_repas_kg, NEW.facteur_co2_evite_par_repas_kg,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = auth.uid()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_facteurs_co2_ag
  AFTER UPDATE ON plateforme.parametres_facteurs_co2_ag
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_facteurs_co2_ag();

-- ============================================================
-- plateforme.parametres_algo
-- Paramètres de l'algorithme d'attribution AG (modèle clé-valeur typé).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.parametres_algo (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cle                  text        NOT NULL UNIQUE,
  valeur               jsonb       NOT NULL,
  type_valeur          text        NOT NULL
                         CHECK (type_valeur IN ('int','time','bool','decimal','string','text[]')),
  description          text        NOT NULL,
  valide_par           uuid        REFERENCES plateforme.users(id),
  motif_derniere_modif text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.parametres_algo ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.coefficients_perte_labo
-- Coefficient de perte labo par traiteur × année de référence.
-- Calcul estimatif déchets amont — affiché gestionnaire uniquement.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.coefficients_perte_labo (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         uuid         NOT NULL REFERENCES plateforme.organisations(id),
  annee_reference         integer      NOT NULL CHECK (annee_reference BETWEEN 2020 AND 2100),
  coefficient_kg_couvert  numeric(6,4) NOT NULL CHECK (coefficient_kg_couvert >= 0),
  source_commentaire      text,
  saisi_par               uuid         NOT NULL REFERENCES plateforme.users(id),
  saisi_le                timestamptz  NOT NULL DEFAULT now(),
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT uniq_coeff_labo_org_annee UNIQUE (organisation_id, annee_reference)
);

CREATE INDEX IF NOT EXISTS idx_coeff_labo_org_annee
  ON plateforme.coefficients_perte_labo (organisation_id, annee_reference);

ALTER TABLE plateforme.coefficients_perte_labo ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.associations
-- Référentiel des associations Anti-Gaspi. Géré par Admin Savr.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.associations (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                             text        NOT NULL,
  adresse                         text        NOT NULL,
  latitude                        float,
  longitude                       float,
  region                          plateforme.region_enum NOT NULL,
  ville                           text        NOT NULL,
  capacite_max_beneficiaires      integer,
  types_aliments_acceptes         text[],
  horaires_ouverture              jsonb,
  contact_nom                     text,
  contact_email                   text        NOT NULL,
  contact_telephone               text,
  habilitee_attestation_fiscale   boolean     NOT NULL DEFAULT false,
  actif                           boolean     NOT NULL DEFAULT true,
  derniere_verification           date,
  commentaires_internes           text,
  -- Obligatoire (min 30 car.) — ajout 2026-05-07
  description_rapport_impact      text        NOT NULL DEFAULT 'Description à compléter.'
                                    CHECK (length(description_rapport_impact) >= 30),
  -- V1 only : identifiant point collecte MTS-1 (déprécié V2)
  id_point_collecte_mts1          text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_associations_region
  ON plateforme.associations (region);
CREATE INDEX IF NOT EXISTS idx_associations_actif
  ON plateforme.associations (actif) WHERE actif = true;

ALTER TABLE plateforme.associations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.transporteurs
-- Référentiel des transporteurs AG (IDF + province).
-- Refonte 2026-05-08 : SIREN, adresse, types_vehicules[], type_tms.
-- code_transporteur_mts1 : V1 only (déprécié V2).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.transporteurs (
  id                     uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                    text                        NOT NULL,
  siren                  text                        NOT NULL CHECK (siren ~ '^[0-9]{9}$'),
  adresse                text                        NOT NULL,
  code_postal            text                        NOT NULL,
  ville                  text                        NOT NULL,
  latitude               float,
  longitude              float,
  types_vehicules        text[]                      NOT NULL,
  -- type_tms : détermine le mode de dispatch
  type_tms               plateforme.type_tms_enum    NOT NULL,
  -- V1 only : carrierShareableCode MTS-1 (requis si type_tms='mts1')
  code_transporteur_mts1 text,
  contact_nom            text                        NOT NULL,
  contact_email          text                        NOT NULL,
  contact_telephone      text                        NOT NULL,
  tarif_par_course       decimal,
  actif                  boolean                     NOT NULL DEFAULT true,
  derniere_verification  date,
  commentaires_internes  text,
  created_at             timestamptz                 NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transporteurs_type_tms
  ON plateforme.transporteurs (type_tms);
CREATE INDEX IF NOT EXISTS idx_transporteurs_actif
  ON plateforme.transporteurs (actif) WHERE actif = true;

ALTER TABLE plateforme.transporteurs ENABLE ROW LEVEL SECURITY;
