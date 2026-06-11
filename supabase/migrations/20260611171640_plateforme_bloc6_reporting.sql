-- Module 0.3 — Bloc 6 : Reporting / Réglementaire
-- rapports_rse, bordereaux_savr, attestations_don,
-- documents_generaux_savr, exports_registre
-- RLS DENY ALL sur chaque table.

-- ============================================================
-- ENUMS Bloc 6
-- ============================================================

DO $$ BEGIN
  CREATE TYPE plateforme.document_statut_enum AS ENUM (
    'en_attente', 'genere', 'erreur', 'expire'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plateforme.rapport_rse_statut_enum AS ENUM (
    'brouillon', 'publie', 'archive'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- plateforme.rapports_rse
-- Rapport RSE / bilan carbone par organisation.
-- 1 rapport = 1 période (mois/trimestre/année).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.rapports_rse (
  id               uuid                                PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid                                NOT NULL REFERENCES plateforme.organisations(id),
  periode_debut    date                                NOT NULL,
  periode_fin      date                                NOT NULL CHECK (periode_fin >= periode_debut),
  nb_collectes     integer                             NOT NULL DEFAULT 0,
  nb_collectes_zd  integer                             NOT NULL DEFAULT 0,
  nb_collectes_ag  integer                             NOT NULL DEFAULT 0,
  poids_total_kg   numeric(12,2)                       NOT NULL DEFAULT 0,
  co2_evite_kg     numeric(12,2)                       NOT NULL DEFAULT 0,
  co2_induit_kg    numeric(12,2)                       NOT NULL DEFAULT 0,
  co2_net_kg       numeric(12,2)                       NOT NULL DEFAULT 0,
  nb_repas_donnes  integer                             NOT NULL DEFAULT 0,
  statut           plateforme.rapport_rse_statut_enum  NOT NULL DEFAULT 'brouillon',
  pdf_fichier_id   uuid                                REFERENCES shared.fichiers(id),
  genere_at        timestamptz,
  created_at       timestamptz                         NOT NULL DEFAULT now(),
  updated_at       timestamptz                         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rapports_rse_organisation
  ON plateforme.rapports_rse (organisation_id);
CREATE INDEX IF NOT EXISTS idx_rapports_rse_periode
  ON plateforme.rapports_rse (periode_debut, periode_fin);

ALTER TABLE plateforme.rapports_rse ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.bordereaux_savr
-- Bordereau de pesée ZD généré par Savr (PDF).
-- Embargo H+24 sur realisee_at → batch J+1 6h.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.bordereaux_savr (
  id                 uuid                              PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id        uuid                              NOT NULL UNIQUE REFERENCES plateforme.collectes(id),
  statut             plateforme.document_statut_enum   NOT NULL DEFAULT 'en_attente',
  pdf_fichier_id     uuid                              REFERENCES shared.fichiers(id),
  genere_at          timestamptz,
  eligible_at        timestamptz,                     -- = realisee_at + 24h (calculé par batch)
  erreur_detail      text,
  created_at         timestamptz                       NOT NULL DEFAULT now(),
  updated_at         timestamptz                       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bordereaux_statut
  ON plateforme.bordereaux_savr (statut);
CREATE INDEX IF NOT EXISTS idx_bordereaux_eligible
  ON plateforme.bordereaux_savr (eligible_at) WHERE statut = 'en_attente';

ALTER TABLE plateforme.bordereaux_savr ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.attestations_don
-- Attestation fiscale Cerfa 2041-GE pour les collectes AG.
-- mention_fiscale_2041ge selon association.habilitee_fiscale.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.attestations_don (
  id                       uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id              uuid                            NOT NULL UNIQUE REFERENCES plateforme.collectes(id),
  association_id           uuid                            NOT NULL REFERENCES plateforme.associations(id),
  mention_fiscale_2041ge   boolean                         NOT NULL DEFAULT false,
  poids_kg                 numeric(10,2),
  nb_repas                 integer,
  valeur_don_estimee_ht    numeric(10,2),
  statut                   plateforme.document_statut_enum NOT NULL DEFAULT 'en_attente',
  pdf_fichier_id           uuid                            REFERENCES shared.fichiers(id),
  genere_at                timestamptz,
  eligible_at              timestamptz,
  erreur_detail            text,
  created_at               timestamptz                     NOT NULL DEFAULT now(),
  updated_at               timestamptz                     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attestations_statut
  ON plateforme.attestations_don (statut);
CREATE INDEX IF NOT EXISTS idx_attestations_association
  ON plateforme.attestations_don (association_id);
CREATE INDEX IF NOT EXISTS idx_attestations_eligible
  ON plateforme.attestations_don (eligible_at) WHERE statut = 'en_attente';

ALTER TABLE plateforme.attestations_don ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.documents_generaux_savr
-- Docs généraux produits par Savr (hors bordereau/attestation/facture).
-- entity_type / entity_id : polymorphe.
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.documents_generaux_savr (
  id              uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
  type_document   text                            NOT NULL,
  entity_type     text                            NOT NULL,
  entity_id       uuid                            NOT NULL,
  statut          plateforme.document_statut_enum NOT NULL DEFAULT 'en_attente',
  pdf_fichier_id  uuid                            REFERENCES shared.fichiers(id),
  genere_at       timestamptz,
  erreur_detail   text,
  created_at      timestamptz                     NOT NULL DEFAULT now(),
  updated_at      timestamptz                     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_generaux_entity
  ON plateforme.documents_generaux_savr (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_docs_generaux_statut
  ON plateforme.documents_generaux_savr (statut);

ALTER TABLE plateforme.documents_generaux_savr ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- plateforme.exports_registre
-- Exports CSV du registre réglementaire ZD (collectes cloturees ZD only).
-- ============================================================

CREATE TABLE IF NOT EXISTS plateforme.exports_registre (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid        NOT NULL REFERENCES plateforme.organisations(id),
  created_by       uuid        NOT NULL REFERENCES plateforme.users(id),
  periode_debut    date        NOT NULL,
  periode_fin      date        NOT NULL CHECK (periode_fin >= periode_debut),
  nb_collectes     integer     NOT NULL DEFAULT 0,
  fichier_id       uuid        REFERENCES shared.fichiers(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exports_registre_organisation
  ON plateforme.exports_registre (organisation_id);

ALTER TABLE plateforme.exports_registre ENABLE ROW LEVEL SECURITY;
