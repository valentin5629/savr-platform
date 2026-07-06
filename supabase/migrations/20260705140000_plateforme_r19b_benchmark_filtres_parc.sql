-- R19b — BL-P1-GEST-04 (encart « Filtres benchmark », §06.05 Bloc 3 ZD).
-- ---------------------------------------------------------------------------
-- L'encart de filtres benchmark laisse le gestionnaire choisir le périmètre du
-- « point rouge » sur TOUT LE PARC Savr (lieux/traiteurs toutes organisations
-- confondues — CDC §06.05). La RLS standard restreint le gestionnaire à ses
-- propres lieux : ces deux fonctions SECURITY DEFINER exposent la LISTE
-- (id + nom uniquement, aucune donnée métier) du parc pour alimenter les
-- multi-selects. Le benchmark lui-même reste anonymisé (k-anonymat ≥5 dans
-- f_benchmark_kg_pax_zd).
--
-- Garde de rôle applicatif (les GRANT PG portent sur `authenticated`, pas sur le
-- rôle métier JWT) : liste lieux = rôles benchmark ; liste traiteurs = PAS les
-- rôles traiteur (préservation compétitive — un traiteur ne benchmarke pas par
-- traiteur nommé, cf. garde f_benchmark_kg_pax_zd).
-- ---------------------------------------------------------------------------

BEGIN;

-- Liste des lieux du parc (id + nom) — pour le filtre « Lieux benchmark ».
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_lieux_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  IF plateforme.f_app_role() NOT IN
     ('gestionnaire_lieux', 'traiteur_manager', 'traiteur_commercial', 'admin_savr', 'ops_savr') THEN
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
  'Liste id+nom des lieux du parc Savr pour le filtre encart benchmark (§06.05). SECURITY DEFINER, garde role (benchmark roles).';

-- Liste des traiteurs du parc (id + nom) — pour le filtre « Traiteurs benchmark ».
-- Réservée aux rôles NON-traiteur (gestionnaire/admin) : préservation compétitive.
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_traiteurs_parc()
RETURNS TABLE (id uuid, nom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  IF plateforme.f_app_role() NOT IN ('gestionnaire_lieux', 'admin_savr', 'ops_savr') THEN
    RAISE EXCEPTION 'Role non autorise pour la liste traiteurs benchmark';
  END IF;
  RETURN QUERY
  SELECT o.id, COALESCE(o.nom, o.raison_sociale) AS nom
  FROM plateforme.organisations o
  WHERE o.type = 'traiteur'
    AND o.actif IS DISTINCT FROM false
    AND o.est_shadow IS DISTINCT FROM true
  ORDER BY 2;
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_traiteurs_parc() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_traiteurs_parc() TO authenticated;

COMMENT ON FUNCTION plateforme.f_benchmark_traiteurs_parc() IS
  'Liste id+nom des traiteurs du parc Savr pour le filtre encart benchmark (§06.05). SECURITY DEFINER, garde role (exclut les roles traiteur — compétitif).';

COMMIT;
