-- =============================================================================
-- Tests pgTAP — P0 sécurité : anti-escalade vers un RÔLE STAFF (admin_savr | ops_savr)
-- Migration testée : 20260903120000_plateforme_anti_escalade_role_staff.sql
-- =============================================================================
-- Faille corrigée (relevée en marge de #246, reproduite en base réelle) : un user
-- client authentifié pouvait `UPDATE users SET role='ops_savr' WHERE id=auth.uid()`
-- puis, au refresh du token, lire/écrire cross-organisation via les policies `*_ops_*`.
--
-- Ces tests s'exécutent sous le VRAI rôle Postgres `authenticated` + claim JWT
-- `user_role` (jamais le claim `role`, réservé PostgREST — cf. f_app_role()). C'est le
-- SEUL niveau qui prouve la garde : un test à Supabase mocké, ou tournant sous
-- service_role, contournerait à la fois la RLS et l'exemption du trigger → ne
-- prouverait RIEN.
--
-- Prouve que :
--   VOLET 1 — escalade de RÔLE
--   1-2. un user client ne peut s'auto-promouvoir ops_savr (LA faille) ni admin_savr
--        (non-régression R10b) ;
--   3.   promouvoir AUTRUI est bloqué aussi (usr_manager_update permet à un manager
--        d'écrire sur les users de son org — le trigger, lui, ne dépend d'aucune policy) ;
--   7-8. le chemin INSERT est bloqué aussi (usr_manager_insert ne contrôle que l'org) ;
--   VOLET 2 — escalade de TENANT
--   9.   un client ne peut pas se rattacher à une autre organisation (LE pivot :
--        fn_custom_access_token dérive le claim organisation_id de cette colonne) ;
--   10-12. email d'un tiers, deleted_at, auto-réactivation : même famille ;
--   13-14. `id` (le sien comme celui d'un collègue) : re-binding d'identité /
--        répudiation d'audit — cible de 21 FK ;
--   CONTRÔLES POSITIFS (pas de sur-blocage — la moitié qui compte)
--   4.   un ops_savr existant édite son profil sans toucher role ;
--   5.   admin_savr promeut toujours ;
--   6.   chemin service_role/postgres exempté : l'Admin crée toujours un ops_savr ;
--   15.  un manager suspend toujours un collaborateur (garde `actif` scopé à soi).
-- =============================================================================

BEGIN;
SELECT plan(15);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
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

-- =====================================================================
-- FIXTURE
-- =====================================================================
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'Org escalade', 'traiteur', true, false, '77711100000001', 'esc@test.com'),
  -- org tierce = cible du pivot cross-tenant (cas 9)
  ('e5ca1ad0-0000-0000-0000-0000000000b1'::uuid, 'Org victime', 'traiteur', true, false, '77711100000002', 'vic@test.com');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES
  -- l'attaquant : un client lambda
  ('e5ca1ad0-0000-0000-0000-000000000001'::uuid, 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'mgr@esc.test', 'M', 'GR', 'traiteur_manager', true),
  -- un compte SUSPENDU (cas 12 : auto-réactivation)
  ('e5ca1ad0-0000-0000-0000-000000000006'::uuid, 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'susp@esc.test', 'S', 'US', 'traiteur_manager', false),
  -- un collègue de la même org (cible d'une promotion d'autrui via usr_manager_update)
  ('e5ca1ad0-0000-0000-0000-000000000002'::uuid, 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'com@esc.test', 'C', 'OM', 'traiteur_commercial', true),
  -- un ops_savr déjà en place (contrôle : pas de faux positif sur les no-op)
  ('e5ca1ad0-0000-0000-0000-000000000003'::uuid, 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'ops@esc.test', 'O', 'PS', 'ops_savr', true),
  -- un admin_savr (contrôle positif : promotion légitime)
  ('e5ca1ad0-0000-0000-0000-000000000004'::uuid, 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'adm@esc.test', 'A', 'DM', 'admin_savr', true);

-- =====================================================================
-- 1-2 — LA FAILLE : auto-promotion vers un rôle staff
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'ops_savr' WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'P0 — traiteur_manager NE PEUT PAS s''auto-promouvoir ops_savr (la faille corrigée)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'admin_savr' WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'non-régression R10b — traiteur_manager NE PEUT PAS s''auto-promouvoir admin_savr'
);

-- =====================================================================
-- 3 — Promotion d'AUTRUI : usr_manager_update autorise l'UPDATE sur les users
--     de son org ; le trigger bloque quand même le passage au rôle staff.
-- =====================================================================
SELECT throws_ok(
  $$ UPDATE plateforme.users SET role = 'ops_savr'
     WHERE id = 'e5ca1ad0-0000-0000-0000-000000000002'::uuid $$,
  '42501',
  NULL,
  'P0 — traiteur_manager NE PEUT PAS promouvoir un collègue de son org en ops_savr'
);

-- =====================================================================
-- 4 — Anti-faux-positif : un ops_savr existant édite son profil sans toucher role.
--     (NEW.role IS NOT DISTINCT FROM OLD.role → la garde ne doit pas s'armer.)
-- =====================================================================
SELECT test_set_jwt('ops_savr', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000003'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET prenom = 'Olivia' WHERE id = auth.uid() $$,
  'ops_savr PEUT éditer son profil sans changer son rôle (pas de faux positif sur les no-op)'
);

-- =====================================================================
-- 5 — Contrôle positif : admin_savr authentifié promeut toujours (pas de sur-blocage).
-- =====================================================================
SELECT test_set_jwt('admin_savr', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000004'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET role = 'ops_savr'
     WHERE id = 'e5ca1ad0-0000-0000-0000-000000000002'::uuid $$,
  'admin_savr PEUT promouvoir un user en ops_savr (pas de sur-blocage)'
);

-- =====================================================================
-- 6 — Chemin service_role/postgres exempté : c'est ainsi que les routes
--     back-office Admin (createAdminSupabaseClient) créent un compte ops_savr.
-- =====================================================================
SELECT test_as_superuser();
SELECT lives_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES ('e5ca1ad0-0000-0000-0000-000000000005'::uuid,
             'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid,
             'ops2@esc.test', 'O', 'P2', 'ops_savr') $$,
  'service_role/postgres PEUT toujours créer un ops_savr (routes admin back-office)'
);

-- =====================================================================
-- 7-8 — VOLET 1, chemin INSERT : `usr_manager_insert` / `usr_gestionnaire_insert`
--       ont un WITH CHECK qui ne contrôle QUE l'organisation, jamais le rôle
--       cible. Un client pouvait donc POSER directement une ligne staff (et
--       `plateforme.users` n'a aucune FK vers `auth.users` : id arbitraire, sans
--       compte Auth). Le garde couvre `TG_OP='INSERT'` — ces 2 cas l'ancrent,
--       sinon une réécriture en `TG_OP='UPDATE'` resterait verte.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (gen_random_uuid(), 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid,
             'inj-ops@esc.test', 'I', 'NJ', 'ops_savr') $$,
  '42501',
  NULL,
  'P0 — traiteur_manager NE PEUT PAS INSÉRER un user ops_savr (usr_manager_insert)'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
     VALUES (gen_random_uuid(), 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid,
             'inj-adm@esc.test', 'I', 'NJ', 'admin_savr') $$,
  '42501',
  NULL,
  'P0 — traiteur_manager NE PEUT PAS INSÉRER un user admin_savr (usr_manager_insert)'
);

-- =====================================================================
-- 9-12 — VOLET 2 : escalade de TENANT / colonnes structurantes immuables.
--        9 = LE pivot cross-organisation (le claim organisation_id en dérive via
--        fn_custom_access_token) ; 10-12 = les vecteurs voisins de la même famille.
-- =====================================================================
SELECT throws_ok(
  $$ UPDATE plateforme.users SET organisation_id = 'e5ca1ad0-0000-0000-0000-0000000000b1'::uuid
     WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'P0 — un client NE PEUT PAS se rattacher à une autre organisation (pivot cross-tenant)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET email = 'pirate@esc.test'
     WHERE id = 'e5ca1ad0-0000-0000-0000-000000000002'::uuid $$,
  '42501',
  NULL,
  'un client NE PEUT PAS réécrire l''email d''un tiers (capture de compte via reset)'
);

-- ⚠ CAS 11 — la RLS refuse DÉJÀ toute écriture de `deleted_at` par un client, quel
-- que soit le chemin (mesuré : self ET collègue). Le garde du trigger y est donc de
-- la DÉFENSE EN PROFONDEUR, pas le mécanisme qui ferme le trou (même logique que
-- R10b pour `organisations.tarif_refacture_pax_zd`, déjà couvert par un GRANT colonne).
-- PIÈGE : une violation de WITH CHECK RLS et le RAISE du trigger renvoient le MÊME
-- SQLSTATE 42501 — asserter le seul code rendrait ce cas VACUOUS (vert avec ou sans
-- la migration). On assert donc le MESSAGE du trigger : comme un BEFORE ROW s'exécute
-- AVANT l'évaluation du WITH CHECK, c'est bien lui qui parle en premier quand il
-- existe. Le cas redevient porteur (rouge sans la migration) et distingue les deux
-- mécanismes. Contrepartie assumée : couplage à la chaîne de caractères.
SELECT throws_ok(
  $$ UPDATE plateforme.users SET deleted_at = now() WHERE id = auth.uid() $$,
  '42501',
  'Changement de deleted_at refusé sous authenticated (dé-anonymisation RGPD)',
  'un client NE PEUT PAS toucher deleted_at (garde trigger, en amont de la RLS)'
);

SELECT test_set_jwt('traiteur_manager', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000006'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.users SET actif = true WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'un compte suspendu NE PEUT PAS se réactiver lui-même (actif sur soi)'
);

-- =====================================================================
-- 13-14 — VOLET 2, colonne `id` : clé de jointure avec auth.uid() et cible de
--         21 FK → re-binding d'identité et répudiation d'audit.
--         LES DEUX CAS SONT PORTEURS : `usr_self_update` bloquerait seul le cas 13
--         (son WITH CHECK `id = auth.uid()` casse si l'id change), MAIS les policies
--         permissives se combinent en OR — et `usr_manager_update` / `usr_gestionnaire_update`
--         ne revérifient que rôle + organisation, jamais l'identité de la ligne. Il
--         suffit donc qu'UNE policy valide la ligne pour que l'UPDATE passe. Mesuré
--         en isolation sur l'état pré-correctif : `UPDATE ... SET id = ... WHERE
--         id = auth.uid()` par un traiteur_manager -> `UPDATE 1`. Vulnérabilité réelle.
--
--         ⚠ PIÈGE DE MÉTHODE, vécu sur ce fichier : mesurer la non-vacuité en
--         rejouant le fichier ENTIER sans la migration donne un faux « vert » sur le
--         cas 13. Sans le correctif, le cas 9 (pivot) RÉUSSIT et déplace l'attaquant
--         dans l'org victime ; le cas 13 est alors rejeté par la RLS pour une raison
--         SANS RAPPORT (claim d'org désormais désaligné). Une conclusion de
--         non-vacuité par cas ne vaut que mesurée EN ISOLATION — les cas antérieurs
--         mutent l'état. C'est la revue de conformité qui a attrapé l'erreur.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000001'::uuid);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET id = 'e5ca1ad0-0000-0000-0000-0000000000ff'::uuid
     WHERE id = auth.uid() $$,
  '42501',
  NULL,
  'un client NE PEUT PAS réécrire son propre id (re-binding d''identité)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.users SET id = 'e5ca1ad0-0000-0000-0000-0000000000fe'::uuid
     WHERE id = 'e5ca1ad0-0000-0000-0000-000000000002'::uuid $$,
  '42501',
  NULL,
  'un manager NE PEUT PAS réécrire l''id d''un collègue (répudiation d''audit)'
);

-- =====================================================================
-- 15 — Anti-sur-blocage du volet 2, le contrôle le PLUS important : suspendre un
--      COLLABORATEUR reste possible. `traiteur/equipe/[id]` et
--      `gestionnaire/mon-organisation/users/[id]` tournent en
--      createSupabaseServerClient (donc sous `authenticated`) : si le garde `actif`
--      n'était pas scopé à `NEW.id = auth.uid()`, cette fonctionnalité casserait.
-- =====================================================================
SELECT test_set_jwt('traiteur_manager', 'e5ca1ad0-0000-0000-0000-0000000000a1'::uuid, 'e5ca1ad0-0000-0000-0000-000000000001'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET actif = false
     WHERE id = 'e5ca1ad0-0000-0000-0000-000000000002'::uuid $$,
  'un manager PEUT toujours suspendre un collaborateur de son org (pas de sur-blocage)'
);

SELECT * FROM finish();
ROLLBACK;
