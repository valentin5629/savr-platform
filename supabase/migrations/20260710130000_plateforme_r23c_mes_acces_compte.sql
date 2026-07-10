-- =============================================================================
-- R23c / BL-P3-13 — Page « Sécurité du compte » : historique SELF des accès.
-- =============================================================================
-- CDC §15 §2.3 : « L'utilisateur impersoné peut voir dans son historique que son
-- compte a été accédé (page "Sécurité du compte") ».
--
-- Contrainte sécurité : audit_log est RESTREINT au staff (policy al_select_staff =
-- f_is_staff()). Un client ne peut PAS le lire. On expose donc UNIQUEMENT ses
-- propres accès via une fonction SECURITY DEFINER scopée à auth.uid(), qui :
--   • ne renvoie QUE la date d'accès + un libellé générique ;
--   • ne renvoie JAMAIS l'identité de l'admin (impersonator_id / email) — le CDC
--     exige que l'utilisateur sache QUE son compte a été accédé, pas PAR QUI ;
--   • filtre sur action = 'impersonation_session' (marqueur inséré une fois par
--     session d'impersonation, user_id = utilisateur impersoné).
-- On NE touche PAS à al_select_staff (aucun élargissement de la RLS staff).
-- SECURITY DEFINER : auth.uid() reste celui de l'APPELANT (claim JWT, non affecté
-- par le DEFINER) → le scope self est garanti même si la fonction bypass la RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.f_mes_acces_compte()
RETURNS TABLE (accede_le timestamptz, type_acces text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = plateforme, pg_temp
AS $$
  SELECT
    al.created_at                    AS accede_le,
    'acces_administrateur'::text     AS type_acces
  FROM plateforme.audit_log al
  WHERE al.user_id = auth.uid()
    AND al.action = 'impersonation_session'
  ORDER BY al.created_at DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION plateforme.f_mes_acces_compte() IS
  'BL-P3-13 — Historique self des accès admin (impersonation) de l''utilisateur '
  'courant. Projette date + libellé générique uniquement (jamais l''identité de '
  'l''admin). Scopé auth.uid(). CDC §15 §2.3.';

-- Seul un utilisateur authentifié peut lister SES accès ; anon/public exclus.
REVOKE EXECUTE ON FUNCTION plateforme.f_mes_acces_compte() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.f_mes_acces_compte() FROM anon;
GRANT EXECUTE ON FUNCTION plateforme.f_mes_acces_compte() TO authenticated;
