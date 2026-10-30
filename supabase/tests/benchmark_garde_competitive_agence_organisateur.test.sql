-- =============================================================================
-- pgTAP — garde compétitive de f_benchmark_kg_pax_zd étendue à l'agence et au
-- client organisateur (migration 20261030160000)
-- =============================================================================
-- Prouve sous `authenticated`, JWT au format production (claim réservé `role` +
-- claim métier `user_role`), que la RPC appelée en direct (comme par PostgREST,
-- sans passer par `loadBenchmark`) :
--   1-5   refuse `p_traiteur_ids` non vide à l'agence et au client organisateur
--         (P0001, message de la garde) et les laisse consulter sans traiteur
--         nommé (NULL ou tableau vide) ;
--   6-8   rôles traiteur : inchangés (refusés avec, acceptés sans) ;
--   9-10  gestionnaire de lieux : inchangé (garde de périmètre 42501, pas la
--         garde compétitive ; accepté sans traiteur nommé) ;
--   11    admin_savr : inchangé (peut nommer des traiteurs) ;
--   12-13 droits conservés : ensemble EXACT des bénéficiaires d'EXECUTE
--         (aclexplode) + SECURITY DEFINER / search_path verrouillé.
-- La garde s'évalue avant toute lecture : aucune fixture de données requise.
-- =============================================================================

BEGIN;
SELECT plan(13);

CREATE OR REPLACE FUNCTION _gca_set_jwt(p_role text, p_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org,
    'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- 1-3. Agence ------------------------------------------------------------------
SELECT _gca_set_jwt('agence', 'ca000000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid,
                               'ca000000-0000-0000-0000-0000000000b2'::uuid]) $$,
  'P0001',
  'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)',
  '1. agence + traiteurs nommés ⇒ refus (préservation compétitive)');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M']) $$,
  '2. agence sans traiteur nommé ⇒ benchmark consultable');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_traiteur_ids => '{}'::uuid[]) $$,
  '3. agence + tableau vide ⇒ accepté (ne nomme personne, comportement inchangé)');

-- 4-5. Client organisateur -----------------------------------------------------
SELECT _gca_set_jwt('client_organisateur', 'ca000000-0000-0000-0000-0000000000a2'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid]) $$,
  'P0001',
  'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)',
  '4. client organisateur + traiteur nommé ⇒ refus (préservation compétitive)');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M']) $$,
  '5. client organisateur sans traiteur nommé ⇒ benchmark consultable');

-- 6-8. Rôles traiteur (inchangés) ----------------------------------------------
SELECT _gca_set_jwt('traiteur_manager', 'ca000000-0000-0000-0000-0000000000a3'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid]) $$,
  'P0001', NULL,
  '6. traiteur_manager + traiteur nommé ⇒ refus (inchangé)');

SELECT _gca_set_jwt('traiteur_commercial', 'ca000000-0000-0000-0000-0000000000a3'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid]) $$,
  'P0001', NULL,
  '7. traiteur_commercial + traiteur nommé ⇒ refus (inchangé)');

SELECT _gca_set_jwt('traiteur_manager', 'ca000000-0000-0000-0000-0000000000a3'::uuid);
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M']) $$,
  '8. traiteur_manager sans traiteur nommé ⇒ benchmark consultable (inchangé)');

-- 9-10. Gestionnaire de lieux (inchangé : garde de périmètre, pas compétitive) --
SELECT _gca_set_jwt('gestionnaire_lieux', 'ca000000-0000-0000-0000-0000000000a4'::uuid);
SELECT throws_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid]) $$,
  '42501',
  'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire',
  '9. gestionnaire + traiteur hors de sa vue ⇒ garde de périmètre 42501 (inchangé)');

SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(p_taille_evenement_codes => ARRAY['M']) $$,
  '10. gestionnaire sans traiteur nommé ⇒ benchmark consultable (inchangé)');

-- 11. Admin Savr (inchangé) ------------------------------------------------------
SELECT _gca_set_jwt('admin_savr', NULL);
SELECT lives_ok(
  $$ SELECT * FROM plateforme.f_benchmark_kg_pax_zd(
       p_traiteur_ids => ARRAY['ca000000-0000-0000-0000-0000000000b1'::uuid]) $$,
  '11. admin_savr + traiteur nommé ⇒ accepté (inchangé)');

-- 12-13. Droits conservés --------------------------------------------------------
SELECT set_config('role', 'postgres', true);
SELECT set_config('request.jwt.claims', NULL, true);
SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_benchmark_kg_pax_zd'
      AND a.privilege_type = 'EXECUTE'),
  'authenticated,postgres,service_role',
  '12. ensemble EXACT des bénéficiaires d''EXECUTE (PUBLIC et anon absents)');

SELECT ok(
  (SELECT p.prosecdef
     AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_kg_pax_zd'),
  '13. SECURITY DEFINER + search_path toujours verrouillé');

SELECT * FROM finish();
ROLLBACK;
