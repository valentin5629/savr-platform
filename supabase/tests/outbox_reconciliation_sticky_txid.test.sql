-- =============================================================================
-- Régression Lot A — A1 (réconciliation sticky) + A3b (garde de visibilité txid)
-- =============================================================================
-- Couvre fn_claim_outbox_batch / fn_result_outbox (migration 20260622100000) :
--   A3b-1  garde txid : un event de la transaction COURANTE n'est pas claimable
--   A3b-2  un event « déjà commité » (txid ancien) est claimable + attempts++ (claim, §04 l.2328)
--   A1-1   requires_reconciliation STICKY : un 'failed' sans flag ne l'efface pas
--   A1-2   'done' réinitialise requires_reconciliation à false
--
-- Les appels à effet de bord sont encapsulés dans des blocs DO (PERFORM) pour
-- n'émettre aucun result-set parasite côté pg_prove.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
-- NB : ne PAS poser `SET search_path` ici — pgTAP (plan/is/ok/finish) est installé
-- dans le schéma `extensions` en CI (supabase test db), pas dans `plateforme`/`public`.
-- Tous les objets métier sont qualifiés `plateforme.*` ci-dessous.

SELECT plan(4);

-- ─── A3b-1 : garde txid — event de la transaction courante non claimable ─────
-- txid laissé au DEFAULT txid_current() → = transaction courante → la garde
-- `txid < txid_snapshot_xmin(...)` est fausse. (Avant le fix : ERROR bigint<xid8.)
INSERT INTO plateforme.outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', 'collecte',
        'a1a1a1a1-0000-0000-0000-000000000001', 'collecte.creee', '{}'::jsonb);

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_batch(10)
     WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a1'),
  0,
  'A3b-1 : un event de la transaction courante n''est pas claimable (garde txid)');

-- ─── A3b-2 : event « déjà commité » (txid=1) claimable + attempts++ ──────────
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a2', 1, 'collecte',
        'a2a2a2a2-0000-0000-0000-000000000002', 'collecte.creee', '{}'::jsonb);

DO $$ BEGIN PERFORM plateforme.fn_claim_outbox_batch(10); END $$;

SELECT is(
  (SELECT attempts FROM plateforme.outbox_events
     WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a2'),
  1,
  'A3b-2 : claim d''un event éligible incrémente attempts (claim-before-POST, §04 l.2328)');

-- ─── A1-1 : requires_reconciliation STICKY ───────────────────────────────────
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload)
VALUES ('aaaaaaaa-0000-0000-0000-0000000000a3', 1, 'collecte',
        'a3a3a3a3-0000-0000-0000-000000000003', 'collecte.creee', '{}'::jsonb);

DO $$ BEGIN
  -- 1er échec : AMBIGUOUS → pose le flag de réconciliation
  PERFORM plateforme.fn_result_outbox(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 'failed', 'timeout', NULL,
    (now() + interval '5 min'), true);
  -- 2e échec : TRANSIENT générique → AUCUN flag transmis (default false)
  PERFORM plateforme.fn_result_outbox(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 'failed', '503', NULL,
    (now() + interval '1 hour'));
END $$;

SELECT is(
  (SELECT requires_reconciliation FROM plateforme.outbox_events
     WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a3'),
  true,
  'A1-1 : un échec sans flag n''efface pas une réconciliation déjà exigée (sticky)');

-- ─── A1-2 : succès réinitialise le flag ──────────────────────────────────────
DO $$ BEGIN
  PERFORM plateforme.fn_result_outbox(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 'done');
END $$;

SELECT is(
  (SELECT requires_reconciliation FROM plateforme.outbox_events
     WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000a3'),
  false,
  'A1-2 : fn_result_outbox(done) réinitialise requires_reconciliation à false');

SELECT * FROM finish();
ROLLBACK;
