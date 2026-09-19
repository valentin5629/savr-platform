-- =============================================================================
-- Tests pgTAP — clés de logo bornées au format « <bucket>/logos/<uuid>.(png|jpg) »
-- Migration prouvée : 20260919100000_plateforme_logo_url_format_cle_r2
-- =============================================================================
-- Faille fermée (reviewer-rls-securite, 2026-09-18) : `authenticated` a UPDATE
-- colonne-level sur organisations.logo_url ; par PostgREST direct, un
-- traiteur_manager / gestionnaire_lieux / agence écrivait dans SON logo la clé d'un
-- objet R2 quelconque (bordereau, attestation, photo d'une autre organisation). La
-- synthèse PDF et les batchs PDF téléchargeaient ensuite cette clé et l'inlinaient
-- dans le PDF remis à l'attaquant. Mêmes consommateurs PDF pour
-- associations.logo_url et evenements.logo_client_organisateur_url.
--
-- NON-VACUITÉ (base rejouée SANS la migration) : les assertions de fermeture
-- (1-3, 7, 11-12, 14) tombent en `not ok` — les UPDATE/INSERT passent. Les
-- throws_ok assertent le MESSAGE du trigger, pas seulement le SQLSTATE : un refus
-- venu d'ailleurs (RLS, CHECK) ne les rend pas verts. Les assertions de maintien
-- (4-6, 8-10, 13, 15) sont les contrôles positifs : la ligne est bien modifiable par
-- ce rôle, seul le format est refusé ; valeur héritée hors format tolérée tant
-- qu'on n'y touche pas (backward-compatible).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(15);

-- Helpers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_set_jwt_prod(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
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

-- Fixture ---------------------------------------------------------------------
-- M = traiteur (manager), G = gestionnaire_lieux, A = agence, H = orga à logo hérité
-- hors format (posé avant la migration : triggers coupés le temps de la fixture).
SELECT test_as_superuser();
SET LOCAL session_replication_role = replica;

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif, est_shadow, logo_url)
VALUES
  ('1060a001-0000-0000-0000-0000000000c1'::uuid, 'LOGO Trait', 'LOGO Trait SAS', 'traiteur', true, false, NULL),
  ('1060a002-0000-0000-0000-0000000000c1'::uuid, 'LOGO Gest', 'LOGO Gest SA', 'gestionnaire_lieux', true, false, NULL),
  ('1060a003-0000-0000-0000-0000000000c1'::uuid, 'LOGO Agence', 'LOGO Agence SAS', 'agence', true, false, NULL),
  ('1060a004-0000-0000-0000-0000000000c1'::uuid, 'LOGO Hérité', 'LOGO Hérité SAS', 'traiteur', true, false,
   'https://bubble.test/logo-herite.png');

INSERT INTO plateforme.associations
  (id, nom, adresse, region, ville, contact_email, description_rapport_impact, logo_url)
VALUES ('1060a005-0000-0000-0000-0000000000c1'::uuid, 'LOGO Asso', '5 rue Asso', 'idf', 'Paris',
        'asso@logo.test', 'Association de test pour la garde de format des logos.', NULL);

SET LOCAL session_replication_role = origin;

-- Événement : FK réelles (un UPDATE d'une ligne insérée dans la même transaction
-- revérifie ses FK, même inchangées).
INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('1060a0e1-0000-0000-0000-0000000000c1'::uuid, 'cocktail_logo', 'Cocktail LOGO');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('1060a0e2-0000-0000-0000-0000000000c1'::uuid, '1060a001-0000-0000-0000-0000000000c1'::uuid,
   'mgr@logo.test', 'Mgr', 'Logo', 'traiteur_manager');
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('1060a0e3-0000-0000-0000-0000000000c1'::uuid, '1060a001-0000-0000-0000-0000000000c1'::uuid,
   'LOGO Trait SAS', '10600000000001', '1 rue', '75001', 'Paris');
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('1060a0e4-0000-0000-0000-0000000000c1'::uuid, 'Salle LOGO', '1 rue', '75001', 'Paris', 'fourgon');
INSERT INTO plateforme.evenements
  (id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id, lieu_id,
   created_by, type_evenement_id, pax, contact_principal_nom, contact_principal_telephone)
VALUES ('1060a006-0000-0000-0000-0000000000c1'::uuid,
        '1060a001-0000-0000-0000-0000000000c1'::uuid, '1060a001-0000-0000-0000-0000000000c1'::uuid,
        '1060a0e3-0000-0000-0000-0000000000c1'::uuid, '1060a0e4-0000-0000-0000-0000000000c1'::uuid,
        '1060a0e2-0000-0000-0000-0000000000c1'::uuid, '1060a0e1-0000-0000-0000-0000000000c1'::uuid,
        100, 'Contact Logo', '0100000000');

-- Clé d'upload valide et clé hostile (bordereau d'une autre organisation).
CREATE TEMP TABLE k ON COMMIT DROP AS SELECT
  'savr-dev/logos/0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4.png'::text AS ok,
  'savr-dev/logos/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jpg'::text AS ok_jpg,
  'savr-dev/bordereaux/autre-org/b1.pdf'::text                   AS hostile;
GRANT SELECT ON k TO authenticated, service_role;

-- 1-6 — organisations.logo_url : PATCH PostgREST direct par les 3 rôles clients --
SELECT test_set_jwt_prod('traiteur_manager', '1060a001-0000-0000-0000-0000000000c1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET logo_url = (SELECT hostile FROM k)
      WHERE id = '1060a001-0000-0000-0000-0000000000c1' $$,
  '23514', 'organisations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '1. traiteur_manager : logo_url vers un bordereau refusé');

SELECT test_set_jwt_prod('gestionnaire_lieux', '1060a002-0000-0000-0000-0000000000c1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET logo_url = 'savr-dev/logos/../bordereaux/b1.pdf'
      WHERE id = '1060a002-0000-0000-0000-0000000000c1' $$,
  '23514', 'organisations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '2. gestionnaire_lieux : traversée sous logos/ refusée');

SELECT test_set_jwt_prod('agence', '1060a003-0000-0000-0000-0000000000c1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET logo_url = 'https://attaquant.test/pixel.png'
      WHERE id = '1060a003-0000-0000-0000-0000000000c1' $$,
  '23514', 'organisations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '3. agence : URL externe refusée');

SELECT test_set_jwt_prod('traiteur_manager', '1060a001-0000-0000-0000-0000000000c1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET logo_url = (SELECT ok FROM k)
      WHERE id = '1060a001-0000-0000-0000-0000000000c1' $$,
  '4. traiteur_manager : clé produite par la route d''upload acceptée (contrôle positif)');

SELECT test_set_jwt_prod('gestionnaire_lieux', '1060a002-0000-0000-0000-0000000000c1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET logo_url = (SELECT ok_jpg FROM k)
      WHERE id = '1060a002-0000-0000-0000-0000000000c1' $$,
  '5. gestionnaire_lieux : clé .jpg acceptée (contrôle positif)');

SELECT test_set_jwt_prod('agence', '1060a003-0000-0000-0000-0000000000c1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET logo_url = NULL WHERE id = '1060a003-0000-0000-0000-0000000000c1';
     UPDATE plateforme.organisations SET logo_url = '' WHERE id = '1060a003-0000-0000-0000-0000000000c1' $$,
  '6. agence : logo retiré (NULL puis vide) accepté');

-- 7 — le staff (service_role, routes admin) est soumis au même format -------------
SELECT test_as_service_role();
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, actif, est_shadow, logo_url)
     VALUES ('1060a007-0000-0000-0000-0000000000c1', 'LOGO Ins', 'LOGO Ins SAS', 'traiteur', true, false,
             'savr-dev/attestations/a1.pdf') $$,
  '23514', 'organisations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '7. INSERT organisations : clé hors logos/ refusée');

-- 8-10 — valeur héritée hors format : tolérée tant qu'on n'y touche pas ----------
SELECT test_set_jwt_prod('traiteur_manager', '1060a004-0000-0000-0000-0000000000c1'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET raison_sociale = 'LOGO Hérité SA'
      WHERE id = '1060a004-0000-0000-0000-0000000000c1' $$,
  '8. logo hérité hors format : un UPDATE d''une autre colonne n''est pas bloqué');
SELECT lives_ok(
  $$ UPDATE plateforme.organisations SET logo_url = logo_url
      WHERE id = '1060a004-0000-0000-0000-0000000000c1' $$,
  '9. logo hérité hors format : réécrire la même valeur n''est pas bloqué');
SELECT test_as_superuser();
SELECT is(
  (SELECT raison_sociale || '|' || logo_url FROM plateforme.organisations
    WHERE id = '1060a004-0000-0000-0000-0000000000c1'),
  'LOGO Hérité SA|https://bubble.test/logo-herite.png',
  '10. logo hérité : ligne mise à jour, valeur héritée intacte');

-- 11-13 — associations.logo_url (rapports AG, écrit par le staff) ----------------
SELECT test_as_service_role();
SELECT throws_ok(
  $$ UPDATE plateforme.associations SET logo_url = (SELECT hostile FROM k)
      WHERE id = '1060a005-0000-0000-0000-0000000000c1' $$,
  '23514', 'associations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '11. associations : logo_url vers un bordereau refusé');
SELECT throws_ok(
  $$ UPDATE plateforme.associations SET logo_url = 'savr-dev/logos/abc.png'
      WHERE id = '1060a005-0000-0000-0000-0000000000c1' $$,
  '23514', 'associations.logo_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '12. associations : nom de fichier hors uuid refusé');
SELECT lives_ok(
  $$ UPDATE plateforme.associations SET logo_url = (SELECT ok FROM k)
      WHERE id = '1060a005-0000-0000-0000-0000000000c1' $$,
  '13. associations : clé d''upload acceptée (contrôle positif)');

-- 14-15 — evenements.logo_client_organisateur_url (reçu du corps de programmation) --
SELECT test_as_service_role();
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET logo_client_organisateur_url = (SELECT hostile FROM k)
      WHERE id = '1060a006-0000-0000-0000-0000000000c1' $$,
  '23514', 'evenements.logo_client_organisateur_url : clé de logo invalide (attendu <bucket>/logos/<uuid>.png|jpg)',
  '14. evenements : logo client vers un bordereau refusé');
SELECT lives_ok(
  $$ UPDATE plateforme.evenements SET logo_client_organisateur_url = (SELECT ok FROM k)
      WHERE id = '1060a006-0000-0000-0000-0000000000c1' $$,
  '15. evenements : clé d''upload acceptée (contrôle positif)');

SELECT * FROM finish();
ROLLBACK;
