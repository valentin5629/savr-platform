-- =============================================================================
-- Outbox — isolation du consumer `attribution_job` (divergence M2.3_20260911,
-- option A tranchée par Val le 2026-09-11).
-- =============================================================================
-- La validation d'une attribution AG insère, dans la même transaction et sur le
-- MÊME agrégat (la collecte), deux events : `attribution.validee` (consumer
-- `attribution_job` → emails association §06.02 n°16 + transporteur n°18) puis
-- `collecte.creee` (dispatch logistique).
--
-- Avant ce correctif, `fn_claim_outbox_batch` ne filtrait ni consumer ni
-- event_type : le worker LOGISTIQUE réclamait `attribution.validee`, ne le
-- reconnaissait pas (no-op) et le marquait `done` → aucun email d'attribution ne
-- partait jamais. Et le head-of-line étant calculé sur tout l'agrégat, un email
-- en échec aurait bloqué le dispatch du camion de la collecte.
--
-- Règle posée : chaque famille de consumer a SON claim et SON head-of-line.
--   • fn_claim_outbox_batch            → tout SAUF `attribution_job` ;
--   • fn_claim_outbox_attribution_batch → UNIQUEMENT `attribution_job`.
-- Même pattern lease/claim (garde de visibilité txid, SKIP LOCKED, attempts++
-- au claim) ; le résultat passe par fn_result_outbox (inchangée) et le reaper
-- fn_reap_outbox_claims (inchangé) re-queue les leases expirés des deux familles.
--
-- ⚠ CREATE OR REPLACE réinitialise search_path → on RÉ-INCLUT `SET search_path`
--   (cf. 20260629100000). Signature de fn_claim_outbox_batch INCHANGÉE (pas de
--   DROP : les privilèges du P0 20260903130000 sont conservés, et re-posés ci-dessous
--   par sûreté).
-- =============================================================================

-- ─── 1. Worker logistique : exclut la famille `attribution_job` ─────────────
CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_batch(
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
      -- Famille logistique : les jobs applicatifs `attribution_job` ont leur
      -- propre claim (fn_claim_outbox_attribution_batch).
      AND e.consumer IS DISTINCT FROM 'attribution_job'
      AND NOT EXISTS (
        -- head-of-line PAR collecte, calculé DANS la famille logistique : un
        -- event antérieur non 'done' bloque ('dead' compris, OUTBOX-02) — mais
        -- une notification `attribution_job` ne bloque JAMAIS un dispatch.
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut <> 'done'
          AND e2.consumer IS DISTINCT FROM 'attribution_job'
      )
    ORDER BY e.seq
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE plateforme.outbox_events oe
  SET
    statut        = 'processing',
    claimed_until = now() + p_lease_duration,
    attempts      = oe.attempts + 1   -- claim-before-POST (§04 l.2328) : conservé
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

REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  TO service_role;

-- ─── 2. Job attribution : claim dédié à la famille `attribution_job` ────────
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

-- `CREATE FUNCTION` donne EXECUTE à PUBLIC : on ferme explicitement les trois
-- (cf. P0 20260903130000 — un REVOKE FROM PUBLIC seul ne retire pas un GRANT
-- authenticated/anon).
REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_attribution_batch(integer, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_attribution_batch(integer, interval)
  TO service_role;
