-- M1.7 — Pennylane : schéma facturation complet
-- Prérequis : migration 20260615000000 (enums) exécutée.

-- ============================================================
-- 1. sequences_facturation — renommage dernier → dernier_numero
--    (alignement DDL cible V2 §A2)
-- ============================================================

ALTER TABLE plateforme.sequences_facturation
  RENAME COLUMN dernier TO dernier_numero;

-- Mettre à jour f_next_numero_facture pour utiliser dernier_numero
CREATE OR REPLACE FUNCTION plateforme.f_next_numero_facture(
  p_serie plateforme.serie_facturation_enum,
  p_annee smallint
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier_numero)
  VALUES (p_serie, p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier_numero = plateforme.sequences_facturation.dernier_numero + 1,
        updated_at     = now()
  RETURNING dernier_numero INTO v_next;
  RETURN v_next;
END;
$$;

-- Mettre à jour f_next_numero_bordereau pour utiliser dernier_numero
CREATE OR REPLACE FUNCTION plateforme.f_next_numero_bordereau(
  p_annee integer DEFAULT EXTRACT(YEAR FROM now())::integer
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier_numero)
  VALUES ('BSAV', p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier_numero = plateforme.sequences_facturation.dernier_numero + 1,
        updated_at     = now()
  RETURNING dernier_numero INTO v_next;
  RETURN 'BSAV-' || p_annee::text || '-' || LPAD(v_next::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.f_next_numero_facture TO service_role;
GRANT EXECUTE ON FUNCTION plateforme.f_next_numero_bordereau TO service_role;

-- Fonction publique : attribue ET formate le numéro de facture
-- Appelée dans la même transaction que UPDATE factures SET statut='en_attente_pennylane'
CREATE OR REPLACE FUNCTION plateforme.f_attribuer_numero_facture(
  p_serie plateforme.serie_facturation_enum,
  p_annee smallint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_num integer;
  v_prefix text;
BEGIN
  v_num := plateforme.f_next_numero_facture(p_serie, p_annee);
  v_prefix := p_serie::text;   -- 'FZD', 'FAG', 'FPK', 'AV'
  RETURN v_prefix || '-' || p_annee::text || '-' || LPAD(v_num::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.f_attribuer_numero_facture TO service_role;

-- ============================================================
-- 2. factures — colonnes manquantes + numero nullable
-- ============================================================

-- numero_facture devient nullable (NULL = brouillon sans numéro attribué)
ALTER TABLE plateforme.factures
  ALTER COLUMN numero_facture DROP NOT NULL;

ALTER TABLE plateforme.factures
  ADD COLUMN IF NOT EXISTS type                            plateforme.facture_type,
  ADD COLUMN IF NOT EXISTS mode_facturation                plateforme.facture_mode,
  ADD COLUMN IF NOT EXISTS pack_antgaspi_id                uuid REFERENCES plateforme.packs_antgaspi(id),
  ADD COLUMN IF NOT EXISTS erreur_synchro                  text,
  ADD COLUMN IF NOT EXISTS erreur_synchro_at               timestamptz,
  ADD COLUMN IF NOT EXISTS derniere_tentative_pennylane_at timestamptz,
  ADD COLUMN IF NOT EXISTS marge_logistique                numeric(12,2),
  ADD COLUMN IF NOT EXISTS date_paiement                   date;

-- Index partiel pour polling paiement (seules les factures 'emise' sont sondées)
CREATE INDEX IF NOT EXISTS idx_factures_emises_polling
  ON plateforme.factures (id)
  WHERE statut = 'emise';

-- Index partiel pour worker Pennylane retry
CREATE INDEX IF NOT EXISTS idx_factures_attente_pennylane
  ON plateforme.factures (derniere_tentative_pennylane_at)
  WHERE statut = 'en_attente_pennylane';

-- ============================================================
-- 3. factures_collectes — colonnes manquantes + CHECK
-- ============================================================

ALTER TABLE plateforme.factures_collectes
  ADD COLUMN IF NOT EXISTS designation          text,
  ADD COLUMN IF NOT EXISTS quantite             numeric(10,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS taux_tva             numeric(5,2)  NOT NULL DEFAULT 20.00,
  ADD COLUMN IF NOT EXISTS tarif_applique_id    uuid,
  ADD COLUMN IF NOT EXISTS tarif_applique_source plateforme.tarif_source,
  ADD COLUMN IF NOT EXISTS tarif_detail         jsonb,
  ADD COLUMN IF NOT EXISTS montant_ligne_ht     numeric(12,2),
  ADD COLUMN IF NOT EXISTS libelle_ligne        text;

-- CHECK : ligne libre obligatoire si collecte_id NULL (spec §04 A1)
ALTER TABLE plateforme.factures_collectes
  DROP CONSTRAINT IF EXISTS chk_fc_collecte_ou_designation;
ALTER TABLE plateforme.factures_collectes
  ADD CONSTRAINT chk_fc_collecte_ou_designation
  CHECK (collecte_id IS NOT NULL OR designation IS NOT NULL);

-- ============================================================
-- 4. Trigger avoir — autoriser 'emise' et 'payee' (spec §05 F1)
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_check_avoir_facture_valide()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.facture_origine_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM plateforme.factures
      WHERE id = NEW.facture_origine_id
        AND statut IN ('emise', 'payee')
    ) THEN
      RAISE EXCEPTION 'Un avoir ne peut être créé que sur une facture "emise" ou "payee"';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Remplacer l'ancien trigger
DROP TRIGGER IF EXISTS trg_check_avoir_facture_payee ON plateforme.factures;
CREATE TRIGGER trg_check_avoir_facture_valide
  BEFORE INSERT OR UPDATE OF facture_origine_id ON plateforme.factures
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_check_avoir_facture_valide();

-- ============================================================
-- 5. Vue v_factures_client — reconstituée avec les nouvelles colonnes
--    Colonnes exclues : marge_logistique, erreur_synchro*, derniere_tentative_pennylane_at
-- ============================================================

DROP VIEW IF EXISTS plateforme.v_factures_client;
CREATE VIEW plateforme.v_factures_client
  WITH (security_invoker = true)
AS
  SELECT
    id,
    organisation_id,
    entite_facturation_id,
    numero_facture,
    facture_origine_id,
    type,
    mode_facturation,
    pack_antgaspi_id,
    statut,
    montant_ht,
    taux_tva,
    montant_tva,
    montant_ttc,
    devise,
    pennylane_id,
    pdf_url_pennylane,
    pdf_url_savr,
    motif_avoir,
    notes,
    periode_debut,
    periode_fin,
    date_emission,
    date_echeance,
    date_paiement,
    created_at,
    updated_at
    -- Exclues intentionnellement (F5 masquage) :
    -- marge_logistique, erreur_synchro, erreur_synchro_at,
    -- derniere_tentative_pennylane_at, pennylane_statut, pennylane_push_at
  FROM plateforme.factures
  WHERE (
    auth.jwt()->>'role' IN ('traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux')
    AND organisation_id = (auth.jwt()->>'organisation_id')::uuid
  );

GRANT SELECT ON plateforme.v_factures_client TO authenticated;

-- ============================================================
-- 6. GRANTs nouveaux objets
-- ============================================================

GRANT EXECUTE ON FUNCTION plateforme.fn_check_avoir_facture_valide TO authenticated;
