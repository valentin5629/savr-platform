-- =============================================================================
-- pgTAP — f_dechets_labo_estimes réservée au gestionnaire de lieux (et au staff)
-- Migration : 20261029120000_plateforme_dechets_labo_reserve_gestionnaire.sql
-- =============================================================================
-- Fuite fermée (revue sécurité de la PR #672, 2026-10-29) : une agence qui
-- programme pour un traiteur tiers appelait la fonction sur son propre
-- événement, divisait par le pax et lisait le coefficient confidentiel du
-- traiteur. §05 R_dechets_labo_estimes : « espace gestionnaire de lieux
-- uniquement ».
--
-- ORACLES
--   1-4 fermeture : agence, traiteur manager, traiteur commercial, client
--       organisateur → NULL, chacun sur un événement de SA propre organisation
--       (la branche qui fuyait).
--   5   non-vacuité de 1-4 : le staff lit 30 kg sur ces mêmes événements, le
--       NULL vient donc du rôle, pas d'un coefficient ou d'un événement absent.
--   6-7 le gestionnaire garde la valeur : événement sur son lieu, événement
--       programmé par son organisation hors de ses lieux.
--   8   gestionnaire d'un autre parc : NULL (périmètre inchangé).
--   9-10 anon : plus d'EXECUTE, l'appel est refusé (42501).
--   11  ensemble des grantees EXECUTE = authenticated, postgres, service_role.
--   12  SECURITY DEFINER et search_path conservés par CREATE OR REPLACE.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(12);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_dlr_jwt(p_role text, p_org_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated',
    'user_role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_dlr_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- Fixture ---------------------------------------------------------------------
-- T  = traiteur opérationnel de tous les événements, coefficient 2025 = 0.1500
-- A  = agence · CO = client organisateur · G = gestionnaire du lieu L_IN
-- G2 = gestionnaire d'un autre parc (L_AUTRE)
-- Tous les événements datent de 2026, pax 200 : valeur attendue 200 × 0.15 = 30.
SELECT test_dlr_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES
  ('d1a20001-0000-0000-0000-00000000d1a2'::uuid, 'DLR Traiteur', 'DLR Traiteur SAS', 'traiteur',            '88820000000001', true, 1.50),
  ('d1a20002-0000-0000-0000-00000000d1a2'::uuid, 'DLR Agence',   'DLR Agence SAS',   'agence',              '88820000000002', true, 0),
  ('d1a20003-0000-0000-0000-00000000d1a2'::uuid, 'DLR Client',   'DLR Client SAS',   'client_organisateur', '88820000000003', true, 0),
  ('d1a20004-0000-0000-0000-00000000d1a2'::uuid, 'DLR Gest',     'DLR Gest SA',      'gestionnaire_lieux',  '88820000000004', true, 0),
  ('d1a20005-0000-0000-0000-00000000d1a2'::uuid, 'DLR Gest 2',   'DLR Gest 2 SA',    'gestionnaire_lieux',  '88820000000005', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES
  ('d1a20a01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'chef@dlr-traiteur.test', 'Chef', 'T', 'traiteur_manager', true),
  ('d1a20a02-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'admin@dlr-savr.test', 'Admin', 'S', 'admin_savr', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('d1a2ef01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
        'DLR Traiteur SAS', '88820000000001', '1 rue Traiteur', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('d1a21001-0000-0000-0000-00000000d1a2'::uuid, 'DLR Lieu IN',    '2 rue Dedans', '75002', 'Paris', 'camionnette'),
  ('d1a21002-0000-0000-0000-00000000d1a2'::uuid, 'DLR Lieu OUT',   '3 rue Dehors', '75003', 'Paris', 'camionnette'),
  ('d1a21003-0000-0000-0000-00000000d1a2'::uuid, 'DLR Lieu AUTRE', '4 rue Autre',  '75004', 'Paris', 'camionnette');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES
  ('d1a20004-0000-0000-0000-00000000d1a2'::uuid, 'd1a21001-0000-0000-0000-00000000d1a2'::uuid),
  ('d1a20005-0000-0000-0000-00000000d1a2'::uuid, 'd1a21003-0000-0000-0000-00000000d1a2'::uuid);

INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif)
VALUES ('d1a27e01-0000-0000-0000-00000000d1a2'::uuid, 'DLR_LABO', 'DLR déchets labo', 1, true);

INSERT INTO plateforme.coefficients_perte_labo
  (id, organisation_id, annee_reference, coefficient_kg_couvert, saisi_par)
VALUES ('d1a2c001-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
        2025, 0.1500, 'd1a20a02-0000-0000-0000-00000000d1a2'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by,
  lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  -- E_AGENCE : programmé par l'agence pour T, hors des lieux de G
  ('d1a2ee01-0000-0000-0000-00000000d1a2'::uuid,
   'd1a20002-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'd1a2ef01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20a01-0000-0000-0000-00000000d1a2'::uuid,
   'd1a21002-0000-0000-0000-00000000d1a2'::uuid, 'd1a27e01-0000-0000-0000-00000000d1a2'::uuid,
   'DLR Agence', '2026-06-15', 200, 'Contact', '0600000041'),
  -- E_TRAITEUR : programmé par T lui-même, sur le lieu de G
  ('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid,
   'd1a20001-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'd1a2ef01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20a01-0000-0000-0000-00000000d1a2'::uuid,
   'd1a21001-0000-0000-0000-00000000d1a2'::uuid, 'd1a27e01-0000-0000-0000-00000000d1a2'::uuid,
   'DLR Traiteur', '2026-06-16', 200, 'Contact', '0600000042'),
  -- E_CLIENT : organisation = client organisateur, hors des lieux de G
  ('d1a2ee03-0000-0000-0000-00000000d1a2'::uuid,
   'd1a20003-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'd1a2ef01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20a01-0000-0000-0000-00000000d1a2'::uuid,
   'd1a21002-0000-0000-0000-00000000d1a2'::uuid, 'd1a27e01-0000-0000-0000-00000000d1a2'::uuid,
   'DLR Client', '2026-06-17', 200, 'Contact', '0600000043'),
  -- E_GEST : programmé par G, hors de ses lieux
  ('d1a2ee04-0000-0000-0000-00000000d1a2'::uuid,
   'd1a20004-0000-0000-0000-00000000d1a2'::uuid, 'd1a20001-0000-0000-0000-00000000d1a2'::uuid,
   'd1a2ef01-0000-0000-0000-00000000d1a2'::uuid, 'd1a20a01-0000-0000-0000-00000000d1a2'::uuid,
   'd1a21002-0000-0000-0000-00000000d1a2'::uuid, 'd1a27e01-0000-0000-0000-00000000d1a2'::uuid,
   'DLR Gest', '2026-06-18', 200, 'Contact', '0600000044');

-- =============================================================================
-- 1-4 — fermeture : chaque rôle client sur un événement de SA organisation
-- =============================================================================
SELECT test_dlr_jwt('agence', 'd1a20002-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee01-0000-0000-0000-00000000d1a2'::uuid),
  NULL::numeric,
  '1. agence sur son propre événement pour un traiteur tiers : NULL (le coefficient ne se déduit plus)');

SELECT test_dlr_jwt('traiteur_manager', 'd1a20001-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid),
  NULL::numeric,
  '2. traiteur manager sur son propre événement : NULL');

SELECT test_dlr_jwt('traiteur_commercial', 'd1a20001-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid),
  NULL::numeric,
  '3. traiteur commercial sur un événement de son organisation : NULL');

SELECT test_dlr_jwt('client_organisateur', 'd1a20003-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee03-0000-0000-0000-00000000d1a2'::uuid),
  NULL::numeric,
  '4. client organisateur sur un événement de son organisation : NULL');

-- =============================================================================
-- 5 — non-vacuité de 1-4 : les mêmes événements ont bien une valeur
-- =============================================================================
SELECT test_dlr_jwt('admin_savr', NULL);
SELECT is(
  (SELECT string_agg(coalesce(plateforme.f_dechets_labo_estimes(id)::text, 'NULL'), ',' ORDER BY id)
     FROM unnest(ARRAY[
       'd1a2ee01-0000-0000-0000-00000000d1a2'::uuid,
       'd1a2ee02-0000-0000-0000-00000000d1a2'::uuid,
       'd1a2ee03-0000-0000-0000-00000000d1a2'::uuid]) AS id),
  '30.0000,30.0000,30.0000',
  '5. non-vacuité : le staff lit 30 kg sur les trois événements de 1-4');

-- =============================================================================
-- 6-8 — le gestionnaire garde la valeur, dans son seul périmètre
-- =============================================================================
SELECT test_dlr_jwt('gestionnaire_lieux', 'd1a20004-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid),
  30.0000::numeric,
  '6. gestionnaire, événement sur son lieu : 200 × 0,15 = 30 kg');

SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee04-0000-0000-0000-00000000d1a2'::uuid),
  30.0000::numeric,
  '7. gestionnaire, événement programmé par son organisation hors de ses lieux : 30 kg');

SELECT test_dlr_jwt('gestionnaire_lieux', 'd1a20005-0000-0000-0000-00000000d1a2'::uuid);
SELECT is(
  plateforme.f_dechets_labo_estimes('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid),
  NULL::numeric,
  '8. gestionnaire d''un autre parc : NULL (périmètre inchangé)');

-- =============================================================================
-- 9-10 — anon : plus d'EXECUTE
-- =============================================================================
SELECT test_dlr_superuser();
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.f_dechets_labo_estimes(uuid)', 'EXECUTE'),
  '9. anon n''a plus EXECUTE (ni direct, ni par PUBLIC)');

SELECT set_config('role', 'anon', true);
SELECT throws_ok(
  $$ SELECT plateforme.f_dechets_labo_estimes('d1a2ee02-0000-0000-0000-00000000d1a2'::uuid) $$,
  '42501',
  NULL,
  '10. appel sous anon : permission refusée');
SELECT test_dlr_superuser();

-- =============================================================================
-- 11-12 — ACL et propriétés que CREATE OR REPLACE peut défaire en silence
-- =============================================================================
-- 11. Ensemble des grantees, pas un booléen par rôle : `has_function_privilege`
--     répondrait `true` pour authenticated via PUBLIC et ne mordrait pas.
SELECT is(
  (SELECT string_agg(DISTINCT coalesce(r.rolname, 'PUBLIC'), ','
                     ORDER BY coalesce(r.rolname, 'PUBLIC'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) a
     LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'plateforme'
      AND p.proname = 'f_dechets_labo_estimes'
      AND a.privilege_type = 'EXECUTE'),
  'authenticated,postgres,service_role',
  '11. grantees EXECUTE = authenticated, postgres, service_role (anon et PUBLIC retirés)');

SELECT is(
  (SELECT p.prosecdef::text || ':' || array_to_string(p.proconfig, ';')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'f_dechets_labo_estimes'),
  'true:search_path=plateforme, pg_catalog',
  '12. SECURITY DEFINER et search_path verrouillé conservés');

SELECT * FROM finish();
ROLLBACK;
