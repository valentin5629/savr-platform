-- =============================================================================
-- Durcissement sécurité — search_path verrouillé sur les fonctions SECURITY
-- DEFINER restantes (CWE-426 : search-path hijack théorique).
-- =============================================================================
-- Audit sur DB migrée (HEAD) — fonctions SECURITY DEFINER sans `search_path` :
--   SELECT n.nspname, p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE p.prosecdef AND n.nspname IN ('plateforme','shared','public')
--     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c
--                     WHERE c LIKE 'search_path=%');
-- → 5 retardataires, manqués par le Lot C (20260622140000) qui ne couvrait que
--   f_collecte_visible / f_collecte_editable / f_dechets_labo_estimes / f_fichier_visible
--   + les 3 fn outbox. Aucune des 3 migrations de convergence enum (clusters A/B,
--   20260623110000/120000/130000) n'introduit de nouvelle fn non durcie.
--
-- MÉTHODE — `ALTER FUNCTION … SET search_path`, identique au Lot C (20260622140000,
--   précédent direct de ce durcissement). On NE touche PAS au corps : le brief
--   demandait CREATE OR REPLACE pour « reprendre la dernière définition », or ALTER
--   atteint ce but SANS reproduire le corps (zéro risque de divergence sur PROD
--   LIVE, notamment fn_trg_regenerer_attestation ~150 lignes). Durcissement pur :
--   les corps ne référencent que des objets QUALIFIÉS (plateforme.*, builtins
--   pg_catalog) → aucun changement de comportement.
--
--   `pg_catalog` préféré à `public` (réduit la surface) ; les 5 fn sont en schéma
--   plateforme et n'appellent rien de `public`/`shared`/`extensions` non qualifié.
-- =============================================================================

-- Séquence d'attestation (insère dans plateforme.sequences_facturation).
ALTER FUNCTION plateforme.f_next_numero_attestation(integer)
  SET search_path = plateforme, pg_catalog;

-- Upsert d'alerte Admin in-app (plateforme.alertes_admin).
ALTER FUNCTION plateforme.f_upsert_alerte_admin(text, text, text, text, uuid)
  SET search_path = plateforme, pg_catalog;

-- Agrégation terminale multi-camions (collectes / collecte_tournees / tournees).
ALTER FUNCTION plateforme.fn_agreger_terminal_collecte(uuid)
  SET search_path = plateforme, pg_catalog;

-- Trigger de régénération d'attestation (ECR-2/3) — appelle f_next_numero_attestation.
ALTER FUNCTION plateforme.fn_trg_regenerer_attestation()
  SET search_path = plateforme, pg_catalog;

-- Helper ops interne (SELECT 1) — NON exposé via PostgREST. Le /health runtime
-- appelle public.health_ping (déjà durcie dès 20260613130000). Durcissement ici
-- en défense-en-profondeur (la fn restait SECURITY DEFINER sans search_path).
ALTER FUNCTION plateforme.health_ping()
  SET search_path = plateforme, pg_catalog;
