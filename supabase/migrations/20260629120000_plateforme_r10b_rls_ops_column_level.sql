-- R10b · BL-P1-API-01 — RLS ops column-level (défense en profondeur, escalade de privilège)
--
-- CONTEXTE (audit conformité §09 Auth/permissions, matrice étendue ops_savr l.386-419) :
-- les policies d'écriture ops (`fac_ops_update`, `asso_ops_update`, `org_ops_write`)
-- et les policies UPDATE de `users` n'avaient AUCUNE restriction de colonne →
--   • `plateforme.users.role` : N'IMPORTE QUEL user authentifié pouvait
--     `UPDATE users SET role='admin_savr' WHERE id=auth.uid()` (policies `usr_self_update`,
--     `usr_ops_write`, `usr_manager_update` : WITH CHECK = id/org seul, jamais le rôle cible)
--     → AUTO-PROMOTION admin = escalade de privilège (matrice §09 l.411 : promotion
--     admin_savr réservée admin_savr).
--   • `factures.montant_*` (§09 l.397 « Éditer ligne/montant » = admin only),
--     `associations.habilitee_attestation_fiscale` + désactivation (`actif`) (l.402-403),
--     `organisations.tarif_refacture_pax_zd` (l.407) : écrivables par ops via PostgREST direct.
--
-- MÉCANISME : column-level GRANT/REVOKE Postgres est inopérant ici — tous les users
-- applicatifs (y compris ops) se connectent sous le MÊME rôle Postgres `authenticated`
-- (le rôle métier est dans le claim JWT `user_role`, lu par `plateforme.f_app_role()`).
-- Un REVOKE colonne FROM authenticated frapperait donc tous les rôles clients.
-- → On enforce par TRIGGERS BEFORE (comparaison OLD/NEW), gardés par le rôle applicatif.
-- Approche PUREMENT ADDITIVE : aucune policy DROP+CREATE (backward-compatible, les gardes
-- `deleted_at IS NULL` de R7 et les policies existantes restent intactes).
--
-- EXEMPTION service_role / système : `current_user` = 'authenticated' uniquement pour les
-- requêtes app via PostgREST (prod ET pgTAP via set_config('role','authenticated')). Les
-- routes admin (service_role) → current_user='service_role', les seeds/migrations →
-- 'postgres' : ces contextes BYPASSENT le garde (création légitime d'admins, seed).
-- NB : `col_ops` (collectes) N'EST PAS restreint — la matrice §09 l.388-393 autorise
-- l'écriture opérationnelle large d'ops sur collectes ; le seul interdit (« override
-- prestataire AG ») porte sur `attributions_antgaspi`, pas une colonne de `collectes`.

-- ---------------------------------------------------------------------------
-- 1. Anti-escalade : promotion vers admin_savr réservée à admin_savr
--    (couvre TOUTES les policies UPDATE/INSERT de users, pas seulement ops)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_users_block_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  -- Seules les requêtes applicatives (rôle Postgres `authenticated`) sont gardées.
  -- service_role (routes admin) et postgres (seed/migration) sont exemptés.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- NEW.role::text (cast d'une valeur enum déjà typée) — ne référence PAS le nom de
  -- type schéma-qualifié : le rôle `authenticated` n'a pas USAGE pour résoudre
  -- `plateforme.user_role_enum` par nom dans une fonction SECURITY INVOKER (alors que
  -- les policies RLS, évaluées dans le contexte propriétaire, le peuvent).
  IF NEW.role::text = 'admin_savr'
     AND (TG_OP = 'INSERT' OR NEW.role IS DISTINCT FROM OLD.role)
     AND plateforme.f_app_role() IS DISTINCT FROM 'admin_savr' THEN
    RAISE EXCEPTION
      'Promotion en admin_savr réservée à admin_savr (escalade de privilège refusée)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_block_role_escalation ON plateforme.users;
CREATE TRIGGER trg_users_block_role_escalation
  BEFORE INSERT OR UPDATE ON plateforme.users
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_users_block_role_escalation();

-- ---------------------------------------------------------------------------
-- 2. Garde générique : colonnes immuables pour ops_savr (réservées admin_savr)
--    Le set de colonnes interdites est passé en TG_ARGV par table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_ops_block_column_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_col text;
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  -- Ne concerne QUE le rôle applicatif ops_savr. admin_savr (service_role) → f_app_role
  -- NULL ; autres rôles clients déjà bornés par RLS (pas de policy d'écriture sur ces
  -- tables hors la leur). Seul un JWT user_role='ops_savr' déclenche le garde.
  IF plateforme.f_app_role() IS DISTINCT FROM 'ops_savr' THEN
    RETURN NEW;
  END IF;

  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF v_new ->> v_col IS DISTINCT FROM v_old ->> v_col THEN
      RAISE EXCEPTION
        'ops_savr ne peut pas modifier la colonne %.% (action réservée admin_savr)',
        TG_TABLE_NAME, v_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- factures : montants/TVA = admin only (§09 l.397). ops peut valider (statut, pennylane_id...).
DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.factures;
CREATE TRIGGER trg_ops_immutable_cols
  BEFORE UPDATE ON plateforme.factures
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_ops_block_column_change(
    'montant_ht', 'montant_tva', 'montant_ttc', 'taux_tva');

-- associations : habilitation 2041-GE (§09 l.402) + désactivation `actif` (l.403) = admin only.
-- (V1 : pas de colonne `siren` sur associations — la ligne « Modifier SIREN » est sans objet.)
DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.associations;
CREATE TRIGGER trg_ops_immutable_cols
  BEFORE UPDATE ON plateforme.associations
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_ops_block_column_change(
    'habilitee_attestation_fiscale', 'actif');

-- organisations : tarif refacturé ZD = admin only (§09 l.407 + l.137 liste admin-only).
-- Défense en profondeur : la colonne est DÉJÀ protégée par le REVOKE/GRANT column-level
-- de la migration m3_1 (20260616130000, tarif_refacture_pax_zd hors whitelist GRANT) ;
-- le trigger garantit la protection même si ce GRANT venait à changer.
DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.organisations;
CREATE TRIGGER trg_ops_immutable_cols
  BEFORE UPDATE ON plateforme.organisations
  FOR EACH ROW
  EXECUTE FUNCTION plateforme.fn_ops_block_column_change(
    'tarif_refacture_pax_zd');

-- ---------------------------------------------------------------------------
-- 3. factures : annulation = admin only (§09 l.398 « Annuler / Générer avoir »).
--    « Générer avoir » est déjà bloqué pour ops (avoir = INSERT factures ; ops n'a
--    aucune policy INSERT, l'avoir passe par la route admin service_role). Reste
--    « Annuler » : ops peut valider une facture (statut brouillon→emise, l.395) via
--    fac_ops_update, MAIS poser statut='annulee' est réservé admin. Garde de VALEUR
--    (pas d'immuabilité de colonne : ops change légitimement statut pour valider).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_ops_block_facture_annulation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF plateforme.f_app_role() = 'ops_savr'
     AND NEW.statut::text = 'annulee'
     AND NEW.statut IS DISTINCT FROM OLD.statut THEN
    RAISE EXCEPTION
      'ops_savr ne peut pas annuler une facture (réservé admin_savr, §09 l.398)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ops_block_facture_annulation ON plateforme.factures;
CREATE TRIGGER trg_ops_block_facture_annulation
  BEFORE UPDATE ON plateforme.factures
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_ops_block_facture_annulation();

-- ROLLBACK (purement additif — gardes de sécurité, aucune donnée touchée) :
--   DROP TRIGGER IF EXISTS trg_users_block_role_escalation ON plateforme.users;
--   DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.factures;
--   DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.associations;
--   DROP TRIGGER IF EXISTS trg_ops_immutable_cols ON plateforme.organisations;
--   DROP TRIGGER IF EXISTS trg_ops_block_facture_annulation ON plateforme.factures;
--   DROP FUNCTION IF EXISTS plateforme.fn_users_block_role_escalation();
--   DROP FUNCTION IF EXISTS plateforme.fn_ops_block_column_change();
--   DROP FUNCTION IF EXISTS plateforme.fn_ops_block_facture_annulation();
