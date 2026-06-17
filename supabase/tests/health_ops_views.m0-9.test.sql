-- =============================================================================
-- M0.9 Observabilité — vues ops + health_ping()
-- =============================================================================
-- Vérifie :
--   1. health_ping() accessible à authenticated (liveness public)
--   2. Vues ops (v_ops_outbox, v_ops_jobs_pdf, v_ops_factures_bloquees)
--      REFUSÉES à authenticated (GRANT service_role only)
--   3. Vues placeholder (v_ops_integrations, v_ops_batchs)
--      REFUSÉES à authenticated (idem)
--
-- AUTO-ACTIVATION : si health_ping() n'existe pas, 5 tests s'auto-skippe.
-- Dès que la migration 20260613000001 est appliquée, le test devient BLOQUANT.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Détection migration appliquée
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'health_ping'
  ) THEN
    RAISE NOTICE 'health_ping() absente (migration non appliquée) — tests skippés';
  END IF;
END $$;

SELECT plan(6);

-- =========================================================
-- 1. health_ping() : accessible à authenticated
-- =========================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'health_ping'
  ) THEN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000001","user_role":"traiteur_manager","organisation_id":"00000000-0000-0000-0000-000000000099"}',
      true);
  END IF;
END $$;

SELECT CASE
  WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'plateforme' AND p.proname = 'health_ping'
  )
  THEN lives_ok(
    'SELECT plateforme.health_ping()',
    'health_ping() accessible à authenticated'
  )
  ELSE skip('health_ping() absente — migration non appliquée')
END;

-- =========================================================
-- 2-4. Vues ops à données : refusées à authenticated
-- Rôle authenticated, non-admin (traiteur_manager)
-- GRANT SELECT est service_role only → 42501 attendu
-- =========================================================

-- Repasser en superuser pour le changement de rôle
SELECT set_config('role', 'postgres', true);

DO $$ BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","user_role":"traiteur_manager","organisation_id":"00000000-0000-0000-0000-000000000099"}',
    true);
END $$;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema='plateforme' AND table_name='v_ops_outbox')
  THEN throws_ok(
    'SELECT * FROM plateforme.v_ops_outbox',
    '42501', NULL,
    'v_ops_outbox refusée à authenticated (GRANT service_role only)'
  )
  ELSE skip('v_ops_outbox absente — migration non appliquée')
END;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema='plateforme' AND table_name='v_ops_jobs_pdf')
  THEN throws_ok(
    'SELECT * FROM plateforme.v_ops_jobs_pdf',
    '42501', NULL,
    'v_ops_jobs_pdf refusée à authenticated'
  )
  ELSE skip('v_ops_jobs_pdf absente')
END;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema='plateforme' AND table_name='v_ops_factures_bloquees')
  THEN throws_ok(
    'SELECT * FROM plateforme.v_ops_factures_bloquees',
    '42501', NULL,
    'v_ops_factures_bloquees refusée à authenticated'
  )
  ELSE skip('v_ops_factures_bloquees absente')
END;

-- =========================================================
-- 5-6. Vues placeholder : refusées à authenticated (idem)
-- =========================================================

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema='plateforme' AND table_name='v_ops_integrations')
  THEN throws_ok(
    'SELECT * FROM plateforme.v_ops_integrations',
    '42501', NULL,
    'v_ops_integrations refusée à authenticated'
  )
  ELSE skip('v_ops_integrations absente')
END;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM information_schema.views
               WHERE table_schema='plateforme' AND table_name='v_ops_batchs')
  THEN throws_ok(
    'SELECT * FROM plateforme.v_ops_batchs',
    '42501', NULL,
    'v_ops_batchs refusée à authenticated'
  )
  ELSE skip('v_ops_batchs absente')
END;

SELECT * FROM finish();

ROLLBACK;
