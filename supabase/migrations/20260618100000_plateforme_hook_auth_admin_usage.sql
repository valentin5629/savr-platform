-- Prérequis hook JWT — USAGE schema plateforme pour supabase_auth_admin
--
-- GoTrue exécute le Custom Access Token hook EN TANT QUE `supabase_auth_admin`.
-- Ce rôle a déjà EXECUTE sur `plateforme.fn_custom_access_token` (migrations
-- 20260612000002 + 20260617180000), MAIS il lui faut aussi USAGE sur le schema
-- pour résoudre/appeler la fonction. Sans ça : le login échoue avec
-- « Error running hook URI: pg-functions://postgres/plateforme/fn_custom_access_token »
-- (500 unexpected_failure) → AUCUN utilisateur ne peut se connecter.
--
-- Ce GRANT existait sur dev/prod via une opération MANUELLE dashboard non
-- capturée en migration ; un `supabase db reset` (ou un déploiement prod neuf)
-- le perdait. On le rend déclaratif ici (découvert en testant le fix user_role
-- sur dev, 2026-06-18).
--
-- Sûr : USAGE = résolution de noms uniquement (aucun privilège table). La
-- fonction reste SECURITY DEFINER (lit plateforme.users/organisations en tant
-- que owner). C'est le pattern Supabase documenté pour les auth hooks.

GRANT USAGE ON SCHEMA plateforme TO supabase_auth_admin;
