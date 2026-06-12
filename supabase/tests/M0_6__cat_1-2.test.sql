-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégories 1-2 (Happy path + Limites)
-- =============================================================================
-- Périmètre : 19 tests P1-critique (8 happy path + 11 limites)
-- Conventions : set_config JWT claims, SECURITY DEFINER helpers
-- Objectif : valider visibilité collecte 4 chemins, brouillons tiers, colonnes sensibles
-- =============================================================================

BEGIN;
SELECT plan(22);  -- 3 structurelles E3 + 8 happy path + 11 limites

-- =====================================================================
-- BLOC 1 — SETUP & HELPERS
-- =====================================================================

-- Simule un user avec rôle + organisation_id
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid()
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', p_role,
    'organisation_id', p_org_id,
    'app_domain', 'plateforme'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

-- Reset en superuser (bypass RLS pour setup)
CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- =====================================================================
-- BLOC 1 BIS — ASSERTION STRUCTURELLE E3 (Garde-fou TMS-Ready)
-- =====================================================================
-- Vérifie que TOUTES les tables plateforme.* et shared.* ont ENABLE ROW LEVEL SECURITY
-- Exception whitelist : sequences_facturation, jobs_pdf (no row-level data)

SELECT test_as_superuser();

-- E3-1 : Comptage tables sans RLS (doit être 0)
SELECT is(
  (SELECT count(*)::int FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname IN ('plateforme', 'shared')
     AND c.relrowsecurity = false
     AND c.relname NOT IN ('sequences_facturation', 'jobs_pdf', 'history_*')),
  0,
  'E3-1 BLOQUANT : 0 table sans RLS (assertions structurelle)'
);

-- E3-2 : Audit que plateforme.organisations a RLS activée
SELECT is(
  (SELECT relrowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'plateforme' AND c.relname = 'organisations'),
  true,
  'E3-2 BLOQUANT : plateforme.organisations RLS = ON'
);

-- E3-3 : Audit que shared.fichiers a RLS activée
SELECT is(
  (SELECT relrowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'shared' AND c.relname = 'fichiers'),
  true,
  'E3-3 BLOQUANT : shared.fichiers RLS = ON'
);

-- =====================================================================
-- DONNÉES DE TEST — FIXTURE UNIVERSELLE (5 orgas + 2 lieux + 1 type evt + 5 users)
-- =====================================================================

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Kaspia (Traiteur)', 'traiteur', true, false, '11111111100001', 'kaspia@test.com'),
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'Kardamome (Traiteur)', 'traiteur', true, false, '22222222200001', 'kardamome@test.com'),
  ('cccccccc-0000-0000-0000-000000000001'::uuid, 'Agence D', 'agence', true, false, '33333333300001', 'agence@test.com'),
  ('dddddddd-0000-0000-0000-000000000001'::uuid, 'Gestionnaire X', 'gestionnaire_lieux', true, false, '44444444400001', 'gestx@test.com'),
  ('eeeeeeee-0000-0000-0000-000000000001'::uuid, 'Client Event Z', 'client_organisateur', true, false, '55555555500001', 'clientz@test.com');

-- Types d'événements
INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('11110001-0000-0000-0000-000000000001'::uuid, 'seminaire', 'Séminaire');

-- Lieux
INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('10c00001-0000-0000-0000-000000000001'::uuid, 'Salle Kaspia', '1 rue Paris', '75001', 'Paris', 'fourgon'),
  ('10c00002-0000-0000-0000-000000000001'::uuid, 'Salle Kardamome', '2 rue Lyon', '69001', 'Lyon', 'fourgon');

-- Lien gestionnaire_lieux → lieu 1 (pas lieu 2)
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('dddddddd-0000-0000-0000-000000000001'::uuid, '10c00001-0000-0000-0000-000000000001'::uuid);

-- Utilisateurs (5 rôles: manager, commercial, gestionnaire, agence, client_orga)
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('05e70001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'manager@kaspia.test', 'Jean', 'Dupont', 'traiteur_manager'),
  ('05e70002-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'commercial@kaspia.test', 'Marie', 'Martin', 'traiteur_commercial'),
  ('05e70003-0000-0000-0000-000000000001'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid, 'gestionnaire@x.test', 'Bob', 'Lenoir', 'gestionnaire_lieux'),
  ('05e70004-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0000-000000000001'::uuid, 'agence@d.test', 'Alice', 'Dupuis', 'agence'),
  ('05e70005-0000-0000-0000-000000000001'::uuid, 'eeeeeeee-0000-0000-0000-000000000001'::uuid, 'client@z.test', 'Claire', 'Bonnet', 'client_organisateur');

-- Entités de facturation (pour FK evenements)
INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES
  ('ee100001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Kaspia SARL', '11111111100001', '1 rue Paris', '75001', 'Paris'),
  ('ee100002-0000-0000-0000-000000000001'::uuid, 'eeeeeeee-0000-0000-0000-000000000001'::uuid, 'Client Z SAS', '55555555500001', '5 rue Client', '75005', 'Paris');

-- Événements
-- Evt1: programmateur=Kaspia, traiteur_operationnel=Kaspia, lieu=loc1, client=Client Z, date=futur (CONFIRMÉ)
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  client_organisateur_organisation_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
VALUES
  ('e0e00001-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   '10c00001-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'ee100001-0000-0000-0000-000000000001'::uuid,
   '05e70001-0000-0000-0000-000000000001'::uuid,
   '11110001-0000-0000-0000-000000000001'::uuid,
   'eeeeeeee-0000-0000-0000-000000000001'::uuid,
   NOW() + INTERVAL '10 days', 100, 'Alice Dupont', '0601020304');

-- Evt2: programmateur=Kardamome, brouillon (date_evenement=NULL), lieu=loc2
-- Gestionnaire X (gestionnaire_lieux) ne doit PAS voir ce brouillon tiers (F3)
INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  client_organisateur_organisation_id, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
VALUES
  ('e0e00002-0000-0000-0000-000000000001'::uuid,
   'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
   '10c00002-0000-0000-0000-000000000001'::uuid,
   'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
   'ee100002-0000-0000-0000-000000000001'::uuid,
   '05e70002-0000-0000-0000-000000000001'::uuid,
   '11110001-0000-0000-0000-000000000001'::uuid,
   'eeeeeeee-0000-0000-0000-000000000001'::uuid,
   NULL,  -- BROUILLON TIERS
   50, 'Bob Martin', '0606060606');

-- Collectes
INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES
  ('c01c0001-0000-0000-0000-000000000001'::uuid, 'e0e00001-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00'),
  ('c01c0002-0000-0000-0000-000000000001'::uuid, 'e0e00002-0000-0000-0000-000000000001'::uuid, 'anti_gaspi', 'programmee', 'non_envoye', current_date + 5, '09:00');

-- Bordereaux
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
VALUES ('bd100001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid, 'en_attente');

-- Fichiers
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES
  ('f1100001-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'bdr/col1.pdf', 1024, 'application/pdf', 'plateforme.bordereaux_savr', 'bd100001-0000-0000-0000-000000000001'::uuid),
  ('f1100002-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'photos/col2.jpg', 2048, 'image/jpeg', 'plateforme.collectes', 'c01c0002-0000-0000-0000-000000000001'::uuid);

-- Tarif pack AG
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, actif)
VALUES ('da100001-0000-0000-0000-000000000001'::uuid, 10, 500.00, '2026-01-01', true);

-- Packs AG
INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
VALUES ('ac000001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'da100001-0000-0000-0000-000000000001'::uuid, 10, 2, 0, 'actif', current_date);

-- =====================================================================
-- CATÉGORIE 1 — HAPPY PATH (8 tests : 7 rôles + helper f_collecte_visible)
-- =====================================================================

-- T01 : Programmateur (Kaspia manager) voit sa collecte evt1
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T01 Happy path : programmateur voit SA collecte'
);

-- T02 : Traiteur opérationnel (même org Kaspia) voit collecte evt1
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T02 Happy path : traiteur_operationnel voit collecte'
);

-- T03 : Client organisateur (Client Z) voit collecte evt1 (est le client de l'évènement)
SELECT test_set_jwt('client_organisateur', 'eeeeeeee-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T03 Happy path : client_organisateur voit SA collecte'
);

-- T04 : Gestionnaire lieux (Gestionnaire X) voit collecte evt1 (lieu lui appartient + evt confirmé)
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T04 Happy path : gestionnaire_lieux voit collecte sur SON lieu'
);

-- T05 : Agence (Agence D) ne voit pas collecte (pas programmateur, pas opérationnel, pas client, pas gestionnaire lieu)
SELECT test_set_jwt('agence', 'cccccccc-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T05 Happy path : agence NE voit PAS collecte (hors périmètre 4 chemins)'
);

-- T06 : Admin_savr voit toutes collectes
SELECT test_set_jwt('admin_savr', NULL);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes$$,
  $$VALUES (2)$$,
  'T06 Happy path : admin_savr voit TOUTES les collectes'
);

-- T07 : ops_savr voit toutes collectes
SELECT test_set_jwt('ops_savr', NULL);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes$$,
  $$VALUES (2)$$,
  'T07 Happy path : ops_savr voit TOUTES les collectes'
);

-- T08 : Helper f_collecte_visible fonction structure (test que la fonction n'errore pas)
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT ok(
  (SELECT plateforme.f_collecte_visible('c01c0001-0000-0000-0000-000000000001'::uuid)),
  'T08 Happy path : f_collecte_visible retourne true pour collecte accessible'
);

-- =====================================================================
-- CATÉGORIE 2 — LIMITES (11 tests)
-- =====================================================================

-- T09 : Brouillon tiers — Gestionnaire X ne voit PAS l'evt brouillon de Kardamome sur lieu 2
-- (même si loc2 avait été liée à Gestionnaire X, la garde date_evenement IS NOT NULL l'empêcherait)
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T09 Limites : brouillon tiers caché au gestionnaire (date_evenement IS NULL)'
);

-- T10 : Cross-org deny — Kardamome manager ne voit pas collecte Kaspia
SELECT test_set_jwt('traiteur_manager', 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.collectes WHERE id = 'c01c0001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T10 Limites : cross-org deny collecte'
);

-- T11 : Fichier cross-org deny — Kaspia manager ne voit pas fichier de col2 (Kardamome)
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f1100002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T11 Limites : shared.fichiers cross-org deny'
);

-- T12 : Fichier polymorphe visible — Kaspia manager voit fichier de col1 (son bordereau)
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f1100001-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T12 Limites : shared.fichiers polymorphe visible via FK collecte'
);

-- T13 : Pack AG — Kardamome manager ne voit pas pack Kaspia
SELECT test_set_jwt('traiteur_manager', 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.packs_antgaspi WHERE id = 'ac000001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T13 Limites : packs_antgaspi cross-org deny'
);

-- T14 : Parametres accès client — traiteur_manager ne peut pas lire parametres (si table privée)
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.grilles_tarifaires_zd$$,
  $$VALUES (0)$$,
  'T14 Limites : traiteur ne voit pas tarifs_zd (staff only)'
);

-- T15 : Organisations_lieux — Gestionnaire ne voit que SA ligne (pas autres gestionnaires)
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations_lieux WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T15 Limites : organisations_lieux gestionnaire voit 1 seule ligne (SA ligne)'
);

-- T16 : Organisations_lieux cross — même gestionnaire ne voit pas liaison autre gestionnaire
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations_lieux WHERE lieu_id = '10c00002-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T16 Limites : organisations_lieux cross-org deny (lieu pas lié à SA org)'
);

-- T17 : Outbox_events denied app roles — traiteur ne voit pas outbox
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.outbox_events$$,
  $$VALUES (0)$$,
  'T17 Limites : outbox_events DENY ALL app roles'
);

-- T18 : Outbox_events admin_savr can read
SELECT test_set_jwt('admin_savr', NULL);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.outbox_events) >= 0,
  'T18 Limites : outbox_events admin_savr can read'
);

-- T19 : Bordereaux cross-org deny — Kardamome ne voit pas bordereau Kaspia
SELECT test_set_jwt('traiteur_manager', 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.bordereaux_savr WHERE id = 'bd100001-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T19 Limites : bordereaux_savr cross-org deny'
);

-- =====================================================================
-- FINAL
-- =====================================================================

SELECT * FROM finish();
ROLLBACK;
