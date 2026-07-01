-- R14 · BL-P1-AUTH-01 — Impersonation : injection du claim `impersonator_id`
-- =============================================================================
-- Chaîne d'impersonation (§09 §7 + §15 §2.3) : un Admin Savr se connecte « à la
-- place » d'un user pour du support. Toute action doit être tracée dans
-- `audit_log` avec `user_id` = user impersoné ET `impersonator_id` = admin.
--
-- Le trigger d'audit (`fn_audit_insert`, 20260613200000 puis 20260617180000)
-- lit DÉJÀ `auth.jwt() ->> 'impersonator_id'` — mais ce claim top-level n'était
-- JAMAIS injecté par le hook custom access token → il restait NULL (chaîne
-- rompue, audit conformité BL-P1-AUTH-01).
--
-- Ici : `fn_custom_access_token` est étendue pour exposer `impersonator_id` en
-- claim top-level, LU depuis `app_metadata.impersonator_id` (posé sur la session
-- impersonée par la route `/auth/impersonate-callback`). Garde de fenêtre :
-- le claim n'est injecté QUE si `app_metadata.impersonation_expires_at > now()`
-- → « fin auto au bout d'1h » (§09 §7) garantie CÔTÉ SERVEUR à chaque refresh de
-- token, indépendamment du client (le refresh ré-exécute le hook). Passé l'heure,
-- l'attribution impersonation cesse même si le flag app_metadata n'a pas été purgé.
--
-- Reste inchangé : `role` réservé (= authenticated, PostgREST SET ROLE) jamais
-- écrasé ; `user_role` / `organisation_id` / `organisation_type` / `app_domain`.
-- CREATE OR REPLACE réinitialise search_path → on ré-inclut `SET search_path`.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_custom_access_token(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_user_id      uuid;
  v_role         text;
  v_org_id       uuid;
  v_org_type     text;
  v_claims       jsonb;
  v_impersonator text;
  v_imp_expires  text;
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

  -- Impersonation (BL-P1-AUTH-01) : expose `impersonator_id` en claim top-level
  -- si la session porte le flag app_metadata et que la fenêtre 1h n'est pas
  -- expirée. `app_metadata` est fourni par GoTrue dans `event->'claims'`.
  v_impersonator := event->'claims'->'app_metadata'->>'impersonator_id';
  v_imp_expires  := event->'claims'->'app_metadata'->>'impersonation_expires_at';
  IF v_impersonator IS NOT NULL
     AND v_imp_expires IS NOT NULL
     AND v_imp_expires::timestamptz > now()
  THEN
    v_claims := v_claims || jsonb_build_object('impersonator_id', v_impersonator);
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Idempotent (CREATE OR REPLACE préserve les grants, on les réaffirme).
GRANT EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) FROM authenticated, anon, public;
