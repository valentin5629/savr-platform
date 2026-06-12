-- Module 0.5 — Auth : hook JWT custom access token
-- Fonction SECURITY DEFINER appelée par Supabase Auth (Settings > Auth > Hooks)
-- pour enrichir le JWT avec les claims métier Plateforme.
--
-- Activation manuelle dans le Dashboard Supabase :
--   Settings > Auth > Hooks > "Custom Access Token" → sélectionner
--   plateforme.fn_custom_access_token
--   (documenter dans RUNBOOK_INCIDENT.md section "Auth JWT Hook")
--
-- Claims injectés (si user trouvé dans plateforme.users) :
--   role              : user_role_enum (ex: 'traiteur_manager')
--   organisation_id   : uuid de l'organisation
--   organisation_type : organisation_type_enum (ex: 'traiteur')
--   app_domain        : 'plateforme' (fixe V1)
--
-- Si aucune ligne dans plateforme.users pour cet auth.uid → JWT retourné
-- sans claims custom (pas d'erreur — cas seed/admin Supabase sans profil).

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
  -- Extraire l'UUID de l'user depuis l'event Supabase Auth
  v_user_id := (event->>'user_id')::uuid;

  -- Lire le profil Plateforme (1 seule requête)
  SELECT
    u.role::text,
    u.organisation_id,
    o.type::text
  INTO v_role, v_org_id, v_org_type
  FROM plateforme.users u
  JOIN plateforme.organisations o ON o.id = u.organisation_id
  WHERE u.id = v_user_id
  LIMIT 1;

  -- Si aucun profil → retourner l'event sans modification
  IF v_role IS NULL THEN
    RETURN event;
  END IF;

  -- Injecter les claims dans le JWT (chemin claims du payload)
  v_claims := COALESCE(event->'claims', '{}'::jsonb);
  v_claims := v_claims
    || jsonb_build_object('role', v_role)
    || jsonb_build_object('organisation_id', v_org_id::text)
    || jsonb_build_object('organisation_type', v_org_type)
    || jsonb_build_object('app_domain', 'plateforme');

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Permissions : la fonction est appelée par Supabase Auth (rôle supabase_auth_admin)
-- On accorde EXECUTE au rôle supabase_auth_admin pour le hook.
GRANT EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb)
  TO supabase_auth_admin;

-- Révoquer l'accès aux rôles applicatifs (la fonction est interne Auth uniquement)
REVOKE EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb)
  FROM authenticated, anon, public;
