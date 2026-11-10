-- =============================================================================
-- Tests pgTAP — Code de vérification exigé pour une organisation (VIPARIS)
-- Migration : 20261110200000_plateforme_code_verification_organisation.sql
-- =============================================================================
-- Décision Val du 2026-11-10 : pas de SAML ; le code de vérification de l'équipe
-- Savr est exigé des utilisateurs d'une organisation cochée par l'Admin
-- (VIPARIS), et d'eux seuls parmi les clients.
--
-- Oracle :
--   1-4   la case : colonne NOT NULL, faux par défaut ; ni lisible ni modifiable
--         par authenticated (le client ne peut pas la décocher) ;
--   5-9   le hook du jeton : claim posé pour l'organisation cochée seule, à côté
--         des claims existants et de l'impersonation ;
--   10-18 la règle de la base, cas par cas (jamais NULL) ;
--   19-24 de bout en bout sur plateforme.organisations, sous authenticated :
--         l'utilisateur de l'organisation cochée, code activé, ne lit ni
--         n'écrit sa ligne sans le code ; avec le code, si ; le client d'une
--         organisation non cochée, code activé ou non, n'est pas touché.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`,
-- `aal`, `sub`, `organisation_id`, et le claim de l'organisation quand le hook
-- le pose).
-- =============================================================================

BEGIN;
SELECT plan(24);

-- Identifiants ----------------------------------------------------------------
-- V = organisation cochée (gestionnaire de lieux) ; W = organisation non cochée ;
-- UV, UW = leurs utilisateurs ; FV, FW = leurs facteurs TOTP.
CREATE OR REPLACE FUNCTION test_cvo_id(p_nom text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE p_nom
    WHEN 'V'  THEN 'c0de0110-0000-0000-0000-0000000000b1'
    WHEN 'W'  THEN 'c0de0110-0000-0000-0000-0000000000b2'
    WHEN 'UV' THEN 'c0de0101-0000-0000-0000-0000000000b1'
    WHEN 'UW' THEN 'c0de0101-0000-0000-0000-0000000000b2'
    WHEN 'FV' THEN 'c0de0102-0000-0000-0000-0000000000b1'
    WHEN 'FW' THEN 'c0de0102-0000-0000-0000-0000000000b2'
  END)::uuid
$$;

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_cvo_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Jeton : chaque clé NULL est absente de l'objet.
CREATE OR REPLACE FUNCTION test_cvo_jwt(
  p_role text, p_aal text, p_sub uuid, p_org uuid,
  p_code jsonb DEFAULT NULL, p_impersonator text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', p_sub,
    'role', 'authenticated',
    'user_role', p_role,
    'aal', p_aal,
    'organisation_id', p_org,
    'app_domain', 'plateforme',
    'code_verification_obligatoire', p_code,
    'impersonator_id', p_impersonator))::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- Statut des deux facteurs (code activé ou non).
CREATE OR REPLACE FUNCTION test_cvo_facteurs(p_actif boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test_cvo_superuser();
  UPDATE auth.mfa_factors
     SET status = (CASE WHEN p_actif THEN 'verified' ELSE 'unverified' END)::auth.factor_status
   WHERE id IN (test_cvo_id('FV'), test_cvo_id('FW'));
END $$;

-- Règle évaluée pour un jeton donné, rendue en texte (« NULL » visible).
CREATE OR REPLACE FUNCTION test_cvo_regle(
  p_role text, p_aal text, p_sub uuid, p_org uuid,
  p_code jsonb DEFAULT NULL, p_impersonator text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v boolean;
BEGIN
  PERFORM test_cvo_jwt(p_role, p_aal, p_sub, p_org, p_code, p_impersonator);
  v := plateforme.f_code_verification_ok();
  PERFORM test_cvo_superuser();
  RETURN coalesce(v::text, 'NULL');
END $$;

-- Lignes de plateforme.organisations lisibles, puis modifiées (annulé aussitôt),
-- sous le jeton donné : « lues=N modifiees=M ».
CREATE OR REPLACE FUNCTION test_cvo_acces(
  p_role text, p_aal text, p_sub uuid, p_org uuid, p_code jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n_lues bigint;
  n_modif bigint;
BEGIN
  PERFORM test_cvo_jwt(p_role, p_aal, p_sub, p_org, p_code);
  SELECT count(*) INTO n_lues FROM plateforme.organisations WHERE id = p_org;
  BEGIN
    UPDATE plateforme.organisations SET adresse = adresse WHERE id = p_org;
    GET DIAGNOSTICS n_modif = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0C02';  -- annule l'écriture
  EXCEPTION WHEN SQLSTATE 'P0C02' THEN NULL;
  END;
  PERFORM test_cvo_superuser();
  RETURN 'lues=' || n_lues || ' modifiees=' || n_modif;
END $$;

-- Fixture ---------------------------------------------------------------------
SELECT test_cvo_superuser();

INSERT INTO auth.users (id, email) VALUES
  (test_cvo_id('UV'), 'coche@code-verification-orga.test'),
  (test_cvo_id('UW'), 'non-coche@code-verification-orga.test');

INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) VALUES
  (test_cvo_id('FV'), test_cvo_id('UV'), 'Code de test V', 'totp', 'unverified', now(), now()),
  (test_cvo_id('FW'), test_cvo_id('UW'), 'Code de test W', 'totp', 'unverified', now(), now());

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, adresse) VALUES
  (test_cvo_id('V'), 'CVO Cochée', 'gestionnaire_lieux', true, false, '1 rue V'),
  (test_cvo_id('W'), 'CVO Non cochée', 'gestionnaire_lieux', true, false, '1 rue W');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  (test_cvo_id('UV'), test_cvo_id('V'), 'coche@code-verification-orga.test', 'CVO', 'Coche', 'gestionnaire_lieux'),
  (test_cvo_id('UW'), test_cvo_id('W'), 'non-coche@code-verification-orga.test', 'CVO', 'NonCoche', 'gestionnaire_lieux');

-- =============================================================================
-- 1-4 — la case
-- =============================================================================
SELECT is(
  (SELECT code_verification_obligatoire FROM plateforme.organisations WHERE id = test_cvo_id('V')),
  false,
  '1. colonne : faux par défaut (aucun client existant ne change)');
SELECT col_not_null('plateforme', 'organisations', 'code_verification_obligatoire',
  '2. colonne : NOT NULL (jamais d''état indéterminé)');
SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.organisations', 'code_verification_obligatoire', 'UPDATE'),
  '3. authenticated ne peut pas modifier la case (un client ne peut pas la décocher)');
SELECT ok(
  NOT has_column_privilege('authenticated', 'plateforme.organisations', 'code_verification_obligatoire', 'SELECT'),
  '4. authenticated ne lit pas la case (liste blanche SELECT inchangée)');

UPDATE plateforme.organisations SET code_verification_obligatoire = true WHERE id = test_cvo_id('V');

-- =============================================================================
-- 5-9 — le hook du jeton
-- =============================================================================
SELECT is(
  plateforme.fn_custom_access_token(jsonb_build_object(
    'user_id', test_cvo_id('UV'),
    'claims', jsonb_build_object('sub', test_cvo_id('UV'), 'role', 'authenticated')))
    -> 'claims' -> 'code_verification_obligatoire',
  'true'::jsonb,
  '5. hook : claim code_verification_obligatoire = true pour l''organisation cochée');
SELECT ok(
  NOT (plateforme.fn_custom_access_token(jsonb_build_object(
    'user_id', test_cvo_id('UW'),
    'claims', jsonb_build_object('sub', test_cvo_id('UW'), 'role', 'authenticated')))
    -> 'claims' ? 'code_verification_obligatoire'),
  '6. hook : aucun claim pour une organisation non cochée (jeton inchangé)');
SELECT is(
  (SELECT c ->> 'user_role' || '|' || (c ->> 'organisation_id') || '|' || (c ->> 'organisation_type')
     FROM (SELECT plateforme.fn_custom_access_token(jsonb_build_object(
             'user_id', test_cvo_id('UV'),
             'claims', jsonb_build_object('sub', test_cvo_id('UV'), 'role', 'authenticated')))
             -> 'claims' AS c) x),
  'gestionnaire_lieux|' || test_cvo_id('V') || '|gestionnaire_lieux',
  '7. hook : claims existants inchangés à côté du nouveau');
SELECT is(
  plateforme.fn_custom_access_token(jsonb_build_object(
    'user_id', test_cvo_id('UV'),
    'claims', jsonb_build_object('sub', test_cvo_id('UV'), 'role', 'authenticated')))
    -> 'claims' ->> 'role',
  'authenticated',
  '8. hook : claim réservé role jamais écrasé');
SELECT is(
  (SELECT (c ->> 'impersonator_id') || '|' || (c ->> 'code_verification_obligatoire')
     FROM (SELECT plateforme.fn_custom_access_token(jsonb_build_object(
             'user_id', test_cvo_id('UV'),
             'claims', jsonb_build_object('sub', test_cvo_id('UV'), 'role', 'authenticated',
               'app_metadata', jsonb_build_object(
                 'impersonator_id', 'adm00000-0000-0000-0000-0000000000aa',
                 'impersonation_expires_at', '2999-01-01T00:00:00Z'))))
             -> 'claims' AS c) x),
  'adm00000-0000-0000-0000-0000000000aa|true',
  '9. hook : impersonation toujours posée à côté du claim de l''organisation');

-- =============================================================================
-- 10-18 — la règle de la base, cas par cas
-- =============================================================================
SELECT test_cvo_facteurs(true);
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'false', '10. organisation cochée, code activé, session sans code : refus');
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal2', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'true', '11. organisation cochée, session passée par le code : accès');
SELECT is(test_cvo_regle('gestionnaire_lieux', NULL, test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'false', '12. organisation cochée, code activé, aal absent : refus');
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb,
                         'adm00000-0000-0000-0000-0000000000aa'),
  'true', '13. organisation cochée, session impersonée (l''Admin a passé son code) : accès');
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal1', test_cvo_id('UW'), test_cvo_id('W')),
  'true', '14. organisation non cochée (pas de claim), code activé, sans code : accès (rien ne change)');
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal1', test_cvo_id('UW'), test_cvo_id('W'), 'false'::jsonb),
  'true', '15. claim à false : accès (seul true exige le code)');
SELECT is(test_cvo_regle('admin_savr', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), NULL,
                         'adm00000-0000-0000-0000-0000000000aa'),
  'false', '16. équipe Savr : l''exception d''impersonation ne la concerne pas (règle du 2026-11-04 inchangée)');
SELECT test_cvo_facteurs(false);
SELECT is(test_cvo_regle('gestionnaire_lieux', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'true', '17. organisation cochée, code pas encore activé : accès (fenêtre de première activation)');
SELECT is(test_cvo_regle('admin_savr', 'aal1', test_cvo_id('UV'), test_cvo_id('V')),
  'true', '18. équipe Savr sans code activé : accès (inchangé)');

-- =============================================================================
-- 19-24 — de bout en bout sur plateforme.organisations
-- =============================================================================
SELECT test_cvo_facteurs(true);
SELECT is(test_cvo_acces('gestionnaire_lieux', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'lues=0 modifiees=0', '19. organisation cochée, sans code : sa ligne ni lue ni modifiée');
SELECT is(test_cvo_acces('gestionnaire_lieux', 'aal2', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'lues=1 modifiees=1', '20. organisation cochée, avec code : sa ligne lue et modifiable (contrôle positif)');
SELECT is(test_cvo_acces('gestionnaire_lieux', 'aal1', test_cvo_id('UW'), test_cvo_id('W')),
  'lues=1 modifiees=1', '21. organisation non cochée, code activé, sans code : rien ne change');
SELECT test_cvo_facteurs(false);
SELECT is(test_cvo_acces('gestionnaire_lieux', 'aal1', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb),
  'lues=1 modifiees=1', '22. organisation cochée, code pas encore activé : accès (avant la première activation)');
SELECT test_cvo_jwt('gestionnaire_lieux', 'aal2', test_cvo_id('UV'), test_cvo_id('V'), 'true'::jsonb);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET code_verification_obligatoire = false WHERE id = 'c0de0110-0000-0000-0000-0000000000b1' $$,
  '42501', NULL,
  '23. organisation cochée, avec code : décocher sa propre case est refusé (42501)');
SELECT throws_ok(
  $$ SELECT code_verification_obligatoire FROM plateforme.organisations WHERE id = 'c0de0110-0000-0000-0000-0000000000b1' $$,
  '42501', NULL,
  '24. organisation cochée, avec code : lire la case est refusé (42501)');
SELECT test_cvo_superuser();

SELECT * FROM finish();
ROLLBACK;
