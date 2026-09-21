-- ---------------------------------------------------------------------------
-- Fiche collecte traiteur §06.04 « Bloc 3 ZD — Jauges kg/pax × benchmark parc »
--
-- Normalisation des colonnes de sortie de f_benchmark_single_collecte sur la
-- forme canonique du CDC §04 « Grain single_collecte », exigée au câblage front :
--   bracket        → taille_evenement
--   valeur_kg_pax  → ratio_user
--   median_kg_pax  → benchmark_kg_pax   (la valeur servie est, depuis la refonte
--                                        2026-05-30, la MOYENNE PONDÉRÉE parc —
--                                        l'ancien nom « median » était trompeur)
--   nb_collectes   → nb_collectes_segment
--
-- Le CORPS est inchangé (garde de visibilité, k-anonymat ≥5 hérité de
-- f_benchmark_kg_pax_zd, grain flux × type × taille) : seul le contrat de noms
-- bouge. PostgreSQL refusant de renommer les colonnes OUT via CREATE OR REPLACE,
-- le remplacement passe par DROP + CREATE dans la même transaction.
--
-- Sans risque de régression : la fonction n'avait AUCUN consommateur avant cette
-- PR (0 appel SQL, 0 appel TS — cf. note as-built §04 « actuellement inerte »).
-- Le batch PDF passe, lui, par le wrapper service_role distinct de r21a.
--
-- Le DROP efface l'ACL → REVOKE/GRANT rejoués à l'identique (mêmes grantees
-- qu'en 20260616130000) ; search_path conservé (durcissement sécurité).
-- ---------------------------------------------------------------------------

BEGIN;

DROP FUNCTION IF EXISTS plateforme.f_benchmark_single_collecte(uuid);

CREATE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
 RETURNS TABLE(
   flux_code            text,
   taille_evenement     text,
   ratio_user           numeric,
   benchmark_kg_pax     numeric,
   nb_collectes_segment integer
 )
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
           cf.poids_reel_kg / NULLIF(v_pax, 0) AS ratio_user
    FROM plateforme.collecte_flux cf
    JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = p_collecte_id
      AND cf.poids_reel_kg IS NOT NULL
  )
  SELECT
    v.flux_code,
    v_bracket,
    v.ratio_user,
    -- Filtre type + taille de la collecte ⇒ 1 segment par flux (grain CDC flux×type×taille).
    -- b.kg_par_pax_moyen = moyenne pondérée parc, k-anonymat ≥5 appliqué dans
    -- f_benchmark_kg_pax_zd : segment trop petit ⇒ pas de ligne ⇒ NULL ici (le
    -- front masque alors le repère parc, cf. §06.04 « Données insuffisantes »).
    b.kg_par_pax_moyen,
    COALESCE(b.nb_collectes_segment, 0)
  FROM valeurs v
  LEFT JOIN plateforme.f_benchmark_kg_pax_zd(
              p_type_evenement_ids     => ARRAY[v_type],
              p_taille_evenement_codes => ARRAY[v_bracket]) b
         ON b.flux_code = v.flux_code;
END $function$;

REVOKE EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_benchmark_single_collecte(uuid)
  TO authenticated, service_role;

COMMIT;
