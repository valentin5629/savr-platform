-- =============================================================================
-- Hardening sécurité RPC SECURITY DEFINER (bloquants B1 + B2 reviewer RLS)
-- =============================================================================
-- B1 : REVOKE EXECUTE sur les 3 RPCs métier — non invocables via PostgREST
--      par authenticated/anon. Seul le service role (superuser) peut les
--      appeler (côté routes Next.js via createAdminSupabaseClient).
-- B2 : SET search_path figé sur les 5 fonctions SECURITY DEFINER
--      (prévention search-path hijack CWE-426, aligné sur fn_custom_access_token).
-- =============================================================================

-- ─── B1 : REVOKE EXECUTE ──────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION plateforme.fn_dispatcher_collecte(
  uuid, uuid, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(
  uuid, jsonb, text[]
) FROM PUBLIC;

-- Trigger functions : non appelables via RPC directe, durcissement par défense en profondeur
REVOKE EXECUTE ON FUNCTION plateforme._fn_trg_outbox_collecte_annulee() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme._fn_trg_outbox_lieu_critique() FROM PUBLIC;

-- ─── B2 : SET search_path figé (CWE-426) ────────────────────────────────────

ALTER FUNCTION plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text
) SET search_path = plateforme, public;

ALTER FUNCTION plateforme.fn_dispatcher_collecte(
  uuid, uuid, text
) SET search_path = plateforme, public;

ALTER FUNCTION plateforme.fn_modifier_collecte(
  uuid, jsonb, text[]
) SET search_path = plateforme, public;

ALTER FUNCTION plateforme._fn_trg_outbox_collecte_annulee()
  SET search_path = plateforme, public;

ALTER FUNCTION plateforme._fn_trg_outbox_lieu_critique()
  SET search_path = plateforme, public;
