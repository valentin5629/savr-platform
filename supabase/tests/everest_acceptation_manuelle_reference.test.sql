-- =============================================================================
-- Acceptation manuelle Everest — la reference de mission est obligatoire et
-- rend la mission VISIBLE au systeme (migration 20260916160000).
-- =============================================================================
-- Source : §06.06 §3 Bloc 0 « Acceptation manuelle d'une mission Everest (A
-- Toutes! indisponible) » + scenario Gherkin
-- `acceptation_manuelle_everest_reference_obligatoire` (§06.06 tests).
--
-- ⚠ NON-COMPLAISANCE. Aucune fixture ne pose `tournees.external_ref_commande`
-- ni `collectes.tms_reference` sur les collectes acceptees ici : elles montent
-- l'etat que laisse un E1 echoue alors qu'Everest est indisponible (tournee
-- creee, mission `creation_failed`, `statut_tms = non_envoye`). A0 le verifie
-- AVANT l'appel : tout ce que A2-A6 observent ensuite ne peut venir que de la
-- RPC.
--
-- La RPC est reservee a service_role → appelee ici en superuser.
-- =============================================================================

BEGIN;
SELECT plan(30);

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ── Fixtures referentiel ─────────────────────────────────────────────────────
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('e5a40000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrManuel', 'traiteur', true, false, 'E5A40000000001', 'evrmanuel@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('e5a40000-0000-0000-0000-0000000000e0'::uuid, 'cocktail_evrmanuel', 'Cocktail EvrManuel');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e5a40000-0000-0000-0000-0000000000a0'::uuid, 'e5a40000-0000-0000-0000-000000000001'::uuid, 'u@evrmanuel.test', 'U', 'EvrManuel', 'traiteur_manager'),
  ('e5a40000-0000-0000-0000-0000000000a1'::uuid, 'e5a40000-0000-0000-0000-000000000001'::uuid, 'ops@evrmanuel.test', 'Ops', 'EvrManuel', 'ops_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e5a40000-0000-0000-0000-0000000000f0'::uuid, 'e5a40000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrManuel SARL', 'E5A40000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('e5a40000-0000-0000-0000-0000000000b0'::uuid, 'Salle EvrManuel', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('e5a40000-0000-0000-0000-0000000000d0'::uuid, 'Presta EvrManuel Camion', 'EVRMAN-CAM', ARRAY['zd','ag'], 'manuel', 'actif'),
  ('e5a40000-0000-0000-0000-0000000000d1'::uuid, 'Presta EvrManuel Velo', 'EVRMAN-VELO', ARRAY['ag'], 'manuel', 'actif');

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id,
   code_transporteur_mts1)
VALUES
  ('e5a40000-0000-0000-0000-00000000001a'::uuid, 'Camion EvrManuel', '920000001',
   '1 rue', '75001', 'Paris', ARRAY['fourgon'], 'mts1',
   'C', 'camion@evrmanuel.invalid', '+33600000000',
   'e5a40000-0000-0000-0000-0000000000d0'::uuid, 'EVRMAN-CODE'),
  ('e5a40000-0000-0000-0000-00000000001b'::uuid, 'Velo EvrManuel', '920000002',
   '2 rue', '75001', 'Paris', ARRAY['velo_cargo'], 'a_toutes',
   'V', 'velo@evrmanuel.invalid', '+33600000001',
   'e5a40000-0000-0000-0000-0000000000d1'::uuid, NULL);

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('e5a40000-0000-0000-0000-0000000000e' || n)::uuid,
  'e5a40000-0000-0000-0000-000000000001'::uuid,
  'e5a40000-0000-0000-0000-0000000000b0'::uuid,
  'e5a40000-0000-0000-0000-000000000001'::uuid,
  'e5a40000-0000-0000-0000-0000000000f0'::uuid,
  'e5a40000-0000-0000-0000-0000000000a0'::uuid,
  'e5a40000-0000-0000-0000-0000000000e0'::uuid,
  current_date + 10, 100, 'Contact ' || n, '060' || n
FROM generate_series(1, 7) AS n;

-- Collectes AG, toutes chez le VELO sauf c5 (camion), `non_envoye`, SANS
-- tms_reference :
--   c1 E1 echoue (tournee + mission creation_failed) → le cas nominal
--   c2 tournee SANS ligne everest_missions          → chemin INSERT
--   c3 mission creee par l'API (statut created)     → refus
--   c4 E1 echoue, sert a la collision de reference   → atomicite
--   c5 dispatchee chez le CAMION                     → refus
--   c6 aucune tournee                                → 404 metier
--   c7 re-dispatchee camion → velo : tournee MTS-1 residuelle au RANG 1,
--      tournee Everest au rang 2                      → la reference va a l'Everest
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id)
SELECT
  ('e5a40000-0000-0000-0000-0000000000c' || n)::uuid,
  ('e5a40000-0000-0000-0000-0000000000e' || n)::uuid,
  'anti_gaspi', 'programmee', 'non_envoye', current_date + 10, '21:00',
  CASE WHEN n = 5 THEN 'e5a40000-0000-0000-0000-0000000000d0'::uuid
       ELSE 'e5a40000-0000-0000-0000-0000000000d1'::uuid END
FROM generate_series(1, 7) AS n;

-- Ce que `AdapterEverest.dispatchCollecte` laisse quand `createMission` echoue :
-- la tournee existe (upsertTournee precede le POST), sans reference.
INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande) VALUES
  ('e5a40000-0000-0000-0000-0000000000a2'::uuid, 'EVRMAN-T1', current_date + 10, 'soir', 'e5a40000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5a40000-0000-0000-0000-0000000000a3'::uuid, 'EVRMAN-T2', current_date + 10, 'soir', 'e5a40000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5a40000-0000-0000-0000-0000000000a4'::uuid, 'EVRMAN-T3', current_date + 10, 'soir', 'e5a40000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', 'EVR-API-T3'),
  ('e5a40000-0000-0000-0000-0000000000a5'::uuid, 'EVRMAN-T4', current_date + 10, 'soir', 'e5a40000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5a40000-0000-0000-0000-0000000000a6'::uuid, 'EVRMAN-T5', current_date + 10, 'nuit', 'e5a40000-0000-0000-0000-0000000000d0'::uuid, 'planifiee', NULL),
  ('e5a40000-0000-0000-0000-0000000000a7'::uuid, 'EVRMAN-T7-MTS1', current_date + 10, 'nuit', 'e5a40000-0000-0000-0000-0000000000d0'::uuid, 'planifiee', 'CMD-MTS1-T7'),
  ('e5a40000-0000-0000-0000-0000000000a8'::uuid, 'EVRMAN-T7-EVR',  current_date + 10, 'soir', 'e5a40000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL);

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('e5a40000-0000-0000-0000-0000000000c1'::uuid, 'e5a40000-0000-0000-0000-0000000000a2'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c2'::uuid, 'e5a40000-0000-0000-0000-0000000000a3'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c3'::uuid, 'e5a40000-0000-0000-0000-0000000000a4'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c4'::uuid, 'e5a40000-0000-0000-0000-0000000000a5'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c5'::uuid, 'e5a40000-0000-0000-0000-0000000000a6'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c7'::uuid, 'e5a40000-0000-0000-0000-0000000000a7'::uuid, 1),
  ('e5a40000-0000-0000-0000-0000000000c7'::uuid, 'e5a40000-0000-0000-0000-0000000000a8'::uuid, 2);

INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_mission_id, everest_service_id, statut_everest) VALUES
  ('e5a40000-0000-0000-0000-0000000000a2'::uuid, 'e5a40000-0000-0000-0000-0000000000c1'::uuid, NULL, 71, 'creation_failed'),
  ('e5a40000-0000-0000-0000-0000000000a4'::uuid, 'e5a40000-0000-0000-0000-0000000000c3'::uuid, 'EVR-API-T3', 71, 'created'),
  ('e5a40000-0000-0000-0000-0000000000a5'::uuid, 'e5a40000-0000-0000-0000-0000000000c4'::uuid, NULL, 71, 'creation_failed');

-- ── A0 : NON-COMPLAISANCE — avant l'appel, c1 est « non transmise » ──────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
     WHERE id = 'e5a40000-0000-0000-0000-0000000000c1'::uuid
       AND statut_tms = 'non_envoye' AND tms_reference IS NULL),
  1, 'A0 avant acceptation : c1 est dans le predicat « non transmises » (aucune reference posee par les fixtures)');

SELECT is(
  plateforme.fn_collecte_commandee_chez_provider('e5a40000-0000-0000-0000-0000000000c1'::uuid),
  false, 'A0b avant acceptation : le gate d''emission est ferme (un renvoi emettrait E1)');

-- ── A1 : reference et contact obligatoires ───────────────────────────────────
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c1'::uuid, '   ', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  '22023', 'reference_obligatoire',
  'A1 reference vide -> refus 22023');

SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c1'::uuid, 'EVR-TEL-001', NULL,
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  '22023', 'contact_obligatoire',
  'A1b contact absent -> refus 22023 (chk_everest_created_manually l''exige)');

-- ── A2 : cas nominal ─────────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c1'::uuid, 'EVR-TEL-001', 'Mathieu (A Toutes!)',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', 'Appel 20h', '20:05') $$,
  'A2 acceptation avec reference -> succes');

SELECT is(
  (SELECT external_ref_commande FROM plateforme.tournees
     WHERE id = 'e5a40000-0000-0000-0000-0000000000a2'::uuid),
  'EVR-TEL-001', 'A2a tournees.external_ref_commande porte la reference saisie');

SELECT results_eq(
  $$ SELECT statut_everest::text, everest_mission_id, manual_acceptance_contact,
            manual_acceptance_by_user_id
       FROM plateforme.everest_missions
      WHERE tournee_id = 'e5a40000-0000-0000-0000-0000000000a2'::uuid $$,
  $$ VALUES ('created_manually'::text, 'EVR-TEL-001'::text, 'Mathieu (A Toutes!)'::text,
             'e5a40000-0000-0000-0000-0000000000a1'::uuid) $$,
  'A2b everest_missions : created_manually + everest_mission_id + tracabilite Ops');

SELECT results_eq(
  $$ SELECT tms_reference, statut_tms::text, statut::text FROM plateforme.collectes
      WHERE id = 'e5a40000-0000-0000-0000-0000000000c1'::uuid $$,
  $$ VALUES ('EVR-TEL-001'::text, 'acceptee'::text, 'validee'::text) $$,
  'A2c collecte : tms_reference posee, statut_tms acceptee, statut derive validee');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action = 'MANUAL_ACCEPT'
       AND new_values->>'collecte_id' = 'e5a40000-0000-0000-0000-0000000000c1'
       AND new_values->>'external_ref_commande' = 'EVR-TEL-001'),
  1, 'A2d trace audit_log MANUAL_ACCEPT avec la reference');

-- ── A3 : la collecte SORT de la carte « non transmises » ─────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes
     WHERE id = 'e5a40000-0000-0000-0000-0000000000c1'::uuid
       AND statut_tms = 'non_envoye' AND tms_reference IS NULL),
  0, 'A3 apres acceptation : c1 sort du predicat « non transmises »');

-- ── A4 : gate ouvert → un renvoi emet E2, jamais un second dispatch ──────────
SELECT is(
  plateforme.fn_collecte_commandee_chez_provider('e5a40000-0000-0000-0000-0000000000c1'::uuid),
  true, 'A4 fn_collecte_commandee_chez_provider repond true');

SELECT is(
  plateforme.fn_dispatcher_collecte('e5a40000-0000-0000-0000-0000000000c1'::uuid),
  'collecte.modifiee',
  'A4b « Renvoyer au TMS » -> collecte.modifiee (E2), pas collecte.creee');

SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e5a40000-0000-0000-0000-0000000000c1'::uuid
       AND event_type = 'collecte.creee'),
  0, 'A4c aucune E1 emise pour c1');

-- ── A5 : rejeu meme reference = no-op ; reference differente = refus ─────────
SELECT is(
  plateforme.fn_accepter_mission_everest_manuelle(
    'e5a40000-0000-0000-0000-0000000000c1'::uuid, 'EVR-TEL-001', 'Mathieu (A Toutes!)',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL)->>'rejeu',
  'true', 'A5 rejeu avec la meme reference -> no-op idempotent');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action = 'MANUAL_ACCEPT'
       AND new_values->>'collecte_id' = 'e5a40000-0000-0000-0000-0000000000c1'),
  1, 'A5b le rejeu n''ajoute aucune trace');

SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c1'::uuid, 'EVR-TEL-AUTRE', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', 'Une autre référence de mission est déjà enregistrée pour cette collecte.',
  'A5c reference differente sur une mission deja acceptee -> refus');

-- ── A6 : pas de ligne everest_missions → chemin INSERT ───────────────────────
SELECT lives_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c2'::uuid, 'EVR-TEL-002', 'Sarah',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'A6 collecte sans ligne mission -> succes');

SELECT results_eq(
  $$ SELECT m.statut_everest::text, t.external_ref_commande
       FROM plateforme.everest_missions m
       JOIN plateforme.tournees t ON t.id = m.tournee_id
      WHERE m.collecte_id = 'e5a40000-0000-0000-0000-0000000000c2'::uuid $$,
  $$ VALUES ('created_manually'::text, 'EVR-TEL-002'::text) $$,
  'A6b mission inseree en created_manually, reference sur la tournee');

-- ── A7 : ATOMICITE — reference deja portee par une autre tournee ─────────────
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c4'::uuid, 'EVR-TEL-001', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', 'Cette référence de mission est déjà enregistrée sur une autre collecte. Vérifiez la saisie.',
  'A7 reference deja portee par la tournee de c1 -> refus (uniq_tournee_par_external_ref)');

SELECT results_eq(
  $$ SELECT m.statut_everest::text, t.external_ref_commande, c.tms_reference, c.statut_tms::text
       FROM plateforme.collectes c
       JOIN plateforme.everest_missions m ON m.collecte_id = c.id
       JOIN plateforme.tournees t ON t.id = m.tournee_id
      WHERE c.id = 'e5a40000-0000-0000-0000-0000000000c4'::uuid $$,
  $$ VALUES ('creation_failed'::text, NULL::text, NULL::text, 'non_envoye'::text) $$,
  'A7b rien n''a ete ecrit pour c4 : ni mission, ni tournee, ni collecte (tout ou rien)');

-- ── A8 : gardes metier ───────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c3'::uuid, 'EVR-TEL-003', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', 'Une mission a déjà été créée chez Everest pour cette collecte : aucune acceptation manuelle nécessaire.',
  'A8 mission deja creee par l''API -> refus (jamais ecrasee en created_manually)');

SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c5'::uuid, 'EVR-TEL-005', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', 'La collecte n''est pas attribuée à A Toutes! : dispatchez-la d''abord vers ce transporteur.',
  'A8b collecte dispatchee chez un camion -> refus');

SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c6'::uuid, 'EVR-TEL-006', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0002', 'tournee_everest_introuvable',
  'A8c collecte sans tournee Everest -> introuvable');

-- ── A9 : annulation apres acceptation → E3 emise (cancelCollecte a une cible) ─
SELECT plateforme.fn_modifier_collecte(
  'e5a40000-0000-0000-0000-0000000000c2'::uuid,
  '{"statut": "annulee"}'::jsonb, ARRAY['statut']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'e5a40000-0000-0000-0000-0000000000c2'::uuid
       AND event_type = 'collecte.annulee'),
  1, 'A9 annulation d''une collecte acceptee manuellement -> E3 collecte.annulee emise');

-- ── A9b : collecte annulee → plus d'acceptation manuelle possible ────────────
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c2'::uuid, 'EVR-TEL-002', 'Sarah',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', 'Collecte terminée ou annulée : acceptation manuelle impossible.',
  'A9b collecte annulee -> refus');

-- ── A11 : collecte mixte — la reference vise la tournee EVEREST, jamais la
--    tournee MTS-1 residuelle du rang 1 (un tri par rang non filtre par provider
--    la choisirait, et l'adapter Everest, qui cloisonne, ne verrait rien) ──────
SELECT lives_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c7'::uuid, 'EVR-TEL-007', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'A11 collecte mixte -> succes');

SELECT results_eq(
  $$ SELECT id, external_ref_commande FROM plateforme.tournees
      WHERE id IN ('e5a40000-0000-0000-0000-0000000000a7'::uuid,
                   'e5a40000-0000-0000-0000-0000000000a8'::uuid)
      ORDER BY reference_interne $$,
  $$ VALUES ('e5a40000-0000-0000-0000-0000000000a8'::uuid, 'EVR-TEL-007'::text),
            ('e5a40000-0000-0000-0000-0000000000a7'::uuid, 'CMD-MTS1-T7'::text) $$,
  'A11b reference posee sur la tournee Everest (rang 2) ; la MTS-1 du rang 1 est intacte');

-- ── A10 : la RPC n'est pas appelable par un role client ──────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated',
    'plateforme.fn_accepter_mission_everest_manuelle(uuid,text,text,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'plateforme.fn_accepter_mission_everest_manuelle(uuid,text,text,uuid,text,text,text)', 'EXECUTE'),
  'A10 ni authenticated ni anon n''ont EXECUTE');

-- ── A10b/c : refus EFFECTIF a l'execution sous un role client ────────────────
-- A10 lit les droits ; ceci prouve l'appel refuse, meme avec un JWT staff (la
-- route, sous service_role, est le seul chemin). Le MESSAGE est asserte : un
-- refus sur une TABLE (authenticated n'a plus UPDATE sur collectes) leve aussi
-- 42501 et rendrait le cas vert meme si la fonction etait ouverte.
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"e5a40000-0000-0000-0000-0000000000a1","role":"authenticated","user_role":"ops_savr"}';
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c4'::uuid, 'EVR-TEL-CLIENT', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  '42501', 'permission denied for function fn_accepter_mission_everest_manuelle',
  'A10b authenticated (JWT ops_savr) -> permission denied a l''execution');
RESET role;
SET LOCAL role = 'anon';
SELECT throws_ok(
  $$ SELECT plateforme.fn_accepter_mission_everest_manuelle(
       'e5a40000-0000-0000-0000-0000000000c4'::uuid, 'EVR-TEL-ANON', 'Mathieu',
       'e5a40000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  '42501', 'permission denied for function fn_accepter_mission_everest_manuelle',
  'A10c anon -> permission denied a l''execution');
RESET role;

SELECT * FROM finish();
ROLLBACK;
