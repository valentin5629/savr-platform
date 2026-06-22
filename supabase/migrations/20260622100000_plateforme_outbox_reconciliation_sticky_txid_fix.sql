-- =============================================================================
-- Fix Lot A — Concurrence & idempotence outbox (A1 + A3b)
-- =============================================================================
-- Remplace 2 fonctions de la migration 20260614150000 (corps repris VERBATIM,
-- seules les lignes visées changent — méthode E2 du brief d'audit).
--
-- A1 — Re-POST en doublon sans réconciliation : `requires_reconciliation`
--   devient STICKY dans fn_result_outbox (ne retombe qu'au succès 'done').
--   Avant ce fix, un résultat 'failed' SANS p_requires_reconciliation (palier
--   TRANSIENT générique, ou échec du scan de réconciliation lui-même)
--   RÉINITIALISAIT le flag à false → un event passé en AMBIGUOUS (timeout,
--   flag=true) puis re-échouant sur du TRANSIENT perdait l'obligation de
--   réconciliation → re-POST à l'aveugle = 2e customerOrder MTS-1.
--   Conforme §04 (l.2311/2331/2339) : « toute reprise DOIT exécuter la
--   réconciliation AVANT tout re-POST ».
--
-- A3b — Bug latent (garde de visibilité txid). La fonction comparait
--   e.txid (bigint, posé par txid_current()) à
--   pg_snapshot_xmin(pg_current_snapshot()) (xid8) → « operator does not exist:
--   bigint < xid8 » dès qu'une ligne éligible existe → la fonction échouait à
--   CHAQUE run avec un event en attente (jamais détecté : worker testé en mock
--   TS seulement). On utilise l'API bigint cohérente avec la colonne txid.
--   NB : la garde littérale figure telle quelle dans §04 l.2328 (SQL invalide en
--   PG15) → DIVERGENCE de type « clair » à reporter (bug factuel de la spec).
--
-- NON inclus ici (volontairement) :
--   - A5 (déplacer l'incrément `attempts` du claim vers l'échec) : CONTREDIT
--     §04 l.2328 (« attempts incrémenté AVANT tout HTTP, claim-before-POST »),
--     décision gelée 2026-06-11 R2. Escaladé à Val (conflit brief d'audit ↔ §04).
--     → fn_claim_outbox_batch CONSERVE `attempts = attempts + 1` au claim.
-- =============================================================================

-- ─── fn_claim_outbox_batch — A3b : garde de visibilité txid (bigint) ─────────
-- (Conserve l'incrément `attempts` au claim, conforme §04 l.2328.)
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
      -- A3b : API bigint (cohérente avec la colonne txid) au lieu de
      --       pg_snapshot_xmin(pg_current_snapshot()) (xid8) → opérateur inexistant.
      AND e.txid < txid_snapshot_xmin(txid_current_snapshot())
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

-- ─── fn_result_outbox — A1 : requires_reconciliation STICKY ──────────────────
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
    -- A1 : flag STICKY — ne retombe qu'au succès. Un échec qui ne demande pas
    --      explicitement de réconciliation ne doit JAMAIS effacer une obligation
    --      déjà posée (sinon re-POST à l'aveugle = doublon MTS-1).
    requires_reconciliation = CASE
      WHEN p_statut = 'done' THEN false
      ELSE (requires_reconciliation OR p_requires_reconciliation)
    END,
    processed_at            = CASE
      WHEN p_statut IN ('done', 'dead') THEN now()
      ELSE processed_at
    END
  WHERE id = p_id;
END;
$$;
