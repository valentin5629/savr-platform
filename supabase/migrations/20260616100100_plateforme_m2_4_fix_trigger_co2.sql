-- M2.4 fix ECR-3 (suite) + ECR-2
--
-- ECR-3 : aligner DEFAULT et index sur 'brouillon' (renommé depuis 'en_attente'
--         par la migration 20260616100000).
-- ECR-2 : le trigger fn_trg_regenerer_attestation lisait CO2 depuis
--         parametres_algo (clé co2_kg_par_repas_ag). Il doit lire depuis
--         parametres_facteurs_co2_ag (colonne facteur_co2_evite_par_repas_kg).

-- ============================================================
-- 1. DEFAULT de la colonne statut → 'brouillon'
-- ============================================================
ALTER TABLE plateforme.attestations_don
  ALTER COLUMN statut SET DEFAULT 'brouillon'::plateforme.attestation_statut;

-- ============================================================
-- 2. Reconstruire l'index partial avec la bonne valeur d'enum
-- ============================================================
DROP INDEX IF EXISTS plateforme.idx_attestations_eligible;
CREATE INDEX idx_attestations_eligible
  ON plateforme.attestations_don (eligible_at)
  WHERE statut = 'brouillon';

-- ============================================================
-- 3. Trigger réécrit — ECR-2 : source CO2 = parametres_facteurs_co2_ag
--    ECR-3 : statut 'brouillon' à la création de la nouvelle version
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

  -- ECR-2 : lire le facteur CO2 depuis parametres_facteurs_co2_ag
  SELECT facteur_co2_evite_par_repas_kg
  INTO v_facteur
  FROM plateforme.parametres_facteurs_co2_ag
  WHERE actif = true
  ORDER BY date_maj DESC
  LIMIT 1;
  v_facteur := COALESCE(v_facteur, 2.5);

  v_co2_evite := COALESCE(NEW.volume_repas_realise, 0) * v_facteur;
  v_snapshot := jsonb_build_object(
    'facteur_co2_evite_par_repas_kg', v_facteur,
    'source', 'parametres_facteurs_co2_ag'
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

  -- ECR-3 : créer la nouvelle version en 'brouillon' (pas 'en_attente')
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
    v_att.version + 1, 'brouillon'
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
                                 (v_snapshot->>'facteur_co2_evite_par_repas_kg'),
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
