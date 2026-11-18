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
-- Sonde du 2026-11-18 (les deux déclencheurs désactivés dans la transaction) :
-- les cas 2 à 11, 16, 19, 21, 23, 25, 28 et 29 rougissent ; avec eux, 30 sur 30.
-- =============================================================================

BEGIN;
SELECT plan(30);

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
  (test_rt_id('a6'), 'RT Traiteur 2',    'traiteur',            true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif) VALUES
  (test_rt_id('b1'), test_rt_id('a1'), 'mgr@rt.invalid',   'M', 'GR', 'traiteur_manager',    true),
  (test_rt_id('b2'), test_rt_id('a1'), 'com@rt.invalid',   'C', 'OM', 'traiteur_commercial', true),
  (test_rt_id('b3'), test_rt_id('a3'), 'gest@rt.invalid',  'G', 'ES', 'gestionnaire_lieux',  true),
  (test_rt_id('b4'), test_rt_id('a3'), 'gest2@rt.invalid', 'G', 'E2', 'gestionnaire_lieux',  true),
  (test_rt_id('b5'), test_rt_id('a2'), 'agc@rt.invalid',   'A', 'GC', 'agence',              true),
  (test_rt_id('b6'), test_rt_id('a1'), 'adm@rt.invalid',   'A', 'DM', 'admin_savr',          true),
  (test_rt_id('b7'), test_rt_id('a6'), 'mgr2@rt.invalid',  'M', 'G2', 'traiteur_manager',    true);

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

-- 12. La RLS garde la parole sur une écriture inter-organisations : la garde lit
--     le type en SECURITY DEFINER, trouve un type compatible et laisse refuser
--     la policy (42501), sans révéler l'organisation visée.
SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (test_rt_id('c7'), test_rt_id('a5'), 'c7@rt.invalid', 'X', 'Y', 'gestionnaire_lieux') $$,
  '42501', NULL,
  '12. gestionnaire : INSERT dans une autre organisation → refusé par la RLS (42501), pas par la garde'
);

-- 13. Contrôle positif sous authenticated : un rôle du bon type passe.
SELECT test_set_jwt('traiteur_manager', test_rt_id('a1'), test_rt_id('b1'));

SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = test_rt_id('b2') $$,
  '13. manager traiteur : promouvoir un collègue traiteur_manager reste possible'
);

-- ── 14-16. Contrôles positifs service_role ──────────────────────────────────
SELECT test_as_service_role();

SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
       (test_rt_id('d1'), test_rt_id('a1'), 'd1@rt.invalid', 'X', 'Y', 'traiteur_commercial'),
       (test_rt_id('d2'), test_rt_id('a2'), 'd2@rt.invalid', 'X', 'Y', 'agence'),
       (test_rt_id('d3'), test_rt_id('a3'), 'd3@rt.invalid', 'X', 'Y', 'gestionnaire_lieux'),
       (test_rt_id('d4'), test_rt_id('a4'), 'd4@rt.invalid', 'X', 'Y', 'client_organisateur') $$,
  '14. service_role : chaque rôle client dans son type → accepté'
);

SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
       (test_rt_id('d5'), test_rt_id('a2'), 'd5@rt.invalid', 'X', 'Y', 'ops_savr'),
       (test_rt_id('d6'), test_rt_id('a1'), 'd6@rt.invalid', 'X', 'Y', 'admin_savr') $$,
  '15. service_role : équipe Savr dans une organisation de tout type → acceptée (contournement M0.7b)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_commercial' WHERE id = test_rt_id('d5') $$,
  '23514', NULL,
  '16. service_role : un ops de l''organisation interne (agence) ne devient pas commercial traiteur'
);

-- ── 17-19. Une ligne ancienne discordante reste modifiable ailleurs ─────────
SELECT test_as_superuser();
ALTER TABLE plateforme.users DISABLE TRIGGER trg_users_role_suit_type_organisation;
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES (test_rt_id('e1'), test_rt_id('a2'), 'e1@rt.invalid', 'Ancien', 'Ecart', 'traiteur_commercial');
ALTER TABLE plateforme.users ENABLE TRIGGER trg_users_role_suit_type_organisation;

SELECT test_as_service_role();

SELECT lives_ok(
  $$ UPDATE plateforme.users SET prenom = 'Toujours' WHERE id = test_rt_id('e1') $$,
  '17. ligne discordante d''avant la migration : modifier une autre colonne reste possible'
);

SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = role, organisation_id = organisation_id, prenom = 'Encore'
     WHERE id = test_rt_id('e1') $$,
  '18. ligne discordante : réécrire rôle et organisation à l''identique (charge PostgREST complète) reste possible'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'traiteur_manager' WHERE id = test_rt_id('e1') $$,
  '23514', NULL,
  '19. ligne discordante : un vrai changement de rôle est jugé'
);

-- ── 20-27. Changement de type : les rôles suivent (arbitrage Val 2026-11-18) ─
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'agence' WHERE id = test_rt_id('a1') $$,
  '20. traiteur → agence : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(email || ':' || role::text ORDER BY email)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a1')),
  ARRAY['adm@rt.invalid:admin_savr', 'com@rt.invalid:agence', 'd1@rt.invalid:agence',
        'd6@rt.invalid:admin_savr', 'mgr@rt.invalid:agence'],
  '21. traiteur → agence : manager et commerciaux deviennent agence, l''équipe Savr ne bouge pas'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'traiteur' WHERE id = test_rt_id('a2') $$,
  '22. agence → traiteur : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(email || ':' || role::text ORDER BY email)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a2')),
  ARRAY['agc@rt.invalid:traiteur_manager', 'd2@rt.invalid:traiteur_manager',
        'd5@rt.invalid:ops_savr', 'e1@rt.invalid:traiteur_commercial'],
  '23. agence → traiteur : l''agence devient traiteur_manager ; un rôle déjà admis (e1) et l''équipe Savr ne bougent pas'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET type = 'client_organisateur' WHERE id = test_rt_id('a3') $$,
  '24. gestionnaire_lieux → client_organisateur : le changement de type passe'
);

SELECT is(
  (SELECT array_agg(DISTINCT role::text)
     FROM plateforme.users WHERE organisation_id = test_rt_id('a3')),
  ARRAY['client_organisateur'],
  '25. gestionnaire_lieux → client_organisateur : tous ses utilisateurs deviennent client_organisateur'
);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET nom = 'RT Traiteur 2 renommé' WHERE id = test_rt_id('a6') $$,
  '26. modifier une autre colonne de l''organisation ne touche pas aux rôles'
);

SELECT is(
  (SELECT role::text FROM plateforme.users WHERE id = test_rt_id('b7')),
  'traiteur_manager',
  '27. rôle inchangé quand le type ne change pas'
);

-- ── 28-30. Structure ─────────────────────────────────────────────────────────
SELECT is(
  (SELECT tgenabled::text || ':' || pg_get_triggerdef(oid) LIKE 'O:%BEFORE INSERT OR UPDATE OF role, organisation_id ON plateforme.users%'
     FROM pg_trigger WHERE tgrelid = 'plateforme.users'::regclass
      AND tgname = 'trg_users_role_suit_type_organisation'),
  true,
  '28. garde users active, BEFORE INSERT OR UPDATE OF role, organisation_id'
);

SELECT is(
  (SELECT tgenabled::text || ':' || pg_get_triggerdef(oid) LIKE 'O:%AFTER UPDATE OF type ON plateforme.organisations%'
     FROM pg_trigger WHERE tgrelid = 'plateforme.organisations'::regclass
      AND tgname = 'trg_organisations_type_reecrit_roles'),
  true,
  '29. réécriture des rôles active, AFTER UPDATE OF type'
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
  '30. fonctions de déclencheur : aucun droit EXECUTE pour PUBLIC, anon, authenticated'
);

SELECT * FROM finish();
ROLLBACK;
