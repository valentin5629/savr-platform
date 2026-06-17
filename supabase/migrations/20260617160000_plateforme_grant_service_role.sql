-- =============================================================================
-- FIX — Privilèges `service_role` sur les schémas custom
-- =============================================================================
-- Contexte : la migration 0.4a (20260611180000) accorde USAGE + privilèges
-- table-level à `authenticated`/`anon`, mais PAS à `service_role`. Or toutes
-- les routes serveur (createAdminSupabaseClient) utilisent la clé service_role
-- via PostgREST → sans ces grants, toute requête lève
-- « permission denied for schema plateforme » (42501) et l'app ne lit AUCUNE
-- donnée (dashboards/listes vides). service_role a BYPASSRLS : il est le rôle
-- serveur de confiance, l'autorisation applicative est faite en amont
-- (requireStaff / requireAdmin), jamais exposé au navigateur.
--
-- ⚠ PRÉREQUIS HORS-MIGRATION (config API du projet Supabase, par environnement) :
-- exposer les schémas custom à l'API. Dashboard → Project Settings → API →
-- « Exposed schemas » = `plateforme, shared, public, graphql_public`
-- (plateforme en premier = schéma par défaut, cf. supabase/config.toml local).
-- Sans ça, PostgREST renvoie PGRST106 « Invalid schema: plateforme ».
-- =============================================================================

-- Accès aux schémas
GRANT USAGE ON SCHEMA plateforme TO service_role;
GRANT USAGE ON SCHEMA shared TO service_role;

-- Privilèges sur les objets existants
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plateforme TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA plateforme TO service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA shared TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA plateforme TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA shared TO service_role;

-- Privilèges par défaut pour les objets FUTURS créés par le rôle de migration,
-- afin d'éviter de réaccorder à chaque nouvelle table (cf. dette « GRANT
-- explicite tables post-0.4a »). N'affecte que les objets créés ensuite.
ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA plateforme
  GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shared
  GRANT EXECUTE ON FUNCTIONS TO service_role;
