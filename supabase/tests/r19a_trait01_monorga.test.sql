-- pgTAP R19a · BL-P1-TRAIT-01 — « Mon organisation » traiteur : écriture RLS
-- manager own-org sur entites_facturation + organisations_domaines_email.
-- Prouve : (a) le manager écrit les entités/domaines de SON org ; (b) le
-- commercial est bloqué (lecture seule) ; (c) un manager ne peut pas écrire
-- l'org d'un autre (cloisonnement inter-org — le plus critique).

BEGIN;
SELECT plan(12);

-- ── Helpers JWT (identiques aux autres tests RLS) ───────────────────────────
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id, 'user_role', p_role,
    'organisation_id', p_org_id, 'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- ── Fixtures (superuser) ────────────────────────────────────────────────────
SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif)
VALUES
  ('cc000000-0000-0000-0000-00000000000a'::uuid, 'Kaspia', 'Kaspia SARL', 'traiteur', '11111111100009', true),
  ('cc000000-0000-0000-0000-00000000000b'::uuid, 'Kardamome', 'Kardamome SARL', 'traiteur', '22222222200009', true);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('cc000000-0000-0000-0000-000000000a01'::uuid, 'cc000000-0000-0000-0000-00000000000a'::uuid, 'mgr-a@kaspia.test', 'Mgr', 'A', 'traiteur_manager'),
  ('cc000000-0000-0000-0000-000000000a02'::uuid, 'cc000000-0000-0000-0000-00000000000a'::uuid, 'com-a@kaspia.test', 'Com', 'A', 'traiteur_commercial'),
  ('cc000000-0000-0000-0000-000000000b01'::uuid, 'cc000000-0000-0000-0000-00000000000b'::uuid, 'mgr-b@kardamome.test', 'Mgr', 'B', 'traiteur_manager');

-- Entité existante Org A (cible UPDATE/DELETE) + entité Org B (cible cross-org).
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('cc000000-0000-0000-0000-0000000000f1'::uuid, 'cc000000-0000-0000-0000-00000000000a'::uuid,
   'Kaspia SARL', '11111111100009', '1 rue Kaspia', '75001', 'Paris'),
  ('cc000000-0000-0000-0000-0000000000f2'::uuid, 'cc000000-0000-0000-0000-00000000000b'::uuid,
   'Kardamome SARL', '22222222200009', '2 rue Kardamome', '75002', 'Paris');

-- Domaine existant Org A (cible DELETE).
INSERT INTO plateforme.organisations_domaines_email (id, organisation_id, domaine)
VALUES ('cc000000-0000-0000-0000-0000000000d1'::uuid, 'cc000000-0000-0000-0000-00000000000a'::uuid, 'kaspia.test');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. entites_facturation — écriture manager own-org
-- ════════════════════════════════════════════════════════════════════════════

-- T1 : manager A INSERT une entité de SON org → autorisé
SELECT test_set_jwt('traiteur_manager', 'cc000000-0000-0000-0000-00000000000a'::uuid,
                    'cc000000-0000-0000-0000-000000000a01'::uuid);
SELECT lives_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid,
             'Kaspia Events', '11111111100017', '3 rue Kaspia', '75003', 'Paris') $$,
  'T1 : manager INSERT entité de son org autorisé'
);

-- T2 : manager A UPDATE une entité de son org → 1 ligne
WITH u AS (
  UPDATE plateforme.entites_facturation SET raison_sociale = 'Kaspia SARL v2'
  WHERE id = 'cc000000-0000-0000-0000-0000000000f1'::uuid RETURNING 1
)
SELECT is(count(*)::int, 1, 'T2 : manager UPDATE entité de son org autorisé') FROM u;

-- T3 : manager A DELETE une entité de son org → autorisé (RLS ; la route fait un
-- soft-delete actif=false, mais la policy autorise bien le DELETE)
WITH d AS (
  DELETE FROM plateforme.entites_facturation
  WHERE id = 'cc000000-0000-0000-0000-0000000000f1'::uuid RETURNING 1
)
SELECT is(count(*)::int, 1, 'T3 : manager DELETE entité de son org autorisé') FROM d;

-- T4 : commercial A INSERT entité → refusé (aucune policy write commercial)
SELECT test_set_jwt('traiteur_commercial', 'cc000000-0000-0000-0000-00000000000a'::uuid,
                    'cc000000-0000-0000-0000-000000000a02'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid,
             'Hack', '99999999900009', 'x', '75000', 'Paris') $$,
  '42501', NULL,
  'T4 : commercial ne peut PAS INSERT une entité (lecture seule)'
);

-- T5 : manager A UPDATE une entité de l'org B → 0 ligne (USING filtre cross-org)
SELECT test_set_jwt('traiteur_manager', 'cc000000-0000-0000-0000-00000000000a'::uuid,
                    'cc000000-0000-0000-0000-000000000a01'::uuid);
WITH u AS (
  UPDATE plateforme.entites_facturation SET raison_sociale = 'Hack B'
  WHERE id = 'cc000000-0000-0000-0000-0000000000f2'::uuid RETURNING 1
)
SELECT is(count(*)::int, 0, 'T5 : manager ne peut PAS UPDATE une entité d''une autre org') FROM u;

-- T6 : manager A INSERT une entité en usurpant organisation_id = org B → refusé
SELECT throws_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
     VALUES ('cc000000-0000-0000-0000-00000000000b'::uuid,
             'Usurp', '88888888800009', 'x', '75000', 'Paris') $$,
  '42501', NULL,
  'T6 : manager ne peut PAS INSERT une entité pour une autre org (WITH CHECK)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. organisations_domaines_email — écriture manager own-org
-- ════════════════════════════════════════════════════════════════════════════

-- T7 : manager A INSERT un domaine de son org → autorisé
SELECT lives_ok(
  $$ INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid, 'kaspia-events.test') $$,
  'T7 : manager INSERT domaine de son org autorisé'
);

-- T8 : manager A DELETE un domaine de son org → 1 ligne
WITH d AS (
  DELETE FROM plateforme.organisations_domaines_email
  WHERE id = 'cc000000-0000-0000-0000-0000000000d1'::uuid RETURNING 1
)
SELECT is(count(*)::int, 1, 'T8 : manager DELETE domaine de son org autorisé') FROM d;

-- T9 : manager A INSERT un domaine en usurpant org B → refusé (WITH CHECK)
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine)
     VALUES ('cc000000-0000-0000-0000-00000000000b'::uuid, 'usurp.test') $$,
  '42501', NULL,
  'T9 : manager ne peut PAS INSERT un domaine pour une autre org (WITH CHECK)'
);

-- T10 : commercial A INSERT un domaine → refusé (lecture seule)
SELECT test_set_jwt('traiteur_commercial', 'cc000000-0000-0000-0000-00000000000a'::uuid,
                    'cc000000-0000-0000-0000-000000000a02'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.organisations_domaines_email (organisation_id, domaine)
     VALUES ('cc000000-0000-0000-0000-00000000000a'::uuid, 'hack.test') $$,
  '42501', NULL,
  'T10 : commercial ne peut PAS INSERT un domaine (lecture seule)'
);

-- T11 : commercial A LIT les domaines de son org → autorisé (ode_own_org_read)
SELECT lives_ok(
  $$ SELECT domaine FROM plateforme.organisations_domaines_email
     WHERE organisation_id = 'cc000000-0000-0000-0000-00000000000a'::uuid $$,
  'T11 : commercial lit les domaines de son org'
);

-- T12 : manager B ne voit PAS les domaines de l'org A (cloisonnement lecture)
SELECT test_set_jwt('traiteur_manager', 'cc000000-0000-0000-0000-00000000000b'::uuid,
                    'cc000000-0000-0000-0000-000000000b01'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.organisations_domaines_email
     WHERE organisation_id = 'cc000000-0000-0000-0000-00000000000a'::uuid),
  0,
  'T12 : manager B ne voit aucun domaine de l''org A (cloisonnement)'
);

SELECT test_as_superuser();
SELECT * FROM finish();
ROLLBACK;
