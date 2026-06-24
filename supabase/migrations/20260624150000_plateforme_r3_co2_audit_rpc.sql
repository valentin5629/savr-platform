-- =============================================================================
-- R3 / BL-P0-06 — Mécanisme d'audit-write des paramètres CO₂ + taux recyclage.
-- =============================================================================
-- Contexte : divergence _Divergences/M2.4_20260624.md + arbitrage Val 2026-06-24
-- (Option A : RPC SECURITY DEFINER par famille ; taux_recyclage inclus dans R3).
--
-- Problème corrigé (démontré empiriquement) : les API Routes admin utilisent le
-- client service-role (`auth.uid()` = NULL) → les triggers d'audit history
-- (`modifie_par NOT NULL`) échouaient ("null value in column modifie_par"), et
-- sous client authenticated l'INSERT dans les tables `_history` (RLS = SELECT
-- only) était refusé. Aucun chemin de client ne fonctionnait.
--
-- Solution :
--   1. Helper `f_audit_user()` : lit le GUC `savr.audit_user` (posé par la RPC),
--      fallback `auth.uid()` pour le chemin authenticated direct.
--   2. Triggers history `fn_audit_facteurs_co2` / `_ag` / `_taux_recyclage` rendus
--      SECURITY DEFINER (l'INSERT dans `_history` bypass la RLS) + `modifie_par`
--      résolu via `f_audit_user()`.
--   3. Trigger history MANQUANT ajouté pour `parametres_mix_emballages`
--      (CDC §R_co2_snapshot_fige l'exige).
--   4. `fn_validate_mix_emballages` / `fn_recompute_emballage_fe` gatés sur le GUC
--      `savr.mix_batch` (validation/recompute différés à la fin du batch RPC, sinon
--      une redistribution multi-lignes viole transitoirement Σ=100).
--   5. `fn_audit_parametres_co2_divers` : auteur capté via `f_audit_user()` + motif.
--   6. 5 RPC SECURITY DEFINER (1/famille) qui posent `savr.audit_motif` +
--      `savr.audit_user` en SET LOCAL puis exécutent l'UPDATE — réservées
--      `service_role` (les routes appellent en service-role + requireAdmin).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper : auteur d'audit courant (GUC prioritaire, fallback auth.uid())
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.f_audit_user()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = plateforme, public
AS $fn$
  SELECT COALESCE(
    NULLIF(current_setting('savr.audit_user', true), '')::uuid,
    auth.uid()
  );
$fn$;

GRANT EXECUTE ON FUNCTION plateforme.f_audit_user() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 2. Triggers history existants → SECURITY DEFINER + modifie_par via f_audit_user()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_audit_facteurs_co2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  IF (OLD.fe_induit_kg_t IS DISTINCT FROM NEW.fe_induit_kg_t
    OR OLD.fe_evite_kg_t IS DISTINCT FROM NEW.fe_evite_kg_t
    OR OLD.energie_primaire_evitee_kwh_t IS DISTINCT FROM NEW.energie_primaire_evitee_kwh_t) THEN
    INSERT INTO plateforme.parametres_facteurs_co2_history (
      parametre_id, code_flux,
      fe_induit_avant, fe_induit_apres,
      fe_evite_avant, fe_evite_apres,
      energie_avant, energie_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.code_flux,
      OLD.fe_induit_kg_t, NEW.fe_induit_kg_t,
      OLD.fe_evite_kg_t, NEW.fe_evite_kg_t,
      OLD.energie_primaire_evitee_kwh_t, NEW.energie_primaire_evitee_kwh_t,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = plateforme.f_audit_user()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION plateforme.fn_audit_facteurs_co2_ag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  IF OLD.facteur_co2_evite_par_repas_kg IS DISTINCT FROM NEW.facteur_co2_evite_par_repas_kg THEN
    INSERT INTO plateforme.parametres_facteurs_co2_ag_history (
      parametre_id, facteur_avant, facteur_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.facteur_co2_evite_par_repas_kg, NEW.facteur_co2_evite_par_repas_kg,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = plateforme.f_audit_user()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION plateforme.fn_audit_taux_recyclage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  IF (OLD.taux_captation IS DISTINCT FROM NEW.taux_captation
    OR OLD.prestataire IS DISTINCT FROM NEW.prestataire
    OR OLD.source_donnee IS DISTINCT FROM NEW.source_donnee) THEN
    INSERT INTO plateforme.parametres_taux_recyclage_history (
      parametre_id, code_filiere,
      taux_captation_avant, taux_captation_apres,
      prestataire_avant, prestataire_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.code_filiere,
      OLD.taux_captation, NEW.taux_captation,
      OLD.prestataire, NEW.prestataire,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = plateforme.f_audit_user()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Trigger history MANQUANT pour parametres_mix_emballages (CDC l'exige)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_audit_mix_emballages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  IF (OLD.part_pct IS DISTINCT FROM NEW.part_pct
    OR OLD.fe_induit_kg_t IS DISTINCT FROM NEW.fe_induit_kg_t
    OR OLD.fe_evite_kg_t IS DISTINCT FROM NEW.fe_evite_kg_t) THEN
    INSERT INTO plateforme.parametres_mix_emballages_history (
      parametre_id, code_materiau,
      part_pct_avant, part_pct_apres,
      fe_induit_avant, fe_induit_apres,
      fe_evite_avant, fe_evite_apres,
      source_donnee_avant, source_donnee_apres,
      commentaire_modif, modifie_par, modifie_le
    ) VALUES (
      OLD.id, OLD.code_materiau,
      OLD.part_pct, NEW.part_pct,
      OLD.fe_induit_kg_t, NEW.fe_induit_kg_t,
      OLD.fe_evite_kg_t, NEW.fe_evite_kg_t,
      OLD.source_donnee, NEW.source_donnee,
      COALESCE(current_setting('savr.audit_motif', true), 'Modification sans motif'),
      (SELECT id FROM plateforme.users WHERE id = plateforme.f_audit_user()),
      now()
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_audit_mix_emballages ON plateforme.parametres_mix_emballages;
CREATE TRIGGER trg_audit_mix_emballages
  AFTER UPDATE ON plateforme.parametres_mix_emballages
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_mix_emballages();

-- ---------------------------------------------------------------------------
-- 4. Validation + recompute mix : gatés sur le GUC savr.mix_batch
--    (une redistribution multi-lignes viole transitoirement Σ=100 si on valide
--     par ligne — la RPC pose savr.mix_batch='1' puis valide/recompute 1 fois).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_validate_mix_emballages()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, public
AS $fn$
DECLARE
  total decimal;
BEGIN
  IF current_setting('savr.mix_batch', true) = '1' THEN
    RETURN NEW;  -- validation différée à la fin du batch (RPC rpc_maj_mix_emballages)
  END IF;
  SELECT COALESCE(SUM(part_pct), 0)
    INTO total
    FROM plateforme.parametres_mix_emballages
    WHERE actif = true
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  total := total + CASE WHEN NEW.actif THEN NEW.part_pct ELSE 0 END;
  IF ABS(total - 100) > 0.05 THEN
    RAISE EXCEPTION 'La somme des parts du mix emballages doit être 100 %% (actuelle : %)', total;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION plateforme.fn_recompute_emballage_fe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, public
AS $fn$
DECLARE
  new_induit decimal(8,2);
  new_evite  decimal(8,2);
BEGIN
  IF current_setting('savr.mix_batch', true) = '1' THEN
    RETURN NEW;  -- recompute différé à la fin du batch (RPC rpc_maj_mix_emballages)
  END IF;
  SELECT
    ROUND(SUM(part_pct / 100.0 * fe_induit_kg_t), 2),
    ROUND(SUM(part_pct / 100.0 * fe_evite_kg_t), 2)
  INTO new_induit, new_evite
  FROM plateforme.parametres_mix_emballages
  WHERE actif = true;

  UPDATE plateforme.parametres_facteurs_co2
  SET fe_induit_kg_t = COALESCE(new_induit, 0),
      fe_evite_kg_t  = COALESCE(new_evite, 0),
      updated_at     = now()
  WHERE code_flux = 'emballage';

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. co2_divers : auditée via audit_log — auteur capté via f_audit_user() + motif
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_audit_parametres_co2_divers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  INSERT INTO plateforme.audit_log (
    user_id, role, action, table_name, record_id, old_values, new_values, motif
  ) VALUES (
    plateforme.f_audit_user(),
    plateforme.f_app_role(),
    'parametres_co2_divers_update',
    'parametres_co2_divers',
    NEW.id,
    jsonb_build_object('cle', OLD.cle, 'valeur', OLD.valeur),
    jsonb_build_object('cle', NEW.cle, 'valeur', NEW.valeur),
    current_setting('savr.audit_motif', true)
  );
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. RPC SECURITY DEFINER — 1 par famille. Posent motif + auteur (SET LOCAL),
--    exécutent l'UPDATE (triggers → history/audit). Réservées service_role.
-- ---------------------------------------------------------------------------

-- Garde commune : commentaire obligatoire + auteur admin_savr actif.
CREATE OR REPLACE FUNCTION plateforme.f_assert_audit_context(p_auteur uuid, p_commentaire text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
BEGIN
  IF p_commentaire IS NULL OR length(btrim(p_commentaire)) < 5 THEN
    RAISE EXCEPTION 'commentaire_modif obligatoire (>= 5 caractères)'
      USING errcode = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.users
    WHERE id = p_auteur AND role = 'admin_savr' AND actif
  ) THEN
    RAISE EXCEPTION 'auteur non autorisé (admin_savr actif requis)'
      USING errcode = '42501';
  END IF;
  PERFORM set_config('savr.audit_motif', p_commentaire, true);
  PERFORM set_config('savr.audit_user', p_auteur::text, true);
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.f_assert_audit_context(uuid, text) FROM PUBLIC;

-- 6.1 Facteurs CO₂ par flux ZD (emballage exclu : dérivé du mix)
CREATE OR REPLACE FUNCTION plateforme.rpc_maj_facteurs_co2(
  p_auteur uuid,
  p_commentaire text,
  p_facteurs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_item jsonb;
BEGIN
  IF p_facteurs IS NULL OR jsonb_typeof(p_facteurs) <> 'array' OR jsonb_array_length(p_facteurs) = 0 THEN
    RAISE EXCEPTION 'facteurs obligatoire (tableau non vide)' USING errcode = '22023';
  END IF;
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_commentaire);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_facteurs) LOOP
    -- Ligne 'emballage' : FE induit/évité DÉRIVÉS du mix (lecture seule), mais
    -- l'énergie primaire reste éditée à la main (CDC §06.06 §9.1 + R_co2_emballage_mix).
    UPDATE plateforme.parametres_facteurs_co2 SET
      fe_induit_kg_t = CASE WHEN code_flux = 'emballage' THEN fe_induit_kg_t
                            ELSE COALESCE((v_item->>'fe_induit_kg_t')::decimal, fe_induit_kg_t) END,
      fe_evite_kg_t  = CASE WHEN code_flux = 'emballage' THEN fe_evite_kg_t
                            ELSE COALESCE((v_item->>'fe_evite_kg_t')::decimal, fe_evite_kg_t) END,
      energie_primaire_evitee_kwh_t =
        COALESCE((v_item->>'energie_primaire_evitee_kwh_t')::decimal, energie_primaire_evitee_kwh_t),
      source_donnee  = COALESCE(v_item->>'source_donnee', source_donnee),
      date_maj       = now(),
      updated_at     = now()
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;

  RETURN (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code_flux)
          FROM plateforme.parametres_facteurs_co2 t);
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.rpc_maj_facteurs_co2(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_maj_facteurs_co2(uuid, text, jsonb) TO service_role;

-- 6.2 Mix emballages (batch : valide Σ=100 + recompute emballage 1 seule fois)
CREATE OR REPLACE FUNCTION plateforme.rpc_maj_mix_emballages(
  p_auteur uuid,
  p_commentaire text,
  p_mix jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_item     jsonb;
  v_total    decimal;
  v_induit   decimal(8,2);
  v_evite    decimal(8,2);
BEGIN
  IF p_mix IS NULL OR jsonb_typeof(p_mix) <> 'array' OR jsonb_array_length(p_mix) = 0 THEN
    RAISE EXCEPTION 'mix obligatoire (tableau non vide)' USING errcode = '22023';
  END IF;
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_commentaire);

  -- Diffère validation + recompute le temps d'appliquer toutes les lignes.
  PERFORM set_config('savr.mix_batch', '1', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_mix) LOOP
    -- part_pct par matériau + FE matériau éditables (CDC §06.06 §9.2).
    UPDATE plateforme.parametres_mix_emballages SET
      part_pct       = COALESCE((v_item->>'part_pct')::decimal, part_pct),
      fe_induit_kg_t = COALESCE((v_item->>'fe_induit_kg_t')::decimal, fe_induit_kg_t),
      fe_evite_kg_t  = COALESCE((v_item->>'fe_evite_kg_t')::decimal, fe_evite_kg_t),
      date_maj       = now(),
      updated_at     = now()
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;

  -- Validation finale Σ = 100 (tolérance 0.05)
  SELECT COALESCE(SUM(part_pct), 0) INTO v_total
  FROM plateforme.parametres_mix_emballages WHERE actif = true;
  IF ABS(v_total - 100) > 0.05 THEN
    RAISE EXCEPTION 'La somme des parts du mix emballages doit être 100 %% (reçu : %)', v_total
      USING errcode = '22023';
  END IF;

  -- Recompute emballage FE une seule fois (UPDATE → fn_audit_facteurs_co2 → 1 history)
  SELECT ROUND(SUM(part_pct / 100.0 * fe_induit_kg_t), 2),
         ROUND(SUM(part_pct / 100.0 * fe_evite_kg_t), 2)
    INTO v_induit, v_evite
  FROM plateforme.parametres_mix_emballages WHERE actif = true;

  UPDATE plateforme.parametres_facteurs_co2
  SET fe_induit_kg_t = COALESCE(v_induit, 0),
      fe_evite_kg_t  = COALESCE(v_evite, 0),
      updated_at     = now()
  WHERE code_flux = 'emballage';

  RETURN (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.code_materiau)
          FROM plateforme.parametres_mix_emballages t);
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.rpc_maj_mix_emballages(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_maj_mix_emballages(uuid, text, jsonb) TO service_role;

-- 6.3 Facteur CO₂ évité AG (1 ligne)
CREATE OR REPLACE FUNCTION plateforme.rpc_maj_facteur_co2_ag(
  p_auteur uuid,
  p_commentaire text,
  p_id uuid,
  p_facteur decimal
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_row jsonb;
BEGIN
  IF p_facteur IS NULL OR p_facteur < 0 THEN
    RAISE EXCEPTION 'facteur_co2_evite_par_repas_kg invalide (>= 0)' USING errcode = '22023';
  END IF;
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_commentaire);

  UPDATE plateforme.parametres_facteurs_co2_ag SET
    facteur_co2_evite_par_repas_kg = p_facteur,
    date_maj   = now(),
    updated_at = now()
  WHERE id = p_id
  RETURNING to_jsonb(parametres_facteurs_co2_ag.*) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'parametre facteur AG introuvable' USING errcode = 'P0002';
  END IF;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.rpc_maj_facteur_co2_ag(uuid, text, uuid, decimal) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_maj_facteur_co2_ag(uuid, text, uuid, decimal) TO service_role;

-- 6.4 CO₂ divers (clé-valeur) — audit via audit_log
CREATE OR REPLACE FUNCTION plateforme.rpc_maj_co2_divers(
  p_auteur uuid,
  p_commentaire text,
  p_divers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_item jsonb;
BEGIN
  IF p_divers IS NULL OR jsonb_typeof(p_divers) <> 'array' OR jsonb_array_length(p_divers) = 0 THEN
    RAISE EXCEPTION 'divers obligatoire (tableau non vide)' USING errcode = '22023';
  END IF;
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_commentaire);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_divers) LOOP
    UPDATE plateforme.parametres_co2_divers SET
      valeur     = COALESCE((v_item->>'valeur')::decimal, valeur),
      updated_at = now()
    WHERE id = (v_item->>'id')::uuid;
  END LOOP;

  RETURN (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.cle)
          FROM plateforme.parametres_co2_divers t);
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.rpc_maj_co2_divers(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_maj_co2_divers(uuid, text, jsonb) TO service_role;

-- 6.5 Taux de recyclage (filière) — inclus R3 (même défaut, arbitrage Val)
CREATE OR REPLACE FUNCTION plateforme.rpc_maj_taux_recyclage(
  p_auteur uuid,
  p_commentaire text,
  p_id uuid,
  p_taux decimal
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $fn$
DECLARE
  v_row jsonb;
BEGIN
  IF p_taux IS NULL OR p_taux < 0 OR p_taux > 1 THEN
    RAISE EXCEPTION 'taux_captation doit être compris entre 0 et 1' USING errcode = '22023';
  END IF;
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_commentaire);

  UPDATE plateforme.parametres_taux_recyclage SET
    taux_captation = p_taux,
    date_maj       = now(),
    updated_at     = now()
  WHERE id = p_id
  RETURNING to_jsonb(parametres_taux_recyclage.*) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'filière introuvable' USING errcode = 'P0002';
  END IF;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION plateforme.rpc_maj_taux_recyclage(uuid, text, uuid, decimal) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_maj_taux_recyclage(uuid, text, uuid, decimal) TO service_role;
