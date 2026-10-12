-- =============================================================================
-- Outbox — réservation ciblée des ordres d'UNE collecte (migration 20261012113000).
-- VRAI chemin DB (pas de mock).
-- =============================================================================
-- `fn_claim_outbox_collecte` sert l'envoi immédiat au clic (Val 2026-10-12). Elle
-- recopie les règles de `fn_claim_outbox_batch`, bornées à une collecte. Deux
-- choses sont prouvées ici :
--   1. le ciblage : elle ne touche QUE les ordres de la collecte demandée, un à
--      la fois, dans l'ordre ;
--   2. la parité : chaque règle (head-of-line — ordre précédent 'dead', 'failed'
--      ou en cours —, palier de reprise, famille logistique, visibilité txid,
--      bail de 2 minutes) rend le MÊME verdict sur les deux fonctions, mesuré sur
--      des agrégats jumeaux (suffixe 1 = ciblée, 2 = lot). Une règle retouchée
--      d'un seul côté fait rougir sa paire ;
--   3. le contrat de sortie : la ligne rendue porte l'ordre tel qu'il est en file
--      (type d'ordre, agrégat, payload, destinataire, drapeau « à réconcilier »).
--      Le worker route et réconcilie d'après ces colonnes.
--
-- Limite : pgTAP tourne dans UNE session. L'exclusion entre deux passages
-- simultanés (FOR UPDATE SKIP LOCKED) ne s'y rejoue pas ; seule la présence de
-- la clause dans le corps des fonctions de réservation est épinglée (§5).
--
-- Ordres réservables : txid=1 (committé) — la garde `txid < txid_snapshot_xmin(...)`
-- exclut sinon les ordres de la transaction courante. UUID stricts hex.
-- Le lot est réclamé avec une limite très haute : sur une base déjà peuplée, une
-- limite basse s'arrêterait avant les jumeaux et rendrait les « 0 » vacants.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(34);

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Ciblage : seule la collecte demandée est touchée
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('ea000000-0000-0000-0000-000000000001', 1, 'collecte',
        'ca000000-0000-0000-0000-00000000000a', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('eb000000-0000-0000-0000-000000000001', 1, 'collecte',
        'cb000000-0000-0000-0000-00000000000b', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');

CREATE TEMP TABLE claim_a ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_collecte('ca000000-0000-0000-0000-00000000000a');

SELECT is(
  (SELECT string_agg(id::text, ',') FROM claim_a),
  'ea000000-0000-0000-0000-000000000001',
  'Ciblage : la réservation rend l''ordre de la collecte demandée, et lui seul');

SELECT is(
  (SELECT statut::text || '/' || attempts::text FROM plateforme.outbox_events
    WHERE id = 'eb000000-0000-0000-0000-000000000001'),
  'pending/0',
  'Ciblage : l''ordre d''une AUTRE collecte reste en attente, sans tentative comptée');

-- `now()` est constant dans la transaction : l'écart est exactement le bail.
SELECT is(
  (SELECT statut::text || '/' || attempts::text || '/' || (claimed_until - now())::text
     FROM plateforme.outbox_events WHERE id = 'ea000000-0000-0000-0000-000000000001'),
  'processing/1/00:02:00',
  'Réservation standard : processing, attempts incrémenté avant tout appel, bail par défaut de 2 minutes');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('ca000000-0000-0000-0000-00000000000a')),
  0,
  'Ordre déjà en cours (processing) : il n''est pas réservable une seconde fois');

-- Bail demandé par l'appelant : respecté tel quel.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e5000000-0000-0000-0000-000000000001', 1, 'collecte',
        'c5000000-0000-0000-0000-000000000005', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');
-- Réservation dans une instruction à part : la requête qui appelle la fonction ne
-- voit pas encore la ligne qu'elle vient de modifier.
CREATE TEMP TABLE claim_bail ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_collecte('c5000000-0000-0000-0000-000000000005', interval '7 minutes');
SELECT is(
  (SELECT (o.claimed_until - now())::text
     FROM claim_bail c JOIN plateforme.outbox_events o ON o.id = c.id),
  '00:07:00',
  'Bail : la durée passée en paramètre est celle qui est posée');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Un ordre à la fois, dans l'ordre de la file
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e9000000-0000-0000-0000-000000000001', 1, 'collecte',
        'c9000000-0000-0000-0000-000000000009', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e9000000-0000-0000-0000-000000000002', 1, 'collecte',
        'c9000000-0000-0000-0000-000000000009', 'collecte.modifiee', '{}'::jsonb, 'pending', 'adapter_mts1');

SELECT is(
  (SELECT string_agg(id::text, ',') FROM plateforme.fn_claim_outbox_collecte('c9000000-0000-0000-0000-000000000009')),
  'e9000000-0000-0000-0000-000000000001',
  'Ordre : deux ordres en attente → seul le plus ancien est rendu');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('c9000000-0000-0000-0000-000000000009')),
  0,
  'Ordre : tant que le premier est en cours, le suivant reste bloqué (jamais deux ordres d''une collecte en vol)');

UPDATE plateforme.outbox_events SET statut = 'done', processed_at = now()
 WHERE id = 'e9000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT string_agg(id::text, ',') FROM plateforme.fn_claim_outbox_collecte('c9000000-0000-0000-0000-000000000009')),
  'e9000000-0000-0000-0000-000000000002',
  'Ordre : une fois le premier terminé, l''appel suivant rend le second');

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Bornée aux collectes : un ordre « lieu » n'est jamais pris par cette voie
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e7000000-0000-0000-0000-000000000001', 1, 'lieu',
        'c7000000-0000-0000-0000-000000000007', 'lieu.champ_critique_modifie', '{}'::jsonb, 'pending', 'adapter_mts1');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('c7000000-0000-0000-0000-000000000007')),
  0,
  'Périmètre : un ordre d''agrégat « lieu » n''est pas réservé par la voie ciblée');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Parité des règles — agrégats jumeaux (…1 = ciblée, …2 = lot planifié)
-- ════════════════════════════════════════════════════════════════════════════
-- F : un ordre 'dead' bloque le suivant (OUTBOX-02).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer) VALUES
  ('ef100000-0000-0000-0000-000000000001', 1, 'collecte', 'cf000000-0000-0000-0000-0000000000f1', 'collecte.creee',    '{}'::jsonb, 'dead',    'adapter_mts1'),
  ('ef100000-0000-0000-0000-000000000002', 1, 'collecte', 'cf000000-0000-0000-0000-0000000000f1', 'collecte.modifiee', '{}'::jsonb, 'pending', 'adapter_mts1'),
  ('ef200000-0000-0000-0000-000000000001', 1, 'collecte', 'cf000000-0000-0000-0000-0000000000f2', 'collecte.creee',    '{}'::jsonb, 'dead',    'adapter_mts1'),
  ('ef200000-0000-0000-0000-000000000002', 1, 'collecte', 'cf000000-0000-0000-0000-0000000000f2', 'collecte.modifiee', '{}'::jsonb, 'pending', 'adapter_mts1');

-- E : ordre en échec dont le palier de reprise n'est pas atteint, SUIVI d'un
-- nouvel ordre en attente (l'Admin a recliqué). Ni l'un ni l'autre ne part : le
-- premier attend son palier, le second attend le premier.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer, attempts, next_retry_at) VALUES
  ('ee100000-0000-0000-0000-000000000001', 1, 'collecte', 'ce000000-0000-0000-0000-0000000000e1', 'collecte.creee', '{}'::jsonb, 'failed', 'adapter_mts1', 1, now() + interval '1 hour'),
  ('ee200000-0000-0000-0000-000000000001', 1, 'collecte', 'ce000000-0000-0000-0000-0000000000e2', 'collecte.creee', '{}'::jsonb, 'failed', 'adapter_mts1', 1, now() + interval '1 hour');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer) VALUES
  ('ee100000-0000-0000-0000-000000000002', 1, 'collecte', 'ce000000-0000-0000-0000-0000000000e1', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1'),
  ('ee200000-0000-0000-0000-000000000002', 1, 'collecte', 'ce000000-0000-0000-0000-0000000000e2', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');

-- D : ordre en échec dont le palier de reprise est atteint, SUIVI d'un nouvel
-- ordre en attente. C'est l'ordre en échec qui repart, jamais le suivant.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer, attempts, next_retry_at) VALUES
  ('ed100000-0000-0000-0000-000000000001', 1, 'collecte', 'cd000000-0000-0000-0000-0000000000d1', 'collecte.creee', '{}'::jsonb, 'failed', 'adapter_mts1', 1, now() - interval '1 minute'),
  ('ed200000-0000-0000-0000-000000000001', 1, 'collecte', 'cd000000-0000-0000-0000-0000000000d2', 'collecte.creee', '{}'::jsonb, 'failed', 'adapter_mts1', 1, now() - interval '1 minute');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer) VALUES
  ('ed100000-0000-0000-0000-000000000002', 1, 'collecte', 'cd000000-0000-0000-0000-0000000000d1', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1'),
  ('ed200000-0000-0000-0000-000000000002', 1, 'collecte', 'cd000000-0000-0000-0000-0000000000d2', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');

-- C : un job d'attribution antérieur (autre famille) ne bloque pas le dispatch et
-- n'est jamais réservé par la famille logistique.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer) VALUES
  ('ec100000-0000-0000-0000-000000000001', 1, 'collecte', 'cc000000-0000-0000-0000-0000000000c1', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('ec100000-0000-0000-0000-000000000002', 1, 'collecte', 'cc000000-0000-0000-0000-0000000000c1', 'collecte.creee',      '{}'::jsonb, 'pending', NULL),
  ('ec200000-0000-0000-0000-000000000001', 1, 'collecte', 'cc000000-0000-0000-0000-0000000000c2', 'attribution.validee', '{}'::jsonb, 'pending', 'attribution_job'),
  ('ec200000-0000-0000-0000-000000000002', 1, 'collecte', 'cc000000-0000-0000-0000-0000000000c2', 'collecte.creee',      '{}'::jsonb, 'pending', NULL);

-- R : ordre de MODIFICATION remis en file après un passage mort (drapeau « à
-- réconcilier avant tout renvoi » posé), payload non vide. Sert le contrat de
-- sortie : chaque colonne rendue doit être celle de la ligne.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer, attempts, requires_reconciliation) VALUES
  ('e4100000-0000-0000-0000-000000000001', 1, 'collecte', 'c4000000-0000-0000-0000-000000000041', 'collecte.modifiee',
   '{"collecte_id": "c4000000-0000-0000-0000-000000000041", "champs": ["date_collecte"]}'::jsonb, 'pending', 'adapter_mts1', 1, true),
  ('e4200000-0000-0000-0000-000000000001', 1, 'collecte', 'c4000000-0000-0000-0000-000000000042', 'collecte.modifiee',
   '{"collecte_id": "c4000000-0000-0000-0000-000000000042", "champs": ["date_collecte"]}'::jsonb, 'pending', 'adapter_mts1', 1, true);

-- B bis : ordre écrit par la transaction COURANTE (txid par défaut) → pas encore
-- visible : sa transaction n'est pas terminée.
INSERT INTO plateforme.outbox_events (id, aggregate_type, aggregate_id, event_type, payload, statut, consumer) VALUES
  ('e8100000-0000-0000-0000-000000000001', 'collecte', 'c8000000-0000-0000-0000-000000000081', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1'),
  ('e8200000-0000-0000-0000-000000000001', 'collecte', 'c8000000-0000-0000-0000-000000000082', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');

-- Voie ciblée sur les agrégats …1 (avant le lot, qui ramasserait tout le reste).
SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('cf000000-0000-0000-0000-0000000000f1')),
  0, 'Parité F (ciblée) : un ordre dead bloque le suivant de la collecte');
SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('ce000000-0000-0000-0000-0000000000e1')),
  0, 'Parité E (ciblée) : palier de reprise non atteint → ni l''ordre en échec ni le suivant ne sont réservés');
SELECT is(
  (SELECT string_agg(id::text || '/' || attempts::text, ',')
     FROM plateforme.fn_claim_outbox_collecte('cd000000-0000-0000-0000-0000000000d1')),
  'ed100000-0000-0000-0000-000000000001/2',
  'Parité D (ciblée) : palier de reprise atteint → l''ordre en échec est réservé (tentative comptée), pas le suivant');
SELECT is(
  (SELECT string_agg(id::text, ',') FROM plateforme.fn_claim_outbox_collecte('cc000000-0000-0000-0000-0000000000c1')),
  'ec100000-0000-0000-0000-000000000002',
  'Parité C (ciblée) : le dispatch part malgré un job d''attribution antérieur non terminé');
SELECT is(
  (SELECT statut::text FROM plateforme.outbox_events WHERE id = 'ec100000-0000-0000-0000-000000000001'),
  'pending', 'Parité C (ciblée) : le job d''attribution n''est pas avalé par la voie logistique');
SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_collecte('c8000000-0000-0000-0000-000000000081')),
  0, 'Parité visibilité (ciblée) : un ordre dont la transaction n''est pas terminée n''est pas réservable');

-- Contrat de sortie (ciblée) : la ligne rendue, colonne par colonne.
SELECT is(
  (SELECT concat_ws('|', id, aggregate_type, aggregate_id, event_type,
                    (payload = '{"collecte_id": "c4000000-0000-0000-0000-000000000041", "champs": ["date_collecte"]}'::jsonb),
                    consumer, attempts, requires_reconciliation)
     FROM plateforme.fn_claim_outbox_collecte('c4000000-0000-0000-0000-000000000041')),
  'e4100000-0000-0000-0000-000000000001|collecte|c4000000-0000-0000-0000-000000000041|collecte.modifiee|t|adapter_mts1|2|t',
  'Sortie (ciblée) : type d''ordre, agrégat, payload, destinataire, tentative et drapeau « à réconcilier » sont ceux de la ligne');
SELECT is(
  (SELECT requires_reconciliation::text FROM plateforme.outbox_events
    WHERE id = 'e4100000-0000-0000-0000-000000000001'),
  'true',
  'Sortie (ciblée) : la réservation n''efface pas le drapeau « à réconcilier » en base');

-- Lot planifié sur les agrégats …2.
CREATE TEMP TABLE claim_lot ON COMMIT DROP AS
  SELECT * FROM plateforme.fn_claim_outbox_batch(100000);

SELECT is(
  (SELECT concat_ws('|', id, aggregate_type, aggregate_id, event_type,
                    (payload = '{"collecte_id": "c4000000-0000-0000-0000-000000000042", "champs": ["date_collecte"]}'::jsonb),
                    consumer, attempts, requires_reconciliation)
     FROM claim_lot WHERE aggregate_id = 'c4000000-0000-0000-0000-000000000042'),
  'e4200000-0000-0000-0000-000000000001|collecte|c4000000-0000-0000-0000-000000000042|collecte.modifiee|t|adapter_mts1|2|t',
  'Sortie (lot) : même ligne rendue que la voie ciblée');

SELECT is(
  (SELECT count(*)::int FROM claim_lot WHERE aggregate_id = 'cf000000-0000-0000-0000-0000000000f2'),
  0, 'Parité F (lot) : un ordre dead bloque le suivant de la collecte');
SELECT is(
  (SELECT count(*)::int FROM claim_lot WHERE aggregate_id = 'ce000000-0000-0000-0000-0000000000e2'),
  0, 'Parité E (lot) : palier de reprise non atteint → ni l''ordre en échec ni le suivant ne sont réservés');
SELECT is(
  (SELECT string_agg(id::text || '/' || attempts::text, ',') FROM claim_lot
    WHERE aggregate_id = 'cd000000-0000-0000-0000-0000000000d2'),
  'ed200000-0000-0000-0000-000000000001/2',
  'Parité D (lot) : palier de reprise atteint → l''ordre en échec est réservé (tentative comptée), pas le suivant');
SELECT is(
  (SELECT (claimed_until - now())::text FROM plateforme.outbox_events
    WHERE id = 'ed200000-0000-0000-0000-000000000001'),
  '00:02:00',
  'Parité bail (lot) : bail par défaut de 2 minutes, comme la voie ciblée');
SELECT is(
  (SELECT string_agg(id::text, ',') FROM claim_lot
    WHERE aggregate_id = 'cc000000-0000-0000-0000-0000000000c2'),
  'ec200000-0000-0000-0000-000000000002',
  'Parité C (lot) : le dispatch part malgré un job d''attribution antérieur non terminé');
SELECT is(
  (SELECT count(*)::int FROM claim_lot WHERE aggregate_id = 'c8000000-0000-0000-0000-000000000082'),
  0, 'Parité visibilité (lot) : un ordre dont la transaction n''est pas terminée n''est pas réservable');

-- Non-vacuité du lot : il a bien ramassé ce que la voie ciblée a laissé — l'ordre
-- de l'autre collecte (§1) et l'ordre « lieu » (§3). Les « 0 » ci-dessus ne
-- viennent donc pas d'un lot vide.
SELECT is(
  (SELECT count(*)::int FROM claim_lot
    WHERE id IN ('eb000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001')),
  2,
  'Non-vacuité : le lot planifié réserve l''ordre de l''autre collecte et l''ordre « lieu »');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Fermeture : aucun client ne peut appeler la fonction
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege('authenticated', 'plateforme.fn_claim_outbox_collecte(uuid, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_collecte fermée à authenticated');
SELECT ok(
  NOT has_function_privilege('anon', 'plateforme.fn_claim_outbox_collecte(uuid, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_collecte fermée à anon');
SELECT ok(
  NOT has_function_privilege('public', 'plateforme.fn_claim_outbox_collecte(uuid, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_collecte fermée à PUBLIC');
SELECT ok(
  has_function_privilege('service_role', 'plateforme.fn_claim_outbox_collecte(uuid, interval)', 'EXECUTE'),
  'Privilèges : fn_claim_outbox_collecte ouverte à service_role');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme'
       AND p.proname = 'fn_claim_outbox_collecte'
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=plateforme, pg_catalog']),
  1,
  'Attributs : SECURITY DEFINER avec search_path figé');

-- Exclusion entre passages simultanés : non rejouable dans une session unique
-- (cf. en-tête). On épingle la clause dans le corps des trois réservations,
-- seule sur sa ligne : mise en commentaire, elle ne compte pas.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme'
       AND p.proname IN ('fn_claim_outbox_collecte', 'fn_claim_outbox_batch', 'fn_claim_outbox_attribution_batch')
       AND p.prosrc ~ E'\\n\\s*FOR UPDATE SKIP LOCKED\\s*\\n'),
  3,
  'Corps : les trois fonctions de réservation portent FOR UPDATE SKIP LOCKED');

-- Refus EFFECTIF sous le rôle d'un client connecté, puis d'un visiteur : 42501
-- avant l'exécution du corps (l'ordre visé reste intact, cf. assertion suivante).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('e6000000-0000-0000-0000-000000000001', 1, 'collecte',
        'c6000000-0000-0000-0000-000000000006', 'collecte.creee', '{}'::jsonb, 'pending', 'adapter_mts1');

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT * FROM plateforme.fn_claim_outbox_collecte('c6000000-0000-0000-0000-000000000006') $$,
  '42501', NULL::text,
  'Refus effectif : un client connecté (authenticated) reçoit 42501');
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT * FROM plateforme.fn_claim_outbox_collecte('c6000000-0000-0000-0000-000000000006') $$,
  '42501', NULL::text,
  'Refus effectif : un visiteur (anon) reçoit 42501');
RESET ROLE;

SELECT is(
  (SELECT statut::text || '/' || attempts::text FROM plateforme.outbox_events
    WHERE id = 'e6000000-0000-0000-0000-000000000001'),
  'pending/0',
  'Refus effectif : l''ordre visé par les deux appels refusés n''a pas bougé');

SELECT * FROM finish();
ROLLBACK;
