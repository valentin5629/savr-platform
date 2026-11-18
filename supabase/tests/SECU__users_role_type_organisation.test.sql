-- =============================================================================
-- SECU — rôle d'un utilisateur ↔ type de son organisation (revue sécurité 2026-11-18)
-- =============================================================================
-- Migration : 20261118200000_plateforme_users_role_suit_type_organisation.sql
-- Règle (CDC §09 §2, §05 §8) : traiteur → traiteur_manager, traiteur_commercial ;
-- agence → agence ; gestionnaire_lieux → gestionnaire_lieux ; client_organisateur
-- → client_organisateur. admin_savr et ops_savr : non contrôlés (org interne).
--
-- Avant la migration (mesuré le 2026-11-18) :
--   • service_role : INSERT d'un traiteur_manager dans une organisation de
--     gestionnaire de lieux → accepté (route POST /api/v1/admin/users) ;
--   • authenticated, manager traiteur : UPDATE d'un collègue en
--     gestionnaire_lieux → UPDATE 1 ; gestionnaire : collègue en
--     traiteur_manager → UPDATE 1 ;
--   • changement de type d'organisation : rôles laissés tels quels.
-- Revue sécurité du 2026-11-18 (NON-GO B1, corrigé) : une garde BEFORE +
-- SECURITY DEFINER répondait « refusé dans une organisation de type X » à un
-- INSERT vers l'organisation d'un autre client, avant la RLS : elle révélait
-- l'existence et le type de cette organisation. La garde est AFTER + INVOKER ;
-- les cas 14 à 18 le verrouillent (42501 attendu, jamais 23514).
--
-- Sondes du 2026-11-18 (dans la transaction, base neuve) : 41 sur 41 avec la
-- migration ; déclencheurs désactivés → cas 2 à 11, 19, 21, 22, 26, 29, 31,
-- 33, 35, 38 et 39 rouges ; ancienne version BEFORE + SECURITY DEFINER →
-- cas 14 à 18, 22, 38 et 41 rouges.
-- =============================================================================

BEGIN;
SELECT plan(41);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid,
  p_user_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION test_as_service_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- Identifiants : préfixe 7e1e0000-1118 (lot rôle ↔ type, 2026-11-18).
CREATE OR REPLACE FUNCTION test_rt_id(p text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('7e1e0000-1118-0000-0000-' || lpad(p, 12, '0'))::uuid
$$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow) VALUES
  (test_rt_id('a1'), 'RT Traiteur',      'traiteur',            true, false),
  (test_rt_id('a2'), 'RT Agence',        'agence',              true, false),
  (test_rt_id('a3'), 'RT Gestionnaire',  'gestionnaire_lieux',  true, false),
  (test_rt_id('a4'), 'RT Organisateur',  'client_organisateur', true, false),
  (test_rt_id('a5'), 'RT Gestionnaire 2','gestionnaire_lieux',  true, false),
  (test_rt_id('a6'), 'RT Traiteur 2',    'traiteur',            true, false),
  (test_rt_id('a7'), 'RT Savr',          'agence',              true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  (test_rt_id('b1'), test_rt_id('a1'), 'mgr@rt.invalid',   'M', 'GR', 'traiteur_manager',    true),
  (test_rt_id('b2'), test_rt_id('a1'), 'com@rt.invalid',   'C', 'OM', 'traiteur_commercial', true),
  (test_rt_id('b3'), test_rt_id('a3'), 'gest@rt.invalid',  'G', 'ES', 'gestionnaire_lieux',  true),
  (test_rt_id('b4'), test_rt_id('a3'), 'gest2@rt.invalid', 'G', 'E2', 'gestionnaire_lieux',  true),
  (test_rt_id('b5'), test_rt_id('a2'), 'agc@rt.invalid',   'A', 'GC', 'agence',              true),
  (test_rt_id('b6'), test_rt_id('a1'), 'adm@rt.invalid',   'A', 'DM', 'admin_savr',          true),
  (test_rt_id('b7'), test_rt_id('a6'), 'mgr2@rt.invalid',  'M', 'G2', 'traiteur_manager',    true),
  (test_rt_id('b8'), test_rt_id('a7'), 'ops@rt.invalid',   'O', 'PS', 'ops_savr',            true);

-- Compte ops dont le code de vérification est activé (facteur vérifié) : une
-- session aal1 ne lit ni n'écrit rien (policy restrictive code_verification).
INSERT INTO auth.users (id, email, aud, role)
VALUES (test_rt_id('b8'), 'ops@rt.invalid', 'authenticated', 'authenticated');
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
VALUES (test_rt_id('f8'), test_rt_id('b8'), 'Code RT', 'totp', 'verified', now(), now());

-- ── 1. La correspondance ─────────────────────────────────────────────────────
SELECT is(
  (SELECT array_agg(r::text || '/' || t::text ORDER BY r::text, t::text)
     FROM unnest(enum_range(NULL::plateforme.user_role)) r
    CROSS JOIN unnest(enum_range(NULL::plateforme.organisation_type)) t
    WHERE plateforme.f_role_compatible_type_organisation(r, t)
      AND r::text NOT IN ('admin_savr', 'ops_savr')),
  ARRAY['agence/agence', 'client_organisateur/client_organisateur',
        'gestionnaire_lieux/gestionnaire_lieux',
        'traiteur_commercial/traiteur', 'traiteur_manager/traiteur'],
  '1. correspondance exacte : chaque rôle client n''est admis que dans son type (CDC §09 §2)'
);

-- ── 2-6. service_role (routes Admin) : refus hors du type ────────────────────
SELECT test_as_service_role();

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c1'), test_rt_id('a3'), 'c1@rt.invalid', 'X', 'Y', 'traiteur_manager') $$,
  '23514',
  'Rôle traiteur_manager refusé dans une organisation de type gestionnaire_lieux (CDC §09 §2)',
  '2. service_role : traiteur_manager dans une organisation de gestionnaire de lieux → refusé (le constat du 2026-11-18)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c2'), test_rt_id('a1'), 'c2@rt.invalid', 'X', 'Y', 'gestionnaire_lieux') $$,
  '23514', NULL,
  '3. service_role : gestionnaire_lieux dans un traiteur → refusé'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c3'), test_rt_id('a2'), 'c3@rt.invalid', 'X', 'Y', 'traiteur_commercial') $$,
  '23514', NULL,
  '4. service_role : traiteur_commercial dans une agence → refusé (écart du seed savr-dev)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c4'), test_rt_id('a1'), 'c4@rt.invalid', 'X', 'Y', 'client_organisateur') $$,
  '23514', NULL,
  '5. service_role : client_organisateur dans un traiteur → refusé'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c5'), test_rt_id('a4'), 'c5@rt.invalid', 'X', 'Y', 'agence') $$,
  '23514', NULL,
  '6. service_role : agence dans une organisation de client organisateur → refusé'
);

-- ── 7-8. service_role : changement de rôle ou d'organisation ────────────────
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'agence' WHERE id = test_rt_id('b2') $$,
  '23514', NULL,
  '7. service_role : passer un commercial traiteur en agence → refusé (route PATCH /api/v1/admin/users/[id])'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET organisation_id = test_rt_id('a2') WHERE id = test_rt_id('b2') $$,
  '23514', NULL,
  '8. service_role : déplacer un commercial traiteur dans une agence → refusé'
);

-- ── 9. postgres (seed, script) n'est pas exempté ────────────────────────────
SELECT test_as_superuser();

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c6'), test_rt_id('a2'), 'c6@rt.invalid', 'X', 'Y', 'traiteur_manager')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role $$,
  '23514', NULL,
  '9. postgres : un upsert de seed discordant est refusé (aucune exemption)'
);

-- ── 10-11. authenticated : le chemin PostgREST d'une équipe cliente ─────────
SELECT test_set_jwt('traiteur_manager', test_rt_id('a1'), test_rt_id('b1'));

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'gestionnaire_lieux' WHERE id = test_rt_id('b2') $$,
  '23514', NULL,
  '10. manager traiteur : passer un collègue en gestionnaire_lieux → refusé (avant : UPDATE 1)'
);

SELECT test_set_jwt('gestionnaire_lieux', test_rt_id('a3'), test_rt_id('b3'));

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = test_rt_id('b4') $$,
  '23514', NULL,
  '11. gestionnaire : passer un collègue en traiteur_manager → refusé (avant : UPDATE 1)'
);

-- 12. Écriture inter-organisations, type compatible : la RLS refuse (42501).
SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c7'), test_rt_id('a5'), 'c7@rt.invalid', 'X', 'Y', 'gestionnaire_lieux') $$,
  '42501', NULL,
  '12. gestionnaire : INSERT dans une autre organisation de gestionnaire → refusé par la RLS (42501)'
);

-- 13. Contrôle positif sous authenticated : un rôle du bon type passe.
SELECT test_set_jwt('traiteur_manager', test_rt_id('a1'), test_rt_id('b1'));

SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = test_rt_id('b2') $$,
  '13. manager traiteur : promouvoir un collègue traiteur_manager reste possible'
);

-- ── 14-18. Aucune fuite (revue sécurité, B1) : vers l'organisation d'un autre
--    client, de type INCOMPATIBLE, la réponse est la même 42501 de la RLS que
--    pour une organisation inexistante. Jamais 23514 ni le type visé.
SELECT test_set_jwt('gestionnaire_lieux', test_rt_id('a3'), test_rt_id('b3'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c8'), test_rt_id('a1'), 'c8@rt.invalid', 'X', 'Y', 'gestionnaire_lieux') $$,
  '42501',
  'new row violates row-level security policy for table "users"',
  '14. gestionnaire → organisation traiteur d''un autre client : 42501 de la RLS, le type n''est pas révélé'
);

SELECT test_set_jwt('traiteur_manager', test_rt_id('a6'), test_rt_id('b7'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c9'), test_rt_id('a2'), 'c9@rt.invalid', 'X', 'Y', 'traiteur_manager') $$,
  '42501', NULL,
  '15. manager traiteur → agence d''un autre client : 42501, pas 23514'
);

SELECT test_set_jwt('traiteur_commercial', test_rt_id('a1'), test_rt_id('b2'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('ca'), test_rt_id('a3'), 'ca@rt.invalid', 'X', 'Y', 'traiteur_commercial') $$,
  '42501', NULL,
  '16. commercial (aucune policy INSERT) → organisation de gestionnaire : 42501, pas 23514'
);

SELECT test_set_jwt('agence', test_rt_id('a2'), test_rt_id('b5'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('cb'), test_rt_id('a1'), 'cb@rt.invalid', 'X', 'Y', 'agence') $$,
  '42501', NULL,
  '17. agence (aucune policy INSERT) → organisation traiteur : 42501, pas 23514'
);

-- 18. Session ops sans code (aal1) alors que son compte a un code activé.
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', test_rt_id('b8'), 'role', 'authenticated', 'user_role', 'ops_savr',
  'organisation_id', test_rt_id('a7'), 'app_domain', 'plateforme', 'aal', 'aal1'
)::text, true);
SELECT set_config('role', 'authenticated', true);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('cc'), test_rt_id('a1'), 'cc@rt.invalid', 'X', 'Y', 'agence') $$,
  '42501', NULL,
  '18. ops sans code de vérification → refusé par la policy restrictive (42501), pas par la garde'
);

-- ── 19-21. INSERT par les policies d'équipe (usr_manager_insert,
--    usr_gestionnaire_insert) : avant la garde, UPDATE/INSERT 1 (revue, R2).
SELECT test_set_jwt('traiteur_manager', test_rt_id('a6'), test_rt_id('b7'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('cd'), test_rt_id('a6'), 'cd@rt.invalid', 'X', 'Y', 'agence') $$,
  '23514', NULL,
  '19. manager traiteur : inviter un compte agence dans son traiteur → refusé'
);

SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('ce'), test_rt_id('a6'), 'ce@rt.invalid', 'X', 'Y', 'traiteur_commercial') $$,
  '20. manager traiteur : inviter un commercial dans son traiteur reste possible'
);

SELECT test_set_jwt('gestionnaire_lieux', test_rt_id('a3'), test_rt_id('b3'));

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('cf'), test_rt_id('a3'), 'cf@rt.invalid', 'X', 'Y', 'traiteur_manager') $$,
  '23514', NULL,
  '21. gestionnaire : inviter un traiteur_manager dans son organisation → refusé'
);

-- ── 22-23. Organisation créée par la même instruction ; organisation absente.
SELECT test_as_superuser();

SELECT throws_ok(
  $$ WITH o AS (
       INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow)
       VALUES (test_rt_id('a8'), 'RT CTE', 'agence', true, false)
       RETURNING id
     )
     INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c10'), test_rt_id('a8'), 'c10@rt.invalid', 'X', 'Y', 'traiteur_manager') $$,
  '23514', NULL,
  '22. organisation agence créée dans la même instruction (CTE) : traiteur_manager refusé (revue, R1)'
);

SELECT test_as_service_role();

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c11'), test_rt_id('ff'), 'c11@rt.invalid', 'X', 'Y', 'agence') $$,
  '23503', NULL,
  '23. organisation inexistante : la clé étrangère refuse d''abord (23503)'
);

-- ── 24-26. Contrôles positifs service_role ──────────────────────────────────
SELECT test_as_service_role();

SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
       (test_rt_id('d1'), test_rt_id('a1'), 'd1@rt.invalid', 'X', 'Y', 'traiteur_commercial'),
       (test_rt_id('d2'), test_rt_id('a2'), 'd2@rt.invalid', 'X', 'Y', 'agence'),
       (test_rt_id('d3'), test_rt_id('a3'), 'd3@rt.invalid', 'X', 'Y', 'gestionnaire_lieux'),
       (test_rt_id('d4'), test_rt_id('a4'), 'd4@rt.invalid', 'X', 'Y', 'client_organisateur') $$,
  '24. service_role : chaque rôle client dans son type → accepté'
);

SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
       (test_rt_id('d5'), test_rt_id('a2'), 'd5@rt.invalid', 'X', 'Y', 'ops_savr'),
       (test_rt_id('d6'), test_rt_id('a1'), 'd6@rt.invalid', 'X', 'Y', 'admin_savr') $$,
  '25. service_role : équipe Savr dans une organisation de tout type → acceptée (contournement M0.7b)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_commercial' WHERE id = test_rt_id('d5') $$,
  '23514', NULL,
  '26. service_role : un ops de l''organisation interne (agence) ne devient pas commercial traiteur'
);

-- ── 27-29. Une ligne ancienne discordante reste modifiable ailleurs ─────────
SELECT test_as_superuser();
ALTER TABLE plateforme.users DISABLE TRIGGER trg_users_role_suit_type_organisation;
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES (test_rt_id('e1'), test_rt_id('a2'), 'e1@rt.invalid', 'Ancien', 'Ecart', 'traiteur_commercial');
ALTER TABLE plateforme.users ENABLE TRIGGER trg_users_role_suit_type_organisation;

SELECT test_as_service_role();

SELECT lives_ok(
  $$ UPDATE plateforme.users SET prenom = 'Toujours' WHERE id = test_rt_id('e1') $$,
  '27. ligne discordante d''avant la migration : modifier une autre colonne reste possible'
);

SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = role, organisation_id = organisation_id, prenom = 'Encore'
     WHERE id = test_rt_id('e1') $$,
  '28. ligne discordante : réécrire rôle et organisation à l''identique (charge PostgREST complète) reste possible'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = test_rt_id('e1') $$,
  '23514', NULL,
  '29. ligne discordante : un vrai changement de rôle est jugé'
);

-- ── 30-37. Changement de type : les rôles suivent (arbitrage Val 2026-11-18) ─
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'agence' WHERE id = test_rt_id('a1') $$,
  '30. traiteur → agence : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(email || ':' || role::text ORDER BY email)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a1')),
  ARRAY['adm@rt.invalid:admin_savr', 'com@rt.invalid:agence', 'd1@rt.invalid:agence',
        'd6@rt.invalid:admin_savr', 'mgr@rt.invalid:agence'],
  '31. traiteur → agence : manager et commerciaux deviennent agence, l''équipe Savr ne bouge pas'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'traiteur' WHERE id = test_rt_id('a2') $$,
  '32. agence → traiteur : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(email || ':' || role::text ORDER BY email)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a2')),
  ARRAY['agc@rt.invalid:traiteur_manager', 'd2@rt.invalid:traiteur_manager',
        'd5@rt.invalid:ops_savr', 'e1@rt.invalid:traiteur_commercial'],
  '33. agence → traiteur : l''agence devient traiteur_manager ; un rôle déjà admis (e1) et l''équipe Savr ne bougent pas'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'client_organisateur' WHERE id = test_rt_id('a3') $$,
  '34. gestionnaire_lieux → client_organisateur : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(DISTINCT role::text)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a3')),
  ARRAY['client_organisateur'],
  '35. gestionnaire_lieux → client_organisateur : tous ses utilisateurs deviennent client_organisateur'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET nom = 'RT Traiteur 2 renommé' WHERE id = test_rt_id('a6') $$,
  '36. modifier une autre colonne de l''organisation ne touche pas aux rôles'
);

SELECT is(
  (SELECT role::text FROM plateforme.users WHERE id = test_rt_id('b7')),
  'traiteur_manager',
  '37. rôle inchangé quand le type ne change pas'
);

-- ── 38-41. Structure ─────────────────────────────────────────────────────────
SELECT is(
  (SELECT tgenabled::text || ':' || pg_get_triggerdef(oid) LIKE 'O:%AFTER INSERT OR UPDATE OF role, organisation_id ON plateforme.users%'
     FROM pg_trigger WHERE tgrelid = 'plateforme.users'::regclass
      AND tgname = 'trg_users_role_suit_type_organisation'),
  true,
  '38. garde users active, AFTER INSERT OR UPDATE OF role, organisation_id (après RLS et clé étrangère)'
);

SELECT is(
  (SELECT tgenabled::text || ':' || pg_get_triggerdef(oid) LIKE 'O:%AFTER UPDATE OF type ON plateforme.organisations%'
     FROM pg_trigger WHERE tgrelid = 'plateforme.organisations'::regclass
      AND tgname = 'trg_organisations_type_reecrit_roles'),
  true,
  '39. réécriture des rôles active, AFTER UPDATE OF type'
);

SELECT is(
  (SELECT array_agg(p.proname || ':' || coalesce(r.rolname, 'PUBLIC') ORDER BY p.proname, coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE p.oid IN ('plateforme.fn_users_role_suit_type_organisation()'::regprocedure,
                    'plateforme.fn_organisations_type_reecrit_roles()'::regprocedure)
      AND a.privilege_type = 'EXECUTE'
      AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')),
  NULL,
  '40. fonctions de déclencheur : aucun droit EXECUTE pour PUBLIC, anon, authenticated'
);

SELECT is(
  (SELECT array_agg(p.proname || ':' || p.prosecdef::text ORDER BY p.proname)
     FROM pg_proc p
    WHERE p.oid IN ('plateforme.fn_users_role_suit_type_organisation()'::regprocedure,
                    'plateforme.fn_organisations_type_reecrit_roles()'::regprocedure,
                    'plateforme.f_role_compatible_type_organisation(plateforme.user_role, plateforme.organisation_type)'::regprocedure)),
  ARRAY['f_role_compatible_type_organisation:false',
        'fn_organisations_type_reecrit_roles:false',
        'fn_users_role_suit_type_organisation:false'],
  '41. aucune fonction du lot en SECURITY DEFINER (une lecture privilégiée du type a fui, revue B1)'
);

SELECT * FROM finish();
ROLLBACK;
