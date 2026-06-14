-- =============================================================================
-- Tests sécurité RPC — garde-fous B1 (REVOKE EXECUTE sur RPCs SECURITY DEFINER)
-- Vérifie que fn_creer_collecte, fn_dispatcher_collecte, fn_modifier_collecte
-- ne sont pas invocables par les rôles authenticated ou anon.
-- =============================================================================
BEGIN;

SELECT plan(6);

-- ─── fn_creer_collecte ───────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_creer_collecte(uuid, text, date, time, smallint, boolean, text, text)',
    'execute'
  ),
  'fn_creer_collecte : EXECUTE refusé à authenticated (B1)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_creer_collecte(uuid, text, date, time, smallint, boolean, text, text)',
    'execute'
  ),
  'fn_creer_collecte : EXECUTE refusé à anon (B1)'
);

-- ─── fn_dispatcher_collecte ──────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_dispatcher_collecte(uuid, uuid, text)',
    'execute'
  ),
  'fn_dispatcher_collecte : EXECUTE refusé à authenticated (B1)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_dispatcher_collecte(uuid, uuid, text)',
    'execute'
  ),
  'fn_dispatcher_collecte : EXECUTE refusé à anon (B1)'
);

-- ─── fn_modifier_collecte ────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_modifier_collecte(uuid, jsonb, text[])',
    'execute'
  ),
  'fn_modifier_collecte : EXECUTE refusé à authenticated (B1)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_modifier_collecte(uuid, jsonb, text[])',
    'execute'
  ),
  'fn_modifier_collecte : EXECUTE refusé à anon (B1)'
);

SELECT * FROM finish();

ROLLBACK;
