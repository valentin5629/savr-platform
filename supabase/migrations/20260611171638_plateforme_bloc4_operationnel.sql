-- Module 0.3 — Bloc 4 : Niveau 3 Opérationnel
-- evenements, collectes, collecte_flux, attributions_antgaspi
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 4
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.collecte_type_enum AS ENUM ('zero_dechet', 'anti_gaspi');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 9 valeurs (audit sobriété 2026-05-25 : manquee + en_reexamen retirés)
  CREATE TYPE plateforme.collecte_statut_enum AS ENUM (
    'brouillon', 'programmee', 'validee', 'en_cours',
    'realisee', 'realisee_sans_collecte', 'cloturee',
    'annulation_demandee', 'annulee'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- 8 valeurs alignées §09 (audit 2026-04-25)
  CREATE TYPE plateforme.statut_tms_enum AS ENUM (
    'non_envoye', 'a_attribuer', 'attribuee_en_attente_acceptation',
    'acceptee', 'en_attente_execution', 'rejetee_par_prestataire',
    'annulee_par_traiteur', 'rejetee_par_tms'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.incident_imputable_enum AS ENUM (
    'prestataire', 'client', 'association', 'savr', 'externe'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.attribution_mode_validation_enum AS ENUM (
    'manuel_top1', 'manuel_override', 'auto_accept'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Fonction utilitaire : bracket taille événement (non stocké)
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.taille_evenement_bracket(p_pax integer)
RETURNS text LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pax < 250 THEN 'XS'
    WHEN p_pax < 500 THEN 'S'
    WHEN p_pax < 750 THEN 'M'
    WHEN p_pax < 1000 THEN 'L'
    ELSE 'XL'
  END
$$;

-- ============================================================
-- plateforme.evenements
-- Table centrale. 1 événement → N collectes.
-- date_evenement : auto-dérivé = MIN(collectes.date_collecte) via trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.evenements (
  id                                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                       uuid        NOT NULL REFERENCES plateforme.organisations(id),
  traiteur_operationnel_organisation_id uuid        NOT NULL REFERENCES plateforme.organisations(id),
  entite_facturation_id                 uuid        NOT NULL REFERENCES plateforme.entites_facturation(id),
  lieu_id                               uuid        NOT NULL REFERENCES plateforme.lieux(id),
  created_by                            uuid        NOT NULL REFERENCES plateforme.users(id),
  nom_evenement                         text,
  type_evenement_id                     uuid        NOT NULL REFERENCES plateforme.types_evenements(id),
  -- NULL autorisé : brouillon sans collecte datée (arbitrage F1 test-scenarios 2026-06-07)
  date_evenement                        date,
  pax                                   integer     NOT NULL,
  contact_principal_nom                 text        NOT NULL,
  contact_principal_telephone           text        NOT NULL,
  contact_secours_nom                   text,
  contact_secours_telephone             text,
  nom_client_organisateur               text,
  logo_client_organisateur_url          text,
  client_organisateur_organisation_id   uuid        REFERENCES plateforme.organisations(id),
  reference_affaire                     text,
  notes_internes                        text,
  created_at                            timestamptz NOT NULL DEFAULT now(),
  updated_at                            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evenements_organisation
  ON plateforme.evenements (organisation_id);
CREATE INDEX IF NOT EXISTS idx_evenements_lieu
  ON plateforme.evenements (lieu_id);
CREATE INDEX IF NOT EXISTS idx_evenements_date
  ON plateforme.evenements (date_evenement);
CREATE INDEX IF NOT EXISTS idx_evenements_traiteur_op
  ON plateforme.evenements (traiteur_operationnel_organisation_id);

ALTER TABLE plateforme.evenements ENABLE ROW LEVEL SECURITY;

-- Trigger auto-dérivation date_evenement = MIN(collectes.date_collecte)
-- (déclaré ici, body sera renseigné après création de collectes)
-- Le trigger fn_set_date_evenement est créé dans le même bloc pour cohérence.

-- ============================================================
-- plateforme.collectes
-- Une collecte = une intervention physique ZD ou AG.
-- Nombreuses colonnes snapshot CO₂ et taux recyclage figés à la clôture.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.collectes (
  id                         uuid                              PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id               uuid                              NOT NULL REFERENCES plateforme.evenements(id),
  type                       plateforme.collecte_type_enum     NOT NULL,
  prestataire_logistique_id  uuid                              REFERENCES shared.prestataires(id),
  -- nb_camions_demande : V1 only / MTS-1 (omis V2 — liste fermée garde-fou 1)
  nb_camions_demande         smallint                          NOT NULL DEFAULT 1,
  statut                     plateforme.collecte_statut_enum   NOT NULL DEFAULT 'brouillon',
  aucun_repas_motif          text,
  aucun_repas_photo_url      text,
  statut_tms                 plateforme.statut_tms_enum        NOT NULL DEFAULT 'non_envoye',
  statut_tms_at              timestamptz,
  collecte_remplacee_id      uuid                              REFERENCES plateforme.collectes(id),
  motif_incident             text,
  incident_imputable_a       plateforme.incident_imputable_enum,
  date_collecte              date                              NOT NULL,
  heure_collecte             time                              NOT NULL,
  -- timestamptz (corrigé 2026-06-11 — collectes de nuit)
  heure_debut_reelle         timestamptz,
  heure_fin_reelle           timestamptz,
  volume_estime_repas        integer,
  controle_acces_requis      boolean                           NOT NULL DEFAULT false,
  notes_internes             text,
  informations_supplementaires text,
  tms_reference              text,
  informations_completes     boolean                           NOT NULL DEFAULT true,
  annulee_cote_savr          boolean                           NOT NULL DEFAULT false,
  annulee_cote_savr_motif    text,
  dirty_tms                  boolean                           NOT NULL DEFAULT false,
  motif_override_prestataire text,
  historique_partiel         boolean                           NOT NULL DEFAULT false,
  -- Snapshot taux recyclage (figé à la clôture ZD)
  taux_recyclage             decimal(5,2),
  caps_appliques             jsonb,
  -- Snapshot CO₂ (figé à la clôture ZD + AG)
  co2_induit_kg              decimal(10,2),
  co2_evite_kg               decimal(10,2),
  co2_net_kg                 decimal(10,2),
  energie_primaire_evitee_kwh decimal(12,2),
  co2_facteurs_snapshot      jsonb,
  -- FK pack AG (C1 audit sobriété 2026-05-25)
  pack_antgaspi_id           uuid,                             -- FK ajoutée après création packs_antgaspi
  -- Override lieu per-collecte (option b actée 2026-05-25)
  lieu_overrides             jsonb,
  -- Horodatage réalisation (base embargo H+24)
  realisee_at                timestamptz,
  created_at                 timestamptz                       NOT NULL DEFAULT now(),
  updated_at                 timestamptz                       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collectes_evenement
  ON plateforme.collectes (evenement_id);
CREATE INDEX IF NOT EXISTS idx_collectes_statut
  ON plateforme.collectes (statut);
CREATE INDEX IF NOT EXISTS idx_collectes_date
  ON plateforme.collectes (date_collecte);
CREATE INDEX IF NOT EXISTS idx_collectes_type_statut
  ON plateforme.collectes (type, statut);
CREATE INDEX IF NOT EXISTS idx_collectes_prestataire
  ON plateforme.collectes (prestataire_logistique_id);

ALTER TABLE plateforme.collectes ENABLE ROW LEVEL SECURITY;

-- FK circulaire collecte_tournees.collecte_id (table créée dans bloc 2)
ALTER TABLE plateforme.collecte_tournees
  ADD CONSTRAINT fk_collecte_tournees_collecte
  FOREIGN KEY (collecte_id) REFERENCES plateforme.collectes(id);

-- Trigger auto-dérivation date_evenement depuis collectes
CREATE OR REPLACE FUNCTION plateforme.fn_set_date_evenement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_evenement_id uuid;
BEGIN
  v_evenement_id := COALESCE(NEW.evenement_id, OLD.evenement_id);
  UPDATE plateforme.evenements
  SET date_evenement = (
    SELECT MIN(date_collecte)
    FROM plateforme.collectes
    WHERE evenement_id = v_evenement_id
      AND statut != 'annulee'
  ),
  updated_at = now()
  WHERE id = v_evenement_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_date_evenement
  AFTER INSERT OR UPDATE OF date_collecte OR DELETE ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_set_date_evenement();

-- Trigger dérivation statut_tms → statut collecte (Sujet 2, 2026-05-26)
CREATE OR REPLACE FUNCTION plateforme.fn_sync_statut_collecte_from_tms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut_tms IN ('acceptee','en_attente_execution') AND NEW.statut = 'programmee' THEN
    NEW.statut := 'validee';
  ELSIF NEW.statut_tms IN ('non_envoye','a_attribuer','attribuee_en_attente_acceptation')
    AND NEW.statut = 'validee' THEN
    NEW.statut := 'programmee';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_statut_collecte_from_tms
  BEFORE UPDATE OF statut_tms ON plateforme.collectes
  FOR EACH ROW
  WHEN (OLD.statut_tms IS DISTINCT FROM NEW.statut_tms)
  EXECUTE FUNCTION plateforme.fn_sync_statut_collecte_from_tms();

-- Trigger volume_estime_repas (AG : round(0.10 × pax) — 2026-05-07)
CREATE OR REPLACE FUNCTION plateforme.fn_set_volume_estime_repas()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_pax integer;
BEGIN
  IF NEW.type = 'anti_gaspi' AND NEW.statut NOT IN ('realisee','realisee_sans_collecte','cloturee') THEN
    SELECT pax INTO v_pax FROM plateforme.evenements WHERE id = NEW.evenement_id;
    NEW.volume_estime_repas := ROUND(0.10 * COALESCE(v_pax, 0));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_volume_estime_repas
  BEFORE INSERT OR UPDATE ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_set_volume_estime_repas();

-- Trigger dirty_tms : positionne dirty_tms=true sur modif champs propagés au TMS
CREATE OR REPLACE FUNCTION plateforme.fn_set_collectes_dirty_tms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut_tms NOT IN ('non_envoye') THEN
    -- Champs propagés au TMS (date, heure, lieu, pax via événement, contrôle accès, infos suppl)
    IF (OLD.date_collecte IS DISTINCT FROM NEW.date_collecte
      OR OLD.heure_collecte IS DISTINCT FROM NEW.heure_collecte
      OR OLD.controle_acces_requis IS DISTINCT FROM NEW.controle_acces_requis
      OR OLD.informations_supplementaires IS DISTINCT FROM NEW.informations_supplementaires
      OR OLD.lieu_overrides IS DISTINCT FROM NEW.lieu_overrides) THEN
      NEW.dirty_tms := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_collectes_dirty_tms
  BEFORE UPDATE ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_set_collectes_dirty_tms();

-- Trigger cascade contrôle accès → lieu (upgrade-only, §05 R_controle_acces_cascade)
CREATE OR REPLACE FUNCTION plateforme.fn_controle_acces_cascade()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.controle_acces_requis = true THEN
    UPDATE plateforme.lieux
    SET controle_acces_requis_default = true,
        updated_at = now()
    WHERE id = (SELECT lieu_id FROM plateforme.evenements WHERE id = NEW.evenement_id)
      AND controle_acces_requis_default = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_controle_acces_cascade
  AFTER INSERT OR UPDATE OF controle_acces_requis ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_controle_acces_cascade();

-- ============================================================
-- plateforme.collecte_flux
-- Pesées réelles ZD par flux. Idempotent : UNIQUE (collecte_id, flux_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.collecte_flux (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id     uuid         NOT NULL REFERENCES plateforme.collectes(id),
  flux_id         uuid         NOT NULL REFERENCES plateforme.flux_dechets(id),
  poids_reel_kg   decimal,
  equivalent_roll decimal,
  nb_bacs         integer,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT uniq_collecte_flux UNIQUE (collecte_id, flux_id)
);

CREATE INDEX IF NOT EXISTS idx_collecte_flux_collecte
  ON plateforme.collecte_flux (collecte_id);

ALTER TABLE plateforme.collecte_flux ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.attributions_antgaspi
-- Résultat algo attribution AG. 1 par collecte AG.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.attributions_antgaspi (
  id                       uuid                                      PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id              uuid                                      NOT NULL UNIQUE
                             REFERENCES plateforme.collectes(id),
  association_id           uuid                                      NOT NULL
                             REFERENCES plateforme.associations(id),
  transporteur_id          uuid                                      NOT NULL
                             REFERENCES plateforme.transporteurs(id),
  branche_attribution      text                                      NOT NULL,
  confirmation_transporteur jsonb,
  mode_validation          plateforme.attribution_mode_validation_enum NOT NULL,
  valide_par               uuid                                      REFERENCES plateforme.users(id),
  valide_at                timestamptz,
  volume_repas_realise     integer,
  poids_repas_kg           decimal,
  motif_override           text,
  motif_override_libre     text,
  created_at               timestamptz                               NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attributions_collecte
  ON plateforme.attributions_antgaspi (collecte_id);
CREATE INDEX IF NOT EXISTS idx_attributions_association
  ON plateforme.attributions_antgaspi (association_id);
CREATE INDEX IF NOT EXISTS idx_attributions_transporteur
  ON plateforme.attributions_antgaspi (transporteur_id);

ALTER TABLE plateforme.attributions_antgaspi ENABLE ROW LEVEL SECURITY;
