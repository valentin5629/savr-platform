-- =============================================================================
-- Fermer l'écriture PostgREST directe de `plateforme.organisations_lieux`.
--
-- Source : arbitrage Val 2026-09-29 (divergence SECU-RLS_20260929, option C3).
-- Même geste que `20260921210000` sur `lieux`. CLAUDE.md §12 pt 2bis —
-- migration de FERMETURE (resserrement).
--
-- LE DÉFAUT
-- ---------
-- Le GRANT table-level du blanket 0.4a (`SELECT, INSERT, UPDATE, DELETE ON ALL
-- TABLES IN SCHEMA plateforme TO authenticated`) n'a jamais été repris sur cette
-- table. Mesuré sur la base locale le 2026-09-29 (`relacl`) :
--   authenticated=arwd/postgres
-- La policy `org_lieux_admin` est `FOR ALL`, WITH CHECK `admin_savr` : un JWT
-- `admin_savr` porté par la clé anon (publique) écrit donc directement dans la
-- table, sans passer par les routes admin lieux. Mesuré le 2026-09-29 avant le
-- trigger P0047 : INSERT (traiteur, lieu d'un autre traiteur) accepté, puis ce
-- traiteur lisait la collecte de l'autre via `f_collecte_visible`.
--
-- CE QUE LE TRIGGER P0047 (20260929140000) FERMAIT DÉJÀ, ET CE QUI RESTAIT
-- -------------------------------------------------------------------------
-- Le trigger refuse tout rattachement d'une organisation non gestionnaire, quel
-- que soit le chemin. Restait ouvert par PostgREST : rattacher un gestionnaire à
-- n'importe quel lieu, détacher le gestionnaire d'un lieu, sans audit_log (écrit
-- par les routes seulement) ni contrôle « 1 gestionnaire par lieu » (décision
-- Val 2026-07-02, posé par la route PATCH). Et, pour un non-admin, l'ordre
-- trigger → RLS laissait deviner le type d'une organisation dont on connaît
-- l'identifiant (P0047 vs refus RLS) : le refus de privilège, levé avant les
-- deux, supprime cet oracle.
--
-- CE QUI RESTE INCHANGÉ
-- ---------------------
-- - Le SELECT table-level de `authenticated` : `org_lieux_self_select` sert les
--   sous-requêtes inline des policies `evenements` / `lieux` (§09 A1) — le
--   retirer casserait silencieusement ces policies.
-- - Les routes admin lieux écrivent sous `service_role` : non concernées.
-- - Aucune fonction SQL n'écrit la table sous l'identité de l'appelant (grep des
--   migrations, 2026-09-29).
-- - Les policies `org_lieux_admin` et `org_lieux_self_select` sont conservées ;
--   l'écriture de `org_lieux_admin` devient INERTE pour PostgREST direct tant que
--   le privilège n'est pas ré-accordé.
--
-- NATURE. Fermante et non destructive : aucun DROP de table ou de colonne, aucun
-- RENAME ni backfill, aucun GRANT, aucune policy modifiée.
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON plateforme.organisations_lieux FROM authenticated, anon;

COMMENT ON TABLE plateforme.organisations_lieux IS
  'Rattachement d''un lieu à son gestionnaire (organisations de type gestionnaire_lieux uniquement, trigger P0047 20260929140000 ; 1 gestionnaire par lieu, décision Val 2026-07-02). Écriture FERMÉE à `authenticated` depuis 2026-09-29 (20260929150000) : INSERT, UPDATE et DELETE retirés du GRANT table-level 0.4a, sans re-GRANT — toute écriture passe par les routes admin lieux (service_role), seules à tracer l''audit_log. Le SELECT est conservé : org_lieux_self_select sert les sous-requêtes des policies evenements/lieux.';
