-- R21a — Rapport de recyclage ZD §1.2 : alimentation du bloc benchmark + comparaison parc.
-- ---------------------------------------------------------------------------
-- BL-P1-RPT-01 : le bloc « benchmark kg/pax × parc » (5 jauges + point rouge) du
--   rapport RSE §1.2 n'était jamais calculé. f_benchmark_kg_pax_zd (R19b) existe mais
--   n'était pas appelée par le batch PDF. On expose ici un wrapper grain-collecte,
--   appelable en SERVICE_ROLE (batch J+1 + régénération) — donc SANS garde JWT
--   (le batch/route contrôle le périmètre en amont), contrairement à
--   f_benchmark_single_collecte (fiche traiteur, gardée par auth.jwt()).
--
-- BL-P2-18 (2) : « Comparaison vs moyenne Savr (anonymisée, ≥3 acteurs) » (§12 §1.2
--   l.67) — DISTINCTE du benchmark k≥5. Moyenne pondérée par tonnage du taux de
--   recyclage sur tout le parc, masquée si < 3 organisations distinctes (anonymat).
--
-- Aucune table modifiée. Deux fonctions SECURITY DEFINER, service_role uniquement
-- (REVOKE PUBLIC + pas de GRANT authenticated → aucune surface d'appel client, pas
-- de fuite inter-org ; la lecture parc anonymisée reste médiée par ces fonctions).
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- 1. f_rapport_benchmark_zd — benchmark grain collecte pour le rapport RSE §1.2.
--    Un tuple par flux PESÉ de la collecte : sa valeur kg/pax + le « point rouge »
--    parc (moyenne pondérée f_benchmark_kg_pax_zd) sur le segment choisi, + le compte
--    de collectes du segment (k-anonymat ≥5 hérité de f_benchmark_kg_pax_zd : segment
--    < 5 → aucune ligne parc → benchmark_kg_pax NULL → « Données insuffisantes »).
--    Défaut (batch auto) : segment = type d'événement + taille de la collecte.
--    Régénération : le demandeur peut surcharger les filtres (période/lieux/type/taille).
-- ===========================================================================
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
  -- Agrégation par flux du parc : moyenne des segments retournés (1 seul segment dans
  -- le cas nominal type+taille uniques ; robustesse en cas de multi-sélection à la régén).
  LEFT JOIN LATERAL (
    SELECT AVG(pb.kg_par_pax_moyen)::numeric AS kg,
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
  'Benchmark grain collecte pour le rapport RSE §1.2 (5 jauges kg/pax + point rouge parc). Wrapper SERVICE_ROLE de f_benchmark_kg_pax_zd, sans garde JWT (périmètre contrôlé en amont). Défaut = segment type+taille de la collecte ; filtres surchargés à la régénération. k-anonymat ≥5 hérité.';

REVOKE EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) TO service_role;

-- ===========================================================================
-- 2. f_taux_recyclage_moyen_parc — moyenne Savr anonymisée (§12 §1.2 l.67).
--    Moyenne pondérée par tonnage du taux de recyclage figé (collectes.taux_recyclage)
--    sur l'ensemble du parc ZD cloturé. Anonymat : aucune ligne si < p_nb_acteurs_min
--    organisations distinctes (défaut 3). Distinct du benchmark kg/pax (k≥5).
-- ===========================================================================
CREATE OR REPLACE FUNCTION plateforme.f_taux_recyclage_moyen_parc(
  p_periode_debut   date    DEFAULT NULL,
  p_periode_fin     date    DEFAULT NULL,
  p_nb_acteurs_min  integer DEFAULT 3
) RETURNS TABLE (
  taux_moyen_pondere numeric,
  nb_organisations   integer,
  nb_collectes       integer
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
BEGIN
  RETURN QUERY
  WITH agg AS (
    SELECT
      SUM(c.taux_recyclage * ct.tonnage) / NULLIF(SUM(ct.tonnage), 0) AS taux,
      COUNT(DISTINCT e.organisation_id)                              AS orgs,
      COUNT(*)                                                       AS nb
    FROM plateforme.collectes c
    JOIN plateforme.evenements e ON e.id = c.evenement_id
    JOIN LATERAL (
      SELECT COALESCE(SUM(cf.poids_reel_kg), 0) AS tonnage
      FROM plateforme.collecte_flux cf
      WHERE cf.collecte_id = c.id
    ) ct ON true
    WHERE c.type = 'zero_dechet'
      AND c.statut = 'cloturee'
      AND c.taux_recyclage IS NOT NULL
      AND ct.tonnage > 0
      AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
      AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
  )
  SELECT round(agg.taux, 2), agg.orgs::integer, agg.nb::integer
  FROM agg
  WHERE agg.orgs >= p_nb_acteurs_min;  -- anonymat : masqué sous le seuil d'acteurs
END $$;

COMMENT ON FUNCTION plateforme.f_taux_recyclage_moyen_parc(date, date, integer) IS
  'Moyenne Savr anonymisee du taux de recyclage (§12 §1.2 l.67) : moyenne ponderee par tonnage sur le parc ZD cloture, masquee si < N organisations distinctes (defaut 3). SERVICE_ROLE.';

REVOKE EXECUTE ON FUNCTION
  plateforme.f_taux_recyclage_moyen_parc(date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_taux_recyclage_moyen_parc(date, date, integer) TO service_role;

COMMIT;
