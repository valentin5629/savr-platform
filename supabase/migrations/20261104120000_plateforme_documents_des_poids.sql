-- =============================================================================
-- Documents d'une collecte fabriqués dès que les poids sont là (Val 2026-11-04).
-- =============================================================================
-- 1. Clôture realisee → cloturee à realisee_at + 48 h (au lieu de 24 h) : fin de
--    la fenêtre où MTS-1 peut encore corriger ses pesées, entrée au registre,
--    heure de l'email « document disponible ». L'Admin, lui, peut corriger une
--    pesée à tout moment.
-- 2. CO₂ (et taux de recyclage ZD) recalculés dès que les poids changent sur une
--    collecte réalisée ou clôturée, plus seulement à la clôture : les documents
--    sortent avant elle et sont refaits à chaque correction.
--      ZD : au passage à realisee (pesées dérivées juste avant par l'adapter) et
--           à toute écriture de collecte_flux ;
--      AG : à tout changement du nombre de repas (déduit du poids saisi).
--    Les corps de calcul sont ceux des triggers de clôture (M4.3 ZD, M2.4 AG),
--    inchangés, sortis dans deux fonctions que tous les triggers appellent.
--
-- Rien n'est retiré ni renommé. Les nouvelles fonctions sont fermées aux rôles
-- clients : les calculs ne sont appelés que par les triggers (SECURITY DEFINER,
-- comme les triggers de clôture existants).
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   Rejouer fn_cloturer_collectes_embargo (20260702000000), fn_trg_co2_zd_cloture
--   + trg_co2_zd_cloture (20260619140000) et fn_trg_co2_ag_cloture
--   (20260616100200) ; supprimer les deux triggers et les quatre fonctions
--   créés ici.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_cloturer_collectes_embargo()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_nb integer;
BEGIN
  -- Clôture idempotente (la garde sur le statut rend l'appel rejouable).
  UPDATE plateforme.collectes
  SET statut = 'cloturee'
  WHERE statut = 'realisee'
    AND realisee_at IS NOT NULL
    AND realisee_at + interval '48 hours' <= now();

  GET DIAGNOSTICS v_nb = ROW_COUNT;
  RETURN v_nb;
END;
$$;

COMMENT ON FUNCTION plateforme.fn_cloturer_collectes_embargo() IS
  'Clôture auto realisee → cloturee à realisee_at + 48 h (Val 2026-11-04). Appelée par le cron cloture-embargo. Retourne le nombre de collectes clôturées.';

-- ── Calcul ZD (corps de fn_trg_co2_zd_cloture, M4.3) ─────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_calculer_co2_zd(p_collecte_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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
  WHERE cf.collecte_id = p_collecte_id;

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
    WHERE id = p_collecte_id;
    RETURN;
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
    WHERE cf.collecte_id = p_collecte_id
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
  WHERE cf.collecte_id = p_collecte_id;

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
  WHERE id = p_collecte_id;

  RETURN;
END;
$$;

-- ── Calcul AG (corps de fn_trg_co2_ag_cloture, M2.4) ─────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_calculer_co2_ag(p_collecte_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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
  WHERE collecte_id = p_collecte_id
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
  WHERE id = p_collecte_id;

  RETURN;
END;
$$;

-- ── Triggers de clôture : même calcul, appelé ────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_zd_cloture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
BEGIN
  PERFORM plateforme.fn_calculer_co2_zd(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_ag_cloture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
BEGIN
  PERFORM plateforme.fn_calculer_co2_ag(NEW.id);
  RETURN NEW;
END;
$$;

-- Le passage à realisee recalcule aussi (ZD) : pesées dérivées juste avant.
DROP TRIGGER IF EXISTS trg_co2_zd_cloture ON plateforme.collectes;
CREATE TRIGGER trg_co2_zd_cloture
  AFTER UPDATE ON plateforme.collectes
  FOR EACH ROW
  WHEN (
    NEW.statut::text IN ('realisee', 'cloturee')
    AND OLD.statut IS DISTINCT FROM NEW.statut
    AND NEW.type::text = 'zero_dechet'
  )
  EXECUTE FUNCTION plateforme.fn_trg_co2_zd_cloture();

-- ── Pesées ZD écrites (adapter, saisie Admin) ──────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_zd_pesees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
DECLARE
  v_collecte_id uuid := COALESCE(NEW.collecte_id, OLD.collecte_id);
BEGIN
  IF EXISTS (
    SELECT 1 FROM plateforme.collectes
    WHERE id = v_collecte_id
      AND type::text = 'zero_dechet'
      AND statut::text IN ('realisee', 'cloturee')
  ) THEN
    PERFORM plateforme.fn_calculer_co2_zd(v_collecte_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_co2_zd_pesees ON plateforme.collecte_flux;
CREATE TRIGGER trg_co2_zd_pesees
  AFTER INSERT OR UPDATE OR DELETE ON plateforme.collecte_flux
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_trg_co2_zd_pesees();

-- ── Repas AG changés (poids saisi ou corrigé par l'Admin) ──────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_co2_ag_repas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM plateforme.collectes
    WHERE id = NEW.collecte_id
      AND type::text = 'anti_gaspi'
      AND statut::text IN ('realisee', 'cloturee')
  ) THEN
    PERFORM plateforme.fn_calculer_co2_ag(NEW.collecte_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_co2_ag_repas ON plateforme.attributions_antgaspi;
-- Sans liste de colonnes : le nombre de repas est posé par un trigger BEFORE
-- (trg_calc_volume_repas_realise), hors de la liste SET de la requête, qu'un
-- « UPDATE OF volume_repas_realise » ne verrait pas.
CREATE TRIGGER trg_co2_ag_repas
  AFTER UPDATE ON plateforme.attributions_antgaspi
  FOR EACH ROW
  WHEN (OLD.volume_repas_realise IS DISTINCT FROM NEW.volume_repas_realise)
  EXECUTE FUNCTION plateforme.fn_trg_co2_ag_repas();

REVOKE ALL ON FUNCTION plateforme.fn_calculer_co2_zd(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plateforme.fn_calculer_co2_ag(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plateforme.fn_trg_co2_zd_pesees() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION plateforme.fn_trg_co2_ag_repas() FROM PUBLIC, anon, authenticated;
