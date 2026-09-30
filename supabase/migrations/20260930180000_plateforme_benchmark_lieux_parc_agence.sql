-- Benchmark : liste des lieux du parc ouverte au rôle agence (D8, arbitrage Val 2026-09-30).
-- ÉLARGIT UN ACCÈS (CLAUDE.md §12 2bis) : écrite par Val. L'agence obtient la même liste
-- que les rôles traiteur (id + nom des lieux actifs, rien d'autre). f_benchmark_traiteurs_parc
-- reste fermée à l'agence. Corps identique à 20260923090000, seule la liste blanche change.
-- ROLLBACK : rejouer f_benchmark_lieux_parc de 20260923090000 avec les mêmes REVOKE/GRANT.
BEGIN;

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_lieux_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  IF plateforme.f_app_role() IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;
  IF plateforme.f_app_role() NOT IN
     ('gestionnaire_lieux', 'traiteur_manager', 'traiteur_commercial', 'agence',
      'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste benchmark';
  END IF;
  RETURN QUERY
  SELECT l.id, l.nom
  FROM plateforme.lieux l
  WHERE l.actif IS DISTINCT FROM false
  ORDER BY l.nom;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_lieux_parc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_lieux_parc() TO authenticated;

COMMENT ON FUNCTION plateforme.f_benchmark_lieux_parc() IS
  'Liste id+nom des lieux du parc Savr pour le filtre benchmark (§06.05, §06.11). SECURITY DEFINER, garde role fail-closed ; agence autorisee depuis 20260930180000 (D8).';

COMMIT;
