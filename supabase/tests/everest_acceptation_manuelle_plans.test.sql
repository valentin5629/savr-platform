-- =============================================================================
-- Acceptation manuelle Everest — plans du scénario (§06.06 tests, divergence M2.5)
--   · acceptation_manuelle_everest_statut_depart : 3 départs → acceptee,
--     `rejetee_par_prestataire` → refus (migration 20260916180000) ;
--   · acceptation_manuelle_everest_refus_409 : collecte terminale ou annulée →
--     refus ET aucune écriture.
-- =============================================================================
-- Les autres lignes des deux plans sont prouvées dans
-- everest_acceptation_manuelle_reference.test.sql : non_envoye → acceptee (A2c),
-- transporteur non a_toutes (A8b), mission créée par l'API (A8), autre référence
-- déjà posée (A5c), référence portée par une autre tournée (A7/A7b).
--
-- ⚠ NON-COMPLAISANCE. Aucune fixture ne pose de référence ni de champ
-- manual_acceptance_* : l'état est celui d'un E1 échoué (tournée + mission
-- `creation_failed`). R0 le vérifie avant les appels.
--
-- Refus métier = P0003 (traduit en 409 par la route, prouvé par
-- everest-manual-accept.m2-5.test.ts). La RPC est réservée à service_role →
-- appelée ici en superuser.
-- =============================================================================

BEGIN;
SELECT plan(20);

CREATE EXTENSION IF NOT EXISTS pgtap;

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal) VALUES
  ('e5d90000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrPlans', 'traiteur', true, false, 'E5D90000000001', 'evrplans@test.internal');

INSERT INTO plateforme.types_evenements (id, code, libelle) VALUES
  ('e5d90000-0000-0000-0000-0000000000e0'::uuid, 'cocktail_evrplans', 'Cocktail EvrPlans');

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role) VALUES
  ('e5d90000-0000-0000-0000-0000000000a0'::uuid, 'e5d90000-0000-0000-0000-000000000001'::uuid, 'u@evrplans.test', 'U', 'EvrPlans', 'traiteur_manager'),
  ('e5d90000-0000-0000-0000-0000000000a1'::uuid, 'e5d90000-0000-0000-0000-000000000001'::uuid, 'ops@evrplans.test', 'Ops', 'EvrPlans', 'ops_savr');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville) VALUES
  ('e5d90000-0000-0000-0000-0000000000f0'::uuid, 'e5d90000-0000-0000-0000-000000000001'::uuid, 'Traiteur EvrPlans SARL', 'E5D90000000001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max) VALUES
  ('e5d90000-0000-0000-0000-0000000000b0'::uuid, 'Salle EvrPlans', '1 rue', '75001', 'Paris', 'velo_cargo');

INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('e5d90000-0000-0000-0000-0000000000d1'::uuid, 'Presta EvrPlans Velo', 'EVRPLN-VELO', ARRAY['ag'], 'manuel', 'actif');

INSERT INTO plateforme.transporteurs
  (id, nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
   contact_nom, contact_email, contact_telephone, prestataire_logistique_id)
VALUES
  ('e5d90000-0000-0000-0000-00000000001b'::uuid, 'Velo EvrPlans', '940000002', '2 rue', '75001', 'Paris',
   ARRAY['velo_cargo'], 'a_toutes', 'V', 'velo@evrplans.invalid', '+33600000001',
   'e5d90000-0000-0000-0000-0000000000d1'::uuid);

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  ('e5d90000-0000-0000-0000-0000000000e' || n)::uuid,
  'e5d90000-0000-0000-0000-000000000001'::uuid, 'e5d90000-0000-0000-0000-0000000000b0'::uuid, 'e5d90000-0000-0000-0000-000000000001'::uuid,
  'e5d90000-0000-0000-0000-0000000000f0'::uuid, 'e5d90000-0000-0000-0000-0000000000a0'::uuid, 'e5d90000-0000-0000-0000-0000000000e0'::uuid,
  current_date + 10, 100, 'Contact ' || n, '060' || n
FROM generate_series(1, 6) AS n;

-- Collectes AG chez le vélo, SANS tms_reference. Statut de départ par cas :
--   c1 statut=programmee, statut_tms=a_attribuer → ok
--   c2 statut=programmee, statut_tms=attribuee_en_attente_acceptation → ok
--   c3 statut=programmee, statut_tms=rejetee_par_prestataire → refus
--   c4 statut=realisee, statut_tms=acceptee → refus
--   c5 statut=cloturee, statut_tms=acceptee → refus
--   c6 statut=annulee, statut_tms=non_envoye → refus
-- Insérées sous session_replication_role = replica : les statuts terminaux ne
-- sont pas atteignables par INSERT direct (triggers de cycle de vie), et l'état
-- à reproduire est celui qu'ont laissé ces triggers.
SET LOCAL session_replication_role = replica;
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, prestataire_logistique_id) VALUES
  ('e5d90000-0000-0000-0000-0000000000c1'::uuid, 'e5d90000-0000-0000-0000-0000000000e1'::uuid, 'anti_gaspi', 'programmee', 'a_attribuer', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid),
  ('e5d90000-0000-0000-0000-0000000000c2'::uuid, 'e5d90000-0000-0000-0000-0000000000e2'::uuid, 'anti_gaspi', 'programmee', 'attribuee_en_attente_acceptation', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid),
  ('e5d90000-0000-0000-0000-0000000000c3'::uuid, 'e5d90000-0000-0000-0000-0000000000e3'::uuid, 'anti_gaspi', 'programmee', 'rejetee_par_prestataire', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid),
  ('e5d90000-0000-0000-0000-0000000000c4'::uuid, 'e5d90000-0000-0000-0000-0000000000e4'::uuid, 'anti_gaspi', 'realisee', 'acceptee', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid),
  ('e5d90000-0000-0000-0000-0000000000c5'::uuid, 'e5d90000-0000-0000-0000-0000000000e5'::uuid, 'anti_gaspi', 'cloturee', 'acceptee', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid),
  ('e5d90000-0000-0000-0000-0000000000c6'::uuid, 'e5d90000-0000-0000-0000-0000000000e6'::uuid, 'anti_gaspi', 'annulee', 'non_envoye', current_date + 10, '21:00', 'e5d90000-0000-0000-0000-0000000000d1'::uuid);
SET LOCAL session_replication_role = origin;

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande) VALUES
  ('e5d90000-0000-0000-0000-0000000000a2'::uuid, 'EVRPLN-T1', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5d90000-0000-0000-0000-0000000000a3'::uuid, 'EVRPLN-T2', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5d90000-0000-0000-0000-0000000000a4'::uuid, 'EVRPLN-T3', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5d90000-0000-0000-0000-0000000000a5'::uuid, 'EVRPLN-T4', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5d90000-0000-0000-0000-0000000000a6'::uuid, 'EVRPLN-T5', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL),
  ('e5d90000-0000-0000-0000-0000000000a7'::uuid, 'EVRPLN-T6', current_date + 10, 'soir', 'e5d90000-0000-0000-0000-0000000000d1'::uuid, 'planifiee', NULL);

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('e5d90000-0000-0000-0000-0000000000c1'::uuid, 'e5d90000-0000-0000-0000-0000000000a2'::uuid, 1),
  ('e5d90000-0000-0000-0000-0000000000c2'::uuid, 'e5d90000-0000-0000-0000-0000000000a3'::uuid, 1),
  ('e5d90000-0000-0000-0000-0000000000c3'::uuid, 'e5d90000-0000-0000-0000-0000000000a4'::uuid, 1),
  ('e5d90000-0000-0000-0000-0000000000c4'::uuid, 'e5d90000-0000-0000-0000-0000000000a5'::uuid, 1),
  ('e5d90000-0000-0000-0000-0000000000c5'::uuid, 'e5d90000-0000-0000-0000-0000000000a6'::uuid, 1),
  ('e5d90000-0000-0000-0000-0000000000c6'::uuid, 'e5d90000-0000-0000-0000-0000000000a7'::uuid, 1);

INSERT INTO plateforme.everest_missions (tournee_id, collecte_id, everest_mission_id, everest_service_id, statut_everest) VALUES
  ('e5d90000-0000-0000-0000-0000000000a2'::uuid, 'e5d90000-0000-0000-0000-0000000000c1'::uuid, NULL, 71, 'creation_failed'),
  ('e5d90000-0000-0000-0000-0000000000a3'::uuid, 'e5d90000-0000-0000-0000-0000000000c2'::uuid, NULL, 71, 'creation_failed'),
  ('e5d90000-0000-0000-0000-0000000000a4'::uuid, 'e5d90000-0000-0000-0000-0000000000c3'::uuid, NULL, 71, 'creation_failed'),
  ('e5d90000-0000-0000-0000-0000000000a5'::uuid, 'e5d90000-0000-0000-0000-0000000000c4'::uuid, NULL, 71, 'creation_failed'),
  ('e5d90000-0000-0000-0000-0000000000a6'::uuid, 'e5d90000-0000-0000-0000-0000000000c5'::uuid, NULL, 71, 'creation_failed'),
  ('e5d90000-0000-0000-0000-0000000000a7'::uuid, 'e5d90000-0000-0000-0000-0000000000c6'::uuid, NULL, 71, 'creation_failed');

-- ── R0 : non-complaisance ────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.collectes c
     JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
     JOIN plateforme.everest_missions m ON m.tournee_id = t.id
    WHERE c.id IN ('e5d90000-0000-0000-0000-0000000000c1'::uuid, 'e5d90000-0000-0000-0000-0000000000c2'::uuid, 'e5d90000-0000-0000-0000-0000000000c3'::uuid, 'e5d90000-0000-0000-0000-0000000000c4'::uuid, 'e5d90000-0000-0000-0000-0000000000c5'::uuid, 'e5d90000-0000-0000-0000-0000000000c6'::uuid)
      AND c.tms_reference IS NULL AND t.external_ref_commande IS NULL
      AND m.statut_everest = 'creation_failed' AND m.manual_acceptance_at IS NULL),
  6, 'R0 avant appel : aucune reference ni trace manuelle posee par les fixtures');

-- ── statut_tms a_attribuer → acceptee ──
SELECT lives_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c1'::uuid, 'EVR-PLN-1', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'S1 depart statut_tms=a_attribuer -> acceptation reussit');
SELECT is(
  (SELECT statut_tms::text FROM plateforme.collectes WHERE id = 'e5d90000-0000-0000-0000-0000000000c1'::uuid),
  'acceptee', 'S1b depart a_attribuer -> statut_tms passe a acceptee');
SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions
    WHERE collecte_id = 'e5d90000-0000-0000-0000-0000000000c1'::uuid AND statut_everest = 'created_manually'
      AND everest_mission_id = 'EVR-PLN-1'),
  1, 'S1c depart a_attribuer -> mission created_manually avec la reference');

-- ── statut_tms attribuee_en_attente_acceptation → acceptee ──
SELECT lives_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c2'::uuid, 'EVR-PLN-2', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'S2 depart statut_tms=attribuee_en_attente_acceptation -> acceptation reussit');
SELECT is(
  (SELECT statut_tms::text FROM plateforme.collectes WHERE id = 'e5d90000-0000-0000-0000-0000000000c2'::uuid),
  'acceptee', 'S2b depart attribuee_en_attente_acceptation -> statut_tms passe a acceptee');
SELECT is(
  (SELECT count(*)::int FROM plateforme.everest_missions
    WHERE collecte_id = 'e5d90000-0000-0000-0000-0000000000c2'::uuid AND statut_everest = 'created_manually'
      AND everest_mission_id = 'EVR-PLN-2'),
  1, 'S2c depart attribuee_en_attente_acceptation -> mission created_manually avec la reference');

-- ── statut=programmee, statut_tms=rejetee_par_prestataire → refus, aucune écriture ──
SELECT throws_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c3'::uuid, 'EVR-PLN-3', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', NULL, 'R3 statut=programmee statut_tms=rejetee_par_prestataire -> refus P0003 (409)');
SELECT throws_like($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c3'::uuid, 'EVR-PLN-3', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'A Toutes! a refusé cette collecte%', 'R3b refus motive par le bon cas');
SELECT is(
  (SELECT c.statut_tms::text || '|' || coalesce(c.tms_reference, '-') || '|' ||
          coalesce(t.external_ref_commande, '-') || '|' || m.statut_everest::text || '|' ||
          coalesce(m.everest_mission_id, '-') || '|' || (m.manual_acceptance_at IS NULL)::text
     FROM plateforme.collectes c
     JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
     JOIN plateforme.everest_missions m ON m.tournee_id = t.id
    WHERE c.id = 'e5d90000-0000-0000-0000-0000000000c3'::uuid),
  'rejetee_par_prestataire|-|-|creation_failed|-|true',
  'R3c aucune ecriture : statut_tms, references et mission inchanges');

-- ── statut=realisee, statut_tms=acceptee → refus, aucune écriture ──
SELECT throws_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c4'::uuid, 'EVR-PLN-4', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', NULL, 'R4 statut=realisee statut_tms=acceptee -> refus P0003 (409)');
SELECT throws_like($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c4'::uuid, 'EVR-PLN-4', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'Collecte terminée ou annulée%', 'R4b refus motive par le bon cas');
SELECT is(
  (SELECT c.statut_tms::text || '|' || coalesce(c.tms_reference, '-') || '|' ||
          coalesce(t.external_ref_commande, '-') || '|' || m.statut_everest::text || '|' ||
          coalesce(m.everest_mission_id, '-') || '|' || (m.manual_acceptance_at IS NULL)::text
     FROM plateforme.collectes c
     JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
     JOIN plateforme.everest_missions m ON m.tournee_id = t.id
    WHERE c.id = 'e5d90000-0000-0000-0000-0000000000c4'::uuid),
  'acceptee|-|-|creation_failed|-|true',
  'R4c aucune ecriture : statut_tms, references et mission inchanges');

-- ── statut=cloturee, statut_tms=acceptee → refus, aucune écriture ──
SELECT throws_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c5'::uuid, 'EVR-PLN-5', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', NULL, 'R5 statut=cloturee statut_tms=acceptee -> refus P0003 (409)');
SELECT throws_like($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c5'::uuid, 'EVR-PLN-5', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'Collecte terminée ou annulée%', 'R5b refus motive par le bon cas');
SELECT is(
  (SELECT c.statut_tms::text || '|' || coalesce(c.tms_reference, '-') || '|' ||
          coalesce(t.external_ref_commande, '-') || '|' || m.statut_everest::text || '|' ||
          coalesce(m.everest_mission_id, '-') || '|' || (m.manual_acceptance_at IS NULL)::text
     FROM plateforme.collectes c
     JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
     JOIN plateforme.everest_missions m ON m.tournee_id = t.id
    WHERE c.id = 'e5d90000-0000-0000-0000-0000000000c5'::uuid),
  'acceptee|-|-|creation_failed|-|true',
  'R5c aucune ecriture : statut_tms, references et mission inchanges');

-- ── statut=annulee, statut_tms=non_envoye → refus, aucune écriture ──
SELECT throws_ok($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c6'::uuid, 'EVR-PLN-6', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'P0003', NULL, 'R6 statut=annulee statut_tms=non_envoye -> refus P0003 (409)');
SELECT throws_like($$ SELECT plateforme.fn_accepter_mission_everest_manuelle('e5d90000-0000-0000-0000-0000000000c6'::uuid, 'EVR-PLN-6', 'Mathieu (A Toutes!)', 'e5d90000-0000-0000-0000-0000000000a1'::uuid, 'ops_savr', NULL, NULL) $$,
  'Collecte terminée ou annulée%', 'R6b refus motive par le bon cas');
SELECT is(
  (SELECT c.statut_tms::text || '|' || coalesce(c.tms_reference, '-') || '|' ||
          coalesce(t.external_ref_commande, '-') || '|' || m.statut_everest::text || '|' ||
          coalesce(m.everest_mission_id, '-') || '|' || (m.manual_acceptance_at IS NULL)::text
     FROM plateforme.collectes c
     JOIN plateforme.collecte_tournees ct ON ct.collecte_id = c.id
     JOIN plateforme.tournees t ON t.id = ct.tournee_id
     JOIN plateforme.everest_missions m ON m.tournee_id = t.id
    WHERE c.id = 'e5d90000-0000-0000-0000-0000000000c6'::uuid),
  'non_envoye|-|-|creation_failed|-|true',
  'R6c aucune ecriture : statut_tms, references et mission inchanges');

-- ── Aucune trace MANUAL_ACCEPT pour les refus ────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
    WHERE action = 'MANUAL_ACCEPT'
      AND (new_values->>'collecte_id')::uuid IN ('e5d90000-0000-0000-0000-0000000000c3'::uuid, 'e5d90000-0000-0000-0000-0000000000c4'::uuid, 'e5d90000-0000-0000-0000-0000000000c5'::uuid, 'e5d90000-0000-0000-0000-0000000000c6'::uuid)),
  0, 'R7 aucun refus ne laisse de trace MANUAL_ACCEPT');

SELECT * FROM finish();
ROLLBACK;
