-- =============================================================================
-- M1.5a — Outbox worker lease/claim
-- =============================================================================
-- 1. collecte_tournees.rang : identifiant de rang multi-camions (1..N)
-- 2. outbox_events.next_retry_at : timestamp de prochaine tentative (retry paliers)
-- 3. fn_claim_outbox_batch() : TX courte de claim, SKIP LOCKED, visibilité txid
-- 4. fn_result_outbox() : TX de résultat (done/failed/dead)
-- 5. fn_reap_outbox_claims() : reaper claims expirés
-- =============================================================================

-- ─── 1. collecte_tournees.rang ───────────────────────────────────────────────
-- Identifiant de rang pour multi-camions (1 = mono-camion ou premier camion).
-- Contrainte UNIQUE (collecte_id, rang) : 2 camions ne peuvent pas partager le même rang.

ALTER TABLE plateforme.collecte_tournees
  ADD COLUMN IF NOT EXISTS rang smallint NOT NULL DEFAULT 1;

ALTER TABLE plateforme.collecte_tournees
  DROP CONSTRAINT IF EXISTS uniq_collecte_tournee_rang;

ALTER TABLE plateforme.collecte_tournees
  ADD CONSTRAINT uniq_collecte_tournee_rang UNIQUE (collecte_id, rang);

-- ─── 2. outbox_events.next_retry_at ─────────────────────────────────────────
-- NULL = éligible immédiatement. Renseigné sur FAILED avec les paliers de retry.

ALTER TABLE plateforme.outbox_events
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_outbox_next_retry
  ON plateforme.outbox_events (next_retry_at)
  WHERE statut = 'failed' AND next_retry_at IS NOT NULL;

-- ─── 3. fn_claim_outbox_batch ────────────────────────────────────────────────
-- TX courte : claim jusqu'à p_limit events éligibles.
-- Garde de visibilité txid : ne lit pas les events non encore commités.
-- Head-of-line blocking par aggregate_id : skip si un event antérieur (seq plus petit)
--   du même agrégat est encore non consommé (statut NOT IN done, dead).
-- RETURNS TABLE : les lignes claimées (id, aggregate_type, aggregate_id,
--   event_type, payload, consumer, attempts, requires_reconciliation).

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
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH eligibles AS (
    SELECT e.id
    FROM plateforme.outbox_events e
    WHERE e.statut IN ('pending', 'failed')
      AND (e.next_retry_at IS NULL OR e.next_retry_at <= now())
      AND e.txid < pg_snapshot_xmin(pg_current_snapshot())
      AND NOT EXISTS (
        -- head-of-line blocking : un event antérieur du même agrégat est en attente
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut NOT IN ('done', 'dead')
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

-- ─── 4. fn_result_outbox ─────────────────────────────────────────────────────
-- TX de résultat après traitement HTTP (hors transaction).
-- p_statut : 'done' | 'failed' | 'dead'
-- p_consumer : override du consumer (ex: 'noop_no_remote')
-- p_next_retry_at : planifié côté TypeScript selon le palier (attempts)
-- p_requires_reconciliation : set à true sur AMBIGUOUS (timeout)

CREATE OR REPLACE FUNCTION plateforme.fn_result_outbox(
  p_id                      uuid,
  p_statut                  text,
  p_last_error              text          DEFAULT NULL,
  p_consumer                text          DEFAULT NULL,
  p_next_retry_at           timestamptz   DEFAULT NULL,
  p_requires_reconciliation boolean       DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE plateforme.outbox_events
  SET
    statut                  = p_statut::plateforme.outbox_statut_enum,
    claimed_until           = NULL,
    last_error              = COALESCE(p_last_error, last_error),
    consumer                = COALESCE(p_consumer, consumer),
    next_retry_at           = p_next_retry_at,
    requires_reconciliation = CASE
      WHEN p_statut = 'done' THEN false
      ELSE p_requires_reconciliation
    END,
    processed_at            = CASE
      WHEN p_statut IN ('done', 'dead') THEN now()
      ELSE processed_at
    END
  WHERE id = p_id;
END;
$$;

-- ─── 5. fn_reap_outbox_claims ────────────────────────────────────────────────
-- Reaper : re-queue les claims expirés avec requires_reconciliation = true.
-- Appelé en début de chaque run du worker (avant fn_claim_outbox_batch).

CREATE OR REPLACE FUNCTION plateforme.fn_reap_outbox_claims()
RETURNS integer   -- nombre d'events re-queued
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE plateforme.outbox_events
  SET
    statut                  = 'pending',
    claimed_until           = NULL,
    requires_reconciliation = true
  WHERE statut = 'processing'
    AND claimed_until < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
