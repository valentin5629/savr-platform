-- =============================================================================
-- Outbox — isolation des familles de consumer (migration 20260911150000).
-- VRAI chemin DB (pas de mock).
-- =============================================================================
-- La validation d'une attribution AG émet, sur le MÊME agrégat, `attribution.validee`
-- (consumer `attribution_job`) puis `collecte.creee` (logistique). Avant correctif :
-- le worker logistique réclamait et avalait l'event d'attribution (no-op → done), et
-- le head-of-line, calculé sur tout l'agrégat, aurait laissé un email en échec
-- bloquer le dispatch. Règle vérifiée ici : chaque famille a son claim ET son
-- head-of-line.
--
-- Events claimables : txid=1 (committé) — la garde `txid < txid_snapshot_xmin(...)`
-- exclut sinon les events de la transaction courante. UUID stricts hex.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Le worker logistique n'est ni bloqué ni « nourri » par un event d'attribution
-- ════════════════════════════════════════════════════════════════════════════
-- Agrégat C : attribution.validee (seq bas, pending) puis collecte.creee
-- (consumer NULL, comme un E2/E3 émis sans consumer : NULL = famille logistique).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('c1cccccc-0000-0000-0000-000000000001', 1, 'collecte',
        'c0000000-0000-0000-0000-0000000000c1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('c2cccccc-0000-0000-0000-000000000002', 1, 'collecte',
        'c0000000-0000-0000-0000-0000000000c1', 'collecte.creee', '{}'::jsonb, 'pending', NULL);

CREATE TEMP TABLE claim_logistique ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_batch(50);

SELECT is(
  (SELECT count(*)::int FROM claim_logistique WHERE id = 'c2cccccc-0000-0000-0000-000000000002'),
  1,
  'Logistique : collecte.creee claimé malgré un attribution.validee antérieur non done (head-of-line par famille)');

SELECT is(
  (SELECT count(*)::int FROM claim_logistique WHERE id = 'c1cccccc-0000-0000-0000-000000000001'),
  0,
  'Logistique : un event attribution_job n''est JAMAIS réclamé par le worker logistique');

SELECT is(
  (SELECT statut::text FROM plateforme.outbox_events WHERE id = 'c1cccccc-0000-0000-0000-000000000001'),
  'pending',
  'Logistique : l''event d''attribution reste pending (pas avalé en done)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Le claim d'attribution ne prend QUE sa famille
-- ════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE claim_attribution ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_attribution_batch(50);

SELECT is(
  (SELECT count(*)::int FROM claim_attribution WHERE id = 'c1cccccc-0000-0000-0000-000000000001'),
  1,
  'Attribution : attribution.validee claimé par fn_claim_outbox_attribution_batch');

SELECT is(
  (SELECT count(*)::int FROM claim_attribution WHERE consumer IS DISTINCT FROM 'attribution_job'),
  0,
  'Attribution : aucun event hors famille attribution_job n''est réclamé');

SELECT is(
  (SELECT statut::text || '/' || attempts::text || '/' || (claimed_until > now())::text
     FROM plateforme.outbox_events WHERE id = 'c1cccccc-0000-0000-0000-000000000001'),
  'processing/1/true',
  'Attribution : lease/claim standard (processing, attempts++, claimed_until futur)');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Isolation dans l'autre sens : un event logistique mort ne bloque pas l'email
-- ════════════════════════════════════════════════════════════════════════════
-- Agrégat D : collecte.creee DEAD (seq bas) puis attribution.validee pending.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('d1dddddd-0000-0000-0000-000000000001', 1, 'collecte',
        'd0000000-0000-0000-0000-0000000000d1', 'collecte.creee', '{}'::jsonb, 'dead', 'adapter_mts1');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('d2dddddd-0000-0000-0000-000000000002', 1, 'collecte',
        'd0000000-0000-0000-0000-0000000000d1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_attribution_batch(50)
     WHERE id = 'd2dddddd-0000-0000-0000-000000000002'),
  1,
  'Attribution : un collecte.creee dead de la même collecte ne bloque pas l''email');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Head-of-line et retry conservés À L'INTÉRIEUR de chaque famille
-- ════════════════════════════════════════════════════════════════════════════
-- Agrégat E (attribution) : 1er event failed avec retry dans le futur, 2e pending.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer, next_retry_at)
VALUES ('e1eeeeee-0000-0000-0000-000000000001', 1, 'collecte',
        'e0000000-0000-0000-0000-0000000000e1', 'attribution.validee', '{}'::jsonb, 'failed', 'attribution_job', now() + interval '1 hour');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e2eeeeee-0000-0000-0000-000000000002', 1, 'collecte',
        'e0000000-0000-0000-0000-0000000000e1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job');

CREATE TEMP TABLE claim_attribution_e ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_attribution_batch(50);

SELECT is(
  (SELECT count(*)::int FROM claim_attribution_e WHERE id = 'e1eeeeee-0000-0000-0000-000000000001'),
  0,
  'Attribution : next_retry_at futur respecté (event failed non réclamé avant son palier)');

SELECT is(
  (SELECT count(*)::int FROM claim_attribution_e WHERE id = 'e2eeeeee-0000-0000-0000-000000000002'),
  0,
  'Attribution : head-of-line conservé dans la famille (2e event bloqué par le 1er non done)');

-- Agrégat F (logistique) : E1 dead puis E2 pending → E2 toujours bloqué (OUTBOX-02 intact).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('f1ffffff-0000-0000-0000-000000000001', 1, 'collecte',
        'f0000000-0000-0000-0000-0000000000f1', 'collecte.creee', '{}'::jsonb, 'dead', 'adapter_mts1');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('f2ffffff-0000-0000-0000-000000000002', 1, 'collecte',
        'f0000000-0000-0000-0000-0000000000f1', 'collecte.modifiee', '{}'::jsonb, 'pending', NULL);

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_batch(50)
     WHERE id = 'f2ffffff-0000-0000-0000-000000000002'),
  0,
  'Logistique : OUTBOX-02 intact — un E1 dead bloque toujours E2 de sa famille');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Durcissement : privilèges et attributs SECURITY DEFINER conservés
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_claim_outbox_attribution_batch(integer, interval)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_claim_outbox_attribution_batch(integer, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_attribution_batch fermée à authenticated et anon');

SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_claim_outbox_attribution_batch(integer, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_attribution_batch ouverte à service_role');

SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_claim_outbox_batch(integer, interval)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'plateforme.fn_claim_outbox_batch(integer, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_batch toujours fermée après CREATE OR REPLACE (P0 #263)');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme'
       AND p.proname IN ('fn_claim_outbox_batch', 'fn_claim_outbox_attribution_batch')
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=plateforme, pg_catalog']),
  2,
  'Attributs : les deux claims sont SECURITY DEFINER avec search_path figé');

SELECT * FROM finish();
ROLLBACK;
