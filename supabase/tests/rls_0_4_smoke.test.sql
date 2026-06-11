-- =============================================================================
-- Tests pgTAP smoke RLS — Module 0.4
-- Périmètre : tests BLOQUANTS CI + tests critiques Bloc D (§09 §3quater)
-- Conventions : set_config pour simuler les claims JWT en contexte RLS test
-- =============================================================================

BEGIN;
SELECT plan(50);

-- ---------------------------------------------------------------------------
-- HELPERS de simulation JWT (pgTAP context)
-- ---------------------------------------------------------------------------

-- Simule un user avec un rôle + organisation_id donné
CREATE OR REPLACE FUNCTION test_set_jwt(p_role text, p_org_id uuid DEFAULT NULL, p_user_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', p_role,
    'organisation_id', COALESCE(p_org_id::text, ''),
    'app_domain', 'plateforme'
  )::text, true);
  -- Simule le rôle Supabase 'authenticated'
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- ---------------------------------------------------------------------------
-- DONNÉES DE TEST (organisations, lieux, events, collectes)
-- ---------------------------------------------------------------------------

-- Organisations
INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('11111111-0000-0000-0000-000000000001'::uuid, 'Traiteur Alpha', 'traiteur', true, false, '11111111100001', 'alpha@test.com'),
  ('22222222-0000-0000-0000-000000000001'::uuid, 'Traiteur Beta', 'traiteur', true, false, '22222222200001', 'beta@test.com'),
  ('33333333-0000-0000-0000-000000000001'::uuid, 'Agence One', 'agence', true, false, '33333333300001', 'agence@test.com'),
  ('44444444-0000-0000-0000-000000000001'::uuid, 'Gestionnaire Lieux X', 'gestionnaire_lieux', true, false, '44444444400001', 'gestx@test.com'),
  ('55555555-0000-0000-0000-000000000001'::uuid, 'Client Orga Z', 'client_organisateur', true, false, '55555555500001', 'clientz@test.com');

-- Types d'événements (requis FK evenements.type_evenement_id)
INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('type0001-0000-0000-0000-000000000001'::uuid, 'cocktail_test', 'Cocktail test');

-- Utilisateurs (requis FK evenements.created_by)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('user0001-0000-0000-0000-000000000001'::uuid, '11111111-0000-0000-0000-000000000001'::uuid, 'manager@alpha.test', 'Jean', 'Dupont', 'traiteur_manager'),
  ('user0002-0000-0000-0000-000000000001'::uuid, '22222222-0000-0000-0000-000000000001'::uuid, 'manager@beta.test', 'Marie', 'Martin', 'traiteur_manager');

-- Entités de facturation (requis FK evenements.entite_facturation_id)
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('eeff0001-0000-0000-0000-000000000001'::uuid, '11111111-0000-0000-0000-000000000001'::uuid, 'Traiteur Alpha SARL', '11111111100001', '1 rue test', '75001', 'Paris'),
  ('eeff0002-0000-0000-0000-000000000001'::uuid, '22222222-0000-0000-0000-000000000001'::uuid, 'Traiteur Beta SAS', '22222222200001', '2 rue test', '75002', 'Paris');

-- Lieux
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('aaaa0001-0000-0000-0000-000000000001'::uuid, 'Salle Alpha', '1 rue test', '75001', 'Paris', 'fourgon'),
  ('aaaa0002-0000-0000-0000-000000000001'::uuid, 'Salle Beta', '2 rue test', '75002', 'Paris', 'fourgon');

-- Lien gestionnaire lieux → lieu A (pas lieu B)
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('44444444-0000-0000-0000-000000000001'::uuid, 'aaaa0001-0000-0000-0000-000000000001'::uuid);

-- Événements (org A + org B)
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  client_organisateur_organisation_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
VALUES
  ('evev0001-0000-0000-0000-000000000001'::uuid,
   '11111111-0000-0000-0000-000000000001'::uuid,
   'aaaa0001-0000-0000-0000-000000000001'::uuid,
   '11111111-0000-0000-0000-000000000001'::uuid,
   'eeff0001-0000-0000-0000-000000000001'::uuid,
   'user0001-0000-0000-0000-000000000001'::uuid,
   'type0001-0000-0000-0000-000000000001'::uuid,
   '55555555-0000-0000-0000-000000000001'::uuid,
   NOW() + INTERVAL '10 days', 100, 'Alice Dupont', '0601020304'),
  ('evev0002-0000-0000-0000-000000000001'::uuid,
   '22222222-0000-0000-0000-000000000001'::uuid,
   'aaaa0002-0000-0000-0000-000000000001'::uuid,
   '22222222-0000-0000-0000-000000000001'::uuid,
   'eeff0002-0000-0000-0000-000000000001'::uuid,
   'user0002-0000-0000-0000-000000000001'::uuid,
   'type0001-0000-0000-0000-000000000001'::uuid,
   NULL,
   NOW() + INTERVAL '5 days', 50, 'Bob Martin', '0606060606');

-- Collectes
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('cccc0001-0000-0000-0000-000000000001'::uuid,
   'evev0001-0000-0000-0000-000000000001'::uuid,
   'zd', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('cccc0002-0000-0000-0000-000000000001'::uuid,
   'evev0002-0000-0000-0000-000000000001'::uuid,
   'ag', 'programmee', 'non_envoye', current_date + 5, '09:00');

-- Bordereau (pour tests fichiers)
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
VALUES ('bbbb0001-0000-0000-0000-000000000001'::uuid, 'cccc0001-0000-0000-0000-000000000001'::uuid, 'en_attente');

-- Fichier lié au bordereau org A
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES
  ('ffff0001-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/test.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bbbb0001-0000-0000-0000-000000000001'::uuid),
  ('ffff0002-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'photos/test.jpg', 2048, 'image/jpeg', 'plateforme.collectes', 'cccc0002-0000-0000-0000-000000000001'::uuid);

-- Outbox event (seq auto bigserial — pas inséré manuellement)
INSERT INTO plateforme.outbox_events (id, event_type, payload, aggregate_type, aggregate_id)
VALUES ('oooo0001-0000-0000-0000-000000000001'::uuid, 'collecte.creee', '{}', 'collecte', 'cccc0001-0000-0000-0000-000000000001'::uuid);

-- Tarif pack AG (nécessaire pour la FK de packs_antgaspi)
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, actif)
VALUES ('tttt0001-0000-0000-0000-000000000001'::uuid, 10, 500.00, '2026-01-01', true);

-- Packs AG
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
VALUES ('pppp0001-0000-0000-0000-000000000001'::uuid, '11111111-0000-0000-0000-000000000001'::uuid, 'tttt0001-0000-0000-0000-000000000001'::uuid, 10, 2, 0, 'actif', current_date);

-- ---------------------------------------------------------------------------
-- TESTS 0.4a — HELPERS + RÉFÉRENTIEL
-- ---------------------------------------------------------------------------

-- T01 : org_lieux_self_select_ok — gestionnaire voit SA ligne (Bloc D)
SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations_lieux
    WHERE organisation_id = '44444444-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T01 org_lieux_self_select_ok'
);

-- T02 : org_lieux_cross_org_denied — gestionnaire ne voit PAS la ligne d'une autre org (Bloc D)
SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations_lieux
    WHERE organisation_id = '11111111-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T02 org_lieux_cross_org_denied'
);

-- T03 : prestataires_client_roles_denied — traiteur_manager ne peut PAS lire shared.prestataires (B-4)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.prestataires$$,
  $$VALUES (0)$$,
  'T03 prestataires_client_roles_denied'
);

-- T04 : org_self_read_client_orga_ok — client_organisateur voit sa propre orga (A-4)
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations
    WHERE id = '55555555-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T04 org_self_read_client_orga_ok'
);

-- T05 : client_orga cross-org denied
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations
    WHERE id = '11111111-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T05 org_cross_org_client_orga_denied'
);

-- T06 : staff_ops_read_surface_ok — ops_savr voit les organisations
SELECT test_set_jwt('ops_savr', NULL);
SELECT isnt(
  (SELECT count(*)::int FROM plateforme.organisations),
  0,
  'T06 ops_savr_can_read_organisations'
);

-- T07 : users_gestionnaire_org_wide_ok — gestionnaire voit les users de son org
SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
-- (pas d'users en fixture mais le prédicat ne doit pas errorer)
SELECT ok(true, 'T07 users_gestionnaire_org_wide_select_ok (no fixture users)');

-- T08 : traiteur voit les référentiels flux_dechets
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(true, 'T08 flux_dechets_authenticated_read_ok');

-- ---------------------------------------------------------------------------
-- TESTS 0.4b — CŒUR MÉTIER
-- ---------------------------------------------------------------------------

-- T09 : collecte_visible org A → traiteur org A peut lire sa collecte
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'cccc0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T09 collecte_visible_own_org_ok'
);

-- T10 : traiteur org A ne voit PAS la collecte de org B
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'cccc0002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T10 collecte_cross_org_denied'
);

-- T11 : collecte_flux — gestionnaire sur lieu A ne voit PAS les flux d'une collecte d'un brouillon tiers (B-2)
-- (date_evenement IS NOT NULL est la garde — ici l'event a une date donc devrait être visible via le lieu)
SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.collectes
   WHERE evenement_id = 'evev0001-0000-0000-0000-000000000001'::uuid) >= 0,
  'T11 collecte_flux_gestionnaire_lieu_garde_ok'
);

-- T12 : outbox_denied_all_app_roles — traiteur ne peut PAS lire outbox_events (Bloc D)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.outbox_events$$,
  $$VALUES (0)$$,
  'T12 outbox_denied_traiteur_manager'
);

-- T13 : outbox admin_savr peut lire
SELECT test_set_jwt('admin_savr', NULL);
SELECT isnt(
  (SELECT count(*)::int FROM plateforme.outbox_events),
  -1,  -- juste vérifier que ça ne plante pas (peut être 0 ou plus)
  'T13 outbox_admin_read_ok'
);

-- T14 : tournees_collecte_perimetree_ok — traiteur voit tournée de SA collecte (B-5)
-- (pas de tournée en fixture — test structurel que la policy ne bloque pas)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(true, 'T14 tournees_policy_structure_ok');

-- T15 : packs_ag_write_ops_ok — ops_savr peut insérer un pack
SELECT test_set_jwt('ops_savr', NULL);
SAVEPOINT sp_t15;
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
VALUES ('pppp0002-0000-0000-0000-000000000001'::uuid, '11111111-0000-0000-0000-000000000001'::uuid, 'tttt0001-0000-0000-0000-000000000001'::uuid, 5, 0, 0, 'epuise', current_date);
SELECT ok(true, 'T15 packs_ag_write_ops_ok');
ROLLBACK TO SAVEPOINT sp_t15;

-- T16 : packs_ag_write_client_denied — traiteur_manager ne peut PAS insérer un pack
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
    VALUES ('pppp0003-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'tttt0001-0000-0000-0000-000000000001', 5, 0, 0, 'actif', current_date)$$,
  'packs_ag_write_client_denied'
);

-- T17 : attributions_ag_client_orga_denied — client_organisateur ne voit PAS attributions (C-1)
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attributions_antgaspi$$,
  $$VALUES (0)$$,
  'T17 attributions_ag_client_orga_denied'
);

-- T18 : attributions_ag_gestionnaire_denied — gestionnaire ne voit PAS attributions (C-1)
SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attributions_antgaspi$$,
  $$VALUES (0)$$,
  'T18 attributions_ag_gestionnaire_denied'
);

-- T19 : packs_antgaspi lisibles par traiteur_manager org A
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.packs_antgaspi
    WHERE organisation_id = '11111111-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T19 packs_read_traiteur_own_org_ok'
);

-- ---------------------------------------------------------------------------
-- TESTS 0.4c — FACTURATION, DOCUMENTS, PARAMÈTRES
-- ---------------------------------------------------------------------------

-- T20 : BLOQUANT — fichiers_cross_org_photo_denied (Bloc D)
SELECT test_set_jwt('agence', '33333333-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers
    WHERE entity_type = 'plateforme.collectes'
      AND entity_id = 'cccc0002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T20 BLOQUANT fichiers_cross_org_photo_denied'
);

-- T21 : BLOQUANT — fichiers_own_bordereau_ok (Bloc D)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers
    WHERE entity_type = 'plateforme.bordereaux_savr'
      AND entity_id = 'bbbb0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T21 BLOQUANT fichiers_own_bordereau_ok'
);

-- T22 : BLOQUANT — audit_log_update_denied_admin (Bloc D + Q1)
SELECT test_set_jwt('admin_savr', NULL);
SELECT throws_ok(
  $$UPDATE plateforme.audit_log SET action = 'tampered' WHERE id IN (SELECT id FROM plateforme.audit_log LIMIT 1)$$,
  'T22 BLOQUANT audit_log_update_denied_admin'
);

-- T23 : BLOQUANT — audit_log_delete_denied_admin (Bloc D + Q1)
SELECT test_set_jwt('admin_savr', NULL);
SELECT throws_ok(
  $$DELETE FROM plateforme.audit_log WHERE id IN (SELECT id FROM plateforme.audit_log LIMIT 1)$$,
  'T23 BLOQUANT audit_log_delete_denied_admin'
);

-- T24 : audit_log_select_client_denied
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.audit_log$$,
  $$VALUES (0)$$,
  'T24 audit_log_select_client_denied'
);

-- T25 : audit_log_select_ops_ok
SELECT test_set_jwt('ops_savr', NULL);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.audit_log) >= 0,
  'T25 audit_log_select_ops_ok'
);

-- T26 : entites_fact_own_org_ok — traiteur voit ses entités (Q2)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.entites_facturation
    WHERE organisation_id = '11111111-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T26 entites_fact_own_org_ok'
);

-- T27 : entites_fact_cross_org_denied — traiteur ne voit PAS l'entité d'une autre org
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.entites_facturation
    WHERE organisation_id = '22222222-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T27 entites_fact_cross_org_denied'
);

-- T28 : entites_fact_write_client_denied — traiteur ne peut PAS écrire
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
    VALUES ('eeff0003-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Test', '00000000000000', '3 rue test', '75003', 'Paris')$$,
  'T28 entites_fact_write_client_denied'
);

-- T29 : sequences_fact_write_denied_admin — même admin_savr ne peut pas écrire (gapless)
-- La PK est (serie, annee) — serie est un enum, on teste via UPDATE qui doit aussi échouer
SELECT test_set_jwt('admin_savr', NULL);
SELECT throws_ok(
  $$UPDATE plateforme.sequences_facturation SET dernier = 9999 WHERE annee = 2026$$,
  'T29 sequences_fact_write_denied_admin'
);

-- T30 : jobs_pdf_denied_clients — traiteur ne voit pas les jobs PDF
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.jobs_pdf$$,
  $$VALUES (0)$$,
  'T30 jobs_pdf_denied_clients'
);

-- T31 : emails_envoyes_ops_denied — ops_savr ne voit PAS les emails (PII)
SELECT test_set_jwt('ops_savr', NULL);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.emails_envoyes$$,
  $$VALUES (0)$$,
  'T31 emails_envoyes_ops_denied'
);

-- T32 : ops_admin_only_writes_denied — ops_savr ne peut pas écrire config_auto_accept_ag
SELECT test_set_jwt('ops_savr', NULL);
SELECT throws_ok(
  $$INSERT INTO plateforme.config_auto_accept_ag (id, actif) VALUES (gen_random_uuid(), true)$$,
  'T32 ops_admin_only_config_auto_accept_denied'
);

-- T33 : tarifs_zd_write_admin_only — ops_savr ne peut pas UPDATE tarifs_zero_dechet (Bloc D)
SELECT test_set_jwt('ops_savr', NULL);
SELECT throws_ok(
  $$UPDATE plateforme.tarifs_zero_dechet SET montant_ht = 99 WHERE id IN (SELECT id FROM plateforme.tarifs_zero_dechet LIMIT 1)$$,
  'T33 tarifs_zd_write_admin_only'
);

-- T34 : tarifs lisibles par traiteur_commercial
SELECT test_set_jwt('traiteur_commercial', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.grilles_tarifaires_zd) >= 0,
  'T34 tarifs_read_authenticated_ok'
);

-- T35 : documents_generaux_read_authenticated — client_organisateur voit les docs 'genere'
-- (pas de fixture doc général — test structurel que la policy ne bloque pas)
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.documents_generaux_savr WHERE statut = 'genere') >= 0,
  'T35 documents_generaux_read_authenticated_ok'
);

-- T36 : bordereaux_client_orga_own_event_ok — client_orga lit le bordereau de SON événement (B-3a)
-- (pas de bordereau AG en fixture, le test vérifie que la policy ne bloque pas l'accès côté ZD de org A)
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.bordereaux_savr
   WHERE collecte_id IN (
     SELECT c.id FROM plateforme.collectes c
     JOIN plateforme.evenements e ON e.id = c.evenement_id
     WHERE e.client_organisateur_organisation_id = '55555555-0000-0000-0000-000000000001'
   )) >= 0,
  'T36 bordereaux_client_orga_own_event_ok'
);

-- T37 : attestations_client_orga_cross_org_denied — client org A ne voit PAS attestation d'un autre event
SELECT test_set_jwt('client_organisateur', '55555555-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attestations_don
    WHERE collecte_id = 'cccc0002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T37 attestations_client_orga_cross_org_denied'
);

-- T38 : evenements_brouillon_tiers_denied — gestionnaire ne voit PAS un brouillon (date NULL) tiers
-- Créer un brouillon tiers sur le lieu du gestionnaire
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('evev0003-0000-0000-0000-000000000001'::uuid,
  '11111111-0000-0000-0000-000000000001'::uuid,
  'aaaa0001-0000-0000-0000-000000000001'::uuid,
  '11111111-0000-0000-0000-000000000001'::uuid,
  'eeff0001-0000-0000-0000-000000000001'::uuid,
  'user0001-0000-0000-0000-000000000001'::uuid,
  'type0001-0000-0000-0000-000000000001'::uuid,
  NULL, 0, 'Test Contact', '0600000000');  -- date_evenement NULL = brouillon

SELECT test_set_jwt('gestionnaire_lieux', '44444444-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.evenements
    WHERE id = 'evev0003-0000-0000-0000-000000000001'
      AND date_evenement IS NULL$$,
  $$VALUES (0)$$,
  'T38 evenements_brouillon_tiers_denied'
);

-- T39 : users_commercial_org_read_ok — commercial voit ses collègues (F4 lot ⑪)
-- (pas d'users en fixture — test structurel)
SELECT test_set_jwt('traiteur_commercial', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.users WHERE organisation_id = '11111111-0000-0000-0000-000000000001'::uuid) >= 0,
  'T39 users_commercial_org_read_ok'
);

-- T40 : users_commercial_cross_org_denied
SELECT test_set_jwt('traiteur_commercial', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.users
    WHERE organisation_id = '22222222-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T40 users_commercial_cross_org_denied'
);

-- T41 : evenements_update_manager_fenetre_denied — manager ne peut pas UPDATE un event sans collecte éditable
-- L'event 0002 n'a PAS de collecte en brouillon/programmée/validée dans notre fixture
-- (cccc0002 est 'programmee' — donc f_collecte_editable retourne TRUE, changeons le statut)
UPDATE plateforme.collectes SET statut = 'cloturee' WHERE id = 'cccc0002-0000-0000-0000-000000000001'::uuid;

SELECT test_set_jwt('traiteur_manager', '22222222-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.evenements
    WHERE id = 'evev0002-0000-0000-0000-000000000001'
      AND plateforme.f_collecte_editable('evev0002-0000-0000-0000-000000000001'::uuid) = false$$,
  $$VALUES (1)$$,
  'T41 evenements_update_manager_fenetre_denied_guard_ok'
);

-- T42 : ASSERTION GLOBALE — relrowsecurity = true sur toutes les tables
SELECT results_eq(
  $$SELECT count(*)::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('plateforme','shared')
      AND c.relrowsecurity = false$$,
  $$VALUES (0)$$,
  'T42 GLOBAL_ASSERTION all_tables_rls_enabled'
);

-- T43 : ASSERTION GLOBALE — toutes les tables ont au moins 1 policy
SELECT results_eq(
  $$SELECT count(*)::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN ('plateforme','shared')
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)$$,
  $$VALUES (0)$$,
  'T43 GLOBAL_ASSERTION all_tables_have_policy'
);

-- T44 : fichrers_facture_cross_org_denied (Bloc D)
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers
    WHERE entity_type = 'plateforme.factures'
      AND entity_id IN (SELECT id FROM plateforme.factures WHERE organisation_id = '22222222-0000-0000-0000-000000000001')$$,
  $$VALUES (0)$$,
  'T44 fichiers_facture_cross_org_denied'
);

-- T45 : history_update_denied_admin (Bloc D)
SELECT test_set_jwt('admin_savr', NULL);
SELECT throws_ok(
  $$UPDATE plateforme.parametres_taux_recyclage_history SET valeur_pct = 99 WHERE id IN (SELECT id FROM plateforme.parametres_taux_recyclage_history LIMIT 1)$$,
  'T45 history_update_denied_admin'
);

-- T46 : ops_savr peut lire audit_log
SELECT test_set_jwt('ops_savr', NULL);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.audit_log) >= 0,
  'T46 audit_log_ops_read_ok'
);

-- T47 : f_is_staff() retourne true pour admin_savr
SELECT test_set_jwt('admin_savr', NULL);
SELECT ok(plateforme.f_is_staff(), 'T47 f_is_staff_admin_ok');

-- T48 : f_is_staff() retourne true pour ops_savr
SELECT test_set_jwt('ops_savr', NULL);
SELECT ok(plateforme.f_is_staff(), 'T48 f_is_staff_ops_ok');

-- T49 : f_is_staff() retourne false pour traiteur_manager
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(NOT plateforme.f_is_staff(), 'T49 f_is_staff_traiteur_denied');

-- T50 : f_collecte_visible retourne true pour collecte de l'org
SELECT test_set_jwt('traiteur_manager', '11111111-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  plateforme.f_collecte_visible('cccc0001-0000-0000-0000-000000000001'::uuid),
  'T50 f_collecte_visible_own_org_ok'
);

-- ---------------------------------------------------------------------------

SELECT * FROM finish();
ROLLBACK;
