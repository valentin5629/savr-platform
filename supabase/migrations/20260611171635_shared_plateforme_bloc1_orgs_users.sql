-- Module 0.3 — Bloc 1 : shared.fichiers, shared.prestataires, Niveau 1 Orgs/Users
-- RLS DENY ALL sur chaque table (policies explicites ajoutées par module Auth).
-- Garde-fou 1 TMS-Ready : zéro table tms.*

-- ============================================================
-- EXTENSIONS & DOMAINES COMMUNS
-- ============================================================

-- Types d'enum partagés
-- (PostgreSQL ne supporte pas CREATE TYPE IF NOT EXISTS, donc on utilise DO)

DO $$ BEGIN
  CREATE TYPE shared.storage_provider_enum AS ENUM ('supabase', 'r2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.organisation_type_enum AS ENUM (
    'traiteur', 'agence', 'gestionnaire_lieux', 'client_organisateur'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.user_role_enum AS ENUM (
    'admin_savr', 'ops_savr', 'traiteur_manager', 'traiteur_commercial',
    'agence', 'gestionnaire_lieux', 'client_organisateur'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.siret_verification_enum AS ENUM ('en_attente', 'verifie', 'echec');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.tva_verification_enum AS ENUM ('en_attente', 'verifie', 'echec', 'non_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.mode_paiement_enum AS ENUM ('virement', 'prelevement', 'cb', 'cheque');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- shared.fichiers
-- Référentiel centralisé de tous les fichiers (Plateforme + TMS).
-- Doctrine : source de vérité unique. Les colonnes *_url des tables
-- métier sont des dénormalisations de lecture (bucket/key), jamais
-- des URLs signées.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.fichiers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_provider shared.storage_provider_enum NOT NULL,
  bucket           text        NOT NULL,
  key              text        NOT NULL,
  content_hash     text,
  size_bytes       bigint      NOT NULL,
  content_type     text        NOT NULL,
  entity_type      text        NOT NULL,
  entity_id        uuid        NOT NULL,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fichiers_entity
  ON shared.fichiers (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_fichiers_deleted
  ON shared.fichiers (deleted_at) WHERE deleted_at IS NULL;

-- RLS DENY ALL
ALTER TABLE shared.fichiers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- shared.prestataires
-- Référentiel prestataires logistiques — source de vérité unique.
-- V1 : colonnes Plateforme + opérationnelles de base.
-- V2 (TMS natif) : colonnes supplémentaires ajoutées par migration
-- (grille tarifaire, portail self-service, etc.).
-- ============================================================

CREATE TABLE IF NOT EXISTS shared.prestataires (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                       text        NOT NULL,
  code                      text        NOT NULL UNIQUE,
  -- type_prestation : tableau de valeurs zd/ag (pas d'enum strict pour extensibilité V2)
  type_prestation           text[]      NOT NULL DEFAULT '{}',
  mode_integration          text        NOT NULL DEFAULT 'manuel',
  api_config                jsonb,
  siret                     text,
  tva_intracom              text,
  adresse_siege             jsonb,
  contact_operationnel      jsonb,
  contact_facturation       jsonb,
  -- statut : 3 valeurs actif/suspendu/archive (pas boolean — §04 addendum D14)
  statut                    text        NOT NULL DEFAULT 'actif'
                              CHECK (statut IN ('actif', 'suspendu', 'archive')),
  commentaire_interne       text,
  -- Colonnes opérationnelles (présentes dès V1 pour Plateforme)
  rayon_intervention_km     integer,
  coords_siege_lat          float,
  coords_siege_lng          float,
  date_fin_contrat          date,
  -- Cache nb_collectes pour algo AG (mis à jour par trigger TMS en V2 ; 0 en V1)
  nb_collectes_6_mois_cache integer     NOT NULL DEFAULT 0,
  -- Ping Everest (V1.1)
  last_everest_ping_at      timestamptz,
  last_everest_ping_status  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prestataires_type_statut
  ON shared.prestataires (type_prestation, statut, nb_collectes_6_mois_cache);

-- RLS DENY ALL
ALTER TABLE shared.prestataires ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.organisations
-- Entité générique : traiteurs, agences, gestionnaires de lieux,
-- clients organisateurs. Shadow autorisé uniquement pour traiteur.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.organisations (
  id                       uuid                              PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                      text                              NOT NULL,
  raison_sociale           text,                             -- nullable, fallback = nom (ajout audit 2026-06-11)
  type                     plateforme.organisation_type_enum NOT NULL,
  email_principal          text,
  telephone                text,
  adresse                  text,
  -- siret : utilisé uniquement pour les fiches shadow (source de vérité = entites_facturation.siret)
  siret                    text,
  logo_url                 text,
  notes_internes           text,
  actif                    boolean                           NOT NULL DEFAULT true,
  est_shadow               boolean                           NOT NULL DEFAULT false,
  cree_par_organisation_id uuid                              REFERENCES plateforme.organisations(id),
  -- Tarif refacturé par couvert ZD (pertinent pour type=traiteur)
  tarif_refacture_pax_zd   numeric(10,2)                    NOT NULL DEFAULT 1.50
                             CHECK (tarif_refacture_pax_zd >= 0),
  -- Grille tarifaire ZD affectée (NULL = grille est_defaut)
  grille_tarifaire_zd_id   uuid,                             -- FK ajoutée après création grilles_tarifaires_zd
  created_at               timestamptz                       NOT NULL DEFAULT now(),
  updated_at               timestamptz                       NOT NULL DEFAULT now(),

  CONSTRAINT chk_shadow_only_traiteur
    CHECK (est_shadow = false OR type = 'traiteur'),
  CONSTRAINT chk_shadow_needs_creator
    CHECK (est_shadow = false OR cree_par_organisation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_organisations_type
  ON plateforme.organisations (type);
CREATE INDEX IF NOT EXISTS idx_organisations_shadow
  ON plateforme.organisations (est_shadow) WHERE est_shadow = true;
CREATE INDEX IF NOT EXISTS idx_organisations_actif
  ON plateforme.organisations (actif) WHERE actif = true;

-- RLS DENY ALL
ALTER TABLE plateforme.organisations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.users
-- Tous les utilisateurs. 1 user = 1 organisation (invariant V1).
-- id = UUID Supabase Auth.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.users (
  id                 uuid                          PRIMARY KEY,
  organisation_id    uuid                          NOT NULL REFERENCES plateforme.organisations(id),
  email              text                          NOT NULL UNIQUE,
  prenom             text                          NOT NULL,
  nom                text                          NOT NULL,
  role               plateforme.user_role_enum     NOT NULL,
  actif              boolean                       NOT NULL DEFAULT true,
  derniere_connexion timestamptz,
  created_at         timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_organisation
  ON plateforme.users (organisation_id);
CREATE INDEX IF NOT EXISTS idx_users_role
  ON plateforme.users (role);
CREATE INDEX IF NOT EXISTS idx_users_email
  ON plateforme.users (email);

-- RLS DENY ALL
ALTER TABLE plateforme.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.entites_facturation
-- Entités juridiques de facturation par organisation.
-- Gate facturation : siret_verification = 'verifie' requis.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.entites_facturation (
  id                              uuid                                  PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                 uuid                                  NOT NULL REFERENCES plateforme.organisations(id),
  raison_sociale                  text                                  NOT NULL,
  siret                           text                                  NOT NULL,
  tva_intracom                    text,
  pennylane_customer_id           text,
  adresse_facturation             text                                  NOT NULL,
  code_postal                     text                                  NOT NULL,
  ville                           text                                  NOT NULL,
  pays                            text                                  NOT NULL DEFAULT 'FR',
  email_facturation               text,
  contact_compta_nom              text,
  conditions_paiement_jours       integer                               NOT NULL DEFAULT 30,
  mode_paiement                   plateforme.mode_paiement_enum,
  siret_verification              plateforme.siret_verification_enum    NOT NULL DEFAULT 'en_attente',
  siret_verifie_le                timestamptz,
  tva_verification                plateforme.tva_verification_enum      NOT NULL DEFAULT 'en_attente',
  tva_verifiee_le                 timestamptz,
  entite_par_defaut               boolean                               NOT NULL DEFAULT false,
  actif                           boolean                               NOT NULL DEFAULT true,
  commentaires                    text,
  created_at                      timestamptz                           NOT NULL DEFAULT now(),
  updated_at                      timestamptz                           NOT NULL DEFAULT now()
);

-- Unicité de l'entité par défaut par organisation (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_entite_defaut_par_org
  ON plateforme.entites_facturation (organisation_id)
  WHERE entite_par_defaut = true AND actif = true;

CREATE INDEX IF NOT EXISTS idx_entites_facturation_organisation
  ON plateforme.entites_facturation (organisation_id);
CREATE INDEX IF NOT EXISTS idx_entites_facturation_siret_verif
  ON plateforme.entites_facturation (siret_verification);

-- Trigger : interdire l'insertion d'une entite_facturation pour une org shadow
CREATE OR REPLACE FUNCTION plateforme.fn_check_shadow_no_entite_facturation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM plateforme.organisations
    WHERE id = NEW.organisation_id AND est_shadow = true
  ) THEN
    RAISE EXCEPTION 'Impossible de créer une entité de facturation pour une organisation shadow (est_shadow=true)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_no_entite_facturation_shadow
  BEFORE INSERT ON plateforme.entites_facturation
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_check_shadow_no_entite_facturation();

-- RLS DENY ALL
ALTER TABLE plateforme.entites_facturation ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.organisations_lieux
-- Jointure N-N organisations ↔ lieux.
-- V1 : utilisé uniquement pour gestionnaires_lieux.
-- FK lieu_id ajoutée après création de plateforme.lieux.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.organisations_lieux (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES plateforme.organisations(id),
  -- lieu_id : FK vers plateforme.lieux ajoutée dans la migration lieux
  lieu_id         uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES plateforme.users(id),

  CONSTRAINT uniq_org_lieu UNIQUE (organisation_id, lieu_id)
);

CREATE INDEX IF NOT EXISTS idx_org_lieux_organisation
  ON plateforme.organisations_lieux (organisation_id);
CREATE INDEX IF NOT EXISTS idx_org_lieux_lieu
  ON plateforme.organisations_lieux (lieu_id);

-- RLS DENY ALL
ALTER TABLE plateforme.organisations_lieux ENABLE ROW LEVEL SECURITY;
