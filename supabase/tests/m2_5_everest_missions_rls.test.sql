-- =============================================================================
-- Tests pgTAP M2.5 — RLS plateforme.everest_missions
-- =============================================================================
-- Périmètre : 9 tests RLS — admin_savr/ops_savr (allow) vs autres rôles (deny)
-- =============================================================================

BEGIN;
SELECT plan(9);

-- ─── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
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

-- ─── Setup fixture ────────────────────────────────────────────────────────────

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('0a250001-0000-0000-0000-000000000001'::uuid, 'Savr', 'traiteur', true, false, '10000000000001', 'admin@savr.test'),
  ('0a250002-0000-0000-0000-000000000001'::uuid, 'Kaspia', 'traiteur', true, false, '20000000000002', 'manager@kaspia.test'),
  ('0a250003-0000-0000-0000-000000000001'::uuid, 'VenueCo', 'gestionnaire_lieux', true, false, '30000000000003', 'venue@test.test');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('05250001-0000-0000-0000-000000000001'::uuid, '0a250001-0000-0000-0000-000000000001'::uuid, 'admin@savr.test', 'Admin', 'Savr', 'admin_savr'),
  ('05250002-0000-0000-0000-000000000001'::uuid, '0a250002-0000-0000-0000-000000000001'::uuid, 'mgr@kaspia.test', 'Manager', 'Kaspia', 'traiteur_manager'),
  ('05250004-0000-0000-0000-000000000001'::uuid, '0a250001-0000-0000-0000-000000000001'::uuid, 'ops@savr.test', 'Ops', 'Savr', 'ops_savr'),
  ('05250005-0000-0000-0000-000000000001'::uuid, '0a250003-0000-0000-0000-000000000001'::uuid, 'venue@test.test', 'Venue', 'Mgr', 'gestionnaire_lieux');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('e0250001-0000-0000-0000-000000000001'::uuid, 'ev_m25_test', 'Test M2.5');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('1e250001-0000-0000-0000-000000000001'::uuid, 'Salle M2.5', '1 rue test', '75001', 'Paris', 'velo_cargo');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('ee250001-0000-0000-0000-000000000001'::uuid, '0a250002-0000-0000-0000-000000000001'::uuid, 'Kaspia SAS', '20000000000002', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES (
  'e0e25001-0000-0000-0000-000000000001'::uuid,
  '0a250002-0000-0000-0000-000000000001'::uuid,
  '1e250001-0000-0000-0000-000000000001'::uuid,
  '0a250002-0000-0000-0000-000000000001'::uuid,
  'ee250001-0000-0000-0000-000000000001'::uuid,
  '05250002-0000-0000-0000-000000000001'::uuid,
  'e0250001-0000-0000-0000-000000000001'::uuid,
  NOW() + INTERVAL '10 days', 100, 'Contact', '0601010101'
);

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES (
  'c0250001-0000-0000-0000-000000000001'::uuid,
  'e0e25001-0000-0000-0000-000000000001'::uuid,
  'anti_gaspi', 'validee', 'attribuee_en_attente_acceptation',
  current_date + 3, '22:00'
);

INSERT INTO shared.prestataires (id, nom, code, mode_integration)
VALUES ('fa250001-0000-0000-0000-000000000001'::uuid, 'A Toutes! test', 'a-toutes-m25', 'api');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, type_vehicule, prestataire_logistique_id, statut)
VALUES (
  'b0250001-0000-0000-0000-000000000001'::uuid,
  'EVR-c0250001-m25-001',
  current_date + 3,
  'soir', 'velo_cargo',
  'fa250001-0000-0000-0000-000000000001'::uuid,
  'planifiee'
);

-- Mission en statut creation_failed (pas de everest_mission_id requis, pas de manual_acceptance_* requis)
INSERT INTO plateforme.everest_missions (id, tournee_id, collecte_id, everest_service_id, statut_everest)
VALUES (
  'ed250001-0000-0000-0000-000000000001'::uuid,
  'b0250001-0000-0000-0000-000000000001'::uuid,
  'c0250001-0000-0000-0000-000000000001'::uuid,
  71, 'creation_failed'
);

-- ─── T1 : admin_savr peut SELECT ─────────────────────────────────────────────

SELECT test_set_jwt(
  'admin_savr',
  '0a250001-0000-0000-0000-000000000001'::uuid,
  '05250001-0000-0000-0000-000000000001'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions),
  1,
  'T1 admin_savr — SELECT everest_missions : voit la mission (R1)'
);

-- ─── T2 : traiteur_manager ne peut PAS SELECT ────────────────────────────────

SELECT test_set_jwt(
  'traiteur_manager',
  '0a250002-0000-0000-0000-000000000001'::uuid,
  '05250002-0000-0000-0000-000000000001'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions),
  0,
  'T2 traiteur_manager — SELECT everest_missions : 0 ligne (R2, deny USING)'
);

-- ─── T3 : admin_savr peut INSERT ─────────────────────────────────────────────

-- Préparer une 2e tournée (contrainte UNIQUE tournee_id)
SELECT test_as_superuser();
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, type_vehicule, prestataire_logistique_id, statut)
VALUES (
  'b0250002-0000-0000-0000-000000000001'::uuid,
  'EVR-c0250001-m25-002',
  current_date + 3,
  'soir', 'velo_cargo',
  'fa250001-0000-0000-0000-000000000001'::uuid,
  'planifiee'
);

SELECT test_set_jwt(
  'admin_savr',
  '0a250001-0000-0000-0000-000000000001'::uuid,
  '05250001-0000-0000-0000-000000000001'::uuid
);

SELECT lives_ok(
  $$INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_service_id, statut_everest)
    VALUES (
      'b0250002-0000-0000-0000-000000000001'::uuid,
      'c0250001-0000-0000-0000-000000000001'::uuid,
      71, 'creation_failed'
    )$$,
  'T3 admin_savr — INSERT everest_missions OK (R3, WITH CHECK admin_savr)'
);

-- ─── T4 : traiteur_manager ne peut PAS INSERT ────────────────────────────────

SELECT test_as_superuser();
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, type_vehicule, prestataire_logistique_id, statut)
VALUES (
  'b0250003-0000-0000-0000-000000000001'::uuid,
  'EVR-c0250001-m25-003',
  current_date + 3,
  'soir', 'velo_cargo',
  'fa250001-0000-0000-0000-000000000001'::uuid,
  'planifiee'
);

SELECT test_set_jwt(
  'traiteur_manager',
  '0a250002-0000-0000-0000-000000000001'::uuid,
  '05250002-0000-0000-0000-000000000001'::uuid
);

SELECT throws_ok(
  $$INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_service_id, statut_everest)
    VALUES (
      'b0250003-0000-0000-0000-000000000001'::uuid,
      'c0250001-0000-0000-0000-000000000001'::uuid,
      71, 'creation_failed'
    )$$,
  '42501',
  NULL,
  'T4 traiteur_manager — INSERT everest_missions bloqué RLS 42501 (R4, deny WITH CHECK)'
);

-- ─── T5 : admin_savr peut UPDATE ─────────────────────────────────────────────

SELECT test_set_jwt(
  'admin_savr',
  '0a250001-0000-0000-0000-000000000001'::uuid,
  '05250001-0000-0000-0000-000000000001'::uuid
);

SELECT lives_ok(
  $$UPDATE plateforme.everest_missions
    SET payload_latest_update = '{"ok":true}'::jsonb
    WHERE id = 'ed250001-0000-0000-0000-000000000001'::uuid$$,
  'T5 admin_savr — UPDATE everest_missions OK (R5, USING admin_savr)'
);

-- ─── T6 : traiteur_manager — UPDATE visible = 0 ligne ────────────────────────

SELECT test_set_jwt(
  'traiteur_manager',
  '0a250002-0000-0000-0000-000000000001'::uuid,
  '05250002-0000-0000-0000-000000000001'::uuid
);

WITH upd AS (
  UPDATE plateforme.everest_missions
  SET payload_latest_update = '{"hack":true}'::jsonb
  WHERE id = 'ed250001-0000-0000-0000-000000000001'::uuid
  RETURNING id
)
SELECT is(count(*)::int, 0, 'T6 traiteur_manager — UPDATE everest_missions 0 ligne modifiée (R6, deny via USING)')
FROM upd;

-- ─── T7 : ops_savr peut SELECT ───────────────────────────────────────────────

SELECT test_set_jwt(
  'ops_savr',
  '0a250001-0000-0000-0000-000000000001'::uuid,
  '05250004-0000-0000-0000-000000000001'::uuid
);

SELECT ok(
  EXISTS(SELECT 1 FROM plateforme.everest_missions WHERE id = 'ed250001-0000-0000-0000-000000000001'::uuid),
  'T7 ops_savr — SELECT everest_missions : voit la mission (R7, allow SELECT)'
);

-- ─── T8 : ops_savr peut UPDATE ───────────────────────────────────────────────

SELECT test_set_jwt(
  'ops_savr',
  '0a250001-0000-0000-0000-000000000001'::uuid,
  '05250004-0000-0000-0000-000000000001'::uuid
);

SELECT lives_ok(
  $$UPDATE plateforme.everest_missions
    SET payload_latest_update = '{"ops":true}'::jsonb
    WHERE id = 'ed250001-0000-0000-0000-000000000001'::uuid$$,
  'T8 ops_savr — UPDATE everest_missions OK (R8, allow UPDATE)'
);

-- ─── T9 : gestionnaire_lieux ne peut PAS SELECT ──────────────────────────────

SELECT test_set_jwt(
  'gestionnaire_lieux',
  '0a250003-0000-0000-0000-000000000001'::uuid,
  '05250005-0000-0000-0000-000000000001'::uuid
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions),
  0,
  'T9 gestionnaire_lieux — SELECT everest_missions : 0 ligne (R9, deny tous rôles non-staff)'
);

SELECT * FROM finish();
ROLLBACK;
