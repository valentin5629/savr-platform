-- =============================================================================
-- M1.2 / M1.5a — Édition événement + collecte par les rôles programmateurs.
-- Décision produit Val 2026-06-26. Prouve sous rôle `authenticated` :
--   • evt_*_update : les 4 rôles éditent l'événement de leur périmètre (fenêtre
--     f_collecte_editable), cloisonnement cross-org refusé, commercial = ses créations.
--   • col_update_client / col_update_commercial : édition collecte des 4 rôles +
--     cloisonnement (couvre la « lacune » agence/gestionnaire signalée au brief —
--     col_update_client couvre déjà les 3 rôles non-commercial).
--   • fn_modifier_evenement (service_role) : E2 par collecte dispatchée + recalcul
--     volume_estime_repas sur changement de pax + pas d'E2 pour champ non-TMS / non
--     dispatché (garde-fou 4 transactional outbox).
-- =============================================================================

BEGIN;
SELECT plan(17);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Helpers JWT (cf. rls_0_4_smoke) ──────────────────────────────────────────
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

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('a1110000-0000-0000-0000-000000000001'::uuid, 'Traiteur A', 'traiteur', true, false, 'A1110000000001', 'a@test.com'),
  ('b2220000-0000-0000-0000-000000000001'::uuid, 'Traiteur B', 'traiteur', true, false, 'B2220000000001', 'b@test.com'),
  ('a6330000-0000-0000-0000-000000000001'::uuid, 'Agence G', 'agence', true, false, 'A6330000000001', 'ag@test.com'),
  ('6e440000-0000-0000-0000-000000000001'::uuid, 'Gestionnaire X', 'gestionnaire_lieux', true, false, '6E440000000001', 'gx@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('07e00000-0000-0000-0000-000000000001'::uuid, 'cocktail_e', 'Cocktail');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('05e70000-0000-0000-0000-00000000000a'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'mgr@a.test', 'Mgr', 'A', 'traiteur_manager'),
  ('05e70000-0000-0000-0000-00000000000c'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'com@a.test', 'Com', 'A', 'traiteur_commercial'),
  ('05e70000-0000-0000-0000-00000000000d'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'com2@a.test', 'Com2', 'A', 'traiteur_commercial'),
  ('05e70000-0000-0000-0000-00000000000e'::uuid, 'a6330000-0000-0000-0000-000000000001'::uuid, 'u@ag.test', 'U', 'Ag', 'agence'),
  ('05e70000-0000-0000-0000-00000000000f'::uuid, '6e440000-0000-0000-0000-000000000001'::uuid, 'u@gx.test', 'U', 'Gx', 'gestionnaire_lieux');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('eeff0000-0000-0000-0000-00000000000a'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'Traiteur A SARL', 'A1110000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('1ae00000-0000-0000-0000-000000000001'::uuid, 'Salle A', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id) VALUES
  ('6e440000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid);

-- Événements : evtA (org A, créé par com A), evtB (org B), evtAG (agence),
-- evtG (gestionnaire), evtLock (org A, collecte en_cours), evtDisp/evtNoDisp (E2).
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone, reference_affaire
) VALUES
  ('0e000000-0000-0000-0000-0000000000a1'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000c'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Alice', '0601', 'orig-A'),
  ('0e000000-0000-0000-0000-0000000000b1'::uuid, 'b2220000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'b2220000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 50, 'Bob', '0602', 'orig-B'),
  ('0e000000-0000-0000-0000-0000000000c1'::uuid, 'a6330000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000e'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 70, 'Carl', '0603', 'orig-AG'),
  ('0e000000-0000-0000-0000-0000000000d1'::uuid, '6e440000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000f'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 80, 'Dina', '0604', 'orig-G'),
  ('0e000000-0000-0000-0000-0000000000e1'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 90, 'Eve', '0605', 'orig-LOCK'),
  ('0e000000-0000-0000-0000-0000000000f1'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Fred', '0606', 'orig-DISP'),
  ('0e000000-0000-0000-0000-0000000000f2'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, '1ae00000-0000-0000-0000-000000000001'::uuid, 'a1110000-0000-0000-0000-000000000001'::uuid, 'eeff0000-0000-0000-0000-00000000000a'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid, '07e00000-0000-0000-0000-000000000001'::uuid, current_date + 10, 100, 'Gail', '0607', 'orig-NODISP');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, tms_reference) VALUES
  ('cc000000-0000-0000-0000-0000000000a1'::uuid, '0e000000-0000-0000-0000-0000000000a1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', NULL),
  ('cc000000-0000-0000-0000-0000000000c1'::uuid, '0e000000-0000-0000-0000-0000000000c1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', NULL),
  ('cc000000-0000-0000-0000-0000000000d1'::uuid, '0e000000-0000-0000-0000-0000000000d1'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00', NULL),
  ('cc000000-0000-0000-0000-0000000000e1'::uuid, '0e000000-0000-0000-0000-0000000000e1'::uuid, 'zero_dechet', 'en_cours', 'acceptee', current_date + 10, '08:00', NULL),
  ('cc000000-0000-0000-0000-0000000000f1'::uuid, '0e000000-0000-0000-0000-0000000000f1'::uuid, 'anti_gaspi', 'validee', 'acceptee', current_date + 10, '08:00', 'MTS-DISP-1'),
  ('cc000000-0000-0000-0000-0000000000f2'::uuid, '0e000000-0000-0000-0000-0000000000f2'::uuid, 'anti_gaspi', 'validee', 'acceptee', current_date + 10, '08:00', NULL);

-- ── evt_*_update : édition événement par rôle + cloisonnement ────────────────
-- T1 manager édite l'événement de son orga (fenêtre ouverte) → appliqué.
SELECT test_set_jwt('traiteur_manager', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'mgr-ok' WHERE id = '0e000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000a1'::uuid), 'mgr-ok', 'T1 evt_manager_update applique (orga + fenetre)');

-- T2 manager ne peut PAS éditer un événement d'une autre orga.
SELECT test_set_jwt('traiteur_manager', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'mgr-hack' WHERE id = '0e000000-0000-0000-0000-0000000000b1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000b1'::uuid), 'orig-B', 'T2 evt_manager cross-org refuse');

-- T3 commercial édite SA création.
SELECT test_set_jwt('traiteur_commercial', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000c'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'com-ok' WHERE id = '0e000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000a1'::uuid), 'com-ok', 'T3 evt_commercial_update sa creation');

-- T4 commercial NON créateur (même orga) → refusé.
SELECT test_set_jwt('traiteur_commercial', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000d'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'com2-hack' WHERE id = '0e000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000a1'::uuid), 'com-ok', 'T4 evt_commercial non-createur refuse');

-- T5 agence édite l'événement de son orga.
SELECT test_set_jwt('agence', 'a6330000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000e'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'ag-ok' WHERE id = '0e000000-0000-0000-0000-0000000000c1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000c1'::uuid), 'ag-ok', 'T5 evt_agence_update son orga');

-- T6 agence cross-org refusé.
SELECT test_set_jwt('agence', 'a6330000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000e'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'ag-hack' WHERE id = '0e000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000a1'::uuid), 'com-ok', 'T6 evt_agence cross-org refuse');

-- T7 gestionnaire édite l'événement de son orga.
SELECT test_set_jwt('gestionnaire_lieux', '6e440000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000f'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'g-ok' WHERE id = '0e000000-0000-0000-0000-0000000000d1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000d1'::uuid), 'g-ok', 'T7 evt_gestionnaire_update son orga');

-- T8 gestionnaire cross-org refusé.
SELECT test_set_jwt('gestionnaire_lieux', '6e440000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000f'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'g-hack' WHERE id = '0e000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000a1'::uuid), 'com-ok', 'T8 evt_gestionnaire cross-org refuse');

-- T9 fenêtre fermée : événement dont la seule collecte est en_cours → refus (verrou).
SELECT test_set_jwt('traiteur_manager', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000a'::uuid);
UPDATE plateforme.evenements SET reference_affaire = 'lock-hack' WHERE id = '0e000000-0000-0000-0000-0000000000e1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT reference_affaire FROM plateforme.evenements WHERE id='0e000000-0000-0000-0000-0000000000e1'::uuid), 'orig-LOCK', 'T9 evt verrou des en_cours (f_collecte_editable=false)');

-- ── col_update_* : édition collecte par rôle + cloisonnement ─────────────────
-- T10 agence édite une collecte de son orga (col_update_client couvre agence).
SELECT test_set_jwt('agence', 'a6330000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000e'::uuid);
UPDATE plateforme.collectes SET notes_internes = 'ag-col' WHERE id = 'cc000000-0000-0000-0000-0000000000c1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT notes_internes FROM plateforme.collectes WHERE id='cc000000-0000-0000-0000-0000000000c1'::uuid), 'ag-col', 'T10 col_update_client agence');

-- T11 gestionnaire édite une collecte de son orga (col_update_client couvre gestionnaire).
SELECT test_set_jwt('gestionnaire_lieux', '6e440000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000f'::uuid);
UPDATE plateforme.collectes SET notes_internes = 'g-col' WHERE id = 'cc000000-0000-0000-0000-0000000000d1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT notes_internes FROM plateforme.collectes WHERE id='cc000000-0000-0000-0000-0000000000d1'::uuid), 'g-col', 'T11 col_update_client gestionnaire');

-- T12 gestionnaire ne peut PAS éditer une collecte d'une autre orga.
SELECT test_set_jwt('gestionnaire_lieux', '6e440000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000f'::uuid);
UPDATE plateforme.collectes SET notes_internes = 'g-hack' WHERE id = 'cc000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT notes_internes FROM plateforme.collectes WHERE id='cc000000-0000-0000-0000-0000000000a1'::uuid), NULL, 'T12 col gestionnaire cross-org refuse');

-- T13 commercial édite une collecte de sa création (col_update_commercial).
SELECT test_set_jwt('traiteur_commercial', 'a1110000-0000-0000-0000-000000000001'::uuid, '05e70000-0000-0000-0000-00000000000c'::uuid);
UPDATE plateforme.collectes SET notes_internes = 'com-col' WHERE id = 'cc000000-0000-0000-0000-0000000000a1'::uuid;
SELECT test_as_superuser();
SELECT is((SELECT notes_internes FROM plateforme.collectes WHERE id='cc000000-0000-0000-0000-0000000000a1'::uuid), 'com-col', 'T13 col_update_commercial sa creation');

-- ── fn_modifier_evenement (service_role / SECURITY DEFINER) ──────────────────
-- T14 E2 émis pour la collecte AG dispatchée (tms_reference non null) sur édition pax.
SELECT test_as_superuser();
SELECT plateforme.fn_modifier_evenement(
  '0e000000-0000-0000-0000-0000000000f1'::uuid, '{"pax": 500}'::jsonb, ARRAY['pax']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'cc000000-0000-0000-0000-0000000000f1'::uuid
       AND event_type = 'collecte.modifiee'
       AND payload->>'source' = 'evenement'),
  1, 'T14 fn_modifier_evenement : E2 par collecte dispatchee sur edition pax');

-- T15 recalcul volume_estime_repas = ROUND(0.10 * 500) = 50 (AG non terminale).
SELECT is(
  (SELECT volume_estime_repas FROM plateforme.collectes WHERE id='cc000000-0000-0000-0000-0000000000f1'::uuid),
  50, 'T15 recalcul volume_estime_repas sur edition pax');

-- T16 pas d'E2 pour un champ non persisté côté TMS (nom_evenement).
SELECT plateforme.fn_modifier_evenement(
  '0e000000-0000-0000-0000-0000000000f1'::uuid, '{"nom_evenement": "Gala"}'::jsonb, ARRAY['nom_evenement']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'cc000000-0000-0000-0000-0000000000f1'::uuid
       AND event_type = 'collecte.modifiee'),
  1, 'T16 pas d''E2 supplementaire pour un champ non-TMS (nom_evenement)');

-- T17 pas d'E2 pour une collecte non dispatchée (tms_reference NULL) malgré pax.
SELECT plateforme.fn_modifier_evenement(
  '0e000000-0000-0000-0000-0000000000f2'::uuid, '{"pax": 400}'::jsonb, ARRAY['pax']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'cc000000-0000-0000-0000-0000000000f2'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'T17 pas d''E2 pour collecte non dispatchee (tms_reference NULL)');

SELECT * FROM finish();
ROLLBACK;
