-- M4.3 — Reporting CO₂ ADEME (ZD) : trigger de calcul + snapshot figé à la clôture.
-- Pendant exact de trg_co2_ag_cloture (M2.4) côté zéro déchet.
-- Spec : §05 Règles métier R_co2_calcul + R_taux_recyclage + R_co2_snapshot_fige ;
--        §04 Data Model (collectes.co2_* + caps_appliques + co2_facteurs_snapshot, parametres_co2_divers).
--
-- Produit, à la transition statut → 'cloturee' pour type = 'zero_dechet' :
--   taux_recyclage, caps_appliques, co2_induit_kg, co2_evite_kg, co2_net_kg,
--   energie_primaire_evitee_kwh, co2_facteurs_snapshot.
-- Snapshot figé : les facteurs actifs au moment T sont gelés sur la collecte → une
-- modification ultérieure d'un paramètre n'altère ni la collecte figée ni ses PDF.
-- Recalcul a posteriori (realisee → cloturee re-déclenché) = facteurs DU MOMENT du recalcul.
-- Idempotence : WHEN (OLD.statut IS DISTINCT FROM NEW.statut) empêche la ré-entrée sur le self-UPDATE.

-- ============================================================
-- 1. Seed des clés parametres_co2_divers exigées par R_co2_calcul
--    (forfait collecte + équivalences pédagogiques — §04 Data Model seed V1).
--    Absentes du seed bloc8 ; equiv_km_voiture_kgco2 déjà seedé par M2.4.
-- ============================================================
INSERT INTO plateforme.parametres_co2_divers (cle, valeur, unite, description) VALUES
  ('km_collecte_aller_retour', 50,    'km',          'Distance forfaitaire collecte (V1 ; km réels TMS en V2)'),
  ('fe_camion_benne_kg_km',    2.1,   'kgCO₂e/km',   'FE benne 26 t gazole (Base Carbone V23)'),
  ('equiv_repas_boeuf_kgco2',  7,     'kgCO₂e',      'Équivalence 1 repas avec bœuf'),
  ('equiv_foyer_elec_kwh_an',  4500,  'kWh/an',      'Conso élec annuelle foyer FR (ADEME)')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- 2. Fonction trigger
-- ============================================================
CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_zd_cloture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
DECLARE
  v_p_total       numeric;
  v_km            numeric;
  v_fe_camion     numeric;
  v_forfait       numeric;     -- km × fe_camion (réparti au prorata de P_X / P_total)
  v_induit        numeric;
  v_evite         numeric;
  v_energie       numeric;
  v_net           numeric;
  v_num_taux      numeric;
  v_taux          numeric;
  v_equiv_voiture numeric;
  v_equiv_boeuf   numeric;
  v_equiv_foyer   numeric;
  v_caps          jsonb;
  v_facteurs      jsonb;
  v_mix           jsonb;
  v_snapshot      jsonb;
  v_now           timestamptz := now();
BEGIN
  -- Poids total pesé (toutes filières, OMR/dechet_residuel inclus)
  SELECT COALESCE(SUM(cf.poids_reel_kg), 0)
  INTO v_p_total
  FROM plateforme.collecte_flux cf
  WHERE cf.collecte_id = NEW.id;

  -- Aucune pesée → toutes grandeurs NULL (UI affiche « — »), pas de snapshot
  IF v_p_total IS NULL OR v_p_total = 0 THEN
    UPDATE plateforme.collectes
    SET taux_recyclage              = NULL,
        caps_appliques              = NULL,
        co2_induit_kg               = NULL,
        co2_evite_kg                = NULL,
        co2_net_kg                  = NULL,
        energie_primaire_evitee_kwh = NULL,
        co2_facteurs_snapshot       = NULL,
        updated_at                  = v_now
    WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- Forfait collecte + équivalences (parametres_co2_divers, clé-valeur)
  SELECT valeur INTO v_km            FROM plateforme.parametres_co2_divers WHERE cle = 'km_collecte_aller_retour';
  SELECT valeur INTO v_fe_camion     FROM plateforme.parametres_co2_divers WHERE cle = 'fe_camion_benne_kg_km';
  SELECT valeur INTO v_equiv_voiture FROM plateforme.parametres_co2_divers WHERE cle = 'equiv_km_voiture_kgco2';
  SELECT valeur INTO v_equiv_boeuf   FROM plateforme.parametres_co2_divers WHERE cle = 'equiv_repas_boeuf_kgco2';
  SELECT valeur INTO v_equiv_foyer   FROM plateforme.parametres_co2_divers WHERE cle = 'equiv_foyer_elec_kwh_an';

  v_km        := COALESCE(v_km, 50);
  v_fe_camion := COALESCE(v_fe_camion, 2.1);
  v_forfait   := v_km * v_fe_camion;

  -- Grandeurs CO₂ : Σ sur les flux pesés (facteurs en kgCO₂/tonne → division par 1000).
  -- part_collecte_X = (P_X / P_total) × forfait ; sommée = forfait (réparti intégralement).
  SELECT
    SUM( (s.p / 1000.0) * s.fe_induit + (s.p / v_p_total) * v_forfait ),
    SUM( (s.p / 1000.0) * s.fe_evite ),
    SUM( (s.p / 1000.0) * s.energie )
  INTO v_induit, v_evite, v_energie
  FROM (
    SELECT COALESCE(cf.poids_reel_kg, 0)                 AS p,
           COALESCE(fc.fe_induit_kg_t, 0)                AS fe_induit,
           COALESCE(fc.fe_evite_kg_t, 0)                 AS fe_evite,
           COALESCE(fc.energie_primaire_evitee_kwh_t, 0) AS energie
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    LEFT JOIN plateforme.parametres_facteurs_co2 fc
      ON fc.code_flux::text = fd.code AND fc.actif = true
    WHERE cf.collecte_id = NEW.id
  ) s;

  v_induit  := round(COALESCE(v_induit, 0), 2);
  v_evite   := round(COALESCE(v_evite, 0), 2);   -- valeur positive ; signe − à l'affichage (règle ABC)
  v_energie := round(COALESCE(v_energie, 0), 2);
  v_net     := round(v_induit - v_evite, 2);

  -- Taux de recyclage net (méthode UE 2019/1004) : Σ(P_X × cap_X) / P_total × 100.
  -- dechet_residuel (OMR) n'a pas de captation → numérateur nul, présent au dénominateur seul.
  SELECT COALESCE(SUM(
           CASE WHEN ptr.taux_captation IS NOT NULL
                THEN COALESCE(cf.poids_reel_kg, 0) * ptr.taux_captation
                ELSE 0 END), 0)
  INTO v_num_taux
  FROM plateforme.collecte_flux cf
  JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
  LEFT JOIN plateforme.parametres_taux_recyclage ptr
    ON ptr.code_filiere::text = fd.code AND ptr.actif = true
  WHERE cf.collecte_id = NEW.id;

  v_taux := round(v_num_taux / v_p_total * 100, 2);

  -- Snapshot caps_appliques (4 filières actives + horodatage du gel)
  SELECT jsonb_object_agg(ptr.code_filiere::text, ptr.taux_captation)
  INTO v_caps
  FROM plateforme.parametres_taux_recyclage ptr
  WHERE ptr.actif = true;
  v_caps := COALESCE(v_caps, '{}'::jsonb)
            || jsonb_build_object('version_parametres_at', v_now::text);

  -- Snapshot facteurs CO₂ (5 flux actifs)
  SELECT jsonb_object_agg(fc.code_flux::text, jsonb_build_object(
           'induit',  fc.fe_induit_kg_t,
           'evite',   fc.fe_evite_kg_t,
           'energie', fc.energie_primaire_evitee_kwh_t))
  INTO v_facteurs
  FROM plateforme.parametres_facteurs_co2 fc
  WHERE fc.actif = true;

  -- Snapshot mix emballages (matériaux actifs)
  SELECT jsonb_object_agg(me.code_materiau::text, jsonb_build_object(
           'part_pct', me.part_pct,
           'induit',   me.fe_induit_kg_t,
           'evite',    me.fe_evite_kg_t))
  INTO v_mix
  FROM plateforme.parametres_mix_emballages me
  WHERE me.actif = true;

  v_snapshot := jsonb_build_object(
    'facteurs',         COALESCE(v_facteurs, '{}'::jsonb),
    'mix_emballages',   COALESCE(v_mix, '{}'::jsonb),
    'equivalences',     jsonb_build_object(
      'km_voiture',  COALESCE(v_equiv_voiture, 0.218),
      'repas_boeuf', COALESCE(v_equiv_boeuf, 7),
      'foyer_kwh',   COALESCE(v_equiv_foyer, 4500)),
    'forfait_collecte', jsonb_build_object('km', v_km, 'fe_camion', v_fe_camion),
    'version_parametres_at', v_now::text);

  UPDATE plateforme.collectes
  SET taux_recyclage              = v_taux,
      caps_appliques              = v_caps,
      co2_induit_kg               = v_induit,
      co2_evite_kg                = v_evite,
      co2_net_kg                  = v_net,
      energie_primaire_evitee_kwh = v_energie,
      co2_facteurs_snapshot       = v_snapshot,
      updated_at                  = v_now
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Trigger (WHEN empêche la boucle sur le self-UPDATE)
-- ============================================================
DROP TRIGGER IF EXISTS trg_co2_zd_cloture ON plateforme.collectes;
CREATE TRIGGER trg_co2_zd_cloture
  AFTER UPDATE ON plateforme.collectes
  FOR EACH ROW
  WHEN (
    NEW.statut::text = 'cloturee'
    AND OLD.statut IS DISTINCT FROM NEW.statut
    AND NEW.type::text = 'zero_dechet'
  )
  EXECUTE FUNCTION plateforme.fn_trg_co2_zd_cloture();
