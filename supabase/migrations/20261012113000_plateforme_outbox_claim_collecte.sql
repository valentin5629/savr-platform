-- =============================================================================
-- Outbox — réservation ciblée des ordres d'UNE collecte (envoi immédiat au clic)
-- =============================================================================
-- Décision Val du 2026-10-12 : l'ordre part vers le prestataire au moment du
-- clic, sans attendre le passage planifié du worker (toutes les 15 min). La file
-- `outbox_events` reste le seul chemin d'émission (garde-fou 4) ; le passage
-- planifié reste le filet des reprises.
--
-- Ce que fait cette fonction : la même réservation (lease/claim) que
-- `fn_claim_outbox_batch`, bornée à UNE collecte. Les règles sont recopiées à
-- l'identique, et le test pgTAP `outbox_claim_collecte.test.sql` épingle chaque
-- règle sur les deux fonctions à la fois :
--   - famille logistique seule (jamais un job `attribution_job`) ;
--   - head-of-line par collecte, 'dead' compris (OUTBOX-02) ;
--   - palier de reprise respecté (`next_retry_at`) : un clic ne court-circuite
--     pas l'attente d'une reprise ;
--   - garde de visibilité `txid < xmin` ;
--   - `attempts` incrémenté À LA RÉSERVATION, avant tout appel HTTP.
--
-- Le head-of-line ne laisse réservable qu'UN ordre à la fois par collecte (le
-- plus ancien non terminé) : la fonction rend donc 0 ou 1 ligne, et l'appelant
-- la rappelle après chaque ordre traité.
--
-- Fonction jumelle plutôt que paramètre ajouté à `fn_claim_outbox_batch` : un
-- paramètre de plus crée une surcharge (appels nommés ambigus) et obligerait à
-- remplacer la fonction du passage planifié, qui ne change pas ici. Même choix
-- que `fn_claim_outbox_attribution_batch` (20260911150000).
--
-- Accès : SECURITY DEFINER, EXECUTE réservé à `service_role` (comme les deux
-- autres réservations, cf. P0 20260903130000). Aucun client ne peut l'appeler.
--
-- Retour arrière :
--   DROP FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval);
-- Aucune donnée n'est touchée, les ordres en file restent tels quels. Le code
-- appelant journalise alors l'échec de la réservation
-- (`outbox.envoi_immediat.echec`) et l'ordre part au passage planifié.
-- =============================================================================

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
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut <> 'done'
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
    oe.requires_reconciliation;
END;
$$;

COMMENT ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval) IS
  'Réservation (lease/claim) du plus ancien ordre logistique réservable d''UNE collecte — envoi immédiat au clic (Val 2026-10-12). Mêmes règles que fn_claim_outbox_batch (head-of-line, palier de reprise, visibilité txid, attempts à la réservation). Rend 0 ou 1 ligne. service_role uniquement.';

-- Fermeture explicite : un REVOKE FROM PUBLIC seul ne retire pas un GRANT nominatif
-- hérité des privilèges par défaut du schéma (cf. P0 20260903130000).
REVOKE EXECUTE ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_claim_outbox_collecte(uuid, interval)
  TO service_role;
