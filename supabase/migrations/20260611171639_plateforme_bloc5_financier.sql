-- Module 0.3 — Bloc 5 : Financier
-- grilles_tarifaires_zd, tarifs_zero_dechet, tarifs_packs_ag,
-- packs_antgaspi, factures, factures_collectes, sequences_facturation
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 5
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.facture_statut_enum AS ENUM (
    'brouillon', 'envoyee', 'payee', 'en_retard', 'annulee'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- serie_facturation : ZD par collecte, ZD mensuel groupé, AG mensuel, avoir
  CREATE TYPE plateforme.serie_facturation_enum AS ENUM (
    'ZD_COLLECTE', 'ZD_MENSUEL', 'AG_MENSUEL', 'AVOIR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.pack_statut_enum AS ENUM ('actif', 'epuise', 'expire', 'annule');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- plateforme.grilles_tarifaires_zd
-- Référentiel des grilles tarifaires ZD versionnées.
-- est_defaut : partial UNIQUE INDEX (1 seule grille défaut active).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.grilles_tarifaires_zd (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom          text        NOT NULL,
  description  text,
  est_defaut   boolean     NOT NULL DEFAULT false,
  actif        boolean     NOT NULL DEFAULT true,
  valide_du    date        NOT NULL,
  valide_jusqu date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 1 seule grille défaut active à la fois
CREATE UNIQUE INDEX IF NOT EXISTS uniq_grille_tarifaire_defaut
  ON plateforme.grilles_tarifaires_zd (est_defaut)
  WHERE est_defaut = true AND actif = true;

ALTER TABLE plateforme.grilles_tarifaires_zd ENABLE ROW LEVEL SECURITY;

-- FK circulaire : organisations.grille_tarifaire_zd_id → grilles_tarifaires_zd
ALTER TABLE plateforme.organisations
  ADD CONSTRAINT fk_org_grille_tarifaire
  FOREIGN KEY (grille_tarifaire_zd_id) REFERENCES plateforme.grilles_tarifaires_zd(id);

-- ============================================================
-- plateforme.tarifs_zero_dechet
-- Paliers de prix par grille tarifaire.
-- Tarifs versionnés — jamais modifiés rétroactivement (§04 Règles métier).
-- pax_min/max : bracket PAX pour le tarif (ex: 0-249, 250-499, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.tarifs_zero_dechet (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grille_id             uuid        NOT NULL REFERENCES plateforme.grilles_tarifaires_zd(id),
  pax_min               integer     NOT NULL CHECK (pax_min >= 0),
  pax_max               integer     CHECK (pax_max IS NULL OR pax_max >= pax_min),
  prix_base_ht          numeric(10,2) NOT NULL CHECK (prix_base_ht >= 0),
  -- prix_par_couvert_ht : tarif ZD au couvert (remplace tarif_refacture_pax_zd V1)
  prix_par_couvert_ht   numeric(10,2),
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_tarif_zd_grille_bracket UNIQUE (grille_id, pax_min)
);

CREATE INDEX IF NOT EXISTS idx_tarifs_zd_grille
  ON plateforme.tarifs_zero_dechet (grille_id);

ALTER TABLE plateforme.tarifs_zero_dechet ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.tarifs_packs_ag
-- Grille tarifaire des packs Anti-Gaspi.
-- Versionnée : valide_du/valide_jusqu (modifs = nouvelle ligne).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.tarifs_packs_ag (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  nb_collectes     integer       NOT NULL CHECK (nb_collectes > 0),
  prix_ht          numeric(10,2) NOT NULL CHECK (prix_ht >= 0),
  valide_du        date          NOT NULL,
  valide_jusqu     date          CHECK (valide_jusqu IS NULL OR valide_jusqu >= valide_du),
  actif            boolean       NOT NULL DEFAULT true,
  commentaire      text,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE plateforme.tarifs_packs_ag ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.packs_antgaspi
-- Crédits AG achetés par une organisation.
-- credits_restants = GENERATED ALWAYS AS (nb_collectes - nb_utilisees - nb_annulees).
-- partial UNIQUE INDEX : 1 seul pack actif par organisation.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.packs_antgaspi (
  id               uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid                        NOT NULL REFERENCES plateforme.organisations(id),
  tarif_pack_id    uuid                        NOT NULL REFERENCES plateforme.tarifs_packs_ag(id),
  nb_collectes     integer                     NOT NULL CHECK (nb_collectes > 0),
  nb_utilisees     integer                     NOT NULL DEFAULT 0 CHECK (nb_utilisees >= 0),
  nb_annulees      integer                     NOT NULL DEFAULT 0 CHECK (nb_annulees >= 0),
  credits_restants integer GENERATED ALWAYS AS (nb_collectes - nb_utilisees - nb_annulees) STORED,
  statut           plateforme.pack_statut_enum NOT NULL DEFAULT 'actif',
  date_achat       date                        NOT NULL,
  date_expiration  date,
  facture_pack_id  uuid,                       -- FK ajoutée après création factures
  notes            text,
  created_at       timestamptz                 NOT NULL DEFAULT now(),
  updated_at       timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT chk_pack_credits_positifs
    CHECK (nb_utilisees + nb_annulees <= nb_collectes)
);

-- 1 pack actif par organisation (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pack_actif_par_org
  ON plateforme.packs_antgaspi (organisation_id)
  WHERE statut = 'actif';

CREATE INDEX IF NOT EXISTS idx_packs_organisation
  ON plateforme.packs_antgaspi (organisation_id);
CREATE INDEX IF NOT EXISTS idx_packs_statut
  ON plateforme.packs_antgaspi (statut);

ALTER TABLE plateforme.packs_antgaspi ENABLE ROW LEVEL SECURITY;

-- FK collectes.pack_antgaspi_id → packs_antgaspi (créé dans bloc 4 sans FK)
ALTER TABLE plateforme.collectes
  ADD CONSTRAINT fk_collectes_pack_antgaspi
  FOREIGN KEY (pack_antgaspi_id) REFERENCES plateforme.packs_antgaspi(id);

-- Trigger débit pack AG (annulation tardive < 12h — §04 Règles métier)
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- SI collecte AG passe à annulee ET pack_antgaspi_id est défini
  -- ET date_collecte - INTERVAL '12 hours' <= now() → débit d'un crédit
  IF NEW.statut = 'annulee'
    AND OLD.statut != 'annulee'
    AND NEW.type = 'anti_gaspi'
    AND NEW.pack_antgaspi_id IS NOT NULL
    AND (NEW.date_collecte::timestamptz + NEW.heure_collecte - INTERVAL '12 hours') <= now()
  THEN
    UPDATE plateforme.packs_antgaspi
    SET nb_annulees = nb_annulees + 1,
        updated_at = now()
    WHERE id = NEW.pack_antgaspi_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pack_debit_annulation_tardive
  AFTER UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive();

-- ============================================================
-- plateforme.sequences_facturation
-- Numérotation gapless par série + année.
-- Numéro conservé après échec 4xx (idempotence Pennylane).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.sequences_facturation (
  serie   plateforme.serie_facturation_enum NOT NULL,
  annee   smallint                          NOT NULL CHECK (annee >= 2024),
  dernier integer                           NOT NULL DEFAULT 0,
  updated_at timestamptz                   NOT NULL DEFAULT now(),

  PRIMARY KEY (serie, annee)
);

ALTER TABLE plateforme.sequences_facturation ENABLE ROW LEVEL SECURITY;

-- Fonction atomic nextval pour la numérotation gapless
CREATE OR REPLACE FUNCTION plateforme.f_next_numero_facture(
  p_serie plateforme.serie_facturation_enum,
  p_annee smallint
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier)
  VALUES (p_serie, p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier = plateforme.sequences_facturation.dernier + 1,
        updated_at = now()
  RETURNING dernier INTO v_next;
  RETURN v_next;
END;
$$;

-- ============================================================
-- plateforme.factures
-- Factures client. Numérotation gapless via sequences_facturation.
-- Avoir autorisé sur facture 'payee' (§04).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.factures (
  id                      uuid                              PRIMARY KEY DEFAULT gen_random_uuid(),
  entite_facturation_id   uuid                              NOT NULL REFERENCES plateforme.entites_facturation(id),
  organisation_id         uuid                              NOT NULL REFERENCES plateforme.organisations(id),
  serie                   plateforme.serie_facturation_enum NOT NULL,
  annee                   smallint                          NOT NULL,
  numero                  integer                           NOT NULL,
  numero_complet          text                              NOT NULL,
  statut                  plateforme.facture_statut_enum    NOT NULL DEFAULT 'brouillon',
  date_emission           date,
  date_echeance           date,
  montant_ht              numeric(12,2)                     NOT NULL DEFAULT 0,
  taux_tva                numeric(5,2)                      NOT NULL DEFAULT 20.00,
  montant_tva             numeric(12,2)                     NOT NULL DEFAULT 0,
  montant_ttc             numeric(12,2)                     NOT NULL DEFAULT 0,
  devise                  text                              NOT NULL DEFAULT 'EUR',
  pennylane_invoice_id    text,
  pennylane_push_at       timestamptz,
  pennylane_statut        text,
  avoir_de_facture_id     uuid                              REFERENCES plateforme.factures(id),
  motif_avoir             text,
  pdf_fichier_id          uuid                              REFERENCES shared.fichiers(id),
  notes                   text,
  periode_debut           date,
  periode_fin             date,
  created_at              timestamptz                       NOT NULL DEFAULT now(),
  updated_at              timestamptz                       NOT NULL DEFAULT now(),

  -- Unicité numéro par série+année
  CONSTRAINT uniq_numero_facture UNIQUE (serie, annee, numero)
);

CREATE INDEX IF NOT EXISTS idx_factures_organisation
  ON plateforme.factures (organisation_id);
CREATE INDEX IF NOT EXISTS idx_factures_entite
  ON plateforme.factures (entite_facturation_id);
CREATE INDEX IF NOT EXISTS idx_factures_statut
  ON plateforme.factures (statut);
CREATE INDEX IF NOT EXISTS idx_factures_date_emission
  ON plateforme.factures (date_emission);

ALTER TABLE plateforme.factures ENABLE ROW LEVEL SECURITY;

-- FK facture_pack sur packs_antgaspi (circulaire)
ALTER TABLE plateforme.packs_antgaspi
  ADD CONSTRAINT fk_pack_facture
  FOREIGN KEY (facture_pack_id) REFERENCES plateforme.factures(id);

-- Validation : avoir autorisé uniquement sur facture 'payee'
CREATE OR REPLACE FUNCTION plateforme.fn_check_avoir_facture_payee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.avoir_de_facture_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM plateforme.factures
      WHERE id = NEW.avoir_de_facture_id AND statut = 'payee'
    ) THEN
      RAISE EXCEPTION 'Un avoir ne peut être créé que sur une facture au statut "payee"';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_avoir_facture_payee
  BEFORE INSERT OR UPDATE OF avoir_de_facture_id ON plateforme.factures
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_check_avoir_facture_payee();

-- ============================================================
-- plateforme.factures_collectes
-- Association facture ↔ collectes (N-N).
-- collecte_id nullable : facture AG (pack) sans collecte imputée.
-- Trigger : empêcher double facturation d'une même collecte.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.factures_collectes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id  uuid        NOT NULL REFERENCES plateforme.factures(id),
  collecte_id uuid        REFERENCES plateforme.collectes(id),
  montant_ht  numeric(12,2) NOT NULL DEFAULT 0,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_factures_collectes_facture
  ON plateforme.factures_collectes (facture_id);
CREATE INDEX IF NOT EXISTS idx_factures_collectes_collecte
  ON plateforme.factures_collectes (collecte_id) WHERE collecte_id IS NOT NULL;

ALTER TABLE plateforme.factures_collectes ENABLE ROW LEVEL SECURITY;

-- Trigger : une collecte non nulle ne peut pas être sur 2 factures actives
CREATE OR REPLACE FUNCTION plateforme.fn_trg_fc_collecte_non_facturee()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collecte_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM plateforme.factures_collectes fc
      JOIN plateforme.factures f ON f.id = fc.facture_id
      WHERE fc.collecte_id = NEW.collecte_id
        AND f.statut NOT IN ('annulee')
        AND fc.id != NEW.id
    ) THEN
      RAISE EXCEPTION 'La collecte % est déjà rattachée à une facture active', NEW.collecte_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fc_collecte_non_facturee
  BEFORE INSERT OR UPDATE OF collecte_id ON plateforme.factures_collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_fc_collecte_non_facturee();
