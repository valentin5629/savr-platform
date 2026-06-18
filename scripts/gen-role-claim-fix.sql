-- Générateur DDL : remplace auth.jwt()->>'role' par plateforme.f_app_role()
-- dans toutes les fonctions, policies et vues plateforme/shared.
-- À exécuter contre une base à l'état HEAD (toutes migrations appliquées),
-- SANS la migration fix_role_claim. Sortie capturée vers la migration (psql -t -A).
WITH repl AS (
  SELECT 'auth\.jwt\(\)\s*->>\s*''role''(::text)?' AS pat,
         'plateforme.f_app_role()' AS sub
),
fns AS (
  SELECT 10 AS ord, n.nspname||'.'||p.proname AS k,
         regexp_replace(pg_get_functiondef(p.oid), r.pat, r.sub, 'g') || E';\n' AS ddl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN repl r
  WHERE n.nspname IN ('plateforme','shared') AND p.prokind='f'
    AND p.proname <> 'f_app_role'
    AND pg_get_functiondef(p.oid) ~ 'auth\.jwt\(\)\s*->>\s*''role'''
),
pol AS (
  SELECT 20 AS ord,
         pp.schemaname||'.'||pp.tablename||'.'||pp.policyname AS k,
         format(E'DROP POLICY IF EXISTS %I ON %I.%I;\n', pp.policyname, pp.schemaname, pp.tablename)
         || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                   pp.policyname, pp.schemaname, pp.tablename,
                   pp.permissive, pp.cmd, array_to_string(pp.roles, ', '))
         || coalesce(E'\n  USING (' || regexp_replace(pp.qual, r.pat, r.sub, 'g') || ')', '')
         || coalesce(E'\n  WITH CHECK (' || regexp_replace(pp.with_check, r.pat, r.sub, 'g') || ')', '')
         || E';\n' AS ddl
  FROM pg_policies pp
  CROSS JOIN repl r
  WHERE pp.schemaname IN ('plateforme','shared')
    AND (coalesce(pp.qual,'')||coalesce(pp.with_check,'')) ~ 'auth\.jwt\(\)\s*->>\s*''role'''
),
vws AS (
  SELECT 30 AS ord, n.nspname||'.'||c.relname AS k,
         format('CREATE OR REPLACE VIEW %I.%I%s AS ',
                n.nspname, c.relname,
                CASE WHEN c.reloptions IS NULL THEN ''
                     ELSE ' WITH ('||array_to_string(c.reloptions, ', ')||')' END)
         || regexp_replace(pg_get_viewdef(c.oid), r.pat, r.sub, 'g') || E'\n' AS ddl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN repl r
  WHERE n.nspname IN ('plateforme','shared') AND c.relkind='v'
    AND pg_get_viewdef(c.oid) ~ 'auth\.jwt\(\)\s*->>\s*''role'''
)
SELECT ddl FROM (
  SELECT ord, k, ddl FROM fns
  UNION ALL SELECT ord, k, ddl FROM pol
  UNION ALL SELECT ord, k, ddl FROM vws
) z ORDER BY ord, k;
