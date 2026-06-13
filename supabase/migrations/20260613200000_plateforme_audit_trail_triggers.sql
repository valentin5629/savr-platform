-- =============================================================================
-- M0.10 — Audit trail
-- =============================================================================
-- (1) Colonnes manquantes sur audit_log : impersonator_id, motif, details
-- (2) Index action + created_at
-- (3) Fonction centrale f_log_audit() SECURITY DEFINER (service_role uniquement)
-- (4) Triggers DB : controle_acces_cascade, pack_debit, pack_recredit,
--     config_auto_accept, parametres_algo, parametres_co2_divers
-- =============================================================================

-- ============================================================
-- 1. COLONNES MANQUANTES
-- Note : ALTER TABLE sur table partitionnée propage aux partitions.
-- ============================================================

ALTER TABLE plateforme.audit_log
  ADD COLUMN IF NOT EXISTS impersonator_id uuid REFERENCES plateforme.users(id),
  ADD COLUMN IF NOT EXISTS motif            text,
  ADD COLUMN IF NOT EXISTS details          jsonb;

-- Index sur action pour les requêtes de filtrage par type d'opération
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON plateforme.audit_log (action, created_at DESC);

-- ============================================================
-- 2. FONCTION CENTRALE f_log_audit()
-- Seul point d'entrée serveur-side (API Routes, batch).
-- SECURITY DEFINER : s'exécute en tant que postgres, bypass RLS audit_log.
-- REVOKE PUBLIC + GRANT service_role : pas d'appel direct depuis authenticated.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.f_log_audit(
  p_user_id         uuid,
  p_impersonator_id uuid,
  p_role            text,
  p_action          text,
  p_table_name      text,
  p_record_id       uuid,
  p_old_values      jsonb,
  p_new_values      jsonb,
  p_motif           text,
  p_details         jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
  INSERT INTO plateforme.audit_log (
    user_id, impersonator_id, role, action, table_name,
    record_id, old_values, new_values, motif, details
  ) VALUES (
    p_user_id, p_impersonator_id, p_role, p_action, p_table_name,
    p_record_id, p_old_values, p_new_values, p_motif, p_details
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.f_log_audit(
  uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION plateforme.f_log_audit(
  uuid, uuid, text, text, text, uuid, jsonb, jsonb, text, jsonb
) TO service_role;

-- ============================================================
-- 3. HELPER INTERNE : fn_audit_insert()
-- Mutualisé par les triggers pour éviter la duplication.
-- SECURITY DEFINER : bypass RLS audit_log depuis le contexte trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_audit_insert(
  p_action     text,
  p_table_name text,
  p_record_id  uuid,
  p_old_values jsonb,
  p_new_values jsonb,
  p_motif      text,
  p_details    jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
  INSERT INTO plateforme.audit_log (
    user_id, impersonator_id, role, action, table_name,
    record_id, old_values, new_values, motif, details
  ) VALUES (
    auth.uid(),
    (auth.jwt() ->> 'impersonator_id')::uuid,
    auth.jwt() ->> 'role',
    p_action,
    p_table_name,
    p_record_id,
    p_old_values,
    p_new_values,
    p_motif,
    p_details
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_audit_insert(
  text, text, uuid, jsonb, jsonb, text, jsonb
) FROM PUBLIC;

-- ============================================================
-- 4. TRIGGER : controle_acces_cascade + audit
-- Modifie la fonction existante (CREATE OR REPLACE).
-- Ajoute l'INSERT audit_log quand la cascade a bien mis à jour le lieu.
-- SECURITY DEFINER requis pour écrire dans audit_log depuis le trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_controle_acces_cascade()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  IF NEW.controle_acces_requis = true THEN
    UPDATE plateforme.lieux
    SET controle_acces_requis_default = true,
        updated_at = now()
    WHERE id = (SELECT lieu_id FROM plateforme.evenements WHERE id = NEW.evenement_id)
      AND controle_acces_requis_default = false;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated > 0 THEN
      PERFORM plateforme.fn_audit_insert(
        'controle_acces_cascade_upgrade',
        'collectes',
        NEW.id,
        jsonb_build_object('controle_acces_requis', OLD.controle_acces_requis),
        jsonb_build_object('controle_acces_requis', NEW.controle_acces_requis),
        NULL,
        NULL
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Le trigger existant est conservé tel quel (pas de DROP/CREATE nécessaire).

-- ============================================================
-- 5. TRIGGER : pack débit annulation tardive + audit
-- Modifie la fonction existante (CREATE OR REPLACE).
-- SECURITY DEFINER requis pour écrire dans audit_log.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
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

    PERFORM plateforme.fn_audit_insert(
      'pack_debite_annulation_tardive',
      'packs_antgaspi',
      NEW.pack_antgaspi_id,
      NULL,
      NULL,
      NULL,
      jsonb_build_object('collecte_id', NEW.id, 'debit', 1)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. TRIGGER : pack recrédit sur annulation de collecte réalisée
-- Nouveau trigger : restitue 1 crédit quand realisee → annulee.
-- Concerne uniquement AG avec pack assigné.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredite_annulation_collecte()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
  IF OLD.statut = 'realisee'
    AND NEW.statut = 'annulee'
    AND NEW.type = 'anti_gaspi'
    AND NEW.pack_antgaspi_id IS NOT NULL
  THEN
    UPDATE plateforme.packs_antgaspi
    SET nb_utilisees = nb_utilisees - 1,
        updated_at = now()
    WHERE id = NEW.pack_antgaspi_id
      AND nb_utilisees > 0;

    PERFORM plateforme.fn_audit_insert(
      'pack_recredite_annulation_collecte',
      'packs_antgaspi',
      NEW.pack_antgaspi_id,
      NULL,
      NULL,
      NULL,
      jsonb_build_object('collecte_id', NEW.id, 'recredit', 1)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pack_recredite_annulation_collecte
  AFTER UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_recredite_annulation_collecte();

-- ============================================================
-- 7. TRIGGER : config_auto_accept_ag
-- Toute modification (INSERT ou UPDATE) déclenche un audit.
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_audit_config_auto_accept()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
  PERFORM plateforme.fn_audit_insert(
    'config_auto_accept_update',
    'config_auto_accept_ag',
    NEW.id,
    CASE TG_OP WHEN 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_config_auto_accept
  AFTER INSERT OR UPDATE ON plateforme.config_auto_accept_ag
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_config_auto_accept();

-- ============================================================
-- 8. TRIGGER : parametres_algo
-- Audit sur UPDATE uniquement (INSERT = initialisation admin, pas audité).
-- Motif : lu depuis savr.audit_motif (GUC session, passé par le code appelant).
-- Stocké dans details.motif (pas dans la colonne motif — §04).
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_audit_parametres_algo()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_motif text;
BEGIN
  v_motif := current_setting('savr.audit_motif', true);

  PERFORM plateforme.fn_audit_insert(
    'parametres_algo_update',
    'parametres_algo',
    NEW.id,
    jsonb_build_object('cle', OLD.cle, 'valeur', OLD.valeur),
    jsonb_build_object('cle', NEW.cle, 'valeur', NEW.valeur),
    NULL,
    jsonb_build_object('motif', v_motif)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_parametres_algo
  AFTER UPDATE ON plateforme.parametres_algo
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_parametres_algo();

-- ============================================================
-- 9. TRIGGER : parametres_co2_divers
-- Pas de table _history dédiée — audit via audit_log uniquement (§04 sobriété).
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_audit_parametres_co2_divers()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
BEGIN
  PERFORM plateforme.fn_audit_insert(
    'parametres_co2_divers_update',
    'parametres_co2_divers',
    NEW.id,
    jsonb_build_object('cle', OLD.cle, 'valeur', OLD.valeur),
    jsonb_build_object('cle', NEW.cle, 'valeur', NEW.valeur),
    NULL,
    NULL
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_parametres_co2_divers
  AFTER UPDATE ON plateforme.parametres_co2_divers
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_parametres_co2_divers();
