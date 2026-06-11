-- Module 0.3 — Bloc 2 : Niveau 2 Référentiel
-- types_evenements, lieux, contacts_traiteurs, flux_dechets,
-- tournees, collecte_tournees, pesees_tournees, tarifs_negocie
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 2
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.region_enum AS ENUM ('idf', 'province');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Difficulté accès office / stationnement (refonte 2026-05-08)
  CREATE TYPE plateforme.difficulte_acces_enum AS ENUM ('facile', 'difficile', 'tres_difficile');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Type véhicule (aligné lieux + transporteurs + tournees)
  CREATE TYPE plateforme.type_vehicule_enum AS ENUM (
    'velo_cargo', 'camionnette', 'fourgon', 'vul', 'poids_lourd'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.tournee_creneau_enum AS ENUM (
    'matin', 'apres_midi', 'soir', 'nuit', 'journee_complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 4 valeurs finales (audit 2026-06-11 — confirmee_prestataire retiré)
  CREATE TYPE plateforme.tournee_statut_enum AS ENUM (
    'planifiee', 'en_cours', 'terminee', 'annulee'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.tarif_negocie_activite_enum AS ENUM ('zd', 'ag');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.tarif_negocie_scope_enum AS ENUM ('organisation', 'gestionnaire');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.flux_unite_enum AS ENUM ('kg', 'litre', 'bac');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.flux_filiere_enum AS ENUM (
    'recyclage', 'compostage', 'methanisation',
    'valorisation_energetique', 'enfouissement', 'don_alimentaire'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- plateforme.types_evenements
-- Référentiel extensible (4 catégories V1 — refonte Sujet 4 2026-05-26).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.types_evenements (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text        NOT NULL UNIQUE,
  libelle          text        NOT NULL,
  ordre_affichage  integer     NOT NULL DEFAULT 0,
  actif            boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.types_evenements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.lieux
-- Référentiel des lieux d'événement.
-- acces_office : enum difficulté (refonte 2026-05-08).
-- FK organisations_lieux.lieu_id ajoutée ici.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.lieux (
  id                            uuid                          PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                           text                          NOT NULL,
  nom_alternatif                text,
  adresse_acces                 text                          NOT NULL,
  code_postal                   text                          NOT NULL,
  ville                         text                          NOT NULL,
  latitude                      float,
  longitude                     float,
  region                        plateforme.region_enum,
  -- Carnet terrain partagé Plateforme + TMS (column-level GRANT TMS en V2)
  acces_details                 text,
  -- Difficulté accès office (enum refonte 2026-05-08)
  acces_office                  plateforme.difficulte_acces_enum,
  -- Stationnement : difficulté (refonte 2026-05-08 — ex-type d'emplacement)
  stationnement                 plateforme.difficulte_acces_enum,
  type_vehicule_max             plateforme.type_vehicule_enum NOT NULL,
  contraintes_horaires          text,
  flux_autorises                text[],
  volume_max_bacs               integer,
  traiteurs_operant             uuid[],
  -- Contrôle accès (plaque + nom chauffeur — restauré 2026-05-01, renommé 2026-05-03)
  controle_acces_requis_default boolean                       NOT NULL DEFAULT false,
  photos_urls                   text[],
  commentaires_internes         text,
  -- Colonnes admin/ops only (column-level GRANT)
  commentaire_lieu              text,
  siren                         text CHECK (siren ~ '^[0-9]{9}$'),
  email_gestionnaire            text,
  reference_citeo               boolean                       NOT NULL DEFAULT false,
  actif                         boolean                       NOT NULL DEFAULT true,
  created_at                    timestamptz                   NOT NULL DEFAULT now(),
  updated_at                    timestamptz                   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lieux_ville ON plateforme.lieux (ville);
CREATE INDEX IF NOT EXISTS idx_lieux_region ON plateforme.lieux (region);
CREATE INDEX IF NOT EXISTS idx_lieux_actif ON plateforme.lieux (actif) WHERE actif = true;

ALTER TABLE plateforme.lieux ENABLE ROW LEVEL SECURITY;

-- Ajouter la FK sur organisations_lieux maintenant que lieux existe
ALTER TABLE plateforme.organisations_lieux
  ADD CONSTRAINT fk_org_lieux_lieu FOREIGN KEY (lieu_id) REFERENCES plateforme.lieux(id);

-- ============================================================
-- plateforme.contacts_traiteurs
-- Référentiel autocomplete contacts par organisation.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.contacts_traiteurs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid        NOT NULL REFERENCES plateforme.organisations(id),
  prenom              text        NOT NULL,
  nom                 text        NOT NULL,
  telephone           text        NOT NULL,
  email               text,
  fonction            text,
  utilise_nb_fois     integer     NOT NULL DEFAULT 0,
  derniere_utilisation timestamptz,
  actif               boolean     NOT NULL DEFAULT true,
  created_by          uuid        REFERENCES plateforme.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_contact_telephone UNIQUE (organisation_id, telephone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_traiteurs_org
  ON plateforme.contacts_traiteurs (organisation_id);

ALTER TABLE plateforme.contacts_traiteurs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.flux_dechets
-- Référentiel fermé V1 — 5 flux (biodechet, emballage, carton, verre,
-- dechet_residuel). Extensible sans migration (table, pas enum SQL).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.flux_dechets (
  id                    uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                   text                        NOT NULL,
  code                  text                        NOT NULL UNIQUE
                          CHECK (code IN ('biodechet','emballage','carton','verre','dechet_residuel')),
  unite_mesure          plateforme.flux_unite_enum  NOT NULL,
  ordre_affichage       integer                     NOT NULL DEFAULT 0,
  exutoire              text,
  exutoire_adresse      text,
  exutoire_siret        text,
  code_dechet_europeen  text,
  filiere_valorisation  plateforme.flux_filiere_enum NOT NULL,
  eligible_citeo        boolean                     DEFAULT false,
  actif                 boolean                     NOT NULL DEFAULT true
);

ALTER TABLE plateforme.flux_dechets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.tournees
-- Une tournée = un camion pour N collectes.
-- heure_debut/fin_reelle en timestamptz (corrigé 2026-06-11 — collectes de nuit).
-- prestataire_logistique_id → shared.prestataires (FK cross-schema autorisée).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.tournees (
  id                      uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_interne       text                            NOT NULL UNIQUE,
  date_tournee            date                            NOT NULL,
  creneau                 plateforme.tournee_creneau_enum NOT NULL,
  heure_debut_prevue      time,
  heure_fin_prevue        time,
  -- timestamptz (pas time) pour supporter le passage de minuit
  heure_debut_reelle      timestamptz,
  heure_fin_reelle        timestamptz,
  prestataire_logistique_id uuid                          NOT NULL REFERENCES shared.prestataires(id),
  type_vehicule           plateforme.type_vehicule_enum,
  plaque_immatriculation  text,
  plaque_saisie_at        timestamptz,
  chauffeur_nom           text,
  chauffeur_telephone     text,
  statut                  plateforme.tournee_statut_enum  NOT NULL DEFAULT 'planifiee',
  -- tms_reference : tourId MTS-1 en V1, id TMS natif en V2
  tms_reference           text,
  -- external_ref_commande : customerOrderId MTS-1 (neutre TMS-Ready garde-fou 5)
  external_ref_commande   text,
  notes_internes          text,
  created_at              timestamptz                     NOT NULL DEFAULT now(),
  updated_at              timestamptz                     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tournees_date
  ON plateforme.tournees (date_tournee);
CREATE INDEX IF NOT EXISTS idx_tournees_prestataire
  ON plateforme.tournees (prestataire_logistique_id);
CREATE INDEX IF NOT EXISTS idx_tournees_statut
  ON plateforme.tournees (statut);

ALTER TABLE plateforme.tournees ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.collecte_tournees
-- Jointure N-N collectes ↔ tournees (refonte multi-camions 2026-05-25).
-- collecte_id FK ajoutée après création de plateforme.collectes.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.collecte_tournees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id uuid        NOT NULL,  -- FK ajoutée après création collectes
  tournee_id  uuid        NOT NULL REFERENCES plateforme.tournees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_collecte_tournee UNIQUE (collecte_id, tournee_id)
);

CREATE INDEX IF NOT EXISTS idx_collecte_tournees_collecte
  ON plateforme.collecte_tournees (collecte_id);
CREATE INDEX IF NOT EXISTS idx_collecte_tournees_tournee
  ON plateforme.collecte_tournees (tournee_id);

ALTER TABLE plateforme.collecte_tournees ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.pesees_tournees
-- Pesées brutes par tour (ajout 2026-06-11, revue adversariale INC-0).
-- Source de l'agrégation terminale → collecte_flux (dérivée par UPSERT).
-- Clé naturelle : (tournee_id, stop_id, flux_id).
-- CASCADE DELETE sur tournee_id (réduction de N emporte les pesées brutes).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.pesees_tournees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournee_id  uuid        NOT NULL REFERENCES plateforme.tournees(id) ON DELETE CASCADE,
  stop_id     text        NOT NULL,
  flux_id     uuid        NOT NULL REFERENCES plateforme.flux_dechets(id),
  poids_kg    decimal     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_pesee_tournee_stop_flux UNIQUE (tournee_id, stop_id, flux_id)
);

CREATE INDEX IF NOT EXISTS idx_pesees_tournees_tournee
  ON plateforme.pesees_tournees (tournee_id);

ALTER TABLE plateforme.pesees_tournees ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.tarifs_negocie
-- Remises % uniquement (refonte 2026-05-26 — plus de prix absolu).
-- Cumul multiplicatif : base × Π(1 − remise_pct).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.tarifs_negocie (
  id                           uuid                                  PRIMARY KEY DEFAULT gen_random_uuid(),
  activite                     plateforme.tarif_negocie_activite_enum NOT NULL,
  scope                        plateforme.tarif_negocie_scope_enum   NOT NULL,
  -- organisation_id : si scope=organisation (bénéficiaire)
  organisation_id              uuid                                  REFERENCES plateforme.organisations(id),
  -- gestionnaire_organisation_id : si scope=gestionnaire (négociateur)
  gestionnaire_organisation_id uuid                                  REFERENCES plateforme.organisations(id),
  -- lieu_id : optionnel pour scope=gestionnaire (null = tous les lieux du gestionnaire)
  lieu_id                      uuid                                  REFERENCES plateforme.lieux(id),
  remise_pct                   decimal                               NOT NULL
                                 CHECK (remise_pct > 0 AND remise_pct <= 1),
  valide_du                    date                                  NOT NULL,
  valide_jusqu_au              date,
  commentaires                 text,
  created_at                   timestamptz                           NOT NULL DEFAULT now(),
  updated_at                   timestamptz                           NOT NULL DEFAULT now(),

  -- organisation_id et gestionnaire_organisation_id mutuellement exclusifs selon scope
  CONSTRAINT chk_tarif_scope_organisation
    CHECK (scope != 'organisation' OR (organisation_id IS NOT NULL AND gestionnaire_organisation_id IS NULL)),
  CONSTRAINT chk_tarif_scope_gestionnaire
    CHECK (scope != 'gestionnaire' OR (gestionnaire_organisation_id IS NOT NULL AND organisation_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_tarifs_negocie_organisation
  ON plateforme.tarifs_negocie (organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarifs_negocie_gestionnaire
  ON plateforme.tarifs_negocie (gestionnaire_organisation_id) WHERE gestionnaire_organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarifs_negocie_lieu
  ON plateforme.tarifs_negocie (lieu_id) WHERE lieu_id IS NOT NULL;

ALTER TABLE plateforme.tarifs_negocie ENABLE ROW LEVEL SECURITY;
