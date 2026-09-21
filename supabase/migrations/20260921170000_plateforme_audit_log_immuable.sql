-- =============================================================================
-- SÉCURITÉ — `plateforme.audit_log` : rendre l'immuabilité append-only effective
-- =============================================================================
-- CDC : `01 - Cahier des charges App/07 - Observabilité/06 - Audit trail.md`
--       §1 (« append-only et immuable (aucun UPDATE/DELETE) ») et §5 pt 4.
-- Preuve de fermeture : `supabase/tests/SECU__audit_log_immuable.test.sql`
--       (8 rouges sur 10 avant cette migration, 10/10 après).
-- Arbitrage Val 2026-09-21 : durcir la base ; la garantie porte sur les rôles
--       applicatifs (`service_role`, `authenticated`, `anon`).
--
-- L'ÉTAT AVANT, MESURÉ LE 2026-09-21 (identique en local, `savr-dev`, `savr-prod`)
-- ------------------------------------------------------------------------------
-- `audit_log` était décrite comme immuable et ne l'était pas : 0 trigger, et
-- `service_role=arwd` sur le parent comme sur les 6 partitions. Or `service_role`
-- est le rôle de toutes les routes back-office. Une ligne d'audit — facture
-- émise, changement de rôle, ajustement de pack — était réécrivable et
-- supprimable sans laisser de trace de l'effacement. Reproduit en transaction
-- rollbackée : `UPDATE 1`, `DELETE 1`, via le parent comme via la partition.
-- La seule protection en place (REVOKE 0.4c) ne visait que `authenticated`,
-- c'est-à-dire le seul rôle qui n'écrit jamais dans cette table.
--
-- POURQUOI DEUX MÉCANISMES ET PAS UN
-- ----------------------------------
-- Ni le REVOKE ni le trigger ne suffit seul — les deux contre-épreuves ont été
-- jouées en transaction rollbackée avant d'écrire cette migration :
--
--   • REVOKE seul → la protection expire au prochain 1er janvier. Un
--     `ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme` (migration 20260617160000)
--     accorde `arwd` à `service_role` sur toute table NOUVELLE du schéma : la
--     partition annuelle que `f_ensure_partition_annee` crée pour 2032 naîtra
--     avec UPDATE/DELETE ouverts, quoi qu'on ait révoqué aujourd'hui.
--     Le trigger, lui, est cloné automatiquement sur toute partition attachée
--     ensuite (vérifié sur une partition créée après lui).
--
--   • Trigger seul → ne couvre pas `authenticated` visant une partition
--     directement. La RLS ramène d'abord la requête à 0 ligne, donc un trigger
--     `FOR EACH ROW` n'a rien à traiter et ne se déclenche jamais : `UPDATE 0`
--     silencieux, qui n'est pas un refus. Seul le REVOKE lève 42501 là.
--
-- PORTÉE EXACTE DE LA GARANTIE
-- ----------------------------
-- Fermé : `service_role`, `authenticated`, `anon` — y compris en visant une
--   partition directement, et y compris sur les partitions à venir.
-- Non fermé : `postgres`, propriétaire de la base. Un REVOKE lui est
--   structurellement inopérant (mesuré : ses privilèges restent à `true` après
--   REVOKE, sur le parent comme sur une partition), et il peut désactiver un
--   trigger. On protège donc contre le bug et l'accident, pas contre un accès
--   administrateur délibéré. Le trigger ci-dessous n'exempte personne : une
--   migration future qui devrait corriger une ligne d'audit aurait à désactiver
--   ce trigger explicitement, ce qui est visible en revue. Aucune exemption par
--   rôle n'est posée, car `current_user` vaut `postgres` pendant l'exécution de
--   toute fonction `SECURITY DEFINER` : exempter le propriétaire rouvrirait le
--   chemin à n'importe quelle RPC, depuis l'application.
--
-- CE QUE CETTE MIGRATION NE CASSE PAS (recensé avant écriture)
-- ------------------------------------------------------------
-- Aucun code applicatif ne mute `audit_log` (grep UPDATE/DELETE sur tout le
-- repo), aucune fonction SQL en base non plus (`pg_proc`). `f_purge_logs` boucle
-- sur `integrations_logs` seul — `audit_log` n'est jamais purgée (rétention
-- légale 5 ans, §07/06 §4). La RPC RGPD `fn_anonymize_user` ne fait qu'insérer.
-- Non destructive : aucune donnée touchée, aucune colonne ni table retirée.
-- =============================================================================

-- 1. La garde. SECURITY INVOKER (patron des autres triggers de garde du
--    schéma) : un trigger n'a pas besoin des droits du propriétaire pour
--    refuser une écriture.
CREATE OR REPLACE FUNCTION plateforme.fn_audit_log_immuable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION
    'plateforme.audit_log est append-only : % interdit (§07/06 Audit trail)', TG_OP
    USING ERRCODE = '42501';
END;
$$;

-- `CREATE FUNCTION` accorde EXECUTE à PUBLIC par défaut. Sans portée pratique
-- pour une fonction `RETURNS trigger` (non appelable directement), mais on ne
-- laisse pas une fonction du schéma ouverte par omission.
REVOKE EXECUTE ON FUNCTION plateforme.fn_audit_log_immuable() FROM PUBLIC, anon, authenticated;

-- 2. Le trigger. Posé sur la table partitionnée parent : PostgreSQL le clone
--    sur les 6 partitions existantes ET sur toute partition attachée plus tard
--    — c'est ce qui protège les années à venir, que le REVOKE ne peut pas tenir.
DROP TRIGGER IF EXISTS trg_audit_log_immuable ON plateforme.audit_log;
CREATE TRIGGER trg_audit_log_immuable
  BEFORE UPDATE OR DELETE ON plateforme.audit_log
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_audit_log_immuable();

-- 3. Le retrait des privilèges, sur le parent et sur chaque partition.
--    Indispensable pour `authenticated` (cf. « Trigger seul » plus haut) et
--    défense en profondeur pour `service_role`. La boucle couvre les partitions
--    présentes ; celles à venir sont tenues par le trigger cloné.
REVOKE UPDATE, DELETE ON plateforme.audit_log FROM anon, authenticated, service_role;

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
      'REVOKE UPDATE, DELETE ON plateforme.%I FROM anon, authenticated, service_role',
      r.relname
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION plateforme.fn_audit_log_immuable() IS
  'Refuse tout UPDATE/DELETE sur plateforme.audit_log (append-only, §07/06 Audit trail). '
  'Cloné automatiquement sur chaque partition annuelle, y compris celles créées '
  'après cette migration par f_ensure_partition_annee.';
