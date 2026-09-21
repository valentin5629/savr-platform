-- =============================================================================
-- SECU — `plateforme.audit_log` : immuabilité append-only, TOUS RÔLES
-- =============================================================================
-- Exigence : `specs/cdc/01 - Cahier des charges App/07 - Observabilité/
--            06 - Audit trail.md` §1 (« append-only et immuable (aucun
--            UPDATE/DELETE) ») + §5 pt 4 (« Test pgTAP : vérifier l'immuabilité
--            (UPDATE/DELETE refusés tous rôles) »).
--
-- CE QUE CE FICHIER MESURE, ET POURQUOI IL NE SE LIMITE PAS AU PARENT
-- -------------------------------------------------------------------
-- `audit_log` est PARTITIONNÉE BY RANGE(created_at) (migration 20260710000000).
-- Trois faits mesurés le 2026-09-21, identiques en local, `savr-dev` ET `savr-prod` :
--
--   (1) `service_role` porte BYPASSRLS → la RLS de la table est structurellement
--       impuissante contre lui. Seuls l'ACL et un trigger peuvent le contraindre.
--   (2) Les privilèges vérifiés dépendent de la table NOMMÉE dans la requête :
--       passer par le parent lit l'ACL du parent, viser `audit_log_2026`
--       directement lit l'ACL de CETTE partition — et les policies du parent ne
--       s'y appliquent pas (aucune partition ne porte de policy propre).
--       D'où les 4 chemins testés : {UPDATE, DELETE} × {parent, partition}.
--   (3) `ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme` accorde `arwd` à
--       `service_role` sur toute table NOUVELLE du schéma. Chaque partition
--       créée par `f_ensure_partition_annee` (cron, jusqu'en 2031+) naît donc
--       avec UPDATE/DELETE ouverts, qu'on ait révoqué sur le parent ou non.
--       → T10 verrouille ce point : la garde doit survivre à une partition
--         créée APRÈS elle, sinon l'immuabilité expire au prochain 1er janvier.
--
-- LES DEUX RÔLES QUI NE SONT PAS TESTÉS ICI, ET POURQUOI
-- ----------------------------------------------------
-- `anon` : mesuré le 2026-09-21, `has_table_privilege('anon', 'plateforme.
--   audit_log', …)` = false sur les quatre verbes, SELECT compris — le GRANT
--   de schéma 0.4a ne vise que `authenticated`. Un test `anon` serait vert
--   avant comme après n'importe quel correctif : vacuously true, donc exclu.
-- `postgres` (propriétaire) : hors de la garantie, par arbitrage Val du
--   2026-09-21 — « tous rôles » au §5 pt 4 se lit « rôles applicatifs ». Motif
--   mesuré : un REVOKE lui est structurellement inopérant (ses privilèges
--   restent à true après REVOKE, sur le parent comme sur une partition) et il
--   peut désactiver un trigger. On protège contre le bug et l'accident, pas
--   contre un accès administrateur délibéré. Divergence `ambigu` ouverte pour
--   que le §07/06 dise « rôles applicatifs » au lieu de « tous rôles ».
--   NB : la migration n'exempte personne pour autant — `current_user` vaut
--   `postgres` dans toute fonction `SECURITY DEFINER`, donc exempter le
--   propriétaire rouvrirait le chemin à n'importe quelle RPC de l'application.
--
-- ORACLE — pourquoi ce fichier n'est pas complaisant
-- --------------------------------------------------
-- T9 ne se contente pas d'un refus : il relit la ligne et exige que `motif` soit
-- resté NULL et la ligne présente. Un mécanisme qui « refuserait » en laissant
-- passer la mutation (ou un `UPDATE 0` silencieux pris pour un refus) est donc
-- attrapé. T7/T8 sont écrits en `throws_ok` — et non « 0 ligne touchée » —
-- précisément parce que la RLS ramène déjà `authenticated` à `UPDATE 0` : un
-- test « rien n'a bougé » passerait aujourd'hui sans rien prouver.
--
-- ÉTAT AVANT LE CORRECTIF (2026-09-21), mesuré en jouant ce fichier :
-- 0 trigger sur `audit_log`, `service_role=arwd` sur le parent et les 6 partitions.
--   → 8 ROUGES / 10 : T1-T4, T7-T10. Seuls T5 et T6 passaient (REVOKE 0.4c).
--   T9 était rouge parce que le DELETE de T2 avait réellement effacé la ligne
--   (`have: 0`) : la conséquence, pas seulement l'absence de refus.
-- APRÈS la migration `20260921200000_plateforme_audit_log_immuable.sql`, livrée
-- dans le même lot : 10/10. Ce fichier est la preuve de fermeture exigée par
-- CLAUDE.md §12 (2bis) pour une migration qui referme un accès.
--
-- NON-VACUITÉ — chaque test discrimine, vérifié par deux contre-épreuves jouées
-- en transaction rollbackée le 2026-09-21 :
--   • REVOKE UPDATE,DELETE seul (parent + 6 partitions, sans trigger) → T10 rouge.
--     `ALTER DEFAULT PRIVILEGES` re-accorde `arwd` à la partition de l'an prochain.
--   • Trigger seul (sans REVOKE) → T7/T8 rouges. Sous `authenticated` la RLS
--     ramène déjà la requête à 0 ligne, donc le trigger BEFORE ROW ne se
--     déclenche jamais : `UPDATE 0` silencieux, qui n'est pas un refus.
--   ⇒ les deux mécanismes sont nécessaires ; ni l'un ni l'autre ne suffit.
-- =============================================================================

BEGIN;
SELECT plan(10);

-- Helpers. `test_as_superuser()` est celui des 43 autres fichiers du dossier.
-- `test_as_role()` est propre à ce fichier : le helper commun `test_set_jwt()`
-- force `role='authenticated'`, ce qui ne permet pas de basculer vers `service_role`.
CREATE OR REPLACE FUNCTION test_as_role(p_role text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', p_role, true);
END $$;

CREATE OR REPLACE FUNCTION test_as_superuser()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- =====================================================================
-- SETUP — une ligne d'audit dans la partition 2026 (UUID namespace a171)
-- `created_at` figé au 1er juin 2026 pour router vers `audit_log_2026` de
-- façon déterministe, quelle que soit l'année où le test est rejoué.
-- =====================================================================

SELECT test_as_superuser();

INSERT INTO plateforme.audit_log (action, table_name, record_id, created_at)
VALUES (
  'secu_immuabilite_a171', 'users',
  'a1710001-0000-0000-0000-000000000001'::uuid,
  '2026-06-01T12:00:00Z'::timestamptz
);

-- =====================================================================
-- T1-T4 : service_role (BYPASSRLS) — les 4 chemins de mutation
-- Le rôle de toutes les routes back-office. C'est le trou que ce fichier
-- a été écrit pour fermer.
-- =====================================================================

SELECT test_as_role('service_role');

SELECT throws_ok(
  $$UPDATE plateforme.audit_log SET motif = 'REECRIT A POSTERIORI'
     WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T1 UPDATE audit_log (parent) refusé pour service_role'
);

SELECT throws_ok(
  $$DELETE FROM plateforme.audit_log WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T2 DELETE audit_log (parent) refusé pour service_role'
);

SELECT throws_ok(
  $$UPDATE plateforme.audit_log_2026 SET motif = 'REECRIT A POSTERIORI'
     WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T3 UPDATE audit_log_2026 (partition visée directement) refusé pour service_role'
);

SELECT throws_ok(
  $$DELETE FROM plateforme.audit_log_2026 WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T4 DELETE audit_log_2026 (partition visée directement) refusé pour service_role'
);

-- =====================================================================
-- T5-T8 : authenticated — non-régression du REVOKE 0.4c (T5/T6), et le
-- résidu du blanket grant 0.4a sur la partition 2026 (T7/T8), où l'ACL
-- concède encore `arwd` à `authenticated`.
-- =====================================================================

SELECT test_as_role('authenticated');

SELECT throws_ok(
  $$UPDATE plateforme.audit_log SET motif = 'REECRIT A POSTERIORI'
     WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T5 UPDATE audit_log (parent) refusé pour authenticated'
);

SELECT throws_ok(
  $$DELETE FROM plateforme.audit_log WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T6 DELETE audit_log (parent) refusé pour authenticated'
);

SELECT throws_ok(
  $$UPDATE plateforme.audit_log_2026 SET motif = 'REECRIT A POSTERIORI'
     WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T7 UPDATE audit_log_2026 (partition visée directement) refusé pour authenticated'
);

SELECT throws_ok(
  $$DELETE FROM plateforme.audit_log_2026 WHERE action = 'secu_immuabilite_a171'$$,
  '42501', NULL,
  'T8 DELETE audit_log_2026 (partition visée directement) refusé pour authenticated'
);

-- =====================================================================
-- T9 : oracle positif — après 8 tentatives, la ligne est toujours là et
-- intacte. Distingue un vrai refus d'une mutation qui aurait abouti.
-- =====================================================================

SELECT test_as_superuser();

SELECT is(
  (SELECT count(*)::text || '/' || coalesce(max(motif), '<motif NULL>')
     FROM plateforme.audit_log WHERE action = 'secu_immuabilite_a171'),
  '1/<motif NULL>',
  'T9 la ligne d''audit est intacte après les 8 tentatives (présente, motif jamais réécrit)'
);

-- =====================================================================
-- T10 : la garde survit-elle à une partition créée APRÈS elle ?
-- `f_ensure_partition_annee` tourne tous les ans ; la partition naît avec
-- `service_role=arwd` (ALTER DEFAULT PRIVILEGES du schéma). Une protection
-- posée uniquement par REVOKE sur les tables d'aujourd'hui échoue ici.
-- 2035 : hors des partitions pré-créées (2026-2031), et `CREATE TABLE IF NOT
-- EXISTS` dans la fonction rend le test idempotent si elle existe déjà.
-- =====================================================================

SELECT plateforme.f_ensure_partition_annee('audit_log', 2035);

INSERT INTO plateforme.audit_log (action, table_name, created_at)
VALUES ('secu_immuabilite_a171_futur', 'users', '2035-06-01T12:00:00Z'::timestamptz);

SELECT test_as_role('service_role');

SELECT throws_ok(
  $$UPDATE plateforme.audit_log_2035 SET motif = 'REECRIT A POSTERIORI'
     WHERE action = 'secu_immuabilite_a171_futur'$$,
  '42501', NULL,
  'T10 UPDATE refusé sur une partition créée APRÈS la garde (couvre les partitions annuelles à venir)'
);

SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;
