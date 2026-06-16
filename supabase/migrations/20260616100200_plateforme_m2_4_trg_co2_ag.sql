-- ECR-1 : Trigger AFTER UPDATE collectes → peuple co2_evite_kg + co2_facteurs_snapshot
-- lors de la transition statut → 'cloturee' pour type = 'anti_gaspi'.
-- Spec : R_co2_ag §05 Règles métier + R_co2_snapshot_fige.
-- Idempotence : WHEN (OLD.statut IS DISTINCT FROM NEW.statut) empêche la
-- re-entrée quand le trigger fait lui-même un UPDATE sur la même ligne.

-- ============================================================
-- 1. Seed equiv_km_voiture_kgco2 (§04 Data Model ligne 1219)
-- ============================================================
INSERT INTO plateforme.parametres_co2_divers (cle, valeur, unite, description)
VALUES ('equiv_km_voiture_kgco2', 0.218, 'kgCO₂e/km', 'Équivalence 1 km voiture thermique — ADEME 2024')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- 2. Fonction trigger
-- ============================================================
CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_ag_cloture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
DECLARE
  v_facteur     numeric(8,4);
  v_facteur_ts  timestamptz;
  v_volume      integer;
  v_co2_evite   numeric(10,3);
  v_fe_voiture  numeric(8,4);
  v_snapshot    jsonb;
BEGIN
  -- Facteur CO2 actif (source : parametres_facteurs_co2_ag, actif=true, le plus récent)
  SELECT facteur_co2_evite_par_repas_kg, date_maj
  INTO v_facteur, v_facteur_ts
  FROM plateforme.parametres_facteurs_co2_ag
  WHERE actif = true
  ORDER BY date_maj DESC
  LIMIT 1;

  v_facteur    := COALESCE(v_facteur, 2.5);
  v_facteur_ts := COALESCE(v_facteur_ts, now());

  -- Équivalence km voiture (source : parametres_co2_divers.equiv_km_voiture_kgco2)
  SELECT valeur
  INTO v_fe_voiture
  FROM plateforme.parametres_co2_divers
  WHERE cle = 'equiv_km_voiture_kgco2';

  v_fe_voiture := COALESCE(v_fe_voiture, 0.218);

  -- Volume repas réalisé depuis l'attribution AG
  SELECT volume_repas_realise
  INTO v_volume
  FROM plateforme.attributions_antgaspi
  WHERE collecte_id = NEW.id
  LIMIT 1;

  -- co2_evite_kg = 0 si pas d'attribution ou volume null
  v_co2_evite := COALESCE(v_volume, 0) * v_facteur;

  -- Snapshot figé (reproductibilité attestation — doc officiel)
  v_snapshot := jsonb_build_object(
    'type',                           'anti_gaspi',
    'facteur_co2_evite_par_repas_kg', v_facteur,
    'volume_repas_realise',           COALESCE(v_volume, 0),
    'equivalences',                   jsonb_build_object(
      'km_voiture', round(v_co2_evite / v_fe_voiture)::integer
    ),
    'version_parametres_at',          v_facteur_ts::text
  );

  UPDATE plateforme.collectes
  SET co2_evite_kg          = v_co2_evite,
      co2_facteurs_snapshot = v_snapshot,
      updated_at            = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Trigger (WHEN empêche la boucle sur le self-UPDATE)
-- ============================================================
DROP TRIGGER IF EXISTS trg_co2_ag_cloture ON plateforme.collectes;
CREATE TRIGGER trg_co2_ag_cloture
  AFTER UPDATE ON plateforme.collectes
  FOR EACH ROW
  WHEN (
    NEW.statut::text = 'cloturee'
    AND OLD.statut IS DISTINCT FROM NEW.statut
    AND NEW.type::text = 'anti_gaspi'
  )
  EXECUTE FUNCTION plateforme.fn_trg_co2_ag_cloture();
