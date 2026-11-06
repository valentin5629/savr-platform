-- =============================================================================
-- Tests sécurité RPC — garde-fous B1 (REVOKE EXECUTE sur RPCs SECURITY DEFINER)
-- Vérifie que fn_creer_collecte, fn_dispatcher_collecte, fn_modifier_collecte,
-- fn_ajouter_collecte_evenement et fn_modifier_evenement ne sont pas invocables
-- par les rôles authenticated ou anon.
-- =============================================================================
BEGIN;

SELECT plan(10);

-- ─── fn_creer_collecte ───────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_creer_collecte(uuid, text, date, time, smallint, boolean, text, text, jsonb, integer)',
    'execute'
  ),
  'fn_creer_collecte : EXECUTE refusé à authenticated (B1)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_creer_collecte(uuid, text, date, time, smallint, boolean, text, text, jsonb, integer)',
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

-- ─── fn_ajouter_collecte_evenement ───────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_ajouter_collecte_evenement(uuid, text, date, time, boolean, text, integer)',
    'execute'
  ),
  'fn_ajouter_collecte_evenement : EXECUTE refusé à authenticated'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_ajouter_collecte_evenement(uuid, text, date, time, boolean, text, integer)',
    'execute'
  ),
  'fn_ajouter_collecte_evenement : EXECUTE refusé à anon'
);

-- ─── fn_modifier_evenement ───────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'plateforme.fn_modifier_evenement(uuid, jsonb, text[])',
    'execute'
  ),
  'fn_modifier_evenement : EXECUTE refusé à authenticated'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'plateforme.fn_modifier_evenement(uuid, jsonb, text[])',
    'execute'
  ),
  'fn_modifier_evenement : EXECUTE refusé à anon'
);

SELECT * FROM finish();

ROLLBACK;
