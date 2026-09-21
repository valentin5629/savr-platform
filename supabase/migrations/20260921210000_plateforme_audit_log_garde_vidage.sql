-- =============================================================================
-- SÉCURITÉ — `plateforme.audit_log` : fermer le dernier chemin d'effacement
-- =============================================================================
-- CDC : `01 - Cahier des charges App/07 - Observabilité/06 - Audit trail.md`
--       §1 (« append-only et immuable ») et §5 pt 4.
-- Suite de `20260921200000_plateforme_audit_log_immuable.sql`, qui a fermé
--       UPDATE et DELETE. Preuve de fermeture : T11-T13 de
--       `supabase/tests/SECU__audit_log_immuable.test.sql` (3 rouges avant
--       cette migration, 13/13 après).
-- Portée de la garantie : inchangée — rôles applicatifs (`service_role`,
--       `authenticated`, `anon`) ; `postgres` reste hors garantie
--       (arbitrage Val 2026-09-21).
--
-- CE QUI RESTAIT OUVERT, MESURÉ LE 2026-09-21
-- --------------------------------------------
-- Le trigger `BEFORE UPDATE OR DELETE FOR EACH ROW` posé par la migration
-- précédente n'intercepte pas un vidage de table : ce n'est ni un UPDATE ni un
-- DELETE, et c'est un ordre au niveau de l'instruction, sans ligne à lui passer.
--
-- Le chemin direct, lui, était déjà fermé et le reste :
-- `has_table_privilege('service_role', …, 'TRUNCATE')` = false sur le parent,
-- sur les 6 partitions et sur une partition créée à la volée — ce verbe n'a
-- jamais été concédé, ni par le blanket grant 0.4a ni par l'`ALTER DEFAULT
-- PRIVILEGES` du schéma. Identique en local, `savr-dev` et `savr-prod`.
--
-- Le chemin qui restait : dans une fonction `SECURITY DEFINER`, l'ACL vérifiée
-- est celle du PROPRIÉTAIRE, pas celle de l'appelant. Une fonction appartenant
-- à `postgres` qui vide `audit_log_2026`, appelée sous `service_role`,
-- réussissait donc malgré l'ACL et malgré le trigger — reproduit en transaction
-- rollbackée, retour « current_user=postgres », vidage abouti.
--
-- Ce n'est pas le scénario de l'administrateur délibéré (hors garantie), mais
-- celui de la RPC applicative ordinaire : le schéma en compte déjà 17 qui
-- touchent `audit_log`, toutes `SECURITY DEFINER` pour la plupart. Aucune ne
-- vide quoi que ce soit aujourd'hui — scan du catalogue le 2026-09-21 sur
-- `plateforme`, `shared` et `public` : aucune fonction ne contient de vidage de
-- table, de `session_replication_role` ni de `DISABLE TRIGGER`, hors le helper
-- de test `public._table_privs` (non-DEFINER). Le vecteur exige donc d'en
-- AJOUTER une — c'est-à-dire une migration, qui passe en revue. D'où une
-- priorité basse, mais c'était le dernier trou connu de l'immuabilité.
--
-- POURQUOI UNE BOUCLE ET UNE MODIFICATION DE `f_ensure_partition_annee`
-- ---------------------------------------------------------------------
-- Un trigger `BEFORE TRUNCATE` est nécessairement `FOR EACH STATEMENT`
-- (PostgreSQL refuse `FOR EACH ROW`). Or, contrairement au trigger ligne à
-- ligne de la migration précédente, **les triggers d'instruction ne sont clonés
-- sur aucune partition** : ni sur les existantes, ni sur celles attachées
-- ensuite. Mesuré côte à côte le 2026-09-21 sur une partition créée après coup :
-- trigger ligne à ligne présent (1), trigger d'instruction absent (0).
--
-- Posé sur le seul parent, il laissait donc la sonde réussir sur
-- `audit_log_2026` comme sur une partition neuve. Il faut les deux volets :
--
--   • la boucle ci-dessous, pour les partitions d'aujourd'hui ;
--   • `f_ensure_partition_annee`, pour chaque partition annuelle à venir —
--     sans quoi la protection expirerait au prochain 1er janvier, exactement le
--     piège que la migration précédente avait évité pour UPDATE/DELETE en
--     s'appuyant sur le clonage automatique, impossible à réutiliser ici.
--
-- Le trigger est aussi posé sur le parent : un vidage du parent cascade sur les
-- partitions et serait déjà intercepté par la garde de l'une d'elles, mais
-- celle du parent tient encore si une partition venait à être créée un jour
-- hors de `f_ensure_partition_annee`. `TRUNCATE ONLY` sur le parent, lui, est
-- refusé par PostgreSQL même (« cannot truncate only a partitioned table »).
--
-- CE QUE CETTE MIGRATION NE CASSE PAS (recensé avant écriture)
-- ------------------------------------------------------------
-- Rien ne vide `audit_log` : ni le code applicatif, ni une fonction en base
-- (scan `pg_proc` ci-dessus). `f_purge_logs` ne retire que des partitions
-- `integrations_logs` entièrement hors fenêtre — `audit_log` n'est jamais purgée
-- (rétention légale 5 ans, §07/06 §4). `integrations_logs`, partitionnée par la
-- même migration, n'a pas d'exigence d'immuabilité au CDC : la garde ajoutée à
-- `f_ensure_partition_annee` est explicitement restreinte à `audit_log`, pour
-- ne pas bloquer cette purge.
-- Non destructive : aucune donnée touchée, aucun objet retiré, aucun privilège
-- élargi. Le seul verbe SQL de suppression qui apparaît ci-dessous est
-- `DROP TRIGGER IF EXISTS` sur le trigger que cette migration pose elle-même,
-- pour la rendre rejouable.
-- =============================================================================

-- 1. La garde. On réutilise `fn_audit_log_immuable()` de la migration
--    précédente plutôt que d'en écrire une jumelle : elle lève déjà 42501 en
--    interpolant `TG_OP`, qui vaut ici le nom de l'opération de vidage. Le
--    message reste donc exact, et il n'y a qu'un seul endroit où lire la règle.
--    Elle est `SECURITY INVOKER` : un trigger n'a pas besoin des droits du
--    propriétaire pour refuser une écriture.

-- 2. Le parent, puis chaque partition existante — le clonage automatique ne
--    joue pas pour un trigger d'instruction.
DROP TRIGGER IF EXISTS trg_audit_log_vidage_interdit ON plateforme.audit_log;
CREATE TRIGGER trg_audit_log_vidage_interdit
  BEFORE TRUNCATE ON plateforme.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION plateforme.fn_audit_log_immuable();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'plateforme'
       AND c.relname ~ '^audit_log_[0-9]{4}$'
       AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_log_vidage_interdit ON plateforme.%I',
      r.relname
    );
    EXECUTE format(
      'CREATE TRIGGER trg_audit_log_vidage_interdit BEFORE TRUNCATE ON plateforme.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION plateforme.fn_audit_log_immuable()',
      r.relname
    );
  END LOOP;
END;
$$;

-- 3. Les partitions à venir. `f_ensure_partition_annee` (migration
--    20260710000000) est appelée par le cron de purge pour `integrations_logs`
--    ET `audit_log`. On lui ajoute la pose de la garde, restreinte à
--    `audit_log`. Corps repris à l'identique pour le reste ; seul le bloc final
--    est nouveau. `DROP`/`CREATE` plutôt que `CREATE IF NOT EXISTS` (qui
--    n'existe pas pour un trigger) : la fonction reste idempotente, y compris
--    quand `CREATE TABLE IF NOT EXISTS` ne crée rien parce que la partition est
--    déjà là.
CREATE OR REPLACE FUNCTION plateforme.f_ensure_partition_annee(p_parent text, p_annee integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'plateforme', 'pg_temp'
AS $function$
DECLARE
  v_child text;
BEGIN
  IF p_parent NOT IN ('integrations_logs', 'audit_log') THEN
    RAISE EXCEPTION 'f_ensure_partition_annee: table non autorisee %', p_parent;
  END IF;
  v_child := p_parent || '_' || p_annee::text;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS plateforme.%I PARTITION OF plateforme.%I FOR VALUES FROM (%L) TO (%L)',
    v_child, p_parent,
    (p_annee::text || '-01-01'), ((p_annee + 1)::text || '-01-01')
  );
  EXECUTE format('ALTER TABLE plateforme.%I ENABLE ROW LEVEL SECURITY', v_child);
  -- FORCE : l'owner (postgres) reste soumis à la RLS — cohérent avec les partitions
  -- _2026 (migration 20260611180002 §22) ; service_role conserve son BYPASSRLS.
  EXECUTE format('ALTER TABLE plateforme.%I FORCE ROW LEVEL SECURITY', v_child);

  -- `audit_log` seulement : cette table est append-only (§07/06 §1), pas
  -- `integrations_logs`, que `f_purge_logs` doit pouvoir continuer de purger.
  -- Le trigger de l'immuabilité UPDATE/DELETE, lui, est cloné automatiquement
  -- sur la partition et n'a rien à faire ici ; un trigger d'instruction, non —
  -- sans cette pose, l'immuabilité s'arrêterait à la dernière partition
  -- pré-créée.
  IF p_parent = 'audit_log' THEN
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_log_vidage_interdit ON plateforme.%I',
      v_child
    );
    EXECUTE format(
      'CREATE TRIGGER trg_audit_log_vidage_interdit BEFORE TRUNCATE ON plateforme.%I '
      'FOR EACH STATEMENT EXECUTE FUNCTION plateforme.fn_audit_log_immuable()',
      v_child
    );
  END IF;
END;
$function$;

COMMENT ON FUNCTION plateforme.f_ensure_partition_annee(text, integer) IS
  'Crée la partition annuelle d''integrations_logs ou d''audit_log si absente, '
  'active + force la RLS, et — pour audit_log seulement — pose la garde '
  'trg_audit_log_vidage_interdit, qu''aucun clonage automatique ne couvre '
  '(les triggers d''instruction ne sont pas hérités par les partitions).';
