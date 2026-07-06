-- R19b — BL-P1-GEST-04 : refonte f_benchmark_kg_pax_zd (§11 benchmark, §06.05 Bloc 3 ZD).
-- ---------------------------------------------------------------------------
-- Défaut audit : signature à 2 params (p_bracket, p_flux_code) retournant la
-- MÉDIANE (PERCENTILE_CONT 0.5). Le CDC (§11 Dashboards + §04 Data Model) exige :
--   - 7 paramètres de filtre : flux, type d'événement, taille, période (début/fin),
--     lieux, traiteurs (tous optionnels ; NULL = pas de filtre sur la dimension) ;
--   - MOYENNE PONDÉRÉE PAR TONNAGE = Σ poids_reel_kg / Σ pax sur le segment
--     (remplace la médiane) — « point rouge » = cette moyenne pondérée parc ;
--   - k-anonymat ≥ 5 collectes (inchangé), garde compétitive rôle traiteur (RAISE).
--
-- PÉRIMÈTRE R19b (Option A, décision Val 2026-07-05) : la FONCTION + ses appelants
-- existants + BenchmarkGauge relabellé. Le RENDU riche (encart filtres 5 dimensions
-- + 5 jauges échelle fixe + lib charting) reste hors périmètre = lot R20 / PARITE-01
-- (composants §11 partagés montés sur les 3 rôles).
--
-- Ordre des dépendances :
--   1. DROP mv_benchmark_kg_pax_zd_base    (dépend de la fonction 1-arg)
--   2. DROP f_benchmark_kg_pax_zd(text,text)  (ancienne signature)
--   3. CREATE nouvelle fonction 7 params (moyenne pondérée)
--   4. GRANT EXECUTE nouvelle signature → authenticated
--   5. CREATE OR REPLACE f_benchmark_single_collecte (appelant SQL : nouvelle signature)
--   6. RECREATE mv baseline + index + REVOKE authenticated/anon (sécurité M3.5 T10/T18)
-- ---------------------------------------------------------------------------

BEGIN;

-- 1. La vue matérialisée dépend de f_benchmark_kg_pax_zd('XS'…) (1-arg) → DROP d'abord.
DROP MATERIALIZED VIEW IF EXISTS plateforme.mv_benchmark_kg_pax_zd_base;

-- 2. Ancienne signature (text, text) — plus référencée après recâblage des appelants.
DROP FUNCTION IF EXISTS plateforme.f_benchmark_kg_pax_zd(text, text);

-- 3. Nouvelle fonction : 7 paramètres CDC + moyenne pondérée par tonnage.
CREATE FUNCTION plateforme.f_benchmark_kg_pax_zd(
  p_flux_id                 uuid   DEFAULT NULL,
  p_type_evenement_ids      uuid[] DEFAULT NULL,
  p_taille_evenement_codes  text[] DEFAULT NULL,
  p_periode_debut           date   DEFAULT NULL,
  p_periode_fin             date   DEFAULT NULL,
  p_lieu_ids                uuid[] DEFAULT NULL,
  p_traiteur_ids            uuid[] DEFAULT NULL
) RETURNS TABLE (
  flux_id                     uuid,
  flux_code                   text,
  type_evenement_id           uuid,
  taille_evenement            text,
  kg_par_pax_moyen            numeric,
  nb_collectes_segment        integer,
  nb_organisations_distinctes integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  -- Garde compétitive (§04) : un rôle traiteur ne peut cibler des traiteurs nommés
  -- (sinon il déduirait la performance individuelle d'un concurrent).
  IF plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial')
     AND p_traiteur_ids IS NOT NULL
     AND array_length(p_traiteur_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)';
  END IF;

  -- Grain de sortie CDC §04 « Colonnes exposées » : un tuple par
  -- (flux × type d'événement × taille). Les paramètres p_* sont des FILTRES.
  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    e.type_evenement_id,
    plateforme.taille_evenement_bracket(e.pax) AS taille_evenement,
    -- Moyenne pondérée par tonnage : Σ poids du flux / Σ pax du segment
    -- (collectes plus lourdes pèsent proportionnellement plus — §04 Data Model).
    (SUM(cf.poids_reel_kg) / NULLIF(SUM(e.pax), 0))::numeric AS kg_par_pax_moyen,
    COUNT(DISTINCT c.id)::integer AS nb_collectes_segment,
    -- Audit anti-domination : nb d'organisations distinctes dans le segment (§04).
    COUNT(DISTINCT e.organisation_id)::integer AS nb_organisations_distinctes
  FROM plateforme.collectes c
  JOIN plateforme.evenements e     ON e.id = c.evenement_id
  JOIN plateforme.collecte_flux cf ON cf.collecte_id = c.id
  JOIN plateforme.flux_dechets fd  ON fd.id = cf.flux_id
  WHERE c.statut = 'cloturee'
    AND c.type = 'zero_dechet'
    AND cf.poids_reel_kg IS NOT NULL
    AND (p_flux_id IS NULL OR fd.id = p_flux_id)
    AND (p_type_evenement_ids IS NULL
         OR e.type_evenement_id = ANY (p_type_evenement_ids))
    AND (p_taille_evenement_codes IS NULL
         OR plateforme.taille_evenement_bracket(e.pax) = ANY (p_taille_evenement_codes))
    AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
    AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
    AND (p_lieu_ids IS NULL OR e.lieu_id = ANY (p_lieu_ids))
    AND (p_traiteur_ids IS NULL
         OR e.traiteur_operationnel_organisation_id = ANY (p_traiteur_ids))
  GROUP BY fd.id, fd.code, e.type_evenement_id, taille_evenement
  HAVING COUNT(DISTINCT c.id) >= 5;  -- k-anonymat : segment < 5 collectes masqué (non retourné)
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[]) IS
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), moyenne ponderee par tonnage (SUM poids / SUM pax), k-anonymat >=5, 7 filtres CDC 04/11. SECURITY DEFINER + garde competitive role traiteur.';

-- 4. EXECUTE : révoqué à PUBLIC (une CREATE FUNCTION grant EXECUTE à PUBLIC par
--    défaut → anon pourrait appeler la RPC via PostgREST), puis ouvert à authenticated
--    seulement. RLS des tables sources appliquée via search_path figé + SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION
  plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[])
  TO authenticated;

-- 5. Appelant SQL : f_benchmark_single_collecte (fiche traiteur M3.1, sans consommateur
--    front actuel) joignait l'ancienne signature 1-arg. On la recâble sur la nouvelle
--    signature (filtre taille = bracket de la collecte). Sa signature de SORTIE reste
--    inchangée (colonne median_kg_pax conservée pour ne pas rippler M3.1) ; la VALEUR
--    servie est désormais la moyenne pondérée benchmark (CDC §11 refonte).
CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(flux_code text, bracket text, valeur_kg_pax numeric, median_kg_pax numeric, nb_collectes integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'plateforme', 'pg_catalog'
AS $function$
DECLARE
  v_role    text := plateforme.f_app_role();
  v_org     uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_evt_org uuid;
  v_evt_top uuid;
  v_pax     integer;
  v_bracket text;
  v_type    uuid;
BEGIN
  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible)
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, e.pax, e.type_evenement_id
    INTO v_evt_org, v_evt_top, v_pax, v_type
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  IF v_role NOT IN ('admin_savr', 'ops_savr')
     AND v_org IS DISTINCT FROM v_evt_org
     AND v_org IS DISTINCT FROM v_evt_top THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);

  RETURN QUERY
  WITH valeurs AS (
    -- ratio kg/pax de la collecte courante, par flux
    SELECT fd.code AS flux_code,
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS valeur_kg_pax
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.valeur_kg_pax,
    -- Filtre type + taille de la collecte ⇒ 1 segment par flux (grain CDC flux×type×taille).
    -- b.kg_par_pax_moyen = moyenne pondérée parc (servie dans le slot median_kg_pax
    -- conservé pour la stabilité du contrat M3.1).
    b.kg_par_pax_moyen,
    COALESCE(b.nb_collectes_segment, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(
              p_type_evenement_ids     => ARRAY[v_type],
              p_taille_evenement_codes => ARRAY[v_bracket]) b
         ON b.flux_code = v.flux_code;
END $function$;

-- 6. Recréation de la vue matérialisée baseline (parc entier, sans filtre optionnel).
--    f_benchmark_kg_pax_zd() sans argument = tous flux × brackets, moyenne pondérée,
--    k-anonymat ≥5 (f_app_role() = NULL au refresh cron → garde traiteur inactive).
CREATE MATERIALIZED VIEW plateforme.mv_benchmark_kg_pax_zd_base AS
  SELECT * FROM plateforme.f_benchmark_kg_pax_zd()
WITH NO DATA;

CREATE INDEX idx_mv_benchmark_bracket_flux
  ON plateforme.mv_benchmark_kg_pax_zd_base (taille_evenement, flux_code);

-- Sécurité (M3.5 T10/T18) : accès benchmark UNIQUEMENT via la fonction (SECURITY DEFINER,
-- k-anonymat). SELECT direct sur la mv refusé à authenticated/anon.
REVOKE ALL ON plateforme.mv_benchmark_kg_pax_zd_base FROM authenticated, anon;

COMMIT;
