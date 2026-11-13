-- =============================================================================
-- Email à l'association d'un don AG : envoyé 48 h avant le créneau, pas avant
-- (décision Val 2026-11-13).
-- =============================================================================
-- Avant : l'event `attribution.validee` (famille `attribution_job`) était réclamé
-- dès la validation de l'attribution, donc l'email `ag_attribution_association`
-- pouvait partir des semaines avant la collecte.
--
-- Désormais le claim de la famille retient l'event tant que le créneau de la
-- collecte (date_collecte + heure_collecte, heure de Paris) est à plus de 48 h.
-- La date est relue à chaque passage du cron : un créneau déplacé avant l'envoi
-- est suivi sans rien réécrire. Une collecte à moins de 48 h part au passage
-- suivant (5 min). Un event sans collecte correspondante n'est pas retenu.
--
-- La garde est posée sur l'event retenu seulement : le head-of-line par collecte
-- dans la famille reste inchangé (une seule attribution par collecte, UNIQUE).
-- Fonction réservée à service_role (inchangé) : aucun accès ouvert.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_attribution_batch(
  p_limit integer DEFAULT 10,
  p_lease_duration interval DEFAULT interval '2 minutes'
)
RETURNS TABLE (
  id                      uuid,
  aggregate_type          text,
  aggregate_id            uuid,
  event_type              text,
  payload                 jsonb,
  consumer                text,
  attempts                integer,
  requires_reconciliation boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  WITH eligibles AS (
    SELECT e.id
    FROM plateforme.outbox_events e
    WHERE e.statut IN ('pending', 'failed')
      AND (e.next_retry_at IS NULL OR e.next_retry_at <= now())
      AND e.txid < txid_snapshot_xmin(txid_current_snapshot())
      AND e.consumer = 'attribution_job'
      AND NOT EXISTS (
        -- head-of-line PAR collecte, DANS la famille `attribution_job` seule.
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut <> 'done'
          AND e2.consumer = 'attribution_job'
      )
      AND NOT EXISTS (
        -- Retenu tant que le créneau est à plus de 48 h (Val 2026-11-13).
        SELECT 1
        FROM plateforme.collectes c
        WHERE c.id = e.aggregate_id
          AND ((c.date_collecte + c.heure_collecte) AT TIME ZONE 'Europe/Paris')
              - interval '48 hours' > now()
      )
    ORDER BY e.seq
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE plateforme.outbox_events oe
  SET
    statut        = 'processing',
    claimed_until = now() + p_lease_duration,
    attempts      = oe.attempts + 1
  FROM eligibles
  WHERE oe.id = eligibles.id
  RETURNING
    oe.id,
    oe.aggregate_type,
    oe.aggregate_id,
    oe.event_type,
    oe.payload,
    oe.consumer,
    oe.attempts,
    oe.requires_reconciliation;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_attribution_batch(integer, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_attribution_batch(integer, interval)
  TO service_role;
