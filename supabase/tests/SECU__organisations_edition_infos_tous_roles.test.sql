-- =============================================================================
-- Tests pgTAP — organisations : informations légales modifiables par tous les rôles
-- Migration prouvée : 20260928100000_plateforme_organisations_edition_infos_tous_roles
-- =============================================================================
-- Décision Val 2026-09-28 : raison sociale, SIRET et adresse de SA propre organisation
-- modifiables par traiteur_commercial et client_organisateur (en plus du manager, de
-- l'agence et du gestionnaire). Rien d'autre : nom, email, téléphone, updated_at
-- restent refusés à ces deux rôles ; l'organisation d'un tiers reste intouchable.
--
-- NON-VACUITÉ (mesurée 2026-09-28 sur base jetable fidèle à la CI) :
--   - sans la migration : 2-5, 8-11, 13-14 tombent (aucune policy UPDATE → 0 ligne,
--     la valeur relue est l'ancienne ; 1 et 7 restent verts, un UPDATE de 0 ligne
--     n'échoue pas — c'est 2 et 8 qui portent la preuve) ;
--   - avec les policies mais l'ANCIEN corps du trigger (gestionnaire seul) : 3-5 et
--     9-11 tombent → l'ouverture est bien bornée aux trois colonnes légales par le
--     trigger, pas par un hasard de privilège.
--   6 et 12 : la policy reste own-org.
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(14);

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

-- Fixture ---------------------------------------------------------------------
-- T = traiteur (commercial), O = organisation du client organisateur, X = tiers
SELECT test_as_superuser();

INSERT INTO plateforme.organisations
  (id, nom, raison_sociale, type, actif, est_shadow, siret, email_principal, telephone, adresse)
VALUES
  ('5e2e0001-0000-0000-0000-0000000000c1'::uuid, 'EDIT Trait', 'EDIT Trait SAS', 'traiteur', true, false,
   '55520000000001', 'trait@edit.test', '0100000011', '1 rue Trait'),
  ('5e2e0002-0000-0000-0000-0000000000c1'::uuid, 'EDIT Orga', 'EDIT Orga SA', 'client_organisateur', true, false,
   '55520000000002', 'orga@edit.test', '0100000012', '2 rue Orga'),
  ('5e2e0003-0000-0000-0000-0000000000c1'::uuid, 'EDIT Tiers', 'EDIT Tiers SA', 'traiteur', true, false,
   '55520000000003', 'tiers@edit.test', NULL, '3 rue Tiers');

-- =============================================================================
-- 1-6 — traiteur_commercial
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_commercial', '5e2e0001-0000-0000-0000-0000000000c1'::uuid);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations
        SET raison_sociale = 'EDIT Trait Bis', siret = '55520000000099', adresse = '9 rue Neuve'
      WHERE id = '5e2e0001-0000-0000-0000-0000000000c1' $$,
  '1. commercial : raison_sociale + siret + adresse de sa propre orga modifiables');
SELECT is(
  (SELECT raison_sociale || '|' || siret || '|' || adresse
     FROM plateforme.organisations WHERE id = '5e2e0001-0000-0000-0000-0000000000c1'),
  'EDIT Trait Bis|55520000000099|9 rue Neuve',
  '2. commercial : l''UPDATE a bien été appliqué (policy org_commercial_update)');

SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET nom = 'Renommé' WHERE id = '5e2e0001-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '3. commercial : nom non modifiable');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET email_principal = 'x@y.test', telephone = '0'
      WHERE id = '5e2e0001-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '4. commercial : email / téléphone non modifiables');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET logo_url = 'savr-dev/logos/0f8b2c1e-3d4a-4b5c-9d6e-7f8091a2b3c4.png'
      WHERE id = '5e2e0001-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '5. commercial : logo non modifiable (hors liste blanche du rôle)');

UPDATE plateforme.organisations SET adresse = 'piraté' WHERE id = '5e2e0003-0000-0000-0000-0000000000c1';
SELECT test_as_superuser();
SELECT is(
  (SELECT adresse FROM plateforme.organisations WHERE id = '5e2e0003-0000-0000-0000-0000000000c1'),
  '3 rue Tiers',
  '6. commercial : l''organisation d''un tiers n''est pas modifiable (0 ligne)');

-- =============================================================================
-- 7-12 — client_organisateur
-- =============================================================================
SELECT test_set_jwt_prod('client_organisateur', '5e2e0002-0000-0000-0000-0000000000c1'::uuid);

SELECT lives_ok(
  $$ UPDATE plateforme.organisations
        SET raison_sociale = 'EDIT Orga Bis', siret = '55520000000088', adresse = '8 rue Neuve'
      WHERE id = '5e2e0002-0000-0000-0000-0000000000c1' $$,
  '7. client_organisateur : raison_sociale + siret + adresse de sa propre orga modifiables');
SELECT is(
  (SELECT raison_sociale || '|' || siret || '|' || adresse
     FROM plateforme.organisations WHERE id = '5e2e0002-0000-0000-0000-0000000000c1'),
  'EDIT Orga Bis|55520000000088|8 rue Neuve',
  '8. client_organisateur : l''UPDATE a bien été appliqué (policy org_client_orga_update)');

SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET nom = 'Renommé' WHERE id = '5e2e0002-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '9. client_organisateur : nom non modifiable');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET adresse = '7 rue X', email_principal = 'x@y.test'
      WHERE id = '5e2e0002-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '10. client_organisateur : un champ autorisé ne blanchit pas un champ interdit');
SELECT throws_ok(
  $$ UPDATE plateforme.organisations SET updated_at = '2000-01-01' WHERE id = '5e2e0002-0000-0000-0000-0000000000c1' $$,
  '42501', NULL, '11. client_organisateur : updated_at non forgeable');

UPDATE plateforme.organisations SET adresse = 'piraté' WHERE id = '5e2e0003-0000-0000-0000-0000000000c1';
SELECT test_as_superuser();
SELECT is(
  (SELECT adresse FROM plateforme.organisations WHERE id = '5e2e0003-0000-0000-0000-0000000000c1'),
  '3 rue Tiers',
  '12. client_organisateur : l''organisation d''un tiers n''est pas modifiable (0 ligne)');

-- =============================================================================
-- 13-14 — cliquets : prédicats own-org des deux nouvelles policies
-- =============================================================================
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_commercial_update'),
  '((plateforme.f_app_role() = ''traiteur_commercial''::text) AND (id = ((auth.jwt() ->> ''organisation_id''::text))::uuid))',
  '13. org_commercial_update : USING = rôle commercial ET id = organisation du JWT');
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_client_orga_update'),
  '((plateforme.f_app_role() = ''client_organisateur''::text) AND (id = ((auth.jwt() ->> ''organisation_id''::text))::uuid))',
  '14. org_client_orga_update : USING = rôle client_organisateur ET id = organisation du JWT');

SELECT * FROM finish();
ROLLBACK;
