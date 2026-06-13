-- health_ping dans le schéma public (exposé par PostgREST).
-- plateforme.health_ping() n'est pas accessible via REST car le schéma plateforme
-- n'est pas dans la liste des schémas exposés par PostgREST (public, graphql_public).
-- La route /api/health appelle /rest/v1/rpc/health_ping → cherche dans public.
CREATE OR REPLACE FUNCTION public.health_ping()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT 1;
$$;

GRANT EXECUTE ON FUNCTION public.health_ping() TO anon, authenticated, service_role;
