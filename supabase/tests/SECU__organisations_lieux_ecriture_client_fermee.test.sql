-- =============================================================================
-- SÉCURITÉ — écriture PostgREST directe de `plateforme.organisations_lieux` fermée.
--
-- Migration prouvée : 20260929150000_plateforme_organisations_lieux_ecriture_client_fermee.
-- Même geste que SECU__lieux_ecriture_client_fermee. CLAUDE.md §12 pt 2bis.
--
-- ⚠ Le chemin fermé est STAFF : `org_lieux_admin` est `FOR ALL`, USING
-- `f_is_staff()`, WITH CHECK `admin_savr`. Avant la migration, un JWT admin_savr
-- porté par la clé anon insérait, modifiait et supprimait ; un JWT ops_savr
-- supprimait (USING seul). A1-A5 rejouent ces écritures et exigent un refus.
--
-- ⚠ Tout se joue SOUS RÔLE `authenticated` : sous service_role ou superuser la
-- RLS est bypassée et les privilèges sont ceux d'un autre rôle. Chaque refus
-- asserte le MESSAGE « permission denied for table organisations_lieux », pour
-- qu'un 42501 levé ailleurs — RLS, trigger — ne suffise pas à faire passer le cas.
--
-- ⚠ Le bloc B interdit la SUR-fermeture : le SELECT sert les sous-requêtes des
-- policies `evenements` / `lieux` (§09 A1) ; le retirer les viderait en silence.
-- =============================================================================

BEGIN;
SELECT plan(12);

CREATE OR REPLACE FUNCTION olf_jwt(p_role text, p_org uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'user_role', p_role,
    'organisation_id', p_org, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION olf_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

CREATE OR REPLACE FUNCTION olf_service_role() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role', 'service_role', true);
END $$;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- G1, G2 : gestionnaires ; L1 rattaché à G1, L2 libre, L3 rattaché à G2.
-- E1 : événement DATÉ programmé par le traiteur T sur L1 (preuve bloc B).
SELECT olf_superuser();

INSERT INTO plateforme.organisations (id, nom, type, siret, actif, est_shadow) VALUES
  ('0f1a0001-0000-0000-0000-000000000001'::uuid, 'OLF G1', 'gestionnaire_lieux', '93000000000001', true, false),
  ('0f1a0001-0000-0000-0000-000000000002'::uuid, 'OLF G2', 'gestionnaire_lieux', '93000000000002', true, false),
  ('0f1a0001-0000-0000-0000-000000000003'::uuid, 'OLF T',  'traiteur',           '93000000000003', true, false);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('0f1a0002-0000-0000-0000-000000000003'::uuid, '0f1a0001-0000-0000-0000-000000000003'::uuid,
   'm@olf-t.test', 'M', 'T', 'traiteur_manager');

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('0f1a0005-0000-0000-0000-000000000003'::uuid, '0f1a0001-0000-0000-0000-000000000003'::uuid,
   'OLF T SAS', '93000000000003', '3 rue test', '75003', 'Paris');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('0f1a0006-0000-0000-0000-000000000001'::uuid, 'olf_cocktail', 'Cocktail OLF');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('0f1a0003-0000-0000-0000-000000000001'::uuid, 'OLF L1', '1 r', '75001', 'Paris', 'fourgon'),
  ('0f1a0003-0000-0000-0000-000000000002'::uuid, 'OLF L2', '2 r', '75002', 'Paris', 'fourgon'),
  ('0f1a0003-0000-0000-0000-000000000003'::uuid, 'OLF L3', '3 r', '75003', 'Paris', 'fourgon');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('0f1a0001-0000-0000-0000-000000000001'::uuid, '0f1a0003-0000-0000-0000-000000000001'::uuid),
  ('0f1a0001-0000-0000-0000-000000000002'::uuid, '0f1a0003-0000-0000-0000-000000000003'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone) VALUES
  ('0f1a0004-0000-0000-0000-000000000001'::uuid, '0f1a0001-0000-0000-0000-000000000003'::uuid,
   '0f1a0003-0000-0000-0000-000000000001'::uuid, '0f1a0001-0000-0000-0000-000000000003'::uuid,
   '0f1a0005-0000-0000-0000-000000000003'::uuid, '0f1a0002-0000-0000-0000-000000000003'::uuid,
   '0f1a0006-0000-0000-0000-000000000001'::uuid, current_date + 7, 90, 'Alice', '0601020304');

-- ── A. Écriture directe refusée par le PRIVILÈGE ─────────────────────────────
SELECT olf_jwt('admin_savr', NULL);

SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0f1a0001-0000-0000-0000-000000000001', '0f1a0003-0000-0000-0000-000000000002') $$,
  '42501', 'permission denied for table organisations_lieux',
  'A1 admin_savr : INSERT direct refusé (rattachement hors route, sans audit)'
);

SELECT throws_ok(
  $$ UPDATE plateforme.organisations_lieux
        SET lieu_id = '0f1a0003-0000-0000-0000-000000000002'
      WHERE organisation_id = '0f1a0001-0000-0000-0000-000000000001' $$,
  '42501', 'permission denied for table organisations_lieux',
  'A2 admin_savr : UPDATE direct refusé'
);

SELECT throws_ok(
  $$ DELETE FROM plateforme.organisations_lieux
      WHERE organisation_id = '0f1a0001-0000-0000-0000-000000000001' $$,
  '42501', 'permission denied for table organisations_lieux',
  'A3 admin_savr : DELETE direct refusé (détachement hors route)'
);

SELECT olf_jwt('ops_savr', NULL);
SELECT throws_ok(
  $$ DELETE FROM plateforme.organisations_lieux
      WHERE organisation_id = '0f1a0001-0000-0000-0000-000000000002' $$,
  '42501', 'permission denied for table organisations_lieux',
  'A4 ops_savr : DELETE direct refusé (org_lieux_admin l''admettait par son seul USING)'
);

-- Oracle de type supprimé : un non-admin reçoit le refus de privilège AVANT le
-- trigger P0047 comme avant la RLS, qu'on vise un gestionnaire ou un traiteur.
SELECT olf_jwt('gestionnaire_lieux', '0f1a0001-0000-0000-0000-000000000002'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0f1a0001-0000-0000-0000-000000000003', '0f1a0003-0000-0000-0000-000000000002') $$,
  '42501', 'permission denied for table organisations_lieux',
  'A5 gestionnaire visant un traiteur : refus de privilège, plus de P0047 (oracle de type fermé)'
);

-- ── B. Rien de plus n'est fermé ──────────────────────────────────────────────
-- Fixture restaurée : le bloc B ne dépend pas de l'issue du bloc A (à la
-- contre-épreuve, A3/A4 suppriment réellement des lignes).
SELECT olf_superuser();
DELETE FROM plateforme.organisations_lieux
 WHERE organisation_id IN ('0f1a0001-0000-0000-0000-000000000001'::uuid,
                           '0f1a0001-0000-0000-0000-000000000002'::uuid);
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('0f1a0001-0000-0000-0000-000000000001'::uuid, '0f1a0003-0000-0000-0000-000000000001'::uuid),
  ('0f1a0001-0000-0000-0000-000000000002'::uuid, '0f1a0003-0000-0000-0000-000000000003'::uuid);

SELECT ok(
  has_table_privilege('authenticated', 'plateforme.organisations_lieux', 'SELECT'),
  'B1 SELECT conservé à authenticated (sous-requêtes des policies evenements/lieux)'
);

SELECT olf_jwt('gestionnaire_lieux', '0f1a0001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_lieux),
  1,
  'B2 gestionnaire G1 : lit SA ligne (org_lieux_self_select), pas celle de G2'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE id = '0f1a0004-0000-0000-0000-000000000001'::uuid),
  1,
  'B3 gestionnaire G1 : voit l''événement daté d''un traiteur sur SON lieu (sous-requête evt_gestionnaire_select intacte)'
);

SELECT olf_jwt('gestionnaire_lieux', '0f1a0001-0000-0000-0000-000000000002'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.evenements
    WHERE id = '0f1a0004-0000-0000-0000-000000000001'::uuid),
  0,
  'B4 gestionnaire G2 : ne voit pas l''événement d''un lieu qui n''est pas le sien'
);

-- Chemin des routes admin lieux : service_role, vraies écritures.
SELECT olf_service_role();
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
     VALUES ('0f1a0001-0000-0000-0000-000000000001', '0f1a0003-0000-0000-0000-000000000002') $$,
  'B5 service_role : INSERT (route POST/PATCH admin lieux) passe'
);

SELECT lives_ok(
  $$ DELETE FROM plateforme.organisations_lieux
      WHERE lieu_id = '0f1a0003-0000-0000-0000-000000000002' $$,
  'B6 service_role : DELETE (remplacement du gestionnaire par la route PATCH) passe'
);

SELECT ok(
  NOT has_table_privilege('anon', 'plateforme.organisations_lieux', 'INSERT')
  AND NOT has_table_privilege('anon', 'plateforme.organisations_lieux', 'DELETE'),
  'B7 anon : aucune écriture'
);

SELECT * FROM finish();
ROLLBACK;
