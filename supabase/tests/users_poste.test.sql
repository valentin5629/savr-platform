-- =============================================================================
-- Tests pgTAP — poste de l'utilisateur (migration 20261101100000).
-- =============================================================================
-- Oracle (Val 2026-11-01) : « Poste » = champ libre de « Mon profil », sans
-- effet sur les droits, affiché dans la liste des membres.
--   · l'utilisateur écrit SON poste sous `authenticated` (usr_self_update) ;
--   · il ne touche pas au poste d'un utilisateur d'une autre organisation ;
--   · borne 100 caractères tenue par la table (UPDATE PostgREST direct inclus) ;
--   · un membre de la même organisation le lit (liste des membres) ;
--   · l'effacement RGPD (fn_anonymize_user) vide `poste` ET `telephone`, et
--     reste refusé à `authenticated`.
-- =============================================================================

BEGIN;
SELECT plan(9);

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid()
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ─── Fixture ────────────────────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('11010001-0000-0000-0000-000000000001'::uuid, 'Savr', 'traiteur', true, false, '11010000000001', 'admin@savr.test'),
  ('11010002-0000-0000-0000-000000000001'::uuid, 'Lieux A', 'gestionnaire_lieux', true, false, '11010000000002', 'a@lieux.test'),
  ('11010003-0000-0000-0000-000000000001'::uuid, 'Lieux B', 'gestionnaire_lieux', true, false, '11010000000003', 'b@lieux.test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, telephone)
VALUES
  ('11050001-0000-0000-0000-000000000001'::uuid, '11010001-0000-0000-0000-000000000001'::uuid, 'admin@savr.test', 'Admin', 'Savr', 'admin_savr', NULL),
  ('11050002-0000-0000-0000-000000000001'::uuid, '11010002-0000-0000-0000-000000000001'::uuid, 'moi@lieux.test', 'Moi', 'A', 'gestionnaire_lieux', '0600000000'),
  ('11050003-0000-0000-0000-000000000001'::uuid, '11010002-0000-0000-0000-000000000001'::uuid, 'collegue@lieux.test', 'Collegue', 'A', 'gestionnaire_lieux', NULL),
  ('11050004-0000-0000-0000-000000000001'::uuid, '11010003-0000-0000-0000-000000000001'::uuid, 'autre@lieux.test', 'Autre', 'B', 'gestionnaire_lieux', NULL);

-- ─── 1. Écriture de son propre poste ─────────────────────────────────────────
SELECT test_set_jwt('gestionnaire_lieux', '11010002-0000-0000-0000-000000000001'::uuid,
                    '11050002-0000-0000-0000-000000000001'::uuid);
SELECT lives_ok(
  $$ UPDATE plateforme.users SET poste = 'Responsable RSE'
     WHERE id = '11050002-0000-0000-0000-000000000001'::uuid $$,
  'self : écrit son propre poste sous authenticated');

-- ─── 2. Poste d'un utilisateur d'une autre organisation : 0 ligne touchée ─────
UPDATE plateforme.users SET poste = 'pirate'
WHERE id = '11050004-0000-0000-0000-000000000001'::uuid;

-- ─── 3. Borne 100 caractères (UPDATE direct) ─────────────────────────────────
SELECT throws_ok(
  $$ UPDATE plateforme.users SET poste = repeat('x', 101)
     WHERE id = '11050002-0000-0000-0000-000000000001'::uuid $$,
  '23514', NULL,
  'borne : 101 caractères refusés par la table');
SELECT lives_ok(
  $$ UPDATE plateforme.users SET poste = repeat('é', 100)
     WHERE id = '11050002-0000-0000-0000-000000000001'::uuid $$,
  'borne : 100 caractères (multi-octets) acceptés');
UPDATE plateforme.users SET poste = 'Responsable RSE'
WHERE id = '11050002-0000-0000-0000-000000000001'::uuid;

-- ─── 4. Lecture par un collègue de la même organisation ──────────────────────
SELECT test_set_jwt('gestionnaire_lieux', '11010002-0000-0000-0000-000000000001'::uuid,
                    '11050003-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT poste FROM plateforme.users WHERE id = '11050002-0000-0000-0000-000000000001'::uuid),
  'Responsable RSE', 'liste des membres : le collègue lit le poste');

SELECT test_as_superuser();
SELECT is(
  (SELECT poste FROM plateforme.users WHERE id = '11050004-0000-0000-0000-000000000001'::uuid),
  NULL, 'autre organisation : poste inchangé (UPDATE cross-org sans effet)');

-- ─── 5. Effacement RGPD ──────────────────────────────────────────────────────
SELECT test_set_jwt('gestionnaire_lieux', '11010002-0000-0000-0000-000000000001'::uuid,
                    '11050002-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$ SELECT plateforme.fn_anonymize_user(
       '11050002-0000-0000-0000-000000000001'::uuid, 'x', '11050002-0000-0000-0000-000000000001'::uuid) $$,
  '42501', NULL,
  'fn_anonymize_user : toujours refusé à authenticated');

SELECT test_as_superuser();
SELECT lives_ok(
  $$ SELECT plateforme.fn_anonymize_user(
       '11050002-0000-0000-0000-000000000001'::uuid, 'Demande RGPD',
       '11050001-0000-0000-0000-000000000001'::uuid) $$,
  'fn_anonymize_user : exécution (service_role)');
SELECT is(
  (SELECT poste FROM plateforme.users WHERE id = '11050002-0000-0000-0000-000000000001'::uuid),
  NULL, 'RGPD : poste effacé');
SELECT is(
  (SELECT telephone FROM plateforme.users WHERE id = '11050002-0000-0000-0000-000000000001'::uuid),
  NULL, 'RGPD : téléphone effacé');

SELECT * FROM finish();
ROLLBACK;
