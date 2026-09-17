-- =============================================================================
-- §09 RLS transverse — écriture directe PostgREST fermée sur `collectes` et
-- `evenements` (révision 2026-09-16 des scénarios §09).
-- =============================================================================
-- Scénarios (specs/tests/app/09-rls-app-transverse-scenarios.md) :
--   · ecriture_directe_collectes_evenements_revoke_42501 (catégorie 6, db, P1) ;
--   · manager_update_dans_fenetre_edition_ok (F3 lot ⑪, révisé) — moitié DB : la
--     fenêtre d'édition vue par le manager, l'écriture par la RPC de la route sous
--     service_role, l'écriture directe refusée. La moitié route (200 + écriture par
--     le client admin, jamais par la session) : edition-evenement.m1-2.test.ts.
--
-- Migrations prouvées : 20260915160000 (REVOKE INSERT, UPDATE sur collectes) et
-- 20260915190000 (REVOKE INSERT, UPDATE, DELETE sur evenements).
--
-- ⚠ DELETE direct sur `collectes` NON TESTÉ ICI. Le scénario l'attend en 42501, mais
-- 20260915160000 ne révoque pas DELETE (policy col_delete_brouillon conservée) :
-- aujourd'hui un DELETE hors policy affecte 0 ligne sans erreur, et le 42501 d'un
-- brouillon vient du trigger trg_set_date_evenement, pas d'un REVOKE. Divergence
-- ambiguë ouverte (M0.4_20260916_delete-direct-collectes-revoke) : ni la spec ni la
-- base ne sont modifiées tant que Val n'a pas tranché.
--
-- Discriminant : chaque refus asserte le MESSAGE « permission denied for table » —
-- un 42501 levé plus loin (trigger, fonction) ne suffit pas à faire passer le cas.
-- Tout se joue sous rôle `authenticated` ; service_role est exercé par de vraies
-- écritures (SET LOCAL role), pas par has_table_privilege.
-- =============================================================================

BEGIN;
SELECT plan(50);

CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid, p_user_id uuid)
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

-- ── Fixtures (UUID/SIRET improbables) ────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('09e70000-0000-0000-0000-000000000001'::uuid, 'Traiteur R09', 'traiteur', true, false, '09E70000000001', 'r09-t@test.internal'),
  ('09e70000-0000-0000-0000-000000000002'::uuid, 'Agence R09', 'agence', true, false, '09E70000000002', 'r09-a@test.internal'),
  ('09e70000-0000-0000-0000-000000000003'::uuid, 'Gestionnaire R09', 'gestionnaire_lieux', true, false, '09E70000000003', 'r09-g@test.internal'),
  ('09e70000-0000-0000-0000-000000000004'::uuid, 'Client R09', 'client_organisateur', true, false, '09E70000000004', 'r09-c@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('09e70000-0000-0000-0000-00000000007e'::uuid, 'cocktail_r09', 'Cocktail R09');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('09e70000-0000-0000-0000-0000000000a1'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, 'traiteur_manager@r09.test', 'P', 'R09', 'traiteur_manager'),
  ('09e70000-0000-0000-0000-0000000000a2'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, 'traiteur_commercial@r09.test', 'P', 'R09', 'traiteur_commercial'),
  ('09e70000-0000-0000-0000-0000000000a3'::uuid, '09e70000-0000-0000-0000-000000000003'::uuid, 'gestionnaire_lieux@r09.test', 'P', 'R09', 'gestionnaire_lieux'),
  ('09e70000-0000-0000-0000-0000000000a4'::uuid, '09e70000-0000-0000-0000-000000000002'::uuid, 'agence@r09.test', 'P', 'R09', 'agence'),
  ('09e70000-0000-0000-0000-0000000000a5'::uuid, '09e70000-0000-0000-0000-000000000004'::uuid, 'client_organisateur@r09.test', 'P', 'R09', 'client_organisateur');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, 'Traiteur R09 SARL', '09E70000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('09e70000-0000-0000-0000-00000000011e'::uuid, 'Salle R09', '1 rue', '75001', 'Paris', 'fourgon');

-- e1 : événement du traiteur, collecte `programmee` → dans la fenêtre d'édition.
-- e2 : événement sans collecte (cible du DELETE, que la FK ne bloquerait pas).
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES
  ('09e70000-0000-0000-0000-0000000000e1'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a2'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 100, 'Alice', '0601'),
  ('09e70000-0000-0000-0000-0000000000e2'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 10, 60, 'Eve', '0605');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte) VALUES
  ('09e70000-0000-0000-0000-0000000000c1'::uuid, '09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00');

-- =============================================================================
-- A. ecriture_directe_collectes_evenements_revoke_42501 — 5 rôles clients
-- =============================================================================

-- ── A1 traiteur_manager ──
SELECT test_set_jwt('traiteur_manager', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'A1 traiteur_manager — INSERT direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 101 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A1 traiteur_manager — UPDATE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ DELETE FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e2'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A1 traiteur_manager — DELETE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', current_date + 10, '09:00') $$,
  '42501', 'permission denied for table collectes',
  'A1 traiteur_manager — INSERT direct sur collectes -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET heure_collecte = '09:30' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  '42501', 'permission denied for table collectes',
  'A1 traiteur_manager — UPDATE direct sur collectes -> 42501 avant RLS');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.evenements $$,
  'A1 traiteur_manager — SELECT sur evenements reste autorise');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.collectes $$,
  'A1 traiteur_manager — SELECT sur collectes reste autorise');

-- ── A2 traiteur_commercial ──
SELECT test_set_jwt('traiteur_commercial', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a2'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a2'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'A2 traiteur_commercial — INSERT direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 101 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A2 traiteur_commercial — UPDATE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ DELETE FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e2'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A2 traiteur_commercial — DELETE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', current_date + 10, '09:00') $$,
  '42501', 'permission denied for table collectes',
  'A2 traiteur_commercial — INSERT direct sur collectes -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET heure_collecte = '09:30' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  '42501', 'permission denied for table collectes',
  'A2 traiteur_commercial — UPDATE direct sur collectes -> 42501 avant RLS');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.evenements $$,
  'A2 traiteur_commercial — SELECT sur evenements reste autorise');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.collectes $$,
  'A2 traiteur_commercial — SELECT sur collectes reste autorise');

-- ── A3 gestionnaire_lieux ──
SELECT test_set_jwt('gestionnaire_lieux', '09e70000-0000-0000-0000-000000000003'::uuid, '09e70000-0000-0000-0000-0000000000a3'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000003'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a3'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'A3 gestionnaire_lieux — INSERT direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 101 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A3 gestionnaire_lieux — UPDATE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ DELETE FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e2'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A3 gestionnaire_lieux — DELETE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', current_date + 10, '09:00') $$,
  '42501', 'permission denied for table collectes',
  'A3 gestionnaire_lieux — INSERT direct sur collectes -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET heure_collecte = '09:30' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  '42501', 'permission denied for table collectes',
  'A3 gestionnaire_lieux — UPDATE direct sur collectes -> 42501 avant RLS');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.evenements $$,
  'A3 gestionnaire_lieux — SELECT sur evenements reste autorise');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.collectes $$,
  'A3 gestionnaire_lieux — SELECT sur collectes reste autorise');

-- ── A4 agence ──
SELECT test_set_jwt('agence', '09e70000-0000-0000-0000-000000000002'::uuid, '09e70000-0000-0000-0000-0000000000a4'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000002'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a4'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'A4 agence — INSERT direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 101 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A4 agence — UPDATE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ DELETE FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e2'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A4 agence — DELETE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', current_date + 10, '09:00') $$,
  '42501', 'permission denied for table collectes',
  'A4 agence — INSERT direct sur collectes -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET heure_collecte = '09:30' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  '42501', 'permission denied for table collectes',
  'A4 agence — UPDATE direct sur collectes -> 42501 avant RLS');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.evenements $$,
  'A4 agence — SELECT sur evenements reste autorise');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.collectes $$,
  'A4 agence — SELECT sur collectes reste autorise');

-- ── A5 client_organisateur ──
SELECT test_set_jwt('client_organisateur', '09e70000-0000-0000-0000-000000000004'::uuid, '09e70000-0000-0000-0000-0000000000a5'::uuid);
SELECT throws_ok(
  $$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000004'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a5'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  '42501', 'permission denied for table evenements',
  'A5 client_organisateur — INSERT direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 101 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A5 client_organisateur — UPDATE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ DELETE FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e2'::uuid $$,
  '42501', 'permission denied for table evenements',
  'A5 client_organisateur — DELETE direct sur evenements -> 42501 avant RLS');
SELECT throws_ok(
  $$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'programmee', current_date + 10, '09:00') $$,
  '42501', 'permission denied for table collectes',
  'A5 client_organisateur — INSERT direct sur collectes -> 42501 avant RLS');
SELECT throws_ok(
  $$ UPDATE plateforme.collectes SET heure_collecte = '09:30' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  '42501', 'permission denied for table collectes',
  'A5 client_organisateur — UPDATE direct sur collectes -> 42501 avant RLS');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.evenements $$,
  'A5 client_organisateur — SELECT sur evenements reste autorise');
SELECT lives_ok(
  $$ SELECT count(*) FROM plateforme.collectes $$,
  'A5 client_organisateur — SELECT sur collectes reste autorise');

-- ── A6 SELECT toujours filtré par RLS ──
SELECT test_set_jwt('traiteur_manager', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid), 1,
  'A6 traiteur_manager voit la collecte de son organisation');
SELECT test_set_jwt('agence', '09e70000-0000-0000-0000-000000000002'::uuid, '09e70000-0000-0000-0000-0000000000a4'::uuid);
SELECT is((SELECT count(*)::int FROM plateforme.collectes WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid), 0,
  'A6b agence d''une autre organisation ne voit pas la collecte du traiteur');
SELECT is((SELECT count(*)::int FROM plateforme.evenements WHERE id IN ('09e70000-0000-0000-0000-0000000000e1'::uuid, '09e70000-0000-0000-0000-0000000000e2'::uuid)), 0,
  'A6c agence d''une autre organisation ne voit pas les evenements du traiteur');

-- ── A7 service_role écrit sans entrave (vraies écritures) ──
SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT lives_ok($$ UPDATE plateforme.evenements SET pax = 102 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  'A7 service_role — UPDATE evenements');
SELECT lives_ok($$ INSERT INTO plateforme.evenements (organisation_id, lieu_id, traiteur_operationnel_organisation_id, entite_facturation_id, created_by, type_evenement_id, date_evenement, pax, contact_principal_nom, contact_principal_telephone)
       VALUES ('09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-00000000011e'::uuid, '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000f0'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid, '09e70000-0000-0000-0000-00000000007e'::uuid, current_date + 12, 40, 'Zoe', '0609') $$,
  'A7b service_role — INSERT evenements');
SELECT lives_ok($$ UPDATE plateforme.collectes SET heure_collecte = '09:45' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid $$,
  'A7c service_role — UPDATE collectes');
SELECT lives_ok($$ INSERT INTO plateforme.collectes (evenement_id, type, statut, date_collecte, heure_collecte) VALUES ('09e70000-0000-0000-0000-0000000000e2'::uuid, 'zero_dechet', 'programmee', current_date + 10, '10:00') $$,
  'A7d service_role — INSERT collectes');
SELECT is((SELECT pax FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid), 102,
  'A7e l''ecriture service_role est effective');
RESET role;

-- ── A8 policies d'écriture conservées (inertes) ──
SELECT test_as_superuser();
SELECT set_eq(
  $$ SELECT policyname::text FROM pg_policies
      WHERE schemaname = 'plateforme' AND tablename = 'collectes' AND cmd IN ('INSERT', 'UPDATE') $$,
  ARRAY['col_insert', 'col_update_client', 'col_update_commercial'],
  'A8 collectes : col_insert, col_update_client, col_update_commercial toujours presentes');
SELECT set_eq(
  $$ SELECT policyname::text FROM pg_policies
      WHERE schemaname = 'plateforme' AND tablename = 'evenements' AND cmd IN ('INSERT', 'UPDATE', 'DELETE') $$,
  ARRAY['evt_manager_insert', 'evt_commercial_insert', 'evt_agence_insert', 'evt_gestionnaire_insert',
        'evt_manager_update', 'evt_commercial_update', 'evt_agence_update', 'evt_gestionnaire_update',
        'evt_manager_delete'],
  'A8b evenements : les 9 policies d''ecriture client toujours presentes');

-- =============================================================================
-- B. manager_update_dans_fenetre_edition_ok — moitié DB
-- =============================================================================
-- B1 : la route lit la fenêtre avec le client de SESSION (rls.rpc) → sous le JWT
-- du manager. B2-B3 : elle écrit par fn_modifier_evenement sous service_role.
-- B4 : l'écriture directe du même UPDATE est refusée (déjà A1, rejouée ici
-- APRÈS la mise à jour réussie, pour que le scénario se lise d'un bloc).
SELECT test_set_jwt('traiteur_manager', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(plateforme.f_collecte_editable('09e70000-0000-0000-0000-0000000000e1'::uuid), true,
  'B1 manager_kaspia — collecte programmee : f_collecte_editable = true');

SELECT test_as_superuser();
SET LOCAL role service_role;
SELECT lives_ok(
  $$ SELECT plateforme.fn_modifier_evenement('09e70000-0000-0000-0000-0000000000e1'::uuid, '{"pax": 150}'::jsonb, ARRAY['pax']) $$,
  'B2 route (service_role) — fn_modifier_evenement reussit dans la fenetre');
RESET role;
SELECT is((SELECT pax FROM plateforme.evenements WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid), 150,
  'B3 la mise a jour est effective');

SELECT test_set_jwt('traiteur_manager', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid);
SELECT throws_ok(
  $$ UPDATE plateforme.evenements SET pax = 151 WHERE id = '09e70000-0000-0000-0000-0000000000e1'::uuid $$,
  '42501', 'permission denied for table evenements',
  'B4 manager_kaspia — le meme UPDATE en direct PostgREST -> 42501 avant RLS');

SELECT test_as_superuser();
SET LOCAL session_replication_role = replica;
UPDATE plateforme.collectes SET statut = 'realisee' WHERE id = '09e70000-0000-0000-0000-0000000000c1'::uuid;
SET LOCAL session_replication_role = origin;
SELECT test_set_jwt('traiteur_manager', '09e70000-0000-0000-0000-000000000001'::uuid, '09e70000-0000-0000-0000-0000000000a1'::uuid);
SELECT is(plateforme.f_collecte_editable('09e70000-0000-0000-0000-0000000000e1'::uuid), false,
  'B5 contre-epreuve — collecte realisee : f_collecte_editable = false (la route repond 422)');

SELECT * FROM finish();
ROLLBACK;
