-- =============================================================================
-- M1.5b — relève MTS-1 : ce que l'adapter demande à la base, joué sur une vraie
-- base (les tests Vitest de l'adapter simulent la base et ne peuvent pas le voir).
-- =============================================================================
-- DÉFAUT À L'ORIGINE DE CE FICHIER. La relève réservait le statut d'une commande
-- par `upsert(..., { onConflict: 'source,event_id_externe', ignoreDuplicates })`,
-- soit `INSERT ... ON CONFLICT (source, event_id_externe) DO NOTHING`. Or l'index
-- unique de integrations_inbox est PARTIEL (`WHERE event_id_externe IS NOT NULL`)
-- et PostgreSQL ne l'infère pas sans son prédicat : 42P10. Mesuré le 2026-10-13
-- sur la base locale, en SQL et par l'API. La réservation échouait donc pour
-- chaque commande, et rien n'était relevé.
--
-- Vérifie, sous le rôle `service_role` (celui de la relève) :
--   1. la réservation par INSERT nu : première insérée, doublon refusé en 23505,
--      autre statut de la même commande accepté ;
--   2. l'écriture en `ON CONFLICT` sans prédicat reste refusée (42P10) — si cette
--      assertion échoue, l'index a changé : revoir `reserverStatut`
--      (packages/adapters/src/mts1/adapter.ts) ;
--   3. l'upsert d'une pesée par (tournee_id, stop_id, flux_id) est, lui, inférable.
--      Prouvé par EXPLAIN, qui planifie sans exécuter : l'inférence se joue au
--      planificateur (un PREPARE ne la fait pas, mesuré le 2026-10-14 sur un
--      PostgreSQL 16 : il passe, seul l'EXECUTE lève 42P10). Un témoin montre
--      qu'EXPLAIN voit bien 42P10 (`releve_base_explain_voit_42p10`).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

SET LOCAL ROLE service_role;

-- ── 1. Réservation d'un statut par INSERT nu ─────────────────────────────────
SELECT lives_ok(
  $$ INSERT INTO plateforme.integrations_inbox (source, event_type, event_id_externe, payload)
     VALUES ('mts1', 'order_status', 'mts1:commande-pgtap:OK', '{}') $$,
  'M1.5b/releve_base_reservation_inseree — un statut jamais vu est réservé par un INSERT nu'
);

SELECT throws_ok(
  $$ INSERT INTO plateforme.integrations_inbox (source, event_type, event_id_externe, payload)
     VALUES ('mts1', 'order_status', 'mts1:commande-pgtap:OK', '{}') $$,
  '23505',
  NULL,
  'M1.5b/releve_base_reservation_doublon — le même statut de la même commande est refusé en 23505'
);

SELECT lives_ok(
  $$ INSERT INTO plateforme.integrations_inbox (source, event_type, event_id_externe, payload)
     VALUES ('mts1', 'order_status', 'mts1:commande-pgtap:ARCHIVED', '{}') $$,
  'M1.5b/releve_base_reservation_autre_statut — un autre statut de la même commande est réservé'
);

-- ── 2. L'écriture d'avant reste refusée ──────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO plateforme.integrations_inbox (source, event_type, event_id_externe, payload)
     VALUES ('mts1', 'order_status', 'mts1:commande-pgtap:KO', '{}')
     ON CONFLICT (source, event_id_externe) DO NOTHING $$,
  '42P10',
  NULL,
  'M1.5b/releve_base_on_conflict_refuse — ON CONFLICT (source, event_id_externe) sans prédicat : 42P10, index partiel non inféré'
);

SELECT throws_ok(
  $$ EXPLAIN INSERT INTO plateforme.integrations_inbox (source, event_type, event_id_externe, payload)
     VALUES ('mts1', 'order_status', 'mts1:commande-pgtap:KO', '{}')
     ON CONFLICT (source, event_id_externe) DO NOTHING $$,
  '42P10',
  NULL,
  'M1.5b/releve_base_explain_voit_42p10 — EXPLAIN de cette écriture lève aussi 42P10 (il planifie la requête)'
);

-- ── 3. Upsert d'une pesée ────────────────────────────────────────────────────
-- EXPLAIN planifie sans exécuter : l'inférence de la contrainte de conflit s'y
-- joue, sans avoir à créer une tournée et un flux.
SELECT lives_ok(
  $$ EXPLAIN INSERT INTO plateforme.pesees_tournees (tournee_id, stop_id, flux_id, poids_kg)
     VALUES (gen_random_uuid(), 'arret-pgtap', gen_random_uuid(), 12)
     ON CONFLICT (tournee_id, stop_id, flux_id)
     DO UPDATE SET poids_kg = EXCLUDED.poids_kg, updated_at = now() $$,
  'M1.5b/releve_base_upsert_pesee — ON CONFLICT (tournee_id, stop_id, flux_id) est inférable'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
