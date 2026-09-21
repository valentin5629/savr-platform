-- =============================================================================
-- SECU — `plateforme.audit_log` : immuabilité append-only, TOUS RÔLES
-- =============================================================================
-- Exigence : `specs/cdc/01 - Cahier des charges App/07 - Observabilité/
--            06 - Audit trail.md` §1 (« append-only et immuable (aucun
--            UPDATE/DELETE) ») + §5 pt 4 (« Test pgTAP : vérifier l'immuabilité
--            (UPDATE/DELETE refusés tous rôles) »).
--            T11-T13 couvrent le vidage de table : le §5 pt 4 ne le nomme pas,
--            mais le §1 exige l'immuabilité, et vider la table efface les lignes
--            aussi sûrement qu'un DELETE.
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
-- T11-T13 (ajoutés le 2026-09-21) ferment le troisième chemin d'effacement, le
-- vidage de table, que le trigger UPDATE/DELETE n'intercepte pas — voir le
-- commentaire qui les précède, qui dit aussi ce qui reste ouvert et pourquoi ce
-- n'est délibérément pas testé ici. Mesuré avec la seule migration ci-dessus :
-- 10 verts, 3 ROUGES, « caught: no exception » — le vidage aboutissait.
-- APRÈS `20260921210000_plateforme_audit_log_garde_vidage.sql` : 13/13.
--
-- T14-T15 gardent le seul usage légitime du vidage : le reset du seed de dev,
-- qui désactive la garde et la remet. Ils sont la contrepartie de la fermeture
-- — sans eux, la prochaine migration de cette famille recasserait
-- `pnpm seed:minimal` sans que rien ne le signale.
--
-- T16a-T16b couvrent le garde-fou que la revue adversariale a rendu nécessaire.
-- Elle a montré que T14/T15 + le test unitaire laissaient passer une mutation
-- d'un seul token — neutraliser la seule branche `ENABLE` de `reset.ts` donnait
-- une garde DÉFINITIVEMENT désactivée, tout vert. Le trou est structurel : le
-- test unitaire ne touche pas la base, et T14/T15 rejouent une copie du SQL.
-- La réponse n'est donc pas un test de plus mais un mécanisme —
-- `sqlAssertionGardeActive()`, exécutée par `reset.ts` avant son COMMIT, qui
-- lève si une garde est restée désactivée et annule la transaction. T16a
-- vérifie qu'elle se tait quand tout va bien (sinon un `RAISE` inconditionnel
-- passerait), T16b qu'elle lève quand une garde manque.
--
-- NON-VACUITÉ — chaque test discrimine, vérifié par quatre contre-épreuves
-- jouées en transaction rollbackée le 2026-09-21, chacune en retirant un seul
-- mécanisme d'une migration par ailleurs complète :
--   • REVOKE UPDATE,DELETE seul (parent + 6 partitions, sans trigger) → T10 rouge.
--     `ALTER DEFAULT PRIVILEGES` re-accorde `arwd` à la partition de l'an prochain.
--   • Trigger seul (sans REVOKE) → T7/T8 rouges. Sous `authenticated` la RLS
--     ramène déjà la requête à 0 ligne, donc le trigger BEFORE ROW ne se
--     déclenche jamais : `UPDATE 0` silencieux, qui n'est pas un refus.
--   • Garde de vidage sans la boucle sur les partitions existantes (posée sur le
--     seul parent) → T11 rouge, T12/T13 verts : un trigger d'instruction n'est
--     pas cloné, la partition 2026 reste videable. T12 reste vert parce que la
--     garde du parent, elle, intercepte bien le vidage du parent.
--   • Garde de vidage sans la pose dans `f_ensure_partition_annee` → T13 rouge,
--     T11/T12 verts : la protection s'arrête à la dernière partition pré-créée
--     (2031). Échéance réelle 2032, pas « le prochain 1er janvier » : les
--     partitions 2027→2031 sont pré-provisionnées et couvertes par la boucle,
--     et le cron `f_purge_logs` ne crée de partition que pour
--     `integrations_logs` — jamais pour `audit_log`.
--   ⇒ les quatre mécanismes sont nécessaires ; aucun ne suffit seul.
-- =============================================================================

BEGIN;
SELECT plan(17);

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

-- =====================================================================
-- T11-T13 : le vidage de table, troisième chemin d'effacement d'une
-- ligne d'audit. `BEFORE UPDATE OR DELETE FOR EACH ROW` (T1-T10)
-- n'intercepte PAS un `TRUNCATE` : ce n'est ni un UPDATE ni un DELETE,
-- et c'est un ordre au niveau de l'instruction, sans ligne à passer au
-- trigger.
--
-- CE QUI N'EST PAS COUVERT, ET N'EST DONC PAS TESTÉ
-- --------------------------------------------------
-- Fermer le vidage ne rend pas `audit_log` ineffaçable. Trois chemins
-- restent ouverts à une fonction `SECURITY DEFINER` appartenant à
-- `postgres` (mesurés en revue adversariale le 2026-09-21, tracés dans
-- `_Divergences/OBS_20260921_audit-log-immuabilite-vidage-table.md`) :
-- `DROP TABLE` d'une partition — qu'aucun trigger de table ne peut
-- intercepter ; une partition créée hors `f_ensure_partition_annee`, qui
-- naît sans garde d'instruction ; et la désactivation explicite du
-- trigger (`DISABLE TRIGGER`, `session_replication_role`), du ressort du
-- propriétaire et donc hors garantie. Aucun n'est atteignable sans
-- ajouter du code qui passe en revue. Les tester ici reviendrait à
-- figer des trous connus en « comportement attendu ».
--
-- POURQUOI LE CHEMIN DIRECT N'EST PAS TESTÉ ICI
-- ---------------------------------------------
-- Hors fonction `SECURITY DEFINER`, `service_role` n'a pas le privilège :
-- mesuré le 2026-09-21 en local, `savr-dev` ET `savr-prod`,
-- `has_table_privilege('service_role', …, 'TRUNCATE')` = false sur le
-- parent, sur les 6 partitions ET sur une partition créée à la volée —
-- ce verbe n'a jamais été concédé, ni par le blanket grant 0.4a ni par
-- l'`ALTER DEFAULT PRIVILEGES` du schéma. Un test de ce chemin serait
-- vert avant comme après le correctif : vacuously true, donc exclu,
-- pour la même raison qu'`anon` plus haut.
--
-- LE CHEMIN QUI RESTAIT OUVERT, ET QUI EST TESTÉ
-- -----------------------------------------------
-- Dans une fonction `SECURITY DEFINER`, l'ACL vérifiée est celle du
-- PROPRIÉTAIRE, pas celle de l'appelant. Une fonction appartenant à
-- `postgres` qui vide `audit_log_2026`, appelée sous `service_role`,
-- réussissait donc malgré l'ACL et malgré le trigger de T1-T10
-- (reproduit le 2026-09-21 : « current_user=postgres », vidage abouti).
-- C'est le vecteur réaliste : pas un accès administrateur délibéré, mais
-- une RPC applicative ordinaire — le schéma en compte 17 qui touchent
-- déjà `audit_log` — à laquelle on ajouterait un jour un vidage.
-- La sonde ci-dessous reproduit exactement cette forme.
--
-- LE PIÈGE QUE T13 VERROUILLE
-- ----------------------------
-- Un trigger `BEFORE TRUNCATE` est nécessairement `FOR EACH STATEMENT`
-- (PostgreSQL interdit `FOR EACH ROW`), et — contrairement au trigger
-- ligne à ligne de T1-T10 — les triggers d'instruction ne sont clonés
-- sur AUCUNE partition : ni les existantes, ni celles attachées ensuite.
-- Mesuré le 2026-09-21 : posé sur le seul parent, il laisse la sonde
-- réussir sur `audit_log_2026` comme sur une partition neuve. La garde
-- doit donc être posée partition par partition, et par
-- `f_ensure_partition_annee` sur chaque partition annuelle qu'elle crée.
-- L'échéance n'est PAS « le prochain 1er janvier », contrairement au
-- piège que le REVOKE a rencontré au point (3) de l'en-tête : les
-- partitions 2027→2031 sont déjà provisionnées et couvertes, et le cron
-- ne crée de partition que pour `integrations_logs`. C'est 2032, au
-- premier appel délibéré de la fonction — et T13 garantit que cet
-- appel-là produira une partition gardée.
-- =====================================================================

SELECT test_as_superuser();

-- La sonde : même forme que le vecteur décrit ci-dessus — propriétaire
-- `postgres`, `SECURITY DEFINER`, appelée sous `service_role`. `%I` pour
-- que la cible soit un identifiant et non une chaîne concaténée.
CREATE OR REPLACE FUNCTION test_sonde_vidage_audit(p_cible text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE format('TRUNCATE plateforme.%I', p_cible);
END $$;

SELECT test_as_role('service_role');

SELECT throws_ok(
  $$SELECT test_sonde_vidage_audit('audit_log_2026')$$,
  '42501', NULL,
  'T11 vidage de audit_log_2026 refusé, même depuis une fonction SECURITY DEFINER appelée par service_role'
);

SELECT throws_ok(
  $$SELECT test_sonde_vidage_audit('audit_log')$$,
  '42501', NULL,
  'T12 vidage de audit_log (parent, qui cascade sur toutes les partitions) refusé dans les mêmes conditions'
);

-- La partition 2035 a été créée en T10 par `f_ensure_partition_annee`,
-- APRÈS la garde. Si la fonction ne pose pas le trigger sur ce qu'elle
-- crée, ce test est le seul à rougir — et l'immuabilité s'arrête à la
-- dernière partition pré-créée.
SELECT throws_ok(
  $$SELECT test_sonde_vidage_audit('audit_log_2035')$$,
  '42501', NULL,
  'T13 vidage refusé sur une partition créée APRÈS la garde (les triggers d''instruction ne sont jamais clonés)'
);

-- =====================================================================
-- T14-T15 : le seed de dev doit pouvoir vider `audit_log`, et la garde
-- doit mordre de nouveau juste après.
--
-- POURQUOI CES DEUX TESTS EXISTENT
-- ---------------------------------
-- `resetBusinessData()` (`packages/shared/src/seed/reset.ts`) ouvre
-- `pnpm seed:minimal` / `seed:demo` par un vidage en masse des tables
-- métier, `audit_log` comprise — la garde le refusait donc en `42501`,
-- à la toute première instruction du seed. Retirer la table de sa liste
-- ne suffit pas : ses deux FK vers `users` la ramènent par le CASCADE.
-- Le reset désactive donc la garde, vide, puis la réactive, le tout dans
-- une transaction et derrière `assertDev()`.
--
-- On rejoue ici cette séquence EN BASE — une COPIE de celle du module,
-- pas la séquence du module : le pgTAP ne peut pas importer du
-- TypeScript. T14 vérifie donc que la séquence est jouable et qu'elle
-- vide bien la table ; il ne peut pas garantir que `reset.ts` émet
-- encore celle-là. C'est dit ici parce qu'une revue adversariale a
-- montré le contraire de ce que cette phrase affirmait avant : en
-- neutralisant la seule branche `ENABLE` du module, on obtenait une
-- garde définitivement désactivée avec T14/T15 verts.
--
-- T15 est l'oracle qui empêche T14 d'être complaisant sur ce qu'il
-- couvre vraiment : un reset qui désactiverait sans remettre ferait
-- passer T14 tout seul. Et c'est T16a/T16b, plus bas, qui couvrent le
-- mécanisme qui protège réellement la base — l'assertion de sortie.
-- =====================================================================

SELECT test_as_superuser();

CREATE OR REPLACE FUNCTION test_garde_vidage_audit(p_action text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tg.tgrelid::regclass AS tbl
      FROM pg_trigger tg
     WHERE tg.tgname = 'trg_audit_log_vidage_interdit' AND NOT tg.tgisinternal
  LOOP
    EXECUTE format(
      'ALTER TABLE %s %s TRIGGER trg_audit_log_vidage_interdit', r.tbl, p_action
    );
  END LOOP;
END $$;

SELECT lives_ok(
  $$SELECT test_garde_vidage_audit('DISABLE');
    TRUNCATE plateforme.audit_log RESTART IDENTITY CASCADE;
    SELECT test_garde_vidage_audit('ENABLE')$$,
  'T14 le reset du seed peut vider audit_log en désactivant puis réactivant la garde'
);

SELECT test_as_role('service_role');

SELECT throws_ok(
  $$SELECT test_sonde_vidage_audit('audit_log_2026')$$,
  '42501', NULL,
  'T15 la garde est de nouveau active après le reset (elle n''est pas restée désactivée)'
);

-- =====================================================================
-- T16 : le rempart de `reset.ts` lève-t-il vraiment ?
--
-- CE QUE CE TEST PROUVE, ET CE QU'IL NE PROUVE PAS
-- -------------------------------------------------
-- Une revue adversariale a montré que T14/T15 et le test unitaire, à eux
-- deux, laissaient passer une mutation d'un seul token : en neutralisant
-- la seule branche `ENABLE` de la boucle de `reset.ts`, on obtenait une
-- garde DÉFINITIVEMENT désactivée en base, tout vert. Le trou est
-- structurel — le test unitaire ne touche pas la base, et T14/T15
-- rejouent une COPIE du SQL, sans lien exécutable avec le module TS.
--
-- La réponse n'est pas un test de plus mais un mécanisme :
-- `sqlAssertionGardeActive()`, que `reset.ts` exécute avant son COMMIT.
-- Elle relit `pg_trigger` et lève si une garde est restée désactivée —
-- le seed échoue bruyamment et la transaction est annulée, au lieu de
-- committer une base ouverte.
--
-- T16 prouve que cette assertion lève bel et bien. Le chaînage complet
-- est : le test unitaire vérifie que le module émet une assertion de
-- cette FORME (`tgenabled <> 'O'`, `RAISE EXCEPTION`), T16 vérifie
-- qu'une assertion de cette forme MORD. Ce n'est pas une preuve
-- d'exécution bout en bout — il faudrait une base dans le job Vitest,
-- que la CI n'a pas — et c'est dit ici plutôt que sous-entendu.
-- =====================================================================

SELECT test_as_superuser();

-- Le corps est repris de `sqlAssertionGardeActive()` : le pgTAP ne peut pas
-- importer du TypeScript. C'est une COPIE, et elle est signalée comme telle —
-- c'est le test unitaire qui vérifie que le module émet bien cette forme-là.
CREATE OR REPLACE FUNCTION test_assertion_garde_active()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM pg_trigger tg
   WHERE tg.tgname = 'trg_audit_log_vidage_interdit'
     AND NOT tg.tgisinternal
     AND tg.tgenabled <> 'O';
  IF n > 0 THEN
    RAISE EXCEPTION
      'reset seed : la garde % est restée désactivée sur % table(s) — transaction annulée',
      'trg_audit_log_vidage_interdit', n;
  END IF;
END $$;

SELECT test_as_superuser();

-- Contrôle préalable : gardes actives → l'assertion doit se taire. Sans lui,
-- un `RAISE EXCEPTION` inconditionnel passerait T16 sans rien prouver.
SELECT lives_ok(
  $$SELECT test_assertion_garde_active()$$,
  'T16a l''assertion de sortie se tait quand toutes les gardes sont actives'
);

SELECT test_garde_vidage_audit('DISABLE');

SELECT throws_ok(
  $$SELECT test_assertion_garde_active()$$,
  'P0001', NULL,
  'T16b l''assertion de sortie lève quand une garde est restée désactivée'
);

SELECT test_garde_vidage_audit('ENABLE');
SELECT test_as_superuser();

SELECT * FROM finish();
ROLLBACK;
