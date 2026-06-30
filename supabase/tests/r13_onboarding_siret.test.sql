-- =============================================================================
-- Tests pgTAP R13 — Onboarding SIRET (BL-P1-ONB-02 + BL-P1-ONB-03).
-- =============================================================================
-- Oracle :
--   · ONB-03 : index UNIQUE partiel sur entites_facturation.siret (WHERE siret <> '')
--     → 2 entités avec le MÊME SIRET non vide = rejet 23505 ; plusieurs SIRET '' coexistent.
--   · ONB-02 : table file_revalidation_siret = file interne. RLS DENY ALL + lecture staff
--     seule (écriture = service_role bypass). authenticated non-staff : 0 ligne + INSERT refusé.
-- =============================================================================

BEGIN;
SELECT plan(6);

-- ─── Helpers ────────────────────────────────────────────────────────────────
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
  ('13000001-0000-0000-0000-000000000001'::uuid, 'Savr',   'traiteur', true, false, '13000000000001', 'admin@savr.test'),
  ('13000002-0000-0000-0000-000000000001'::uuid, 'Kaspia', 'traiteur', true, false, '13000000000002', 'mgr@kaspia.test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('13050001-0000-0000-0000-000000000001'::uuid, '13000001-0000-0000-0000-000000000001'::uuid, 'admin@savr.test',  'Admin',  'Savr',   'admin_savr'),
  ('13050002-0000-0000-0000-000000000001'::uuid, '13000002-0000-0000-0000-000000000001'::uuid, 'mgr@kaspia.test',  'Mgr',    'Kaspia', 'traiteur_manager');

-- Entité de facturation par défaut avec un SIRET non vide.
INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville, entite_par_defaut)
VALUES
  ('13ef0001-0000-0000-0000-000000000001'::uuid, '13000002-0000-0000-0000-000000000001'::uuid,
   'Kaspia SAS', '13111111111111', '1 rue Test', '75001', 'Paris', true);

-- ─── 1. ONB-03 : UNIQUE SIRET non vide ─────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville, entite_par_defaut)
     VALUES ('13000001-0000-0000-0000-000000000001'::uuid,
             'Doublon', '13111111111111', '2 rue X', '75002', 'Paris', false) $$,
  '23505',
  NULL,
  'ONB-03 : second SIRET non vide identique → rejet unique_violation (23505)');

-- Deux entités SIRET '' coexistent (index partiel WHERE siret <> '').
SELECT lives_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville, entite_par_defaut)
     VALUES ('13000001-0000-0000-0000-000000000001'::uuid,
             'Sans SIRET A', '', '3 rue Y', '75003', 'Paris', false) $$,
  'ONB-03 : 1re entité SIRET vide acceptée (hors index partiel)');

SELECT lives_ok(
  $$ INSERT INTO plateforme.entites_facturation
       (organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville, entite_par_defaut)
     VALUES ('13000002-0000-0000-0000-000000000001'::uuid,
             'Sans SIRET B', '', '4 rue Z', '75004', 'Paris', false) $$,
  'ONB-03 : 2e entité SIRET vide coexiste (les '''' ne collisionnent pas)');

-- ─── 2. ONB-02 : RLS file_revalidation_siret ───────────────────────────────
INSERT INTO plateforme.file_revalidation_siret (id, entite_facturation_id, statut)
VALUES ('13f10001-0000-0000-0000-000000000001'::uuid,
        '13ef0001-0000-0000-0000-000000000001'::uuid, 'en_attente');

-- Staff (admin_savr) : voit la file.
SELECT test_set_jwt('admin_savr', '13000001-0000-0000-0000-000000000001'::uuid,
                    '13050001-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.file_revalidation_siret),
  1, 'ONB-02 : staff (admin_savr) lit la file de revalidation');

-- Non-staff (traiteur_manager) : RLS DENY → 0 ligne.
SELECT test_set_jwt('traiteur_manager', '13000002-0000-0000-0000-000000000001'::uuid,
                    '13050002-0000-0000-0000-000000000001'::uuid);
SELECT is(
  (SELECT count(*)::int FROM plateforme.file_revalidation_siret),
  0, 'ONB-02 : non-staff ne voit AUCUNE ligne de la file (DENY ALL)');

-- Non-staff INSERT → refusé (aucune policy WITH CHECK → RLS 42501).
SELECT throws_ok(
  $$ INSERT INTO plateforme.file_revalidation_siret (entite_facturation_id, statut)
     VALUES ('13ef0001-0000-0000-0000-000000000001'::uuid, 'en_attente') $$,
  '42501',
  NULL,
  'ONB-02 : non-staff ne peut PAS écrire dans la file (RLS, écriture = service_role)');

SELECT * FROM finish();
ROLLBACK;
