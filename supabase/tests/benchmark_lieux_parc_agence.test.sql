-- =============================================================================
-- Benchmark : liste des lieux du parc ouverte au rôle agence (D8)
-- Migration : 20260930180000_plateforme_benchmark_lieux_parc_agence.sql
-- =============================================================================
-- Arbitrage Val 2026-09-30 (divergence M3.1_20260929_popup-client-implementation,
-- D8) : §06.11 donne à l'agence le benchmark 4 dimensions du §06.04, dont le
-- filtre Lieux ; f_benchmark_lieux_parc refusait le rôle agence et la route
-- /api/v1/dashboards/benchmark/filtres échouait en entier (listes vides).
--
-- Migration ÉLARGISSANTE (CLAUDE.md §12 2bis) : ce fichier borne l'ouverture.
--   1     non-vacuité : un lieu actif et un lieu inactif existent (superuser) ;
--   2-3   l'agence obtient la liste, lieu actif NOMMÉ présent, lieu inactif
--         absent — exactement ce que voit déjà un rôle traiteur (miroir 4) ;
--   5     contrat de sortie inchangé : 2 colonnes (id, nom), rien d'autre ;
--   6-8   l'ouverture ne déborde pas : client_organisateur toujours refusé,
--         rôle absent toujours refusé (fail-closed), et f_benchmark_traiteurs_parc
--         reste FERMÉE à l'agence (préservation compétitive) ;
--   9-10  durcissement conservé par le CREATE OR REPLACE : ensemble EXACT des
--         bénéficiaires d'EXECUTE (aclexplode) + SECURITY DEFINER / search_path.
--
-- JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(10);

CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_role_absent boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'sub', gen_random_uuid(),
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
SELECT test_as_superuser();
DO $$ BEGIN
  INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif) VALUES
    ('d8000000-0000-0000-0000-0000000000a1', 'Agence D8', 'Agence D8 SAS', 'agence', '58000000000011', true),
    ('d8000000-0000-0000-0000-0000000000a2', 'Traiteur D8', 'Traiteur D8 SAS', 'traiteur', '58000000000022', true);
  INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max, latitude, longitude, region, actif) VALUES
    ('d8300000-0000-0000-0000-000000000001', 'Salle Active D8', '1 rue D8', '75010', 'Paris', 'camionnette', 48.87, 2.36, 'idf', true),
    ('d8300000-0000-0000-0000-000000000002', 'Salle Fermee D8', '2 rue D8', '75011', 'Paris', 'camionnette', 48.86, 2.37, 'idf', false);
END $$;

-- 1. Non-vacuité ---------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM plateforme.lieux WHERE id::text LIKE 'd830%'),
  2,
  '1. non-vacuité : un lieu actif et un lieu inactif existent en base');

-- 2-3. L'agence obtient la liste ----------------------------------------------
SELECT test_set_jwt_prod('agence', 'd8000000-0000-0000-0000-0000000000a1');
SELECT ok(
  EXISTS (SELECT 1 FROM plateforme.f_benchmark_lieux_parc()
           WHERE id = 'd8300000-0000-0000-0000-000000000001' AND nom = 'Salle Active D8'),
  '2. agence : le lieu actif figure dans la liste (D8)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM plateforme.f_benchmark_lieux_parc()
               WHERE id = 'd8300000-0000-0000-0000-000000000002'),
  '3. agence : le lieu inactif n''y figure pas (même filtre que pour les traiteurs)');

-- 4. Miroir : l'agence voit exactement la liste d'un rôle traiteur ------------
SELECT test_set_jwt_prod('agence', 'd8000000-0000-0000-0000-0000000000a1');
CREATE TEMP TABLE liste_agence ON COMMIT DROP AS
  SELECT id, nom FROM plateforme.f_benchmark_lieux_parc();
SELECT test_set_jwt_prod('traiteur_manager', 'd8000000-0000-0000-0000-0000000000a2');
SELECT set_eq(
  $$SELECT id, nom FROM plateforme.f_benchmark_lieux_parc()$$,
  $$SELECT id, nom FROM liste_agence$$,
  '4. agence = traiteur_manager : même liste, ni plus ni moins');

-- 5. Contrat de sortie inchangé -----------------------------------------------
SELECT test_as_superuser();
SELECT is(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_lieux_parc'),
  'TABLE(id uuid, nom text)',
  '5. sortie limitée à (id, nom) : aucune colonne de lieu supplémentaire');

-- 6-8. L'ouverture ne déborde pas ---------------------------------------------
SELECT test_set_jwt_prod('client_organisateur', 'd8000000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()$$,
  'P0001', 'Role non autorise pour la liste benchmark',
  '6. client_organisateur : toujours refusé');

SELECT test_set_jwt_prod(NULL, 'd8000000-0000-0000-0000-0000000000a1', true);
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_lieux_parc()$$,
  'P0001', 'Role applicatif absent (acces refuse)',
  '7. rôle absent du jeton : toujours refusé (fail-closed)');

SELECT test_set_jwt_prod('agence', 'd8000000-0000-0000-0000-0000000000a1');
SELECT throws_ok(
  $$SELECT count(*) FROM plateforme.f_benchmark_traiteurs_parc()$$,
  'P0001', 'Role non autorise pour la liste traiteurs benchmark',
  '8. agence : la liste des traiteurs reste FERMÉE (préservation compétitive)');

-- 9-10. Durcissement conservé -------------------------------------------------
SELECT test_as_superuser();
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
  '9. ensemble EXACT des bénéficiaires d''EXECUTE (PUBLIC et anon absents)');

SELECT ok(
  (SELECT p.prosecdef
     AND 'search_path=plateforme, pg_catalog' = ANY(coalesce(p.proconfig, '{}'))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_benchmark_lieux_parc'),
  '10. SECURITY DEFINER + search_path toujours verrouillé');

SELECT * FROM finish();
ROLLBACK;
