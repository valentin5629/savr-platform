-- =============================================================================
-- Tests pgTAP — organisations : informations légales modifiables par tous les rôles
-- Migration prouvée : 20260928100000_plateforme_organisations_edition_infos_tous_roles
-- =============================================================================
-- Décision Val 2026-09-28 : raison sociale, SIRET et adresse de SA propre organisation
-- modifiables par client_organisateur (en plus du manager, de l'agence et du
-- gestionnaire). Rien d'autre : nom, email, téléphone, updated_at lui restent
-- refusés ; l'organisation d'un tiers reste intouchable.
-- Val 2026-10-30 (20261030140000) : traiteur_commercial repasse en lecture seule
-- (policy org_commercial_update retirée) — tests 1-4.
--
-- NON-VACUITÉ :
--   - client_organisateur (mesurée 2026-09-28) : sans la migration 20260928100000,
--     8-11 et 14 tombent ; avec l'ANCIEN corps du trigger, 9-11 tombent ; 12 = own-org.
--   - commercial : sans 20261030140000, 2 et 4 tombent (la policy laisse passer
--     l'UPDATE des trois colonnes légales).
--
-- ⚠ JWT au format PRODUCTION (claim réservé `role` + claim métier `user_role`).
-- =============================================================================

BEGIN;
SELECT plan(12);

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
-- 1-4 — traiteur_commercial : lecture seule depuis 20261030140000 (Val 2026-10-30)
-- =============================================================================
SELECT test_set_jwt_prod('traiteur_commercial', '5e2e0001-0000-0000-0000-0000000000c1'::uuid);

-- Sans policy UPDATE pour son rôle, l'UPDATE ne touche aucune ligne : il ne lève
-- rien (1), c'est la relecture (2) qui porte la preuve.
SELECT lives_ok(
  $$ UPDATE plateforme.organisations
        SET raison_sociale = 'EDIT Trait Bis', siret = '55520000000099', adresse = '9 rue Neuve'
      WHERE id = '5e2e0001-0000-0000-0000-0000000000c1' $$,
  '1. commercial : l''UPDATE de sa propre orga ne lève pas d''erreur');
SELECT is(
  (SELECT raison_sociale || '|' || siret || '|' || adresse
     FROM plateforme.organisations WHERE id = '5e2e0001-0000-0000-0000-0000000000c1'),
  'EDIT Trait SAS|55520000000001|1 rue Trait',
  '2. commercial : sa propre organisation reste inchangée (lecture seule)');

UPDATE plateforme.organisations SET adresse = 'piraté' WHERE id = '5e2e0003-0000-0000-0000-0000000000c1';
SELECT test_as_superuser();
SELECT is(
  (SELECT adresse FROM plateforme.organisations WHERE id = '5e2e0003-0000-0000-0000-0000000000c1'),
  '3 rue Tiers',
  '3. commercial : l''organisation d''un tiers n''est pas modifiable (0 ligne)');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND cmd IN ('UPDATE', 'ALL') AND (qual LIKE '%traiteur_commercial%' OR with_check LIKE '%traiteur_commercial%')),
  0,
  '4. aucune policy UPDATE ne cite traiteur_commercial sur organisations');

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
-- 14-14b — cliquets : prédicats own-org (USING + WITH CHECK) de org_client_orga_update
-- =============================================================================
SELECT is(
  (SELECT qual FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_client_orga_update'),
  '((plateforme.f_app_role() = ''client_organisateur''::text) AND (id = ((auth.jwt() ->> ''organisation_id''::text))::uuid))',
  '14. org_client_orga_update : USING = rôle client_organisateur ET id = organisation du JWT');
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'plateforme' AND tablename = 'organisations'
      AND policyname = 'org_client_orga_update'),
  '((plateforme.f_app_role() = ''client_organisateur''::text) AND (id = ((auth.jwt() ->> ''organisation_id''::text))::uuid))',
  '14b. org_client_orga_update : WITH CHECK = rôle ET id = organisation du JWT');

SELECT * FROM finish();
ROLLBACK;
