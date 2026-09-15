-- =============================================================================
-- M1.2 / M1.5a — Édition événement + collecte par les rôles programmateurs.
-- Décision produit Val 2026-06-26. Prouve sous rôle `authenticated` :
--   • écriture directe de `evenements` ET de `collectes` fermée à `authenticated`
--     (2026-09-15) : les policies evt_*_update / col_update_* subsistent mais sont
--     inertes, le privilège UPDATE ayant été retiré des deux tables — preuve par
--     rôle dans SECU__evenements_ecriture_client_fermee.test.sql et
--     SECU__collectes_ecriture_client_fermee.test.sql.
--   • fn_modifier_evenement (service_role) : E2 par collecte dispatchée + recalcul
--     volume_estime_repas sur changement de pax + pas d'E2 pour champ non-TMS / non
--     dispatché (garde-fou 4 transactional outbox).
-- =============================================================================

BEGIN;
SELECT plan(6);

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
  ('cc000000-0000-0000-0000-0000000000f1'::uuid, '0e000000-0000-0000-0000-0000000000f1'::uuid, 'anti_gaspi', 'validee', 'acceptee', current_date + 10, '08:00', NULL),
  ('cc000000-0000-0000-0000-0000000000f2'::uuid, '0e000000-0000-0000-0000-0000000000f2'::uuid, 'anti_gaspi', 'validee', 'acceptee', current_date + 10, '08:00', NULL);

-- « Dispatchée » (cas T14/T16) = une commande existe chez le prestataire, soit une
-- tournée avec `external_ref_commande` liée par `collecte_tournees` — l'état que
-- l'adapter écrit réellement. Depuis le 2026-09-15, c'est ce que lit le gate E2 ;
-- `collectes.tms_reference` (ex-fixture 'MTS-DISP-1') n'est écrite par aucun code de
-- production et ne gate plus rien. cc..f2 reste sans commande → c'est le cas T17.
INSERT INTO shared.prestataires (id, nom, code, type_prestation, mode_integration, statut) VALUES
  ('cc000000-0000-0000-0000-0000000000d0'::uuid, 'Presta EditionEvt', 'EDITEVT', ARRAY['zd','ag'], 'manuel', 'actif');

INSERT INTO plateforme.tournees (id, reference_interne, date_tournee, creneau, prestataire_logistique_id, statut, external_ref_commande) VALUES
  ('cc000000-0000-0000-0000-0000000000a5'::uuid, 'EDITEVT-TOUR-F1', current_date + 10, 'nuit', 'cc000000-0000-0000-0000-0000000000d0'::uuid, 'en_cours', 'CMD-EDITEVT-F1');

INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang) VALUES
  ('cc000000-0000-0000-0000-0000000000f1'::uuid, 'cc000000-0000-0000-0000-0000000000a5'::uuid, 1);

-- ── Écriture directe de `evenements` : fermée depuis 2026-09-15 ─────────────
-- Les ex-T1 à T9 prouvaient ici que evt_manager_update / evt_commercial_update /
-- evt_agence_update / evt_gestionnaire_update laissaient les 4 rôles éditer
-- l'événement de leur périmètre par PATCH PostgREST direct, et que la fenêtre
-- f_collecte_editable fermait l'édition dès `en_cours`. La migration
-- 20260915190000 a retiré INSERT, UPDATE et DELETE du GRANT table-level de
-- `authenticated` : ces écritures lèvent désormais 42501 AVANT toute évaluation
-- RLS, et toute édition d'événement passe par les routes API (service_role), qui
-- seules émettent l'outbox E2 via fn_modifier_evenement, tracent l'audit_log et
-- appliquent la matrice de rôles §09.
--
-- Même traitement que les ex-T10 à T13 ci-dessous (migration 20260915160000 sur
-- `collectes`) : les policies restent en place mais inertes, le détail par rôle
-- (les 4 refus 42501 + le refus d'INSERT + de DELETE + la non-régression de la
-- lecture) est prouvé dans SECU__evenements_ecriture_client_fermee.test.sql, et
-- on garde ici le seul cliquet utile au périmètre de ce fichier : le privilège ne
-- doit pas revenir. Les GARDES fonctionnelles correspondantes (périmètre par rôle,
-- fenêtre d'édition) vivent désormais dans la route et sont couvertes par
-- packages/plateforme/tests/api/programmation/edition-evenement.m1-2.test.ts.
SELECT test_as_superuser();
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.evenements', 'UPDATE'),
  'T1 edition evenement par PATCH direct fermee (privilege UPDATE retire)'
);

-- ── Écriture directe de `collectes` : fermée depuis 2026-09-15 ───────────────
-- Les ex-T10 à T13 prouvaient ici que col_update_client / col_update_commercial
-- laissaient les 4 rôles éditer leur collecte par PATCH PostgREST direct. La
-- migration 20260915160000 a retiré UPDATE et INSERT du GRANT table-level de
-- `authenticated` : ces écritures lèvent désormais 42501 AVANT toute évaluation
-- RLS, et toute édition de collecte passe par les routes API (service_role), qui
-- seules émettent l'outbox, tracent l'audit_log et posent dirty_tms.
--
-- Les policies restent en place mais inertes ; le détail par rôle (les 4 refus
-- 42501 + le refus d'INSERT + la non-régression de la lecture) est prouvé dans
-- SECU__collectes_ecriture_client_fermee.test.sql. On garde ici le seul cliquet
-- utile au périmètre de ce fichier : le privilège ne doit pas revenir.
-- Le cloisonnement cross-org en lecture (ex-T12) reste couvert par col_select
-- (rls_0_4_smoke) ; en écriture il est désormais sans objet, plus aucun rôle
-- client ne pouvant écrire `collectes`.
SELECT test_as_superuser();
SELECT ok(
  NOT has_table_privilege('authenticated', 'plateforme.collectes', 'UPDATE'),
  'T10 edition collecte par PATCH direct fermee (privilege UPDATE retire)'
);

-- ── fn_modifier_evenement (service_role / SECURITY DEFINER) ──────────────────
-- T14 E2 émis pour la collecte AG dispatchée (une commande existe) sur édition pax.
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

-- T17 pas d'E2 pour une collecte non dispatchée (aucune commande) malgré pax.
SELECT plateforme.fn_modifier_evenement(
  '0e000000-0000-0000-0000-0000000000f2'::uuid, '{"pax": 400}'::jsonb, ARRAY['pax']);
SELECT is(
  (SELECT count(*)::int FROM plateforme.outbox_events
     WHERE aggregate_id = 'cc000000-0000-0000-0000-0000000000f2'::uuid
       AND event_type = 'collecte.modifiee'),
  0, 'T17 pas d''E2 pour collecte non dispatchee (aucune commande chez le prestataire)');

SELECT * FROM finish();
ROLLBACK;
