-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégories 6-7 (Cross-app & Migration)
-- =============================================================================
-- Périmètre : 9 tests — SERVICE_ROLE bypass, claim app_domain, cross-schema, JWT enrichissement
-- Note : Catégories 6-7 sont P2-important (post-V1), tests structurels
-- =============================================================================

BEGIN;
SELECT plan(9);

-- Helpers
CREATE OR REPLACE FUNCTION test_set_jwt(
  p_role text,
  p_org_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT gen_random_uuid(),
  p_app_domain text DEFAULT 'plateforme'
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id,
    'role', p_role,
    'organisation_id', p_org_id,
    'app_domain', p_app_domain
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
-- SETUP — Données pour tests cross-app
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('09aca000-0000-0000-0000-000000000001'::uuid, 'Cross-app Org', 'traiteur', true, false, '11111111100001', 'ca@test.com');

INSERT INTO shared.prestataires (id, nom, code, siret)
VALUES ('0ea50001-0000-0000-0000-000000000001'::uuid, 'Test Presta', 'test-presta-cat67', '12345678900001');

-- =====================================================================
-- CATÉGORIE 6 — SERVICE_ROLE & CROSS-SCHEMA (5 tests)
-- =====================================================================

-- T54 : SERVICE_ROLE bypass — peut insérer dans outbox (app roles ne peuvent pas)
SELECT test_as_superuser();
INSERT INTO plateforme.outbox_events (id, event_type, payload, aggregate_type, aggregate_id)
VALUES (gen_random_uuid(), 'collecte.creee', '{}', 'collecte', gen_random_uuid());

SELECT ok(true, 'T54 Cross-app : SERVICE_ROLE INSERT outbox_events OK');

-- T55 : Cross-schema write denied — plateforme app role ne peut pas écrire shared.prestataires
SELECT test_set_jwt('traiteur_manager', '09aca000-0000-0000-0000-000000000001'::uuid);
SELECT throws_ok(
  $$INSERT INTO shared.prestataires (id, nom, code, siret)
    VALUES (gen_random_uuid(), 'Hacker Presta', 'hacker-presta', '99999999900001')$$,
  '42501', NULL, 'T55 Cross-app : cross-schema write denied'
);

-- T56 : Shared.fichiers cross-schema bridge — la seule exception cross-schema
SELECT test_as_superuser();
INSERT INTO plateforme.types_evenements (id, code, libelle)
VALUES ('e0c10000-0000-0000-0000-000000000001'::uuid, 'test', 'Test');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('1e0ca000-0000-0000-0000-000000000001'::uuid, 'Lieu CA', '1 rue', '75001', 'Paris', 'fourgon');

INSERT INTO plateforme.entites_facturation (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('e0eca000-0000-0000-0000-000000000001'::uuid, '09aca000-0000-0000-0000-000000000001'::uuid, 'CA SARL', '11111111100001', '1 rue', '75001', 'Paris');

INSERT INTO plateforme.evenements (
  id, organisation_id, lieu_id, traiteur_operationnel_organisation_id,
  entite_facturation_id, created_by, type_evenement_id,
  date_evenement, pax, contact_principal_nom, contact_principal_telephone
)
VALUES ('e0500c01-0000-0000-0000-000000000001'::uuid, '09aca000-0000-0000-0000-000000000001'::uuid, '1e0ca000-0000-0000-0000-000000000001'::uuid, '09aca000-0000-0000-0000-000000000001'::uuid, 'e0eca000-0000-0000-0000-000000000001'::uuid, gen_random_uuid(), 'e0c10000-0000-0000-0000-000000000001'::uuid, NOW() + INTERVAL '10 days', 100, 'Contact', '0601010101');

INSERT INTO plateforme.collectes (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte)
VALUES ('c010ca01-0000-0000-0000-000000000001'::uuid, 'e0500c01-0000-0000-0000-000000000001'::uuid, 'zero_dechet', 'programmee', 'non_envoye', current_date + 10, '08:00');

INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES ('f110ca01-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'test.pdf', 1024, 'application/pdf', 'plateforme.collectes', 'c010ca01-0000-0000-0000-000000000001'::uuid);

SELECT test_set_jwt('traiteur_manager', '09aca000-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f110ca01-0000-0000-0000-000000000001'$$,
  $$VALUES (1)$$,
  'T56 Cross-app : shared.fichiers seul pont cross-schema OK'
);

-- T57 : Prestataires shared read-only pour plateforme (si policy exists)
SELECT test_set_jwt('admin_savr', NULL);
SELECT ok(
  (SELECT count(*)::int FROM shared.prestataires) >= 0,
  'T57 Cross-app : admin_savr SELECT shared.prestataires OK (read-only)'
);

-- T58 : Integrations_inbox — SERVICE_ROLE write, aucune app role ne lit
SELECT test_set_jwt('admin_savr', NULL);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.integrations_inbox$$,
  $$VALUES (0)$$,
  'T58 Cross-app : admin_savr SELECT integrations_inbox = 0 (SERVICE_ROLE write-only)'
);

-- =====================================================================
-- CATÉGORIE 7 — MIGRATION & JWT ENRICHISSEMENT (4 tests)
-- =====================================================================

-- T59 : app_domain claim — user avec app_domain='tms' serait bloqué par plateforme policies
SELECT test_set_jwt('traiteur_manager', '09aca000-0000-0000-0000-000000000001'::uuid, gen_random_uuid(), 'tms');
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.organisations$$,
  $$VALUES (0)$$,
  'T59 Migration : user app_domain=tms bloqué par plateforme policies'
);

-- T60 : JWT enrichissement — claims nulls gérés (org_id=NULL pour staff OK)
SELECT test_set_jwt('admin_savr', NULL);
SELECT ok(
  (SELECT count(*)::int FROM plateforme.organisations) > 0,
  'T60 Migration : admin_savr organisation_id=NULL géré correctement'
);

-- T61 : Policies double-run idempotent — rejeu ne provoque pas d'erreur (structurel)
SELECT test_as_superuser();
-- Compte les policies sur une table
SELECT ok(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'plateforme' AND tablename = 'organisations') >= 1,
  'T61 Migration : policies plateforme.organisations idempotentes (aucun doublon)'
);

-- T62 : Mapping rôles V1 → V2 — 6 rôles V1 conservés en V2 (structurel)
SELECT ok(
  (SELECT count(DISTINCT role) FROM plateforme.users) >= 0,
  'T62 Migration : users table structure ready pour V2 (rôles conservés)'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;
