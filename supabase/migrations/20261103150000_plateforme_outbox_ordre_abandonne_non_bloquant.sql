-- =============================================================================
-- Outbox — un ordre abandonné ne bloque plus les ordres suivants de sa collecte
-- =============================================================================
-- Décision Val du 2026-11-03 (C1, C2, C4) : un ordre logistique abandonné
-- (`statut = 'dead'` : erreur définitive, ou 4 tentatives épuisées) ne bloque
-- plus les ordres suivants de la même collecte. Avant, il les bloquait tous
-- (head-of-line OUTBOX-02, `dead` compris) jusqu'à ce que l'équipe technique le
-- débloque en base (`fn_admin_skip_outbox` / `fn_admin_requeue_outbox`).
--
-- Désormais l'Admin corrige la cause sur la fiche (par exemple le prestataire)
-- et reclique sur l'envoi : le nouvel ordre part. L'ordre abandonné reste en
-- base, tel quel (`dead`, avec son erreur), pour la trace et pour la fiche, qui
-- l'affiche tant qu'aucun ordre de même nature ne l'a remplacé
-- (lib/ordre-envoi.ts).
--
-- Garde contre le doublon de commande (revue sécurité 2026-11-03) : un ordre
-- abandonné après une erreur ambiguë porte `requires_reconciliation = true` (la
-- commande a pu être créée chez le prestataire sans que sa référence soit
-- enregistrée). Avant, rien ne passait derrière lui. Désormais l'ordre suivant
-- de la collecte (renvoi depuis la fiche, ou modification qui recrée un rang
-- manquant) est rendu avec ce même drapeau : l'adapter relit la commande par
-- sa clé, stable d'un ordre à l'autre, avant tout POST (CLAUDE.md §2). Le
-- drapeau est rendu, pas écrit : il est recalculé à chaque réservation.
--
-- Ce qui ne change pas :
--   - un ordre en file (`pending`), en cours (`processing`) ou en échec avec
--     reprise planifiée (`failed`) bloque toujours les suivants : l'ordre
--     d'envoi d'une collecte reste celui des clics tant qu'un ordre peut
--     encore partir ;
--   - une annulation abandonnée garde son alerte Slack critique (posée par le
--     worker au passage en `dead`) : le transporteur doit être prévenu à la main ;
--   - les fonctions de déblocage en base restent disponibles.
--
-- C4 : les ordres déjà abandonnés à l'application de cette migration cessent de
-- bloquer d'eux-mêmes, aucune donnée n'est touchée.
--
-- Les deux réservations de la famille logistique changent ensemble (le test
-- pgTAP `outbox_claim_collecte.test.sql` épingle leur parité). La famille
-- `attribution_job` (emails d'attribution) n'est pas concernée.
--
-- ⚠ CREATE OR REPLACE réinitialise search_path : `SET search_path` ré-inclus.
-- Signatures inchangées ; privilèges re-posés (service_role seul).
--
-- Retour arrière : rejouer `fn_claim_outbox_batch` de 20260911150000 et
-- `fn_claim_outbox_collecte` de 20261012113000 (prédicat `e2.statut <> 'done'`).
-- =============================================================================

-- ─── 1. Passage planifié ────────────────────────────────────────────────────
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
      AND e.consumer IS DISTINCT FROM 'attribution_job'
      AND NOT EXISTS (
        -- head-of-line PAR collecte, dans la famille logistique : un ordre
        -- antérieur encore susceptible de partir bloque ; un ordre terminé
        -- (`done`) ou abandonné (`dead`, Val 2026-11-03) ne bloque pas.
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut NOT IN ('done', 'dead')
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
    -- « À réconcilier » hérité : un ordre antérieur abandonné dans le doute
    -- (erreur ambiguë, la commande a pu être créée chez le prestataire) impose
    -- de relire avant tout POST à l'ordre qui passe derrière lui.
    (oe.requires_reconciliation OR EXISTS (
      SELECT 1
      FROM plateforme.outbox_events d
      WHERE d.aggregate_id = oe.aggregate_id
        AND d.seq < oe.seq
        AND d.statut = 'dead'
        AND d.requires_reconciliation
        AND d.consumer IS DISTINCT FROM 'attribution_job'
    ));
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_batch(integer, interval)
  TO service_role;

-- ─── 2. Envoi immédiat au clic (une collecte) ───────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_collecte(
  p_collecte_id uuid,
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
    WHERE e.aggregate_type = 'collecte'
      AND e.aggregate_id = p_collecte_id
      AND e.statut IN ('pending', 'failed')
      AND (e.next_retry_at IS NULL OR e.next_retry_at <= now())
      AND e.txid < txid_snapshot_xmin(txid_current_snapshot())
      AND e.consumer IS DISTINCT FROM 'attribution_job'
      AND NOT EXISTS (
        -- Même head-of-line que fn_claim_outbox_batch : `done` et `dead`
        -- ne bloquent pas (Val 2026-11-03).
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut NOT IN ('done', 'dead')
          AND e2.consumer IS DISTINCT FROM 'attribution_job'
      )
    ORDER BY e.seq
    LIMIT 1
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
    -- « À réconcilier » hérité : un ordre antérieur abandonné dans le doute
    -- (erreur ambiguë, la commande a pu être créée chez le prestataire) impose
    -- de relire avant tout POST à l'ordre qui passe derrière lui.
    (oe.requires_reconciliation OR EXISTS (
      SELECT 1
      FROM plateforme.outbox_events d
      WHERE d.aggregate_id = oe.aggregate_id
        AND d.seq < oe.seq
        AND d.statut = 'dead'
        AND d.requires_reconciliation
        AND d.consumer IS DISTINCT FROM 'attribution_job'
    ));
END;
$$;

COMMENT ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval) IS
  'Réservation (lease/claim) du plus ancien ordre logistique réservable d''UNE collecte — envoi immédiat au clic (Val 2026-10-12). Mêmes règles que fn_claim_outbox_batch (head-of-line hors ordres terminés ou abandonnés, palier de reprise, visibilité txid, attempts à la réservation). Rend 0 ou 1 ligne. service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval)
  TO service_role;
