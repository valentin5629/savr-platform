-- =============================================================================
-- Tests pgTAP — Benchmark : gardes de rôle FAIL-CLOSED (rôle absent = refus)
-- Migration : 20260923090000_plateforme_benchmark_gardes_role_fail_closed.sql
-- =============================================================================
-- Faille fermée : `plateforme.f_app_role()` rend NULL quand le jeton ne porte pas
-- le claim `user_role`, et la logique ternaire de SQL fait que `NULL NOT IN (…)`
-- vaut NULL — ni TRUE, ni FALSE. Un `IF` dont la condition vaut NULL n'exécute pas
-- sa branche : les gardes en liste blanche des trois fonctions SECURITY DEFINER du
-- benchmark ne levaient donc JAMAIS face à l'appelant sans rôle métier, le seul
-- qu'elles auraient dû refuser en premier. Mesuré avant correctif, sous un jeton
-- `authenticated` sans `user_role` : f_benchmark_traiteurs_parc rendait la liste
-- COMPLÈTE des traiteurs du parc (information fermée aux rôles traiteur pour
-- préservation compétitive), f_benchmark_lieux_parc la liste des lieux, et
-- f_benchmark_single_collecte le ratio kg/pax d'une collecte d'une AUTRE
-- organisation. Chemin d'atteinte : PostgREST expose le schéma `plateforme`, donc
-- un POST /rest/v1/rpc/… court-circuite les routes Next.js (déjà fermées, elles,
-- par requireUser).
--
-- Oracle :
--   1-2   précondition de NON-VACUITÉ — sous les jetons de test, f_app_role() est
--         bien NULL (sans quoi tout le fichier pourrait être vert sans rapport) ;
--   3-8   les 3 fonctions REFUSENT, pour les DEUX formes du jeton (clé `user_role`
--         absente de l'objet, et clé présente à `null` JSON) ;
--   9     le message distinct DISCRIMINE bien : sous un rôle légitime, une collecte
--         inexistante lève toujours 'Collecte not accessible' ;
--   10    organisation absente sous rôle client = refus explicite ;
--   11-14 MIROIRS POSITIFS — la garde n'est pas devenue un mur : gestionnaire et
--         traiteur propriétaire passent toujours et rendent des lignes, et
--         admin_savr passe SANS `organisation_id` (un test NULL en bloc l'aurait
--         refusé à tort) ;
--   15-20 le durcissement n'a pas été défait en silence par CREATE OR REPLACE :
--         ensemble EXACT des bénéficiaires d'EXECUTE (aclexplode, pas
--         has_function_privilege qui est vert aussi bien après un GRANT PUBLIC
--         qu'après un REVOKE), + prosecdef + proconfig/search_path.
--
-- ⚠ FIXTURE RÉELLE obligatoire pour f_benchmark_single_collecte : sur un uuid
-- inventé, la fonction lève déjà 'Collecte not accessible' via son `IF NOT FOUND`,
-- et un test écrit ainsi serait vert SANS le correctif. Les cas 5 et 8 portent donc
-- sur une collecte qui EXISTE, et assertent le message DISTINCT.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(20);

-- Helpers ---------------------------------------------------------------------
-- `p_role_absent` = ne pose PAS la clé `user_role` dans l'objet JSON (≠ la poser
-- à NULL). Les deux formes rendent NULL via `->>` — le fichier le PROUVE (1-2)
-- au lieu de le supposer, et couvre les deux (3-5 puis 6-8).
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid(),
  p_role_absent boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'organisation_id', p_org_id,
    'app_domain', 'plateforme');
BEGIN
  IF NOT p_role_absent THEN
    v_claims := v_claims || jsonb_build_object('user_role', p_role);
  END IF;
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Fixture ---------------------------------------------------------------------
-- P = traiteur PROPRIÉTAIRE de l'événement ; C = traiteur CONCURRENT (sans aucun
--     lien avec l'appelant : c'est lui que la fuite exposait) ; G = gestionnaire.
-- `flux_dechets` est un référentiel FERMÉ (CHECK sur `code`) déjà seedé par les
-- migrations : on RÉUTILISE la ligne 'verre', on n'en insère pas.
SELECT test_as_superuser();

INSERT INTO auth.users (id, email)
VALUES ('be470001-0000-0000-0000-000000000001', 'owner@secu-garde.test');

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow) VALUES
  ('be470010-0000-0000-0000-000000000001', 'SECU Traiteur Proprio',     'traiteur',           true, false),
  ('be470010-0000-0000-0000-000000000002', 'SECU Traiteur Concurrent',  'traiteur',           true, false),
  ('be470010-0000-0000-0000-000000000003', 'SECU Gestionnaire',         'gestionnaire_lieux', true, false);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('be470020-0000-0000-0000-000000000001', 'be470010-0000-0000-0000-000000000001',
        'SECU Traiteur Proprio SAS', '11122233300011', '1 rue Secu', '75001', 'Paris');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('be470001-0000-0000-0000-000000000001', 'be470010-0000-0000-0000-000000000001',
        'owner@secu-garde.test', 'Secu', 'Owner', 'traiteur_manager');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, actif)
VALUES ('be470030-0000-0000-0000-000000000001', 'SECU Lieu', '2 rue Secu', '75002', 'Paris', 'fourgon', true);

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('be470040-0000-0000-0000-000000000001', 'secu_garde_cocktail', 'SECU Cocktail');

INSERT INTO plateforme.evenements
  (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, lieu_id,
   created_by, type_evenement_id, pax, contact_principal_nom, contact_principal_telephone)
VALUES ('be470050-0000-0000-0000-000000000001', 'be470010-0000-0000-0000-000000000001',
        'be470010-0000-0000-0000-000000000001', 'be470020-0000-0000-0000-000000000001',
        'be470030-0000-0000-0000-000000000001', 'be470001-0000-0000-0000-000000000001',
        'be470040-0000-0000-0000-000000000001', 300, 'Secu Contact', '0600000000');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, date_collecte, heure_collecte)
VALUES ('be470060-0000-0000-0000-000000000001', 'be470050-0000-0000-0000-000000000001',
        'zero_dechet', 'realisee', current_date - 1, '06:00');

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT 'be470060-0000-0000-0000-000000000001', fd.id, 42.0
  FROM plateforme.flux_dechets fd WHERE fd.code = 'verre';

-- Garde anti-fixture-vide : sans cette ligne, les miroirs positifs 13-14
-- pourraient rendre 0 ligne pour une raison sans rapport avec la garde de rôle.
DO $$ BEGIN
  IF (SELECT count(*) FROM plateforme.collecte_flux
       WHERE collecte_id = 'be470060-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Fixture invalide : le flux ''verre'' du referentiel est introuvable';
  END IF;
END $$;

-- =============================================================================
-- 1-2. PRÉCONDITION DE NON-VACUITÉ — le jeton de test produit bien un rôle NULL
-- =============================================================================
SELECT test_set_jwt_prod(NULL, 'be470010-0000-0000-0000-000000000009'::uuid,
                         'be470001-0000-0000-0000-000000000009'::uuid, true);
SELECT ok(plateforme.f_app_role() IS NULL,
  '1. non-vacuite : clé `user_role` ABSENTE de l''objet ⇒ f_app_role() IS NULL');

SELECT test_set_jwt_prod(NULL, 'be470010-0000-0000-0000-000000000009'::uuid,
                         'be470001-0000-0000-0000-000000000009'::uuid, false);
SELECT ok(plateforme.f_app_role() IS NULL,
  '2. non-vacuite : clé `user_role` présente à `null` JSON ⇒ f_app_role() IS NULL');

-- =============================================================================
-- 3-5. REFUS — clé `user_role` ABSENTE de l'objet
-- =============================================================================
SELECT test_set_jwt_prod(NULL, 'be470010-0000-0000-0000-000000000009'::uuid,
                         'be470001-0000-0000-0000-000000000009'::uuid, true);

SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '3. clé absente : f_benchmark_traiteurs_parc REFUSE (la liste des traiteurs concurrents ne sort plus)');

SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '4. clé absente : f_benchmark_lieux_parc REFUSE');

-- ⚠ sur une collecte qui EXISTE (fixture), et message DISTINCT de celui du
-- `IF NOT FOUND` : sinon le cas serait vert sans le correctif.
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-000000000001')$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '5. clé absente : f_benchmark_single_collecte REFUSE sur une collecte RÉELLE');

-- =============================================================================
-- 6-8. REFUS — clé `user_role` présente à `null` JSON
-- =============================================================================
SELECT test_set_jwt_prod(NULL, 'be470010-0000-0000-0000-000000000009'::uuid,
                         'be470001-0000-0000-0000-000000000009'::uuid, false);

SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '6. `null` JSON : f_benchmark_traiteurs_parc REFUSE');

SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '7. `null` JSON : f_benchmark_lieux_parc REFUSE');

SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-000000000001')$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '8. `null` JSON : f_benchmark_single_collecte REFUSE sur une collecte RÉELLE');

-- =============================================================================
-- 9-10. Le message distinct DISCRIMINE ; organisation absente = refus explicite
-- =============================================================================
-- 9. Rôle légitime + collecte inexistante ⇒ toujours 'Collecte not accessible'.
--    C'est ce qui rend les cas 5 et 8 probants : les deux refus ne se confondent
--    pas, donc leur message prouve bien QUELLE garde a mordu.
SELECT test_set_jwt_prod('traiteur_manager', 'be470010-0000-0000-0000-000000000001'::uuid,
                         'be470001-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-0000000000ff')$$,
  'P0001', 'Collecte not accessible',
  '9. discriminateur : rôle légitime + collecte inexistante ⇒ message INCHANGÉ');

-- 10. Rôle client présent mais `organisation_id` absent : refus explicite.
SELECT test_set_jwt_prod('traiteur_manager', NULL,
                         'be470001-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-000000000001')$$,
  'P0001', 'Organisation applicative absente (acces refuse)',
  '10. rôle client sans organisation_id ⇒ refus explicite');

-- =============================================================================
-- 11-14. MIROIRS POSITIFS — la garde n'est pas devenue un mur
-- =============================================================================
SELECT test_set_jwt_prod('gestionnaire_lieux', 'be470010-0000-0000-0000-000000000003'::uuid,
                         'be470001-0000-0000-0000-000000000003'::uuid);

-- Non vacant : on exige la présence NOMMÉE du traiteur concurrent, pas un count.
SELECT ok(
  EXISTS (SELECT 1 FROM plateforme.f_benchmark_traiteurs_parc()
           WHERE id = 'be470010-0000-0000-0000-000000000002'),
  '11. miroir positif : gestionnaire_lieux obtient TOUJOURS la liste des traiteurs');

SELECT ok(
  EXISTS (SELECT 1 FROM plateforme.f_benchmark_lieux_parc()
           WHERE id = 'be470030-0000-0000-0000-000000000001'),
  '12. miroir positif : gestionnaire_lieux obtient TOUJOURS la liste des lieux');

-- Le traiteur propriétaire de l'événement : au moins une ligne, sinon vacant.
SELECT test_set_jwt_prod('traiteur_manager', 'be470010-0000-0000-0000-000000000001'::uuid,
                         'be470001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-000000000001')),
  1,
  '13. miroir positif : le traiteur propriétaire obtient TOUJOURS sa fiche (1 flux pesé)');

-- admin_savr SANS organisation_id : un `IF v_role IS NULL OR v_org IS NULL` posé
-- en bloc l'aurait refusé À TORT. `organisation_id` n'a aucun sens pour ce rôle.
SELECT test_set_jwt_prod('admin_savr', NULL,
                         'be470001-0000-0000-0000-000000000004'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.f_benchmark_single_collecte('be470060-0000-0000-0000-000000000001')),
  1,
  '14. miroir positif : admin_savr passe SANS organisation_id (pas de mur)');

-- =============================================================================
-- 15-20. Le durcissement n'a pas été défait en silence par CREATE OR REPLACE
-- =============================================================================
-- `CREATE OR REPLACE` PRÉSERVE l'ACL mais REMET `proconfig` À ZÉRO.
-- On asserte l'ENSEMBLE EXACT des bénéficiaires d'EXECUTE via aclexplode :
-- `has_function_privilege` ne mord dans aucun sens (vert après un GRANT PUBLIC
-- comme après un REVOKE). `postgres` = propriétaire ; `service_role` vient de
-- l'ALTER DEFAULT PRIVILEGES de 20260617160000 (l.43-44) pour les fonctions
-- créées après lui. PUBLIC doit être ABSENT des trois.
SELECT test_as_superuser();

SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_benchmark_single_collecte'
      AND a.privilege_type = 'EXECUTE'),
  'authenticated,postgres,service_role',
  '15. f_benchmark_single_collecte : ensemble EXACT des grantees EXECUTE (PUBLIC absent)');

SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_benchmark_lieux_parc'
      AND a.privilege_type = 'EXECUTE'),
  'authenticated,postgres,service_role',
  '16. f_benchmark_lieux_parc : ensemble EXACT des grantees EXECUTE (PUBLIC absent)');

SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_benchmark_traiteurs_parc'
      AND a.privilege_type = 'EXECUTE'),
  'authenticated,postgres,service_role',
  '17. f_benchmark_traiteurs_parc : ensemble EXACT des grantees EXECUTE (PUBLIC absent)');

SELECT ok(
  (SELECT p.prosecdef
     AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_single_collecte'),
  '18. f_benchmark_single_collecte : SECURITY DEFINER + search_path toujours verrouillé');

SELECT ok(
  (SELECT p.prosecdef
     AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_lieux_parc'),
  '19. f_benchmark_lieux_parc : SECURITY DEFINER + search_path toujours verrouillé');

SELECT ok(
  (SELECT p.prosecdef
     AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_traiteurs_parc'),
  '20. f_benchmark_traiteurs_parc : SECURITY DEFINER + search_path toujours verrouillé');

SELECT * FROM finish();
ROLLBACK;
