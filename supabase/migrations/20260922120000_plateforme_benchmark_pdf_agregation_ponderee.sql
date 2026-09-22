-- Benchmark kg/pax × parc — aligner le PDF rapport RSE sur l'écran (§06.04 + §12 §1.2).
-- ---------------------------------------------------------------------------
-- Divergence M3.1 « benchmark écran vs PDF » (2026-09-22) — arbitrage Val, option (a).
--
-- Le §06.04 exige que l'écran et le PDF montrent le MÊME graphe. Les deux
-- surfaces agrégeaient pourtant les segments parc différemment :
--   - écran : `aggregateBenchmarkPerFlux` (cockpit-derive.ts) = moyenne des segments
--     PONDÉRÉE par `nb_collectes_segment` — règle commune aux 4 écrans à jauges ;
--   - PDF   : `f_rapport_benchmark_zd` = `AVG(kg_par_pax_moyen)`, moyenne SIMPLE.
-- Écart mesuré sur les segments (0,30 ; n=5) et (0,40 ; n=15) : écran 0,375 contre
-- PDF 0,350. Le cas multi-segments ne demande aucune action de l'utilisateur : il
-- survient dès qu'un filtre porte sur plusieurs types d'événement ou plusieurs
-- brackets de taille (élargissement des filtres benchmark à la régénération).
--
-- Cette migration aligne le PDF sur la règle de l'écran :
--   AVG(kg)  →  SUM(kg × n) / NULLIF(SUM(n), 0)
-- Rien d'autre ne bouge : `f_benchmark_kg_pax_zd` (partagée par TOUS les dashboards)
-- et `aggregateBenchmarkPerFlux` sont inchangées ; l'option (b) du §04 (pondération
-- au tonnage Σpoids/Σpax entre segments) est écartée par l'arbitrage — elle
-- supposerait d'exposer Σpax en sortie de la fonction partagée.
--
-- Équivalence avec la règle écran, terme à terme :
--   - dénominateur nul (aucun segment ≥ k-anonymat 5) ⇒ NULLIF → NULL, comme le
--     `if (den > 0)` de la version TS qui omet alors le flux (jauge sans point rouge,
--     « Données insuffisantes ») ;
--   - segment dont `kg_par_pax_moyen` est NULL (Σpax = 0) ⇒ SUM ignore le terme au
--     numérateur mais compte son n au dénominateur, exactement comme `num(null) = 0`
--     côté TS.
--
-- Portée : les rapports RÉGÉNÉRÉS changent de valeur ; les PDF déjà rendus, non
-- (`rapports_rse.filtres_benchmark` fige les filtres, pas le résultat).
--
-- CREATE OR REPLACE : mêmes colonnes de sortie, même signature, `SECURITY DEFINER`
-- et `SET search_path` ré-énoncés explicitement (un CREATE OR REPLACE qui les
-- omettrait réinitialiserait le durcissement en silence). L'ACL est conservée par
-- REPLACE ; les REVOKE/GRANT ci-dessous la ré-affirment à l'identique
-- (service_role seul — aucun élargissement, ni `authenticated`, ni `anon`, ni PUBLIC).
--
-- ROLLBACK — rejouer 20260707130000 (corps d'origine, `AVG(pb.kg_par_pax_moyen)`) :
-- la signature d'entrée comme de sortie est inchangée, aucun appelant à reprendre.
-- Attention : revenir en arrière rétablit l'écart écran/PDF que cette PR ferme.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION plateforme.f_rapport_benchmark_zd(
  p_collecte_id            uuid,
  p_periode_debut          date   DEFAULT NULL,
  p_periode_fin            date   DEFAULT NULL,
  p_lieu_ids               uuid[] DEFAULT NULL,
  p_type_evenement_ids     uuid[] DEFAULT NULL,   -- NULL → type d'événement de la collecte
  p_taille_evenement_codes text[] DEFAULT NULL    -- NULL → taille (bracket) de la collecte
) RETURNS TABLE (
  flux_id              uuid,
  flux_code            text,
  flux_nom             text,
  taille_evenement     text,
  collecte_kg_pax      numeric,
  benchmark_kg_pax     numeric,
  nb_collectes_segment integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_pax     integer;
  v_type    uuid;
  v_bracket text;
  v_types   uuid[];
  v_tailles text[];
BEGIN
  SELECT e.pax, e.type_evenement_id
    INTO v_pax, v_type
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RETURN;  -- collecte inconnue → 0 ligne (le batch omet le bloc)
  END IF;

  v_bracket := plateforme.taille_evenement_bracket(v_pax);
  -- Filtres effectifs : surcharge du demandeur, sinon segment propre de la collecte.
  v_types   := COALESCE(p_type_evenement_ids, ARRAY[v_type]);
  v_tailles := COALESCE(p_taille_evenement_codes, ARRAY[v_bracket]);

  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    fd.nom,
    v_bracket,
    (cf.poids_reel_kg / NULLIF(v_pax, 0))::numeric,
    b.kg,
    COALESCE(b.n, 0)
  FROM plateforme.collecte_flux cf
  JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
  -- Agrégation par flux du parc : moyenne des segments PONDÉRÉE par le nombre de
  -- collectes du segment — même règle que `aggregateBenchmarkPerFlux` côté écran
  -- (§06.04 « Règle d'agrégation des segments parc », divergence M3.1 option (a)).
  -- Un segment de 15 collectes pèse 3× un segment de 5 ; la moyenne simple d'avant
  -- les mettait à égalité et rendait au PDF un chiffre que l'écran ne montrait pas.
  LEFT JOIN LATERAL (
    SELECT (SUM(pb.kg_par_pax_moyen * pb.nb_collectes_segment)
            / NULLIF(SUM(pb.nb_collectes_segment), 0))::numeric AS kg,
           SUM(pb.nb_collectes_segment)::integer AS n
    FROM plateforme.f_benchmark_kg_pax_zd(
           p_flux_id                => fd.id,
           p_type_evenement_ids     => v_types,
           p_taille_evenement_codes => v_tailles,
           p_periode_debut          => p_periode_debut,
           p_periode_fin            => p_periode_fin,
           p_lieu_ids               => p_lieu_ids
         ) pb
  ) b ON true
  WHERE cf.collecte_id = p_collecte_id
    AND cf.poids_reel_kg IS NOT NULL
  ORDER BY fd.code;
END $$;

COMMENT ON FUNCTION plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) IS
  'Benchmark grain collecte pour le rapport RSE §1.2 (5 jauges kg/pax + point rouge parc). Wrapper SERVICE_ROLE de f_benchmark_kg_pax_zd, sans garde JWT (périmètre contrôlé en amont). Défaut = segment type+taille de la collecte ; filtres surchargés à la régénération. k-anonymat >=5 hérité. Agrégation des segments = moyenne PONDEREE par nb_collectes_segment, identique a aggregateBenchmarkPerFlux cote ecran (divergence M3.1 2026-09-22, option (a)).';

-- Ré-affirmation de l'ACL existante (identique à 20260707130000) : aucun élargissement.
REVOKE EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) TO service_role;

COMMIT;
