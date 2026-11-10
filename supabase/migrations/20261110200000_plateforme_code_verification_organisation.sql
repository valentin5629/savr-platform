-- =============================================================================
-- Code de vérification exigé pour les utilisateurs d'une organisation (2026-11-10)
-- =============================================================================
-- Décision Val du 2026-11-10 (questionnaire sécurité VIPARIS, exigence IAM3) :
-- pas de SAML ; à la place, le code de vérification de l'équipe Savr (TOTP,
-- docs/claude/code-verification.md) est exigé des utilisateurs de VIPARIS, et
-- d'eux seuls parmi les clients. L'Admin coche la case sur la fiche de
-- l'organisation ; aucun identifiant d'organisation n'est écrit dans le code.
--
-- 1. organisations.code_verification_obligatoire (faux par défaut : aucun
--    client existant ne change). Écrite par l'Admin seul, via le serveur
--    (service_role) : la colonne n'entre ni dans la liste blanche UPDATE ni
--    dans la liste blanche SELECT de authenticated (migrations 20260616130000
--    et 20260918100000), qui ne peut donc ni la lire ni la décocher.
-- 2. Le hook du jeton (fn_custom_access_token) ajoute le claim
--    `code_verification_obligatoire: true` aux utilisateurs d'une organisation
--    cochée, et à eux seuls. Le claim suit la case au rafraîchissement suivant
--    du jeton (une heure au plus). Corps repris de 20260701120000, avec deux
--    ajouts : ce claim, et le claim `impersonator_id` réservé à la seule
--    session ouverte par l'Admin (`app_metadata.impersonation_session_id` égal
--    au `session_id` du jeton). Avant, toute session du compte impersoné
--    pendant l'heure en héritait ; l'exemption du code ci-dessous l'aurait
--    étendue à une vraie connexion de l'utilisateur.
-- 3. plateforme.f_code_verification_ok() : la règle de la base vaut aussi pour
--    ces sessions. Faux, et seulement alors, pour une session sans code (aal
--    différent de aal2) dont le compte a un code activé, si elle est de
--    l'équipe Savr (inchangé) ou porte le claim ci-dessus hors impersonation.
--    Session impersonée (claim impersonator_id, posé par le seul hook depuis
--    app_metadata, écrit par le serveur, pour la seule session ouverte par
--    l'Admin) : l'administrateur a passé son propre code pour la lancer, la
--    règle ne la bloque pas (même exception côté application). Les policies, fonctions et vues qui appellent la règle
--    (migration 20261104200000) n'ont pas à changer.
--
-- Fermant (CLAUDE.md §12-2bis) : aucun droit ajouté. La colonne vaut faux par
-- défaut ; la règle ne peut que refuser davantage. Preuve :
-- supabase/tests/SECU__code_verification_organisation.test.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La case de l'organisation
-- -----------------------------------------------------------------------------
ALTER TABLE plateforme.organisations
  ADD COLUMN code_verification_obligatoire boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN plateforme.organisations.code_verification_obligatoire IS
  'Vrai : le code de vérification (TOTP) est exigé de tous les utilisateurs de l''organisation, en production. Cochée par l''Admin (VIPARIS, décision Val 2026-11-10, à la place du SAML). Ni lue ni écrite par authenticated.';

-- -----------------------------------------------------------------------------
-- 2. Hook du jeton : claim code_verification_obligatoire
-- -----------------------------------------------------------------------------
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
  v_code_org     boolean;
  v_claims       jsonb;
  v_impersonator text;
  v_imp_expires  text;
  v_imp_session  text;
BEGIN
  v_user_id := (event->>'user_id')::uuid;

  SELECT
    u.role::text,
    u.organisation_id,
    o.type::text,
    o.code_verification_obligatoire
  INTO v_role, v_org_id, v_org_type, v_code_org
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

  -- Code de vérification exigé par l'organisation (case cochée par l'Admin,
  -- 2026-11-10) : claim posé pour elle seule, absent pour toutes les autres.
  IF v_code_org THEN
    v_claims := v_claims || jsonb_build_object('code_verification_obligatoire', true);
  END IF;

  -- Impersonation (BL-P1-AUTH-01) : expose `impersonator_id` en claim top-level
  -- si le compte porte le flag app_metadata, que la fenêtre 1h n'est pas
  -- expirée ET que le jeton est celui de la session ouverte par l'Admin
  -- (`impersonation_session_id`, posé par /auth/impersonate-callback ; ajout
  -- 2026-11-10). Sans cette dernière condition, toute autre session du compte
  -- pendant l'heure (une vraie connexion de l'utilisateur) héritait du claim :
  -- écritures imputées à l'Admin, et code de vérification de l'organisation
  -- non demandé. `app_metadata` et `session_id` sont fournis par GoTrue dans
  -- `event->'claims'`.
  v_impersonator := event->'claims'->'app_metadata'->>'impersonator_id';
  v_imp_expires  := event->'claims'->'app_metadata'->>'impersonation_expires_at';
  v_imp_session  := event->'claims'->'app_metadata'->>'impersonation_session_id';
  IF v_impersonator IS NOT NULL
     AND v_imp_expires IS NOT NULL
     AND v_imp_expires::timestamptz > now()
     AND v_imp_session IS NOT NULL
     AND v_imp_session = event->'claims'->>'session_id'
  THEN
    v_claims := v_claims || jsonb_build_object('impersonator_id', v_impersonator);
  END IF;

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Idempotent (CREATE OR REPLACE préserve les grants, on les réaffirme).
GRANT EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION plateforme.fn_custom_access_token(jsonb) FROM authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- 3. Règle de la base étendue aux organisations cochées
-- -----------------------------------------------------------------------------
-- Même forme que 20261104200000 : SQL, SECURITY INVOKER, évaluée de gauche à
-- droite. Un client d'une organisation non cochée, ou une session déjà passée
-- par le code, s'arrête aux deux premiers termes, sans lire auth.mfa_factors.
-- Aucun terme ne vaut NULL.
CREATE OR REPLACE FUNCTION plateforme.f_code_verification_ok()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT (    coalesce(auth.jwt() ->> 'user_role', '') NOT IN ('admin_savr', 'ops_savr')
          AND (   coalesce(auth.jwt() ->> 'code_verification_obligatoire', '') <> 'true'
               OR coalesce(auth.jwt() ->> 'impersonator_id', '') <> ''))
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT plateforme.f_code_verification_active()
$function$;

COMMENT ON FUNCTION plateforme.f_code_verification_ok() IS
  'Faux seulement pour une session sans code de vérification (aal différent de aal2) dont le compte a un code activé, si elle est de l''équipe Savr (admin_savr, ops_savr) ou d''une organisation qui exige le code (claim code_verification_obligatoire, hors session impersonée). Lue par la policy restrictive code_verification_equipe_savr de chaque table, et au début des fonctions SECURITY DEFINER et des vues security_invoker = false ouvertes à authenticated (2026-11-04, organisations 2026-11-10).';

-- Droits inchangés (CREATE OR REPLACE les conserve), réaffirmés.
REVOKE ALL ON FUNCTION plateforme.f_code_verification_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION plateforme.f_code_verification_ok() TO authenticated, service_role;

COMMENT ON FUNCTION plateforme.f_code_verification_active() IS
  'Vrai si le compte du jeton a un code de vérification activé (facteur vérifié dans auth.mfa_factors), ou si le jeton n''a pas de titulaire. Appelée par f_code_verification_ok, pour une session sans code de l''équipe Savr ou d''une organisation qui exige le code seulement (2026-11-04, organisations 2026-11-10).';
