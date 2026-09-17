-- =============================================================================
-- Mission Everest acceptée manuellement : elle reprend le cycle de vie normal
-- (CHECK `chk_everest_created_manually` en IMPLICATION, migration 20260916170000).
-- =============================================================================
-- Source : §04 Data Model TMS, CHECK `everest_missions` (arbitrage Val
-- 2026-09-16, divergence M2.5) + scénario Gherkin
-- `mission_created_manually_reprend_le_cycle_de_vie` (§06.06 tests, couche db).
--
-- ⚠ NON-COMPLAISANCE. Aucune fixture ne pose `manual_acceptance_*` : les deux
-- missions sont posées par la RPC `fn_accepter_mission_everest_manuelle` depuis
-- l'état que laisse un E1 échoué (tournée + mission `creation_failed`). B0 le
-- vérifie avant l'appel.
--
-- Non-vacuité : sous l'ancienne ÉQUIVALENCE, B2, B4, B6 et B8 lèvent 23514 et
-- B3, B5, B7, B9 échouent (les colonnes manual_* seraient à effacer).
--
-- La RPC est réservée à service_role → appelée ici en superuser, comme les
-- UPDATE de l'adapter et du webhook (service_role, RLS contournée).
-- =============================================================================

BEGIN;
SELECT plan(16);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Fixtures référentiel ─────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('e5c70000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrCycle', 'traiteur', true, false, 'E5C70000000001', 'evrcycle@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('e5c70000-0000-0000-0000-0000000000e0'::uuid, 'cocktail_evrcycle', 'Cocktail EvrCycle');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e5c70000-0000-0000-0000-0000000000a0'::uuid, 'e5c70000-0000-0000-0000-000000000001'::uuid, 'u@evrcycle.test', 'U', 'EvrCycle', 'traiteur_manager'),
  ('e5c70000-0000-0000-0000-0000000000a1'::uuid, 'e5c70000-0000-0000-0000-000000000001'::uuid, 'ops@evrcycle.test', 'Ops', 'EvrCycle', 'ops_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e5c70000-0000-0000-0000-0000000000f0'::uuid, 'e5c70000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrCycle SARL', 'E5C70000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('e5c70000-0000-0000-0000-0000000000b0'::uuid, 'Salle EvrCycle', '1 rue', '75001', 'Paris', 'velo_cargo');

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('e5c70000-0000-0000-0000-0000000000d1'::uuid, 'Presta EvrCycle Velo', 'EVRCYC-VELO', ARRAY['ag'], 'manuel', 'actif');

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
VALUES
  ('e5c70000-0000-0000-0000-00000000001b'::uuid, 'Velo EvrCycle', '930000002',
   '2 rue', '75001', 'Paris', ARRAY['velo_cargo'], 'a_toutes',
   'V', 'velo@evrcycle.invalid', '+33600000001',
   'e5c70000-0000-0000-0000-0000000000d1'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('e5c70000-0000-0000-0000-0000000000e' || n)::uuid,
  'e5c70000-0000-0000-0000-000000000001'::uuid,
  'e5c70000-0000-0000-0000-0000000000b0'::uuid,
  'e5c70000-0000-0000-0000-000000000001'::uuid,
  'e5c70000-0000-0000-0000-0000000000f0'::uuid,
  'e5c70000-0000-0000-0000-0000000000a0'::uuid,
  'e5c70000-0000-0000-0000-0000000000e0'::uuid,
  current_date + 10, 100, 'Contact ' || n, '060' || n
FROM generate_series(1, 3) AS n;

-- c1 : acceptée manuellement puis annulée (cancelCollecte)
-- c2 : acceptée manuellement puis servie (webhooks assigned → in_progress → completed)
-- c3 : mission creation_failed, cible des tentatives created_manually incomplètes
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id)
SELECT
  ('e5c70000-0000-0000-0000-0000000000c' || n)::uuid,
  ('e5c70000-0000-0000-0000-0000000000e' || n)::uuid,
  'anti_gaspi', 'programmee', 'non_envoye', current_date + 10, '21:00',
  'e5c70000-0000-0000-0000-0000000000d1'::uuid
FROM generate_series(1, 3) AS n;

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut) VALUES
  ('e5c70000-0000-0000-0000-0000000000a2'::uuid, 'EVRCYC-T1', current_date + 10, 'soir', 'e5c70000-0000-0000-0000-0000000000d1'::uuid, 'planifiee'),
  ('e5c70000-0000-0000-0000-0000000000a3'::uuid, 'EVRCYC-T2', current_date + 10, 'soir', 'e5c70000-0000-0000-0000-0000000000d1'::uuid, 'planifiee'),
  ('e5c70000-0000-0000-0000-0000000000a4'::uuid, 'EVRCYC-T3', current_date + 10, 'soir', 'e5c70000-0000-0000-0000-0000000000d1'::uuid, 'planifiee');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('e5c70000-0000-0000-0000-0000000000c1'::uuid, 'e5c70000-0000-0000-0000-0000000000a2'::uuid, 1),
  ('e5c70000-0000-0000-0000-0000000000c2'::uuid, 'e5c70000-0000-0000-0000-0000000000a3'::uuid, 1),
  ('e5c70000-0000-0000-0000-0000000000c3'::uuid, 'e5c70000-0000-0000-0000-0000000000a4'::uuid, 1);

INSERT INTO plateforme.everest_missions (id, tournee_id, collecte_id, everest_mission_id, everest_service_id, statut_everest) VALUES
  ('e5c70000-0000-0000-0000-0000000000f1'::uuid, 'e5c70000-0000-0000-0000-0000000000a2'::uuid, 'e5c70000-0000-0000-0000-0000000000c1'::uuid, NULL, 71, 'creation_failed'),
  ('e5c70000-0000-0000-0000-0000000000f2'::uuid, 'e5c70000-0000-0000-0000-0000000000a3'::uuid, 'e5c70000-0000-0000-0000-0000000000c2'::uuid, NULL, 71, 'creation_failed'),
  ('e5c70000-0000-0000-0000-0000000000f3'::uuid, 'e5c70000-0000-0000-0000-0000000000a4'::uuid, 'e5c70000-0000-0000-0000-0000000000c3'::uuid, NULL, 71, 'creation_failed');

-- ── B0 : non-complaisance — aucune trace manuelle avant la RPC ───────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions
     WHERE collecte_id IN ('e5c70000-0000-0000-0000-0000000000c1'::uuid, 'e5c70000-0000-0000-0000-0000000000c2'::uuid)
       AND statut_everest = 'creation_failed'
       AND manual_acceptance_at IS NULL AND manual_acceptance_by_user_id IS NULL AND manual_acceptance_contact IS NULL),
  2, 'B0 avant acceptation : missions creation_failed, aucun champ manual_acceptance_* pose par les fixtures');

SELECT plateforme.fn_accepter_mission_everest_manuelle(
  'e5c70000-0000-0000-0000-0000000000c1'::uuid, 'EVR-CYC-001', 'Mathieu (A Toutes!)',
  'e5c70000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL);
SELECT plateforme.fn_accepter_mission_everest_manuelle(
  'e5c70000-0000-0000-0000-0000000000c2'::uuid, 'EVR-CYC-002', 'Mathieu (A Toutes!)',
  'e5c70000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL);

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions
     WHERE collecte_id IN ('e5c70000-0000-0000-0000-0000000000c1'::uuid, 'e5c70000-0000-0000-0000-0000000000c2'::uuid)
       AND statut_everest = 'created_manually'
       AND manual_acceptance_at IS NOT NULL
       AND manual_acceptance_by_user_id = 'e5c70000-0000-0000-0000-0000000000a1'::uuid
       AND manual_acceptance_contact = 'Mathieu (A Toutes!)'),
  2, 'B1 la RPC pose created_manually avec les 3 champs de tracabilite');

-- Instantané de l'audit, pour prouver qu'il n'est ni effacé ni réécrit.
CREATE TEMP TABLE audit_avant ON COMMIT DROP AS
  SELECT id, manual_acceptance_at, manual_acceptance_by_user_id, manual_acceptance_contact
  FROM plateforme.everest_missions
  WHERE collecte_id IN ('e5c70000-0000-0000-0000-0000000000c1'::uuid, 'e5c70000-0000-0000-0000-0000000000c2'::uuid);

-- ── B2-B3 : annulation (UPDATE de AdapterEverest.cancelCollecte) ─────────────
SELECT lives_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'cancelled', derniere_sync_at = now()
     WHERE everest_mission_id = 'EVR-CYC-001' $$,
  'B2 created_manually -> cancelled : l''UPDATE reussit (plus de 23514)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions m JOIN audit_avant a USING (id)
     WHERE m.everest_mission_id = 'EVR-CYC-001' AND m.statut_everest = 'cancelled'
       AND m.manual_acceptance_at = a.manual_acceptance_at
       AND m.manual_acceptance_by_user_id = a.manual_acceptance_by_user_id
       AND m.manual_acceptance_contact = a.manual_acceptance_contact),
  1, 'B3 cancelled : les 3 colonnes manual_acceptance_* sont conservees a l''identique');

-- ── B4-B9 : webhooks Everest assigned → in_progress → completed ──────────────
SELECT lives_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'assigned', derniere_sync_at = now()
     WHERE everest_mission_id = 'EVR-CYC-002' $$,
  'B4 created_manually -> assigned : l''UPDATE reussit');

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions m JOIN audit_avant a USING (id)
     WHERE m.everest_mission_id = 'EVR-CYC-002' AND m.statut_everest = 'assigned'
       AND m.manual_acceptance_at = a.manual_acceptance_at
       AND m.manual_acceptance_by_user_id = a.manual_acceptance_by_user_id
       AND m.manual_acceptance_contact = a.manual_acceptance_contact),
  1, 'B5 assigned : colonnes manual_acceptance_* conservees');

SELECT lives_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'in_progress', derniere_sync_at = now()
     WHERE everest_mission_id = 'EVR-CYC-002' $$,
  'B6 assigned -> in_progress : l''UPDATE reussit');

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions m JOIN audit_avant a USING (id)
     WHERE m.everest_mission_id = 'EVR-CYC-002' AND m.statut_everest = 'in_progress'
       AND m.manual_acceptance_at = a.manual_acceptance_at
       AND m.manual_acceptance_by_user_id = a.manual_acceptance_by_user_id
       AND m.manual_acceptance_contact = a.manual_acceptance_contact),
  1, 'B7 in_progress : colonnes manual_acceptance_* conservees');

SELECT lives_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'completed', derniere_sync_at = now()
     WHERE everest_mission_id = 'EVR-CYC-002' $$,
  'B8 in_progress -> completed : l''UPDATE reussit');

SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions m JOIN audit_avant a USING (id)
     WHERE m.everest_mission_id = 'EVR-CYC-002' AND m.statut_everest = 'completed'
       AND m.manual_acceptance_at = a.manual_acceptance_at
       AND m.manual_acceptance_by_user_id = a.manual_acceptance_by_user_id
       AND m.manual_acceptance_contact = a.manual_acceptance_contact),
  1, 'B9 completed : colonnes manual_acceptance_* conservees');

-- ── B10-B14 : created_manually exige TOUJOURS les 3 champs (23514) ───────────
SELECT throws_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'created_manually', manual_acceptance_at = now()
     WHERE id = 'e5c70000-0000-0000-0000-0000000000f3'::uuid $$,
  '23514', NULL,
  'B10 created_manually avec seulement manual_acceptance_at -> 23514');

SELECT throws_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'created_manually',
           manual_acceptance_by_user_id = 'e5c70000-0000-0000-0000-0000000000a1'::uuid
     WHERE id = 'e5c70000-0000-0000-0000-0000000000f3'::uuid $$,
  '23514', NULL,
  'B11 created_manually avec seulement manual_acceptance_by_user_id -> 23514');

SELECT throws_ok(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'created_manually', manual_acceptance_contact = 'Mathieu'
     WHERE id = 'e5c70000-0000-0000-0000-0000000000f3'::uuid $$,
  '23514', NULL,
  'B12 created_manually avec seulement manual_acceptance_contact -> 23514');

SELECT throws_ok(
  $$ INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_service_id, statut_everest, manual_acceptance_contact)
     VALUES ('e5c70000-0000-0000-0000-0000000000a4'::uuid, 'e5c70000-0000-0000-0000-0000000000c3'::uuid, 71, 'created_manually', 'Mathieu') $$,
  '23514', NULL,
  'B13 INSERT created_manually avec un seul champ manual_acceptance_* -> 23514');

-- Le refus porte bien sur CE check (et non sur une autre contrainte).
SELECT throws_like(
  $$ UPDATE plateforme.everest_missions
       SET statut_everest = 'created_manually'
     WHERE id = 'e5c70000-0000-0000-0000-0000000000f3'::uuid $$,
  '%chk_everest_created_manually%',
  'B14 created_manually sans aucun champ -> refus nomme chk_everest_created_manually');

-- ── B15 : forme de la contrainte en base = implication ───────────────────────
SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'chk_everest_created_manually'
       AND conrelid = 'plateforme.everest_missions'::regclass) LIKE '%<>%OR%',
  'B15 chk_everest_created_manually est une implication (statut <> created_manually OR ...)');

SELECT * FROM finish();
ROLLBACK;
