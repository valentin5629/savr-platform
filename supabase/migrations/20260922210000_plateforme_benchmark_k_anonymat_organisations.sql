-- Benchmark parc kg/pax ZD — k-anonymat durci : compter les ACTEURS, pas seulement
-- les collectes (§04 Data Model « RLS / k-anonymat », arbitrage Val 2026-09-22).
-- ---------------------------------------------------------------------------
-- CONSTAT (revue sécurité 2026-09-22). Le seuil était `COUNT(DISTINCT c.id) >= 5`,
-- donc porté par le seul NOMBRE DE COLLECTES. Un segment de 5 collectes appartenant
-- au MÊME acteur le franchissait, et sa moyenne kg/pax était publiée : elle ne décrit
-- alors plus « le parc » mais cet acteur. Or la fonction porte
-- `GRANT EXECUTE … TO authenticated` : tout utilisateur connecté l'appelle avec les
-- filtres de son choix (type d'événement, taille, période, lieux, traiteurs) et peut
-- resserrer jusqu'à ce qu'un seul acteur reste — ce que la garde compétitive sur
-- `p_traiteur_ids` empêche déjà par l'autre porte.
-- La fonction calculait pourtant `nb_organisations_distinctes`, que le §04 décrit comme
-- servant à « vérifier qu'on n'a pas un seul gestionnaire qui poids tout » : la colonne
-- était retournée, jamais utilisée comme garde.
--
-- MESURE sur seed_demo (666 collectes, base reconstruite depuis toutes les migrations) :
--   parc entier      → 25 segments publiés, 0 à acteur unique
--   filtré 1 lieu    → 60 segments publiés, 10 à organisation unique, 20 à traiteur unique
--   filtré 1 mois    → 125 segments publiés, 0 à acteur unique
--   filtré lieu+mois → 70 segments publiés, 0 à acteur unique
--
-- CORRECTIF (arbitrage Val 2026-09-22, rendu sur ces chiffres) — deux seuils cumulatifs :
--   1. `COUNT(DISTINCT c.id) >= 5` (inchangé, lettre du CDC) ;
--   2. `>= 3` acteurs distincts, exigé sur LES DEUX colonnes :
--        - `evenements.organisation_id` (organisation programmatrice) ;
--        - `evenements.traiteur_operationnel_organisation_id` (traiteur qui opère).
--      Seuil 3 aligné sur `f_taux_recyclage_moyen_parc` (`p_nb_acteurs_min = 3`, §12 §1.2)
--      et sur le k-anonymat ≥ 3 acteurs du §11. Deux acteurs n'anonymisent pas : chacun,
--      connaissant sa propre performance, déduit celle de l'autre par soustraction.
--      Les DEUX colonnes, parce que `p_traiteur_ids` filtre le traiteur OPÉRATIONNEL
--      (as-built `20260705130000`) tandis que la colonne d'audit compte la programmatrice :
--      ne compter que celle-ci laissait 10 segments (filtre lieu) à traiteur unique.
--      Toutes deux sont NOT NULL au schéma — aucun segment masqué par un COUNT sur NULL.
--
-- COÛT : 0 segment perdu sur le parc entier (l'affichage nominal des dashboards ne perd
-- rien), 25/60 sur une requête filtrée par lieu, 25/125 sur une requête filtrée par mois.
-- Les pertes se concentrent sur les requêtes resserrées — celles qui servent à isoler.
--
-- PÉRIMÈTRE : le HAVING, et rien d'autre. Mêmes 7 paramètres, mêmes colonnes de sortie
-- (en ajouter obligerait à recréer la vue matérialisée baseline et les deux appelants SQL),
-- même formule de moyenne pondérée, même garde compétitive. `SECURITY DEFINER` et
-- `SET search_path = plateforme, pg_catalog` sont reconduits MOT POUR MOT : un
-- `CREATE OR REPLACE` remplace `proconfig`, les omettre défairait le durcissement CWE-426
-- en silence. L'ACL (`authenticated`, `service_role`), elle, est préservée par REPLACE —
-- aucun GRANT à re-poser, et cette migration n'ouvre aucun accès.
--
-- Consommateurs (tous inchangés, un segment masqué est déjà un cas géré = jauge grise) :
-- dashboards traiteur / gestionnaire / agence / dashboard-client admin, fiche collecte via
-- `f_benchmark_single_collecte`, PDF rapport RSE via `f_rapport_benchmark_zd`,
-- vue matérialisée baseline `mv_benchmark_kg_pax_zd_base`.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_kg_pax_zd(
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
    -- Organisations programmatrices du segment. Depuis le durcissement 2026-09-22,
    -- c'est une GARDE (cf. HAVING), plus seulement une colonne d'audit.
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
  -- k-anonymat (§04, durci 2026-09-22) : segment masqué s'il porte moins de 5 collectes
  -- OU moins de 3 acteurs distincts, de part ET d'autre (programmateur / opérationnel).
  HAVING COUNT(DISTINCT c.id) >= 5
     AND COUNT(DISTINCT e.organisation_id) >= 3
     AND COUNT(DISTINCT e.traiteur_operationnel_organisation_id) >= 3;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[]) IS
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), moyenne ponderee par tonnage (SUM poids / SUM pax), 7 filtres CDC 04/11. k-anonymat DOUBLE (durci 2026-09-22) : >=5 collectes ET >=3 acteurs distincts sur les deux colonnes (organisation programmatrice ET traiteur operationnel) — 5 collectes d''un acteur unique publiaient sa performance individuelle. SECURITY DEFINER + garde competitive role traiteur.';

COMMIT;
