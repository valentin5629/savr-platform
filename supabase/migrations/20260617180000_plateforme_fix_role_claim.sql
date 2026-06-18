-- Fix RLS — le claim JWT applicatif passe de `role` à `user_role` (Option A canonique)
--
-- Cause racine (diagnostic 2026-06-17) : le hook custom access token écrasait le
-- claim réservé `role` (normalement `authenticated`) par le rôle métier
-- (ex: `traiteur_manager`). Supabase/PostgREST lit ce claim pour `SET ROLE` avant
-- d'appliquer la RLS → erreur 22023 « role "traiteur_manager" does not exist » →
-- 401 sur TOUTE requête client (les routes admin passent par le service-role et
-- n'étaient donc pas affectées, d'où le faux négatif). Les pgTAP épinglaient
-- `role=authenticated` à la main, masquant le bug.
--
-- Correctif : le hook n'écrit plus `role` (laisse `authenticated` intact pour
-- PostgREST) et place le rôle métier dans `user_role`. La RLS lit désormais
-- `user_role` via le helper centralisé `plateforme.f_app_role()`.
--
-- ⚠ Après cette migration, les sessions clientes en cours doivent se reconnecter
--   (token en cookie périmé sans le claim `user_role`).

-- ---------------------------------------------------------------------------
-- 1. Hook custom access token — `role` → `user_role`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.fn_custom_access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_user_id     uuid;
  v_role        text;
  v_org_id      uuid;
  v_org_type    text;
  v_claims      jsonb;
BEGIN
  v_user_id := (event->>'user_id')::uuid;

  SELECT
    u.role::text,
    u.organisation_id,
    o.type::text
  INTO v_role, v_org_id, v_org_type
  FROM plateforme.users u
  JOIN plateforme.organisations o ON o.id = u.organisation_id
  WHERE u.id = v_user_id
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN event;
  END IF;

  -- Le claim réservé `role` (= `authenticated`) n'est JAMAIS écrasé : PostgREST
  -- s'en sert pour `SET ROLE`. Le rôle métier va dans `user_role`.
  v_claims := COALESCE(event->'claims', '{}'::jsonb);
  v_claims := v_claims
    || jsonb_build_object('user_role', v_role)
    || jsonb_build_object('organisation_id', v_org_id::text)
    || jsonb_build_object('organisation_type', v_org_type)
    || jsonb_build_object('app_domain', 'plateforme');

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

GRANT EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) FROM authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- 2. Helper centralisé : rôle applicatif courant (claim `user_role`)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plateforme.f_app_role()
RETURNS text LANGUAGE sql STABLE AS
$$ SELECT auth.jwt()->>'user_role' $$;

GRANT EXECUTE ON FUNCTION plateforme.f_app_role() TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Régénération des fonctions, policies et vues (auth.jwt()->>'role'
--    → plateforme.f_app_role()) — généré depuis une base à l'état HEAD
--    (toutes migrations appliquées) : 129 policies, 6 fonctions, 2 vues.
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(flux_code text, bracket text, valeur_kg_pax numeric, median_kg_pax numeric, nb_collectes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role    text := plateforme.f_app_role();
  v_org     uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_evt_org uuid;
  v_evt_top uuid;
  v_pax     integer;
  v_bracket text;
BEGIN
  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible)
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, e.pax
    INTO v_evt_org, v_evt_top, v_pax
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  IF v_role NOT IN ('admin_savr', 'ops_savr')
     AND v_org IS DISTINCT FROM v_evt_org
     AND v_org IS DISTINCT FROM v_evt_top THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux
    SELECT fd.code AS flux_code,
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS valeur_kg_pax
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.valeur_kg_pax,
    b.median_kg_pax,
    COALESCE(b.nb_collectes, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(v_bracket) b
         ON b.flux_code = v.flux_code;
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_collecte_visible(p_collecte_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    WHERE c.id = p_collecte_id
      AND (
        plateforme.f_app_role() IN ('admin_savr','ops_savr')
        OR e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
        OR e.traiteur_operationnel_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
        OR e.client_organisateur_organisation_id     = (auth.jwt()->>'organisation_id')::uuid
        OR (
          e.date_evenement IS NOT NULL  -- garde anti-fuite brouillons tiers (B-2)
          AND e.lieu_id IN (
            SELECT lieu_id FROM plateforme.organisations_lieux
            WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
          )
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION plateforme.f_completer_siret_shadow(p_org_id uuid, p_siret text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role       text := plateforme.f_app_role();
  v_caller_org uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_org        plateforme.organisations;
BEGIN
  -- Garde 1 — rôle agence uniquement
  IF v_role IS DISTINCT FROM 'agence' THEN
    RAISE EXCEPTION 'Action réservée au rôle agence' USING ERRCODE = '42501';
  END IF;

  -- Garde 2 — format SIRET : 14 chiffres exactement
  IF p_siret IS NULL OR p_siret !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'Format SIRET invalide (14 chiffres requis)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM plateforme.organisations WHERE id = p_org_id;

  -- Garde 3 — la cible existe et est une fiche shadow
  IF NOT FOUND OR v_org.est_shadow IS NOT TRUE THEN
    RAISE EXCEPTION 'Organisation cible introuvable ou non shadow' USING ERRCODE = '22023';
  END IF;

  -- Garde 4 — fiche créée par l'organisation appelante
  IF v_org.cree_par_organisation_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Fiche shadow non créée par votre organisation' USING ERRCODE = '42501';
  END IF;

  -- Garde 5 — écrasement interdit
  IF v_org.siret IS NOT NULL THEN
    RAISE EXCEPTION 'SIRET déjà renseigné' USING ERRCODE = '22023';
  END IF;

  UPDATE plateforme.organisations
  SET siret = p_siret, updated_at = now()
  WHERE id = p_org_id;

  -- Notification Admin in-app (F3) — dédupliquée, sans email
  PERFORM plateforme.f_upsert_alerte_admin(
    'shadow_siret_complete',
    'SIRET complété sur fiche traiteur shadow',
    format(
      'Le SIRET de la fiche traiteur shadow « %s » a été renseigné par l''agence.',
      COALESCE(v_org.raison_sociale, v_org.nom)
    ),
    'organisations',
    p_org_id
  );
END $function$
;

CREATE OR REPLACE FUNCTION plateforme.f_is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT plateforme.f_app_role() IN ('admin_savr','ops_savr')
$function$
;

CREATE OR REPLACE FUNCTION plateforme.fn_audit_insert(p_action text, p_table_name text, p_record_id uuid, p_old_values jsonb, p_new_values jsonb, p_motif text, p_details jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
BEGIN
  INSERT INTO plateforme.audit_log (
    user_id, impersonator_id, role, action, table_name,
    record_id, old_values, new_values, motif, details
  ) VALUES (
    auth.uid(),
    (auth.jwt() ->> 'impersonator_id')::uuid,
    plateforme.f_app_role(),
    p_action,
    p_table_name,
    p_record_id,
    p_old_values,
    p_new_values,
    p_motif,
    p_details
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION shared.f_fichier_visible(p_entity_type text, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT CASE p_entity_type
    WHEN 'plateforme.collectes' THEN
      plateforme.f_collecte_visible(p_entity_id)

    WHEN 'plateforme.bordereaux_savr' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.bordereaux_savr WHERE id = p_entity_id))

    WHEN 'plateforme.attestations_don' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.attestations_don WHERE id = p_entity_id))

    WHEN 'plateforme.rapports_rse' THEN
      plateforme.f_collecte_visible(
        (SELECT collecte_id FROM plateforme.rapports_rse WHERE id = p_entity_id))

    WHEN 'plateforme.organisations' THEN
      p_entity_id = (auth.jwt()->>'organisation_id')::uuid

    WHEN 'plateforme.lieux' THEN
      p_entity_id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
        UNION
        SELECT lieu_id FROM plateforme.evenements
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )

    WHEN 'plateforme.evenements' THEN
      EXISTS (
        SELECT 1 FROM plateforme.evenements e WHERE e.id = p_entity_id
          AND (
            e.organisation_id                         = (auth.jwt()->>'organisation_id')::uuid
            OR e.traiteur_operationnel_organisation_id = (auth.jwt()->>'organisation_id')::uuid
            OR e.client_organisateur_organisation_id   = (auth.jwt()->>'organisation_id')::uuid
            OR e.lieu_id IN (
              SELECT lieu_id FROM plateforme.organisations_lieux
              WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
            )
          )
      )

    WHEN 'plateforme.factures' THEN
      -- Scope strict : org-scoped + rôles clients uniquement (jamais client_organisateur)
      EXISTS (
        SELECT 1 FROM plateforme.factures f WHERE f.id = p_entity_id
          AND f.organisation_id = (auth.jwt()->>'organisation_id')::uuid
          AND plateforme.f_app_role() IN (
            'traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux'
          )
      )

    WHEN 'plateforme.documents_generaux_savr' THEN
      EXISTS (
        SELECT 1 FROM plateforme.documents_generaux_savr d
        WHERE d.id = p_entity_id AND d.statut = 'genere'
      )

    ELSE false  -- fail-safe : tout entity_type non listé = deny
  END
$function$
;

DROP POLICY IF EXISTS aa_admin ON plateforme.alertes_admin;
CREATE POLICY aa_admin ON plateforme.alertes_admin AS PERMISSIVE FOR ALL TO authenticated
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS asso_admin ON plateforme.associations;
CREATE POLICY asso_admin ON plateforme.associations AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS asso_ops_select ON plateforme.associations;
CREATE POLICY asso_ops_select ON plateforme.associations AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS asso_ops_update ON plateforme.associations;
CREATE POLICY asso_ops_update ON plateforme.associations AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS att_admin ON plateforme.attestations_don;
CREATE POLICY att_admin ON plateforme.attestations_don AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS att_client_orga_select ON plateforme.attestations_don;
CREATE POLICY att_client_orga_select ON plateforme.attestations_don AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'client_organisateur'::text) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = attestations_don.collecte_id) AND (e.client_organisateur_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))));

DROP POLICY IF EXISTS att_gestionnaire_select ON plateforme.attestations_don;
CREATE POLICY att_gestionnaire_select ON plateforme.attestations_don AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = attestations_don.collecte_id) AND (e.lieu_id IN ( SELECT organisations_lieux.lieu_id
           FROM plateforme.organisations_lieux
          WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))))));

DROP POLICY IF EXISTS att_ops_select ON plateforme.attestations_don;
CREATE POLICY att_ops_select ON plateforme.attestations_don AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS att_traiteur_select ON plateforme.attestations_don;
CREATE POLICY att_traiteur_select ON plateforme.attestations_don AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text, 'agence'::text])) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = attestations_don.collecte_id) AND (e.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))));

DROP POLICY IF EXISTS aa_admin ON plateforme.attributions_antgaspi;
CREATE POLICY aa_admin ON plateforme.attributions_antgaspi AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS aa_write_ops ON plateforme.attributions_antgaspi;
CREATE POLICY aa_write_ops ON plateforme.attributions_antgaspi AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS bord_admin ON plateforme.bordereaux_savr;
CREATE POLICY bord_admin ON plateforme.bordereaux_savr AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS bord_client_orga_select ON plateforme.bordereaux_savr;
CREATE POLICY bord_client_orga_select ON plateforme.bordereaux_savr AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'client_organisateur'::text) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = bordereaux_savr.collecte_id) AND (e.client_organisateur_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))));

DROP POLICY IF EXISTS bord_gestionnaire_select ON plateforme.bordereaux_savr;
CREATE POLICY bord_gestionnaire_select ON plateforme.bordereaux_savr AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = bordereaux_savr.collecte_id) AND (e.lieu_id IN ( SELECT organisations_lieux.lieu_id
           FROM plateforme.organisations_lieux
          WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))))));

DROP POLICY IF EXISTS bord_ops_select ON plateforme.bordereaux_savr;
CREATE POLICY bord_ops_select ON plateforme.bordereaux_savr AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS bord_traiteur_select ON plateforme.bordereaux_savr;
CREATE POLICY bord_traiteur_select ON plateforme.bordereaux_savr AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text, 'agence'::text])) AND (EXISTS ( SELECT 1
   FROM (plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
  WHERE ((c.id = bordereaux_savr.collecte_id) AND (e.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))));

DROP POLICY IF EXISTS cpl_admin ON plateforme.coefficients_perte_labo;
CREATE POLICY cpl_admin ON plateforme.coefficients_perte_labo AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS cpl_ops_read ON plateforme.coefficients_perte_labo;
CREATE POLICY cpl_ops_read ON plateforme.coefficients_perte_labo AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS cf_admin ON plateforme.collecte_flux;
CREATE POLICY cf_admin ON plateforme.collecte_flux AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ct_admin_select ON plateforme.collecte_tournees;
CREATE POLICY ct_admin_select ON plateforme.collecte_tournees AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ct_admin_update ON plateforme.collecte_tournees;
CREATE POLICY ct_admin_update ON plateforme.collecte_tournees AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ct_ops_select ON plateforme.collecte_tournees;
CREATE POLICY ct_ops_select ON plateforme.collecte_tournees AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS col_admin ON plateforme.collectes;
CREATE POLICY col_admin ON plateforme.collectes AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS col_delete_brouillon ON plateforme.collectes;
CREATE POLICY col_delete_brouillon ON plateforme.collectes AS PERMISSIVE FOR DELETE TO public
  USING (((statut = 'brouillon'::plateforme.collecte_statut_enum) AND ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))) OR (((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.created_by = auth.uid()))))))));

DROP POLICY IF EXISTS col_ops ON plateforme.collectes;
CREATE POLICY col_ops ON plateforme.collectes AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS col_update_client ON plateforme.collectes;
CREATE POLICY col_update_client ON plateforme.collectes AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))) AND (statut = ANY (ARRAY['programmee'::plateforme.collecte_statut_enum, 'validee'::plateforme.collecte_statut_enum]))))
  WITH CHECK ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))))));

DROP POLICY IF EXISTS col_update_commercial ON plateforme.collectes;
CREATE POLICY col_update_commercial ON plateforme.collectes AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.created_by = auth.uid())))) AND (statut = ANY (ARRAY['programmee'::plateforme.collecte_statut_enum, 'validee'::plateforme.collecte_statut_enum]))))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (EXISTS ( SELECT 1
   FROM plateforme.evenements e
  WHERE ((e.id = collectes.evenement_id) AND (e.created_by = auth.uid()))))));

DROP POLICY IF EXISTS caa_admin ON plateforme.config_auto_accept_ag;
CREATE POLICY caa_admin ON plateforme.config_auto_accept_ag AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ct_admin ON plateforme.contacts_traiteurs;
CREATE POLICY ct_admin ON plateforme.contacts_traiteurs AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ct_ops_select ON plateforme.contacts_traiteurs;
CREATE POLICY ct_ops_select ON plateforme.contacts_traiteurs AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS ct_traiteur_select ON plateforme.contacts_traiteurs;
CREATE POLICY ct_traiteur_select ON plateforme.contacts_traiteurs AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS ct_traiteur_write ON plateforme.contacts_traiteurs;
CREATE POLICY ct_traiteur_write ON plateforme.contacts_traiteurs AS PERMISSIVE FOR ALL TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS dg_write ON plateforme.documents_generaux_savr;
CREATE POLICY dg_write ON plateforme.documents_generaux_savr AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS dep_admin_write ON plateforme.domaines_email_publics;
CREATE POLICY dep_admin_write ON plateforme.domaines_email_publics AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS etpl_admin_read ON plateforme.email_templates;
CREATE POLICY etpl_admin_read ON plateforme.email_templates AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS eenv_admin_read ON plateforme.emails_envoyes;
CREATE POLICY eenv_admin_read ON plateforme.emails_envoyes AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS evt_admin ON plateforme.evenements;
CREATE POLICY evt_admin ON plateforme.evenements AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS evt_agence_insert ON plateforme.evenements;
CREATE POLICY evt_agence_insert ON plateforme.evenements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'agence'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_agence_select ON plateforme.evenements;
CREATE POLICY evt_agence_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_agence_update ON plateforme.evenements;
CREATE POLICY evt_agence_update ON plateforme.evenements AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND plateforme.f_collecte_editable(id)))
  WITH CHECK ((((plateforme.f_app_role()) = 'agence'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_client_orga_select ON plateforme.evenements;
CREATE POLICY evt_client_orga_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'client_organisateur'::text) AND (client_organisateur_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_commercial_insert ON plateforme.evenements;
CREATE POLICY evt_commercial_insert ON plateforme.evenements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND (created_by = auth.uid())));

DROP POLICY IF EXISTS evt_commercial_select ON plateforme.evenements;
CREATE POLICY evt_commercial_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND ((organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) OR (traiteur_operationnel_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))));

DROP POLICY IF EXISTS evt_commercial_update ON plateforme.evenements;
CREATE POLICY evt_commercial_update ON plateforme.evenements AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (created_by = auth.uid()) AND plateforme.f_collecte_editable(id)))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (created_by = auth.uid())));

DROP POLICY IF EXISTS evt_gestionnaire_insert ON plateforme.evenements;
CREATE POLICY evt_gestionnaire_insert ON plateforme.evenements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND (lieu_id IN ( SELECT organisations_lieux.lieu_id
   FROM plateforme.organisations_lieux
  WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))) AND (traiteur_operationnel_organisation_id IN ( SELECT organisations.id
   FROM plateforme.organisations
  WHERE ((organisations.type = 'traiteur'::plateforme.organisation_type_enum) AND (organisations.est_shadow = false))))));

DROP POLICY IF EXISTS evt_gestionnaire_select ON plateforme.evenements;
CREATE POLICY evt_gestionnaire_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND ((organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) OR ((date_evenement IS NOT NULL) AND (lieu_id IN ( SELECT organisations_lieux.lieu_id
   FROM plateforme.organisations_lieux
  WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))))));

DROP POLICY IF EXISTS evt_gestionnaire_update ON plateforme.evenements;
CREATE POLICY evt_gestionnaire_update ON plateforme.evenements AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND plateforme.f_collecte_editable(id)))
  WITH CHECK ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_manager_delete ON plateforme.evenements;
CREATE POLICY evt_manager_delete ON plateforme.evenements AS PERMISSIVE FOR DELETE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_manager_insert ON plateforme.evenements;
CREATE POLICY evt_manager_insert ON plateforme.evenements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_manager_select ON plateforme.evenements;
CREATE POLICY evt_manager_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND ((organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) OR (traiteur_operationnel_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))));

DROP POLICY IF EXISTS evt_manager_update ON plateforme.evenements;
CREATE POLICY evt_manager_update ON plateforme.evenements AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND plateforme.f_collecte_editable(id)))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS evt_ops_select ON plateforme.evenements;
CREATE POLICY evt_ops_select ON plateforme.evenements AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS evt_ops_write ON plateforme.evenements;
CREATE POLICY evt_ops_write ON plateforme.evenements AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS admin_savr_insert_everest_missions ON plateforme.everest_missions;
CREATE POLICY admin_savr_insert_everest_missions ON plateforme.everest_missions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS admin_savr_select_everest_missions ON plateforme.everest_missions;
CREATE POLICY admin_savr_select_everest_missions ON plateforme.everest_missions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS admin_savr_update_everest_missions ON plateforme.everest_missions;
CREATE POLICY admin_savr_update_everest_missions ON plateforme.everest_missions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ops_savr_select_everest_missions ON plateforme.everest_missions;
CREATE POLICY ops_savr_select_everest_missions ON plateforme.everest_missions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS ops_savr_update_everest_missions ON plateforme.everest_missions;
CREATE POLICY ops_savr_update_everest_missions ON plateforme.everest_missions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS fac_admin ON plateforme.factures;
CREATE POLICY fac_admin ON plateforme.factures AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS fac_client_select ON plateforme.factures;
CREATE POLICY fac_client_select ON plateforme.factures AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS fac_ops_select ON plateforme.factures;
CREATE POLICY fac_ops_select ON plateforme.factures AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS fac_ops_update ON plateforme.factures;
CREATE POLICY fac_ops_update ON plateforme.factures AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS fc_admin ON plateforme.factures_collectes;
CREATE POLICY fc_admin ON plateforme.factures_collectes AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS fd_admin ON plateforme.flux_dechets;
CREATE POLICY fd_admin ON plateforme.flux_dechets AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS gtz_admin ON plateforme.grilles_tarifaires_zd;
CREATE POLICY gtz_admin ON plateforme.grilles_tarifaires_zd AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS jp_admin_read ON plateforme.jobs_pdf;
CREATE POLICY jp_admin_read ON plateforme.jobs_pdf AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS lieux_admin ON plateforme.lieux;
CREATE POLICY lieux_admin ON plateforme.lieux AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS lieux_clients_select ON plateforme.lieux;
CREATE POLICY lieux_clients_select ON plateforme.lieux AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) <> ALL (ARRAY['admin_savr'::text, 'ops_savr'::text])) AND ((id IN ( SELECT organisations_lieux.lieu_id
   FROM plateforme.organisations_lieux
  WHERE (organisations_lieux.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))) OR (id IN ( SELECT evenements.lieu_id
   FROM plateforme.evenements
  WHERE (evenements.organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid))) OR (id IN ( SELECT evenements.lieu_id
   FROM plateforme.evenements
  WHERE ((evenements.client_organisateur_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) AND (evenements.date_evenement IS NOT NULL)))))));

DROP POLICY IF EXISTS lieux_ops_read ON plateforme.lieux;
CREATE POLICY lieux_ops_read ON plateforme.lieux AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS lieux_ops_write ON plateforme.lieux;
CREATE POLICY lieux_ops_write ON plateforme.lieux AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS org_admin ON plateforme.organisations;
CREATE POLICY org_admin ON plateforme.organisations AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS org_agence_insert_shadow ON plateforme.organisations;
CREATE POLICY org_agence_insert_shadow ON plateforme.organisations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'agence'::text) AND (est_shadow = true) AND (type = 'traiteur'::plateforme.organisation_type_enum) AND (cree_par_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_agence_select ON plateforme.organisations;
CREATE POLICY org_agence_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND ((id = ((auth.jwt() ->> 'organisation_id'::text))::uuid) OR ((est_shadow = true) AND (cree_par_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))));

DROP POLICY IF EXISTS org_agence_update ON plateforme.organisations;
CREATE POLICY org_agence_update ON plateforme.organisations AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = 'agence'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_client_orga_select ON plateforme.organisations;
CREATE POLICY org_client_orga_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'client_organisateur'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_commercial_select ON plateforme.organisations;
CREATE POLICY org_commercial_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_gestionnaire_select ON plateforme.organisations;
CREATE POLICY org_gestionnaire_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_gestionnaire_traiteur_select ON plateforme.organisations;
CREATE POLICY org_gestionnaire_traiteur_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (type = 'traiteur'::plateforme.organisation_type_enum) AND plateforme.f_traiteur_intervenu_lieux_gestionnaire(id)));

DROP POLICY IF EXISTS org_gestionnaire_update ON plateforme.organisations;
CREATE POLICY org_gestionnaire_update ON plateforme.organisations AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_manager_select ON plateforme.organisations;
CREATE POLICY org_manager_select ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_manager_update ON plateforme.organisations;
CREATE POLICY org_manager_update ON plateforme.organisations AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS org_ops_read ON plateforme.organisations;
CREATE POLICY org_ops_read ON plateforme.organisations AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS org_ops_write ON plateforme.organisations;
CREATE POLICY org_ops_write ON plateforme.organisations AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS ode_admin ON plateforme.organisations_domaines_email;
CREATE POLICY ode_admin ON plateforme.organisations_domaines_email AS PERMISSIVE FOR ALL TO public
  USING (plateforme.f_is_staff())
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS org_lieux_admin ON plateforme.organisations_lieux;
CREATE POLICY org_lieux_admin ON plateforme.organisations_lieux AS PERMISSIVE FOR ALL TO public
  USING (plateforme.f_is_staff())
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS outbox_admin_read ON plateforme.outbox_events;
CREATE POLICY outbox_admin_read ON plateforme.outbox_events AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pa_select_programmateurs ON plateforme.packs_antgaspi;
CREATE POLICY pa_select_programmateurs ON plateforme.packs_antgaspi AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS pa_write ON plateforme.parametres_algo;
CREATE POLICY pa_write ON plateforme.parametres_algo AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pcd_admin ON plateforme.parametres_co2_divers;
CREATE POLICY pcd_admin ON plateforme.parametres_co2_divers AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pcd_ops_read ON plateforme.parametres_co2_divers;
CREATE POLICY pcd_ops_read ON plateforme.parametres_co2_divers AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS pfc_admin ON plateforme.parametres_facteurs_co2;
CREATE POLICY pfc_admin ON plateforme.parametres_facteurs_co2 AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pfc_ops_read ON plateforme.parametres_facteurs_co2;
CREATE POLICY pfc_ops_read ON plateforme.parametres_facteurs_co2 AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS pfca_admin ON plateforme.parametres_facteurs_co2_ag;
CREATE POLICY pfca_admin ON plateforme.parametres_facteurs_co2_ag AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pfca_ops_read ON plateforme.parametres_facteurs_co2_ag;
CREATE POLICY pfca_ops_read ON plateforme.parametres_facteurs_co2_ag AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS pme_admin ON plateforme.parametres_mix_emballages;
CREATE POLICY pme_admin ON plateforme.parametres_mix_emballages AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pme_ops_read ON plateforme.parametres_mix_emballages;
CREATE POLICY pme_ops_read ON plateforme.parametres_mix_emballages AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS ptr_admin ON plateforme.parametres_taux_recyclage;
CREATE POLICY ptr_admin ON plateforme.parametres_taux_recyclage AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS ptr_ops_read ON plateforme.parametres_taux_recyclage;
CREATE POLICY ptr_ops_read ON plateforme.parametres_taux_recyclage AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS pt_admin ON plateforme.pesees_tournees;
CREATE POLICY pt_admin ON plateforme.pesees_tournees AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS pt_ops_select ON plateforme.pesees_tournees;
CREATE POLICY pt_ops_select ON plateforme.pesees_tournees AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS rr_admin ON plateforme.rapports_rse;
CREATE POLICY rr_admin ON plateforme.rapports_rse AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS rr_write_admin ON plateforme.rapports_rse;
CREATE POLICY rr_write_admin ON plateforme.rapports_rse AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS sf_admin_read ON plateforme.sequences_facturation;
CREATE POLICY sf_admin_read ON plateforme.sequences_facturation AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS tn_admin ON plateforme.tarifs_negocie;
CREATE POLICY tn_admin ON plateforme.tarifs_negocie AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS tn_gestionnaire_read ON plateforme.tarifs_negocie;
CREATE POLICY tn_gestionnaire_read ON plateforme.tarifs_negocie AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (scope = 'gestionnaire'::plateforme.tarif_negocie_scope_enum) AND (gestionnaire_organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS tpa_admin ON plateforme.tarifs_packs_ag;
CREATE POLICY tpa_admin ON plateforme.tarifs_packs_ag AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS tzd_admin ON plateforme.tarifs_zero_dechet;
CREATE POLICY tzd_admin ON plateforme.tarifs_zero_dechet AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS t_admin ON plateforme.tournees;
CREATE POLICY t_admin ON plateforme.tournees AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS t_ops_select ON plateforme.tournees;
CREATE POLICY t_ops_select ON plateforme.tournees AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS transp_admin ON plateforme.transporteurs;
CREATE POLICY transp_admin ON plateforme.transporteurs AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS transp_ops_select ON plateforme.transporteurs;
CREATE POLICY transp_ops_select ON plateforme.transporteurs AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS transp_ops_write ON plateforme.transporteurs;
CREATE POLICY transp_ops_write ON plateforme.transporteurs AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS te_admin ON plateforme.types_evenements;
CREATE POLICY te_admin ON plateforme.types_evenements AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS usr_admin ON plateforme.users;
CREATE POLICY usr_admin ON plateforme.users AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS usr_agence_self ON plateforme.users;
CREATE POLICY usr_agence_self ON plateforme.users AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND (id = auth.uid())));

DROP POLICY IF EXISTS usr_agence_update_self ON plateforme.users;
CREATE POLICY usr_agence_update_self ON plateforme.users AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'agence'::text) AND (id = auth.uid())))
  WITH CHECK ((((plateforme.f_app_role()) = 'agence'::text) AND (id = auth.uid())));

DROP POLICY IF EXISTS usr_commercial_select ON plateforme.users;
CREATE POLICY usr_commercial_select ON plateforme.users AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_commercial_update_self ON plateforme.users;
CREATE POLICY usr_commercial_update_self ON plateforme.users AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (id = auth.uid())))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_commercial'::text) AND (id = auth.uid())));

DROP POLICY IF EXISTS usr_gestionnaire_insert ON plateforme.users;
CREATE POLICY usr_gestionnaire_insert ON plateforme.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_gestionnaire_select ON plateforme.users;
CREATE POLICY usr_gestionnaire_select ON plateforme.users AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_gestionnaire_update ON plateforme.users;
CREATE POLICY usr_gestionnaire_update ON plateforme.users AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = 'gestionnaire_lieux'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_manager_insert ON plateforme.users;
CREATE POLICY usr_manager_insert ON plateforme.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_manager_select ON plateforme.users;
CREATE POLICY usr_manager_select ON plateforme.users AS PERMISSIVE FOR SELECT TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_manager_update ON plateforme.users;
CREATE POLICY usr_manager_update ON plateforme.users AS PERMISSIVE FOR UPDATE TO public
  USING ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)))
  WITH CHECK ((((plateforme.f_app_role()) = 'traiteur_manager'::text) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid)));

DROP POLICY IF EXISTS usr_ops_insert ON plateforme.users;
CREATE POLICY usr_ops_insert ON plateforme.users AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS usr_ops_select ON plateforme.users;
CREATE POLICY usr_ops_select ON plateforme.users AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS usr_ops_write ON plateforme.users;
CREATE POLICY usr_ops_write ON plateforme.users AS PERMISSIVE FOR UPDATE TO public
  USING (((plateforme.f_app_role()) = 'ops_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'ops_savr'::text));

DROP POLICY IF EXISTS fichiers_admin_write ON shared.fichiers;
CREATE POLICY fichiers_admin_write ON shared.fichiers AS PERMISSIVE FOR ALL TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text))
  WITH CHECK (((plateforme.f_app_role()) = 'admin_savr'::text));

DROP POLICY IF EXISTS prest_plateforme_read ON shared.prestataires;
CREATE POLICY prest_plateforme_read ON shared.prestataires AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = ANY (ARRAY['admin_savr'::text, 'ops_savr'::text])));

CREATE OR REPLACE VIEW plateforme.v_factures_client WITH (security_invoker=true) AS  SELECT id,
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
   FROM plateforme.factures
  WHERE (((plateforme.f_app_role()) = ANY (ARRAY['traiteur_manager'::text, 'traiteur_commercial'::text, 'agence'::text, 'gestionnaire_lieux'::text])) AND (organisation_id = ((auth.jwt() ->> 'organisation_id'::text))::uuid));

CREATE OR REPLACE VIEW plateforme.v_registre_dechets WITH (security_invoker=false) AS  SELECT c.id AS collecte_id,
    c.date_collecte,
    e.pax,
    plateforme.taille_evenement_bracket(e.pax) AS taille_bracket,
    o.nom AS organisation_nom,
    l.nom AS lieu_nom,
    l.adresse_acces AS lieu_adresse,
    sp.nom AS prestataire_nom,
    cf.poids_reel_kg,
    fd.code AS flux_code,
    fd.nom AS flux_nom,
    fd.filiere_valorisation,
    c.taux_recyclage,
    c.co2_induit_kg,
    c.co2_evite_kg,
    c.co2_net_kg,
    c.realisee_at,
    c.created_at
   FROM ((((((plateforme.collectes c
     JOIN plateforme.evenements e ON ((e.id = c.evenement_id)))
     JOIN plateforme.organisations o ON ((o.id = e.organisation_id)))
     JOIN plateforme.lieux l ON ((l.id = e.lieu_id)))
     LEFT JOIN shared.prestataires sp ON ((sp.id = c.prestataire_logistique_id)))
     LEFT JOIN plateforme.collecte_flux cf ON ((cf.collecte_id = c.id)))
     LEFT JOIN plateforme.flux_dechets fd ON ((fd.id = cf.flux_id)))
  WHERE ((c.statut = 'cloturee'::plateforme.collecte_statut_enum) AND (c.type = 'zero_dechet'::plateforme.collecte_type_enum) AND ((plateforme.f_app_role()) IS DISTINCT FROM 'agence'::text));

