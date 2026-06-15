-- M2.4 — Attestation de don AG
-- Aligne attestations_don sur le DDL V2, ajoute f_next_numero_attestation,
-- trigger de régénération auto sur correction volume_repas_realise, et GRANTs.

-- ============================================================
-- 1. Nouveau type attestation_statut (distinct de document_statut_enum)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE plateforme.attestation_statut AS ENUM ('en_attente', 'emise', 'corrigee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Convertir attestations_don.statut → attestation_statut
-- ============================================================
DROP INDEX IF EXISTS plateforme.idx_attestations_eligible;

ALTER TABLE plateforme.attestations_don ALTER COLUMN statut DROP DEFAULT;
ALTER TABLE plateforme.attestations_don
  ALTER COLUMN statut TYPE plateforme.attestation_statut
  USING CASE statut::text
    WHEN 'genere' THEN 'emise'::plateforme.attestation_statut
    ELSE 'en_attente'::plateforme.attestation_statut
  END;
ALTER TABLE plateforme.attestations_don
  ALTER COLUMN statut SET DEFAULT 'en_attente'::plateforme.attestation_statut;

CREATE INDEX IF NOT EXISTS idx_attestations_eligible
  ON plateforme.attestations_don (eligible_at) WHERE statut = 'en_attente';

-- ============================================================
-- 3. Colonnes snapshot alignées sur DDL V2
-- ============================================================
ALTER TABLE plateforme.attestations_don
  ADD COLUMN IF NOT EXISTS attribution_antgaspi_id        uuid REFERENCES plateforme.attributions_antgaspi(id),
  ADD COLUMN IF NOT EXISTS numero                          text UNIQUE,
  ADD COLUMN IF NOT EXISTS date_emission                   date,
  ADD COLUMN IF NOT EXISTS date_collecte                   date,
  ADD COLUMN IF NOT EXISTS donateur_entite_facturation_id  uuid REFERENCES plateforme.entites_facturation(id),
  ADD COLUMN IF NOT EXISTS donateur_raison_sociale         text,
  ADD COLUMN IF NOT EXISTS donateur_siret                  text,
  ADD COLUMN IF NOT EXISTS association_nom                 text,
  ADD COLUMN IF NOT EXISTS association_numero_rup          text,
  ADD COLUMN IF NOT EXISTS association_habilitation        text,
  ADD COLUMN IF NOT EXISTS volume_repas                    integer,
  ADD COLUMN IF NOT EXISTS co2_evite_kg                    numeric(10,3),
  ADD COLUMN IF NOT EXISTS co2_facteurs_snapshot           jsonb,
  ADD COLUMN IF NOT EXISTS version                         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pdf_url                         text;

-- ============================================================
-- 4. Numérotation gapless ATT-DON-YYYY-NNNNN
-- ============================================================
CREATE OR REPLACE FUNCTION plateforme.f_next_numero_attestation(
  p_annee integer DEFAULT EXTRACT(YEAR FROM now())::integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO plateforme.sequences_facturation (serie, annee, dernier)
  VALUES ('ATTDON', p_annee, 1)
  ON CONFLICT (serie, annee) DO UPDATE
    SET dernier    = plateforme.sequences_facturation.dernier + 1,
        updated_at = now()
  RETURNING dernier INTO v_next;

  RETURN 'ATT-DON-' || p_annee::text || '-' || LPAD(v_next::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.f_next_numero_attestation TO service_role;

-- ============================================================
-- 5. Trigger : régénération automatique sur correction volume_repas_realise
-- Scénario : Admin corrige poids_repas_kg (→ BEFORE trigger calcule
-- volume_repas_realise) OU Admin corrige directement volume_repas_realise.
-- AFTER UPDATE : marque l'ancienne 'emise' en 'corrigee', crée version+1.
-- ============================================================
CREATE OR REPLACE FUNCTION plateforme.fn_trg_regenerer_attestation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_att             plateforme.attestations_don;
  v_facteur         numeric;
  v_co2_evite       numeric;
  v_snapshot        jsonb;
  v_nouveau_numero  text;
  v_new_att_id      uuid;
  v_payload         jsonb;
  v_nom_evenement   text;
  v_date_evenement  text;
BEGIN
  IF OLD.volume_repas_realise IS NOT DISTINCT FROM NEW.volume_repas_realise THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_att
  FROM plateforme.attestations_don
  WHERE attribution_antgaspi_id = NEW.id
    AND statut = 'emise'
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Recalculer le CO2 avec le facteur courant
  SELECT valeur::numeric
  INTO v_facteur
  FROM plateforme.parametres_algo
  WHERE cle = 'co2_kg_par_repas_ag';
  v_facteur := COALESCE(v_facteur, 2.5);
  v_co2_evite := COALESCE(NEW.volume_repas_realise, 0) * v_facteur;
  v_snapshot := jsonb_build_object(
    'co2_kg_par_repas_ag', v_facteur,
    'source', 'regeneration_auto'
  );

  -- Contexte événement pour le payload PDF
  SELECT e.nom_evenement, e.date_evenement::text
  INTO v_nom_evenement, v_date_evenement
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = v_att.collecte_id;

  -- Nouveau numéro
  v_nouveau_numero := plateforme.f_next_numero_attestation(EXTRACT(YEAR FROM now())::integer);

  -- Marquer l'ancienne comme supersédée
  UPDATE plateforme.attestations_don
  SET statut = 'corrigee', updated_at = now()
  WHERE id = v_att.id;

  -- Créer la nouvelle version (clone snapshot + mise à jour volume/co2)
  INSERT INTO plateforme.attestations_don (
    collecte_id, attribution_antgaspi_id, association_id,
    mention_fiscale_2041ge, poids_kg, nb_repas, valeur_don_estimee_ht,
    eligible_at,
    numero, date_emission, date_collecte,
    donateur_entite_facturation_id, donateur_raison_sociale, donateur_siret,
    association_nom, association_numero_rup, association_habilitation,
    volume_repas, co2_evite_kg, co2_facteurs_snapshot,
    version, statut
  ) VALUES (
    v_att.collecte_id, v_att.attribution_antgaspi_id, v_att.association_id,
    v_att.mention_fiscale_2041ge,
    CASE WHEN NEW.poids_repas_kg IS NOT NULL THEN NEW.poids_repas_kg
         ELSE v_att.poids_kg END,
    NEW.volume_repas_realise, v_att.valeur_don_estimee_ht,
    now(),
    v_nouveau_numero, CURRENT_DATE, v_att.date_collecte,
    v_att.donateur_entite_facturation_id, v_att.donateur_raison_sociale, v_att.donateur_siret,
    v_att.association_nom, v_att.association_numero_rup, v_att.association_habilitation,
    NEW.volume_repas_realise, v_co2_evite, v_snapshot,
    v_att.version + 1, 'en_attente'
  ) RETURNING id INTO v_new_att_id;

  -- Construire le payload PDF
  v_payload := jsonb_build_object(
    'numero',                  v_nouveau_numero,
    'date_emission',           CURRENT_DATE::text,
    'date_collecte',           COALESCE(v_att.date_collecte::text, CURRENT_DATE::text),
    'nom_evenement',           COALESCE(v_nom_evenement, ''),
    'date_evenement',          COALESCE(v_date_evenement, ''),
    'donateur_raison_sociale', COALESCE(v_att.donateur_raison_sociale, ''),
    'donateur_siret',          COALESCE(v_att.donateur_siret, ''),
    'association_nom',         COALESCE(v_att.association_nom, ''),
    'association_numero_rup',  v_att.association_numero_rup,
    'mention_fiscale_2041ge',  v_att.mention_fiscale_2041ge,
    'volume_repas',            NEW.volume_repas_realise,
    'poids_kg',                v_att.poids_kg,
    'co2_evite_kg',            v_co2_evite,
    'co2_facteurs_version',    COALESCE(
                                 (v_snapshot->>'co2_kg_par_repas_ag'),
                                 '2.5'
                               )
  );

  -- Enqueuer le job PDF de régénération
  INSERT INTO plateforme.jobs_pdf (
    type_document, entity_type, entity_id, payload, statut, attempts
  ) VALUES (
    'attestation-don', 'attestations_don', v_new_att_id, v_payload, 'pending', 0
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_regenerer_attestation ON plateforme.attributions_antgaspi;
CREATE TRIGGER trg_regenerer_attestation
  AFTER UPDATE ON plateforme.attributions_antgaspi
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_regenerer_attestation();

-- ============================================================
-- 6. GRANT (règle post-M0.4a : toute table créée après doit avoir GRANT explicite)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.attestations_don TO authenticated;
