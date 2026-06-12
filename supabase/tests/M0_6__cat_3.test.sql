-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégorie 3 (Cas d'erreur métier)
-- =============================================================================
-- Périmètre : 11 tests P1-critique — tentatives denied par rôle
-- Validation que les policies USING/WITH CHECK empêchent les actions non-autorisées
-- =============================================================================

BEGIN;
SELECT plan(11);

-- Helpers (copie de cat_1-2)
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

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- =====================================================================
-- SETUP FIXTURE MINIMALE (reprise de cat_1-2)
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Kaspia', 'traiteur', true, false, '11111111100001', 'kaspia@test.com'),
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'Kardamome', 'traiteur', true, false, '22222222200001', 'kardamome@test.com'),
  ('cccccccc-0000-0000-0000-000000000001'::uuid, 'Agence D', 'agence', true, false, '33333333300001', 'agence@test.com'),
  ('dddddddd-0000-0000-0000-000000000001'::uuid, 'Gestionnaire X', 'gestionnaire_lieux', true, false, '44444444400001', 'gestx@test.com');

INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('11110001-0000-0000-0000-000000000001'::uuid, 'seminaire', 'Séminaire');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES
  ('10c00001-0000-0000-0000-000000000001'::uuid, 'Salle Kaspia', '1 rue Paris', '75001', 'Paris', 'fourgon'),
  ('10c00002-0000-0000-0000-000000000001'::uuid, 'Salle Kardamome', '2 rue Lyon', '69001', 'Lyon', 'fourgon');

INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('dddddddd-0000-0000-0000-000000000001'::uuid, '10c00001-0000-0000-0000-000000000001'::uuid);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES
  ('05e70001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'mgr@kaspia.test', 'Jean', 'D', 'traiteur_manager'),
  ('05e70003-0000-0000-0000-000000000001'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid, 'gest@x.test', 'Bob', 'L', 'gestionnaire_lieux');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('ee100001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Kaspia SARL', '11111111100001', '1 rue Paris', '75001', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES
  ('e0e00001-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   '10c00001-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
   'ee100001-0000-0000-0000-000000000001'::uuid,
   '05e70001-0000-0000-0000-000000000001'::uuid,
   '11110001-0000-0000-0000-000000000001'::uuid,
   NOW() + INTERVAL '10 days', 100, 'Alice D', '0601020304');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('c01c0001-0000-0000-0000-000000000001'::uuid, 'e0e00001-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00');

-- Tarif + pack pour tests
INSERT INTO plateforme.tarifs_packs_ag (id, nb_collectes, prix_ht, valide_du, actif)
VALUES ('da100001-0000-0000-0000-000000000001'::uuid, 10, 500.00, '2026-01-01', true);

INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
VALUES ('ac000001-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'da100001-0000-0000-0000-000000000001'::uuid, 10, 0, 0, 'actif', current_date);

-- =====================================================================
-- CATÉGORIE 3 — CAS D'ERREUR (11 tests d'INSERT/UPDATE DENIED)
-- =====================================================================

-- T20 : Agence tente INSERT organisation (hors périmètre agence) → DENIED (42501)
SELECT test_set_jwt('agence', 'cccccccc-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
    VALUES (gen_random_uuid(), 'Fake Org', 'traiteur', true, false, '99999999999999', 'fake@test.com')$$,
  '42501', NULL, 'T20 Erreur : agence INSERT organisation denied'
);

-- T21 : Gestionnaire lieux tente INSERT lieu (admin-only) → DENIED
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
    VALUES (gen_random_uuid(), 'Fake Lieu', '1 rue fake', '75001', 'Paris', 'fourgon')$$,
  '42501', NULL, 'T21 Erreur : gestionnaire INSERT lieu denied'
);

-- T22 : Traiteur tente INSERT pack AG (ops-only) → DENIED
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.packs_antgaspi (id, organisation_id, tarif_pack_id, nb_collectes, nb_utilisees, nb_annulees, statut, date_achat)
    VALUES (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'da100001-0000-0000-0000-000000000001', 5, 0, 0, 'actif', current_date)$$,
  '42501', NULL, 'T22 Erreur : traiteur INSERT pack denied'
);

-- T23 : Traiteur tente UPDATE paramètres (staff-only) → UPDATE 0 lignes (USING denied)
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
WITH u AS (
  UPDATE plateforme.grilles_tarifaires_zd
  SET actif = false
  WHERE id = (SELECT id FROM plateforme.grilles_tarifaires_zd LIMIT 1)
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T23 Erreur : traiteur UPDATE parametres retourne 0 lignes');

-- T24 : Gestionnaire lieux tente UPDATE organisations_lieux autre gestionnaire → 0 lignes
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
SELECT test_as_superuser();
-- Crée une liaison d'un autre gestionnaire
INSERT INTO plateforme.organisations_lieux (organisation_id, lieu_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, '10c00002-0000-0000-0000-000000000001'::uuid);
SELECT test_set_jwt('gestionnaire_lieux', 'dddddddd-0000-0000-0000-000000000001'::uuid);
-- Tente de modifier une liaison qui n'existe pas pour lui
WITH u AS (
  UPDATE plateforme.organisations_lieux
  SET lieu_id = '10c00001-0000-0000-0000-000000000001'::uuid
  WHERE lieu_id = '10c00002-0000-0000-0000-000000000001'::uuid
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T24 Erreur : gestionnaire UPDATE organisations_lieux cross-org');

-- T25 : Client tente INSERT bordereau (policy INSERT denied) → 42501
SELECT test_as_superuser();
INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
VALUES ('bd100001-0000-0000-0000-000000000001'::uuid, 'c01c0001-0000-0000-0000-000000000001'::uuid, 'en_attente');
SELECT test_set_jwt('traiteur_manager', 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO plateforme.bordereaux_savr (id, collecte_id, statut)
    VALUES (gen_random_uuid(), 'c01c0001-0000-0000-0000-000000000001', 'en_attente')$$,
  '42501', NULL, 'T25 Erreur : cross-org INSERT bordereau denied'
);

-- T26 : Traiteur tente DELETE collecte (pas de policy DELETE) → 0 lignes
SELECT test_set_jwt('traiteur_manager', 'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
WITH d AS (
  DELETE FROM plateforme.collectes
  WHERE id = 'c01c0001-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T26 Erreur : traiteur DELETE collecte retourne 0 lignes');

-- T27 : Outbox write denied — aucun rôle app ne peut insérer outbox (SERVICE_ROLE seul)
SELECT test_set_jwt('ops_savr', NULL);
SELECT throws_ok(
  $$INSERT INTO plateforme.outbox_events (id, event_type, payload, aggregate_type, aggregate_id)
    VALUES (gen_random_uuid(), 'collecte.creee', '{}', 'collecte', gen_random_uuid())$$,
  '42501', NULL, 'T27 Erreur : ops INSERT outbox_events denied'
);

-- T28 : Fichier cross-org insert denied
SELECT test_set_jwt('traiteur_manager', 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
    VALUES (gen_random_uuid(), 'r2', 'savr-docs', 'test.pdf', 1024, 'application/pdf', 'plateforme.collectes', 'c01c0001-0000-0000-0000-000000000001')$$,
  '42501', NULL, 'T28 Erreur : cross-org INSERT shared.fichiers denied'
);

-- T29 : Agence UPDATE evenement cross-org (USING denied) → 0 lignes
SELECT test_set_jwt('agence', 'cccccccc-0000-0000-0000-000000000001'::uuid);
WITH u AS (
  UPDATE plateforme.evenements
  SET pax = 200
  WHERE id = 'e0e00001-0000-0000-0000-000000000001'
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T29 Erreur : agence UPDATE evenement denied');

-- T30 : Attributions cross-org denied (client_organisateur can't see) → SELECT 0
SELECT test_set_jwt('client_organisateur', gen_random_uuid());
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.attributions_antgaspi$$,
  $$VALUES (0)$$,
  'T30 Erreur : client_organisateur SELECT attributions_antgaspi retourne 0'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;
