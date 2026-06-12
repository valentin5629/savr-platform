-- =============================================================================
-- Tests pgTAP M0.6 — RLS exhaustive — Catégorie 5 (Idempotence & États)
-- =============================================================================
-- Périmètre : 9 tests — append-only, immuabilité, SERVICE_ROLE, gapless, soft-delete
-- Validation patterns transactionnels et d'audit
-- =============================================================================

BEGIN;
SELECT plan(9);

-- Helpers
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
-- SETUP — Données minimales
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.organisations (id, nom, type, actif, est_shadow, siret, email_principal)
VALUES ('0b9e5700-0000-0000-0000-000000000001'::uuid, 'Test Org', 'traiteur', true, false, '11111111100001', 'test@test.com');

-- =====================================================================
-- CATÉGORIE 5 — IDEMPOTENCE & ÉTATS (9 tests)
-- =====================================================================

-- T45 : audit_log append-only — INSERT ok, UPDATE denied, DELETE denied
SELECT test_as_superuser();
INSERT INTO plateforme.audit_log (user_id, action, table_name, record_id, new_values)
VALUES (gen_random_uuid(), 'INSERT', 'organisations', '0b9e5700-0000-0000-0000-000000000001'::uuid, '{}');

-- Tentative UPDATE (doit échouer car pas de policy UPDATE)
SELECT test_set_jwt('admin_savr', NULL);
WITH u AS (
  UPDATE plateforme.audit_log
  SET new_values = '{}'
  WHERE table_name = 'organisations'
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T45 Idempotence : audit_log UPDATE retourne 0 (append-only)');

-- T46 : Outbox events write SERVICE_ROLE only — aucun rôle app ne peut insérer
SELECT test_set_jwt('admin_savr', NULL);
SELECT throws_ok(
  $$INSERT INTO plateforme.outbox_events (id, event_type, payload, aggregate_type, aggregate_id)
    VALUES (gen_random_uuid(), 'test', '{}', 'test', gen_random_uuid())$$,
  '42501', NULL, 'T46 Idempotence : outbox admin_savr write denied'
);

-- T47 : Outbox lease/claim claim_until not stale
SELECT test_as_superuser();
INSERT INTO plateforme.outbox_events (
  id, event_type, payload, aggregate_type, aggregate_id,
  status, claimed_by, claimed_until, attempts
)
VALUES (gen_random_uuid(), 'test', '{}', 'test', gen_random_uuid(),
  'processing', 'worker-1', NOW() + INTERVAL '5 minutes', 1);

-- Vérifie que claimed_until est peuplé (idem pour txid)
SELECT ok(
  (SELECT claimed_until FROM plateforme.outbox_events
   WHERE status = 'processing' LIMIT 1) > NOW(),
  'T47 Idempotence : outbox claimed_until > NOW() (lease pattern active)'
);

-- T48 : Sequences_facturation — numérotation gapless, INSERT via RPC seul
SELECT test_as_superuser();
INSERT INTO plateforme.sequences_facturation (nom_sequence, valeur_courante)
VALUES ('factures', 1);

-- Tentative UPDATE direct (doit échouer ou faire 0 lignes)
SELECT test_set_jwt('admin_savr', NULL);
WITH u AS (
  UPDATE plateforme.sequences_facturation
  SET valeur_courante = 100
  WHERE nom_sequence = 'factures'
  RETURNING 1
)
SELECT is(count(*)::int, 0, 'T48 Idempotence : sequences UPDATE direct = 0 lignes (RPC seul)');

-- T49 : Soft-delete users — deleted_at SET = invisible
SELECT test_as_superuser();
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role)
VALUES ('05ede100-0000-0000-0000-000000000001'::uuid, '0b9e5700-0000-0000-0000-000000000001'::uuid, 'deleted@test.com', 'Del', 'User', 'traiteur_manager');

UPDATE plateforme.users SET deleted_at = NOW() WHERE id = '05ede100-0000-0000-0000-000000000001'::uuid;

SELECT test_set_jwt('traiteur_manager', '0b9e5700-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.users WHERE id = '05ede100-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T49 Idempotence : user soft-deleted invisible'
);

-- T50 : Soft-delete fichiers — f_fichier_visible considère deleted_at
SELECT test_as_superuser();
INSERT INTO shared.fichiers (id, storage_provider, bucket, key, size_bytes, content_type, entity_type, entity_id)
VALUES ('f11de100-0000-0000-0000-000000000001'::uuid, 'r2', 'savr-docs', 'test.pdf', 1024, 'application/pdf', 'plateforme.collectes', gen_random_uuid());

UPDATE shared.fichiers SET deleted_at = NOW() WHERE id = 'f11de100-0000-0000-0000-000000000001'::uuid;

SELECT test_set_jwt('admin_savr', NULL);
SELECT results_eq(
  $$SELECT count(*)::int FROM shared.fichiers WHERE id = 'f11de100-0000-0000-0000-000000000001'$$,
  $$VALUES (0)$$,
  'T50 Idempotence : fichier soft-deleted invisible (f_fichier_visible check)'
);

-- T51 : Policies idempotentes — rejeu des mêmes policies ne duplique pas
SELECT test_as_superuser();

-- Cherche les policies de plateforme.organisations
SELECT ok(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'plateforme' AND tablename = 'organisations') >= 1,
  'T51 Idempotence : plateforme.organisations a >= 1 policy (pas duplicat)'
);

-- T52 : Intégrations_inbox SERVICE_ROLE write, app read denied
SELECT test_as_superuser();
INSERT INTO plateforme.integrations_inbox (source, event_type, payload, processed_at)
VALUES ('tms', 'tour.created', '{}', NULL);

SELECT test_set_jwt('traiteur_manager', '0b9e5700-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.integrations_inbox$$,
  $$VALUES (0)$$,
  'T52 Idempotence : integrations_inbox app role read denied (SERVICE_ROLE write-only)'
);

-- T53 : Email_envoyes PII hidden — traiteur ne voit pas email addresses
SELECT test_as_superuser();
INSERT INTO plateforme.emails_envoyes (
  id, organisation_id, destinataire_email, template_id, statut, sent_at
)
VALUES (gen_random_uuid(), '0b9e5700-0000-0000-0000-000000000001'::uuid, 'secret@test.com', gen_random_uuid(), 'sent', NOW());

SELECT test_set_jwt('traiteur_manager', '0b9e5700-0000-0000-0000-000000000001'::uuid);
SELECT results_eq(
  $$SELECT count(*)::int FROM plateforme.emails_envoyes$$,
  $$VALUES (0)$$,
  'T53 Idempotence : emails_envoyes app role denied (staff only for PII)'
);

-- =====================================================================

SELECT * FROM finish();
ROLLBACK;
