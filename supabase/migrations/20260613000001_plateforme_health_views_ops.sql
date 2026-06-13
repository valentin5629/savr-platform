-- Migration M0.9 : fonction health_ping + vues ops
-- health_ping : utilisée par /health (liveness check DB)
CREATE OR REPLACE FUNCTION plateforme.health_ping()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT 1;
$$;

GRANT EXECUTE ON FUNCTION plateforme.health_ping() TO anon, authenticated, service_role;

-- v_ops_outbox : events outbox non consommés + plus ancien
CREATE OR REPLACE VIEW plateforme.v_ops_outbox AS
SELECT
  COUNT(*) FILTER (WHERE statut = 'pending')   AS nb_pending,
  COUNT(*) FILTER (WHERE statut = 'processing') AS nb_processing,
  COUNT(*) FILTER (WHERE statut = 'dead')       AS nb_dlq,
  MIN(created_at) FILTER (WHERE statut IN ('pending', 'processing')) AS plus_ancien_at
FROM plateforme.outbox_events;

-- v_ops_jobs_pdf : jobs PDF en attente ou en échec
CREATE OR REPLACE VIEW plateforme.v_ops_jobs_pdf AS
SELECT
  COUNT(*) FILTER (WHERE statut = 'queued')   AS nb_pending,
  COUNT(*) FILTER (WHERE statut = 'failed')   AS nb_failed,
  MAX(tentatives) FILTER (WHERE statut = 'failed') AS max_tentatives,
  MIN(created_at) FILTER (WHERE statut IN ('queued', 'retrying', 'failed')) AS plus_ancien_at
FROM plateforme.jobs_pdf;

-- v_ops_factures_bloquees : factures émises sans retour Pennylane depuis > 48h
CREATE OR REPLACE VIEW plateforme.v_ops_factures_bloquees AS
SELECT
  f.id            AS facture_id,
  f.numero_facture,
  f.organisation_id,
  f.statut,
  f.created_at,
  EXTRACT(EPOCH FROM (NOW() - f.updated_at)) / 3600 AS heures_sans_retour
FROM plateforme.factures f
WHERE f.statut = 'emise'
  AND f.updated_at < NOW() - INTERVAL '48 hours'
ORDER BY f.updated_at ASC;

-- v_ops_integrations : dernier appel par service externe (alimentée par les logs applicatifs)
-- Note : cette vue est un placeholder V1 — en V1 les logs sont sur stdout/Supabase Logs,
-- pas dans une table. Elle sera peuplée via une table de métriques en V1.1.
-- Pour V1, on expose les métriques via la table audit_log (appels externes loggés en error).
CREATE OR REPLACE VIEW plateforme.v_ops_integrations AS
SELECT
  'mts1'      AS service,
  NULL::timestamptz AS dernier_appel_at,
  0           AS nb_echecs_24h
UNION ALL
SELECT
  'pennylane' AS service,
  NULL::timestamptz AS dernier_appel_at,
  0           AS nb_echecs_24h
UNION ALL
SELECT
  'resend'    AS service,
  NULL::timestamptz AS dernier_appel_at,
  0           AS nb_echecs_24h;

-- v_ops_batchs : statut des derniers runs de chaque cron (basé sur audit_log events système)
-- Placeholder V1 — les crons émettent leurs logs sur stdout ; cette vue sera peuplée
-- via une table jobs_cron en V1.1. Pour V1 on expose les noms attendus.
CREATE OR REPLACE VIEW plateforme.v_ops_batchs AS
SELECT job_name, NULL::timestamptz AS dernier_run_at, NULL::text AS statut, NULL::integer AS nb_traite
FROM (VALUES
  ('attestations_batch'),
  ('bordereaux_rapports_batch'),
  ('mts1_polling'),
  ('pennylane_polling'),
  ('relance_factures'),
  ('purge_logs')
) AS t(job_name);

-- RLS : vues ops accessibles uniquement aux rôles admin_savr et ops_savr
-- Les vues héritent des policies des tables sous-jacentes via SECURITY INVOKER (défaut).
-- On accorde l'accès explicitement via des grants sur les rôles de service.
GRANT SELECT ON plateforme.v_ops_outbox TO service_role;
GRANT SELECT ON plateforme.v_ops_jobs_pdf TO service_role;
GRANT SELECT ON plateforme.v_ops_factures_bloquees TO service_role;
GRANT SELECT ON plateforme.v_ops_integrations TO service_role;
GRANT SELECT ON plateforme.v_ops_batchs TO service_role;
