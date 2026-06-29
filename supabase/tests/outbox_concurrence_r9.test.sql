-- =============================================================================
-- R9 — Concurrence outbox (cluster C7). VRAI chemin DB (pas de mock — G5).
-- =============================================================================
-- Couvre les fonctions de concurrence réelles :
--   BL-P1-OUTBOX-02  head-of-line : un event 'dead' BLOQUE son agrégat ('done' libère)
--   BL-P1-OUTBOX-03  fn_reap_outbox_claims : claim expiré → pending + reconciliation
--   BL-P1-OUTBOX-01  fn_admin_requeue/skip/resolve_outbox (DLQ) + gardes admin/motif/dead
--   BL-P2-36         E3 émis par RPC, trigger trg_collecte_annulee_e3 supprimé
--   BL-P2-35         pesees_tournees pt_admin = FOR SELECT (plus FOR ALL)
--
-- Les events claimables portent txid=1 (committé) — la garde de visibilité
-- `txid < txid_snapshot_xmin(...)` exclut sinon les events de la transaction courante.
-- (IDs/aggregate_id = UUID stricts hex 0-9a-f.)
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(17);

-- ─── Fixture : org + admin_savr (f_assert_audit_context exige un admin actif) ──
INSERT INTO plateforme.organisations (id, nom, type, siret)
VALUES ('99999999-0000-0000-0000-0000000000aa', 'Org R9', 'traiteur', '00000000000099');
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('99999999-0000-0000-0000-0000000000ad',
        '99999999-0000-0000-0000-0000000000aa',
        'admin-r9@savr-test.local', 'A', 'R9', 'admin_savr', true);
-- Un user non-admin pour la garde 42501
INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('99999999-0000-0000-0000-0000000000ae',
        '99999999-0000-0000-0000-0000000000aa',
        'traiteur-r9@savr-test.local', 'T', 'R9', 'traiteur_manager', true);

-- ════════════════════════════════════════════════════════════════════════════
-- BL-P1-OUTBOX-02 — head-of-line : 'dead' bloque, 'done' libère
-- ════════════════════════════════════════════════════════════════════════════

-- Agrégat A : E1 dead (seq bas) + E2 pending (seq haut). E2 NON claimable.
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e1aaaaaa-0000-0000-0000-000000000001', 1, 'collecte',
        'a0000000-0000-0000-0000-0000000000a1', 'collecte.creee', '{}'::jsonb, 'dead');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e2aaaaaa-0000-0000-0000-000000000002', 1, 'collecte',
        'a0000000-0000-0000-0000-0000000000a1', 'collecte.modifiee', '{}'::jsonb, 'pending');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_batch(10)
     WHERE id = 'e2aaaaaa-0000-0000-0000-000000000002'),
  0,
  'OUTBOX-02 : un E1 dead BLOQUE l''agrégat → E2 (seq supérieur) non claimé');

-- Agrégat B : E1 done (seq bas) + E2 pending. E2 claimable (done ne bloque pas).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e1bbbbbb-0000-0000-0000-000000000001', 1, 'collecte',
        'b0000000-0000-0000-0000-0000000000b1', 'collecte.creee', '{}'::jsonb, 'done');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e2bbbbbb-0000-0000-0000-000000000002', 1, 'collecte',
        'b0000000-0000-0000-0000-0000000000b1', 'collecte.modifiee', '{}'::jsonb, 'pending');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_batch(10)
     WHERE id = 'e2bbbbbb-0000-0000-0000-000000000002'),
  1,
  'OUTBOX-02 (contrôle) : un E1 done ne bloque PAS → E2 claimé');

-- ════════════════════════════════════════════════════════════════════════════
-- BL-P1-OUTBOX-03 — fn_reap_outbox_claims : claim expiré re-queue + reconciliation
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, claimed_until, requires_reconciliation)
VALUES ('eccccccc-0000-0000-0000-0000000000ee', 1, 'collecte',
        'c0000000-0000-0000-0000-0000000000c1', 'collecte.creee', '{}'::jsonb,
        'processing', now() - interval '1 minute', false);

DO $$ BEGIN PERFORM plateforme.fn_reap_outbox_claims(); END $$;

SELECT is(
  (SELECT statut::text FROM plateforme.outbox_events WHERE id = 'eccccccc-0000-0000-0000-0000000000ee'),
  'pending',
  'OUTBOX-03 : reaper re-queue un claim expiré (processing → pending)');

SELECT is(
  (SELECT requires_reconciliation FROM plateforme.outbox_events WHERE id = 'eccccccc-0000-0000-0000-0000000000ee'),
  true,
  'OUTBOX-03 : reaper exige la réconciliation avant tout re-POST');

-- ════════════════════════════════════════════════════════════════════════════
-- BL-P1-OUTBOX-01 — RPC DLQ skip motivé : dead → done + débloque + audit
-- ════════════════════════════════════════════════════════════════════════════
-- Agrégat D : E1 dead (à skipper) + E2 pending (bloqué tant que E1 ≠ done).
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e1dddddd-0000-0000-0000-000000000001', 1, 'collecte',
        'd0000000-0000-0000-0000-0000000000d1', 'collecte.creee', '{}'::jsonb, 'dead');
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('e2dddddd-0000-0000-0000-000000000002', 1, 'collecte',
        'd0000000-0000-0000-0000-0000000000d1', 'collecte.annulee', '{}'::jsonb, 'pending');

DO $$ BEGIN PERFORM plateforme.fn_admin_skip_outbox(
  'e1dddddd-0000-0000-0000-000000000001',
  '99999999-0000-0000-0000-0000000000ad',
  'Collecte annulée entre-temps — E1 sans objet'); END $$;

SELECT is(
  (SELECT statut::text FROM plateforme.outbox_events WHERE id = 'e1dddddd-0000-0000-0000-000000000001'),
  'done',
  'OUTBOX-01 skip : event dead → done');

SELECT is(
  (SELECT count(*)::int FROM plateforme.fn_claim_outbox_batch(10)
     WHERE id = 'e2dddddd-0000-0000-0000-000000000002'),
  1,
  'OUTBOX-01 skip : l''agrégat est DÉBLOQUÉ (E2 redevient claimable)');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action = 'outbox_skip'
       AND record_id = 'e1dddddd-0000-0000-0000-000000000001'
       AND user_id = '99999999-0000-0000-0000-0000000000ad'),
  1,
  'OUTBOX-01 skip : tracé dans audit_log (auteur + motif)');

-- ─── requeue : dead → pending + attempts=0 + reconciliation + audit ──────────
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, attempts)
VALUES ('f1aaaaaa-0000-0000-0000-000000000011', 1, 'collecte',
        'fa000000-0000-0000-0000-0000000000a1', 'collecte.creee', '{}'::jsonb, 'dead', 4);

DO $$ BEGIN PERFORM plateforme.fn_admin_requeue_outbox(
  'f1aaaaaa-0000-0000-0000-000000000011',
  '99999999-0000-0000-0000-0000000000ad',
  'MTS-1 rétabli — nouvelle tentative'); END $$;

SELECT is(
  (SELECT statut::text || ':' || attempts::text || ':' || requires_reconciliation::text
     FROM plateforme.outbox_events WHERE id = 'f1aaaaaa-0000-0000-0000-000000000011'),
  'pending:0:true',
  'OUTBOX-01 requeue : dead → pending, attempts remis à 0, réconciliation exigée');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action = 'outbox_requeue'
       AND record_id = 'f1aaaaaa-0000-0000-0000-000000000011'),
  1,
  'OUTBOX-01 requeue : tracé dans audit_log');

-- ─── resolve : dead → done + consumer=manual + audit ─────────────────────────
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut, consumer)
VALUES ('f2bbbbbb-0000-0000-0000-000000000012', 1, 'collecte',
        'fb000000-0000-0000-0000-0000000000b1', 'collecte.creee', '{}'::jsonb, 'dead', 'adapter_mts1');

DO $$ BEGIN PERFORM plateforme.fn_admin_resolve_outbox(
  'f2bbbbbb-0000-0000-0000-000000000012',
  '99999999-0000-0000-0000-0000000000ad',
  'Commande créée manuellement côté MTS-1'); END $$;

SELECT is(
  (SELECT statut::text || ':' || consumer
     FROM plateforme.outbox_events WHERE id = 'f2bbbbbb-0000-0000-0000-000000000012'),
  'done:manual',
  'OUTBOX-01 resolve : dead → done + consumer=manual');

SELECT is(
  (SELECT count(*)::int FROM plateforme.audit_log
     WHERE action = 'outbox_resolve'
       AND record_id = 'f2bbbbbb-0000-0000-0000-000000000012'),
  1,
  'OUTBOX-01 resolve : tracé dans audit_log');

-- ─── Gardes : non-dead → 22023, motif court → 22023, non-admin → 42501 ───────
INSERT INTO plateforme.outbox_events (id, txid, aggregate_type, aggregate_id, event_type, payload, statut)
VALUES ('f3cccccc-0000-0000-0000-000000000013', 1, 'collecte',
        'fc000000-0000-0000-0000-0000000000c1', 'collecte.creee', '{}'::jsonb, 'pending');

SELECT throws_ok(
  $$ SELECT plateforme.fn_admin_skip_outbox(
       'f3cccccc-0000-0000-0000-000000000013',
       '99999999-0000-0000-0000-0000000000ad', 'Motif valide assez long') $$,
  '22023', NULL,
  'OUTBOX-01 garde : un event NON dead n''est pas déblocable (22023)');

SELECT throws_ok(
  $$ SELECT plateforme.fn_admin_skip_outbox(
       'f1aaaaaa-0000-0000-0000-000000000011',
       '99999999-0000-0000-0000-0000000000ad', 'abc') $$,
  '22023', NULL,
  'OUTBOX-01 garde : motif < 5 caractères refusé (22023)');

SELECT throws_ok(
  $$ SELECT plateforme.fn_admin_skip_outbox(
       'f1aaaaaa-0000-0000-0000-000000000011',
       '99999999-0000-0000-0000-0000000000ae', 'Motif valide assez long') $$,
  '42501', NULL,
  'OUTBOX-01 garde : auteur non admin_savr refusé (42501)');

-- ════════════════════════════════════════════════════════════════════════════
-- BL-P2-36 — E3 par RPC : le trigger AFTER UPDATE est SUPPRIMÉ (pattern interdit)
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT count(*)::int FROM pg_trigger
     WHERE tgname = 'trg_collecte_annulee_e3' AND NOT tgisinternal),
  0,
  'P2-36 : trigger trg_collecte_annulee_e3 supprimé (E3 émis par fn_modifier_collecte)');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'plateforme' AND p.proname = '_fn_trg_outbox_collecte_annulee'),
  0,
  'P2-36 : fonction trigger _fn_trg_outbox_collecte_annulee supprimée');

-- ════════════════════════════════════════════════════════════════════════════
-- BL-P2-35 — pesees_tournees pt_admin = FOR SELECT (plus FOR ALL)
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT cmd FROM pg_policies
     WHERE schemaname = 'plateforme' AND tablename = 'pesees_tournees' AND policyname = 'pt_admin'),
  'SELECT',
  'P2-35 : pt_admin restreinte à SELECT (l''admin ne contourne plus le chemin tracé)');

SELECT * FROM finish();
ROLLBACK;
