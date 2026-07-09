-- =============================================================================
-- M0.9 — BL-P2-33 (R22g) : rotation + rétention des journaux (purge_logs).
-- =============================================================================
-- Vérifie :
--   1. f_ensure_partition_annee / f_purge_logs présentes.
--   2. Partitions futures pré-provisionnées (integrations_logs 2027, audit_log 2031) + RLS.
--   3. f_ensure_partition_annee crée une partition annuelle + active la RLS.
--   4. Durcissement : authenticated NE PEUT PAS exécuter ces fonctions DDL (REVOKE PUBLIC),
--      service_role le PEUT.
--   5. f_purge_logs : DROP des partitions integrations_logs > 2 ans, conserve les récentes,
--      ne touche JAMAIS audit_log (§07/02 l.55), purge integrations_inbox > 7 j (§04 l.2351).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ── 1. Présence des fonctions ────────────────────────────────────────────────
SELECT has_function(
  'plateforme', 'f_ensure_partition_annee', ARRAY['text', 'integer'],
  'f_ensure_partition_annee(text, integer) existe'
);
SELECT has_function(
  'plateforme', 'f_purge_logs', ARRAY['timestamp with time zone'],
  'f_purge_logs(timestamptz) existe'
);

-- ── 2. Durcissement des droits (REVOKE PUBLIC / GRANT service_role) ───────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'plateforme.f_purge_logs(timestamptz)', 'EXECUTE'),
  'authenticated NE PEUT PAS exécuter f_purge_logs (REVOKE PUBLIC)'
);
SELECT ok(
  has_function_privilege(
    'service_role', 'plateforme.f_purge_logs(timestamptz)', 'EXECUTE'),
  'service_role PEUT exécuter f_purge_logs'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'plateforme.f_ensure_partition_annee(text, integer)', 'EXECUTE'),
  'authenticated NE PEUT PAS exécuter f_ensure_partition_annee'
);

-- ── 3. Partitions futures pré-provisionnées par la migration ─────────────────
SELECT ok(
  to_regclass('plateforme.integrations_logs_2027') IS NOT NULL,
  'integrations_logs_2027 pré-provisionnée (runway +1 an)'
);
SELECT ok(
  to_regclass('plateforme.audit_log_2031') IS NOT NULL,
  'audit_log_2031 pré-provisionnée (runway 5 ans, jamais purgée)'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'plateforme' AND c.relname = 'integrations_logs_2027'),
  'RLS activée sur integrations_logs_2027'
);

-- ── 4. f_ensure_partition_annee crée une partition + RLS ─────────────────────
SELECT plateforme.f_ensure_partition_annee('integrations_logs', 2099);
SELECT ok(
  to_regclass('plateforme.integrations_logs_2099') IS NOT NULL,
  'f_ensure_partition_annee crée integrations_logs_2099'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'plateforme' AND c.relname = 'integrations_logs_2099'),
  'RLS activée sur la partition créée par f_ensure_partition_annee'
);

-- ── 5. Setup rétention : partitions anciennes + lignes inbox ─────────────────
SELECT plateforme.f_ensure_partition_annee('integrations_logs', 2020); -- > 2 ans
SELECT plateforme.f_ensure_partition_annee('audit_log', 2019); -- > 2 ans, mais audit_log
INSERT INTO plateforme.integrations_inbox (source, event_type, payload, created_at)
VALUES ('r22g-test-old', 'x', '{}'::jsonb, '2026-05-22T00:00:00Z'::timestamptz); -- > 7 j
INSERT INTO plateforme.integrations_inbox (source, event_type, payload, created_at)
VALUES ('r22g-test-recent', 'x', '{}'::jsonb, '2026-05-30T00:00:00Z'::timestamptz); -- < 7 j

-- Exécution du job à une date de référence (cutoff logs = 2024-06-01 ; inbox = 2026-05-25).
SELECT plateforme.f_purge_logs('2026-06-01T12:00:00Z'::timestamptz);

SELECT ok(
  to_regclass('plateforme.integrations_logs_2020') IS NULL,
  'purge : integrations_logs_2020 (> 2 ans) supprimée'
);
SELECT ok(
  to_regclass('plateforme.integrations_logs_2026') IS NOT NULL,
  'purge : integrations_logs_2026 (< 2 ans) conservée'
);
SELECT ok(
  to_regclass('plateforme.audit_log_2019') IS NOT NULL,
  'purge : audit_log_2019 JAMAIS supprimée (§07/02 l.55)'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.integrations_inbox WHERE source = 'r22g-test-old'),
  0,
  'purge : integrations_inbox > 7 j supprimée (§04 l.2351)'
);
SELECT is(
  (SELECT count(*)::int FROM plateforme.integrations_inbox WHERE source = 'r22g-test-recent'),
  1,
  'purge : integrations_inbox < 7 j conservée'
);

SELECT * FROM finish();

ROLLBACK;
