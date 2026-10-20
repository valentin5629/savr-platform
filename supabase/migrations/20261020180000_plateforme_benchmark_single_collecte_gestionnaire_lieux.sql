-- =============================================================================
-- Radar de la fiche collecte : le gestionnaire de lieux le voit aussi sur les
-- collectes que des traiteurs tiennent sur ses lieux (décision Val 2026-10-20)
-- =============================================================================
-- CONSTAT (savr-dev, lecture seule, 2026-10-20) : un gestionnaire Viparis ouvre
-- la fiche d'une collecte ZD clôturée tenue au Palais des Congrès, programmée et
-- opérée par le traiteur Potel. L'onglet « Bilan & documents » affiche les
-- chiffres clés et la répartition des tonnages, mais pas le radar. Cause :
-- `f_benchmark_single_collecte` n'acceptait que l'organisation programmatrice ou
-- le traiteur opérationnel ; elle refusait le gestionnaire du lieu, la route
-- répondait « pas de radar » (200, data null) et l'écran masquait le bloc.
--
-- CDC : §06.04 (« Bilan & documents ZD », refonte du pop-up 2026-09-29) prévoit
-- le radar pour tous les rôles clients, gestionnaire compris. Le masquage sur
-- les collectes de traiteurs tiers était un écart tracé (divergence D13 du
-- 2026-09-30), repris au §06.05 (« radar ZD masqué »). Val tranche le
-- 2026-10-20 : le gestionnaire voit le radar sur ces collectes. Une fiche de
-- divergence corrige le §06.05 en conséquence.
--
-- CE QUI S'OUVRE, ET RIEN D'AUTRE : la fonction accepte en plus l'appelant de
-- rôle `gestionnaire_lieux` dont l'organisation est rattachée
-- (`organisations_lieux`) au lieu d'un événement DATÉ. C'est la borne du
-- régime (b) de `evt_gestionnaire_select` et de `f_collecte_visible` : les
-- collectes que la RLS lui montre déjà, pas une de plus. Restent refusés :
--   • un gestionnaire sur un lieu qui n'est pas rattaché à son organisation ;
--   • un événement sans date (condition `date_evenement IS NOT NULL` de la RLS,
--     garde B-2 ; la date vient des collectes non annulées) ;
--   • tout autre rôle client (traiteur, agence, client organisateur) hors de
--     ses programmations ou de ses collectes opérées, comme avant.
-- Les gardes de tête (rôle absent, organisation absente) sont inchangées.
--
-- AUCUNE DONNÉE NOUVELLE pour le gestionnaire : le ratio rendu
-- (`poids_reel_kg` du flux / `pax`) se calcule déjà à partir de ce que sa
-- session lit sur ces collectes — `collecte_flux.poids_reel_kg` sous
-- `cf_select` (`f_collecte_visible`) et `evenements.pax` (liste blanche de
-- 20261001103000). Le test pgTAP de ce lot le mesure sous le rôle
-- `authenticated` et compare les deux valeurs. Le repère parc reste calculé par
-- `f_benchmark_kg_pax_zd` sous le jeton de l'appelant, sans lieu ni traiteur :
-- k-anonymat et garde de périmètre du gestionnaire inchangés.
--
-- Corps recopié de 20260923090000 ; seuls changent la lecture du lieu et de la
-- date de l'événement, et la condition d'accès des rôles clients. Droits
-- d'exécution identiques (PUBLIC retiré ; authenticated et service_role).
-- Preuve : supabase/tests/benchmark_single_collecte_gestionnaire_lieux.test.sql.
--
-- ROLLBACK (down-migration) : rejouer par CREATE OR REPLACE le corps de
-- f_benchmark_single_collecte de 20260923090000 (lignes 134-221, REVOKE et
-- GRANT compris). Aucune donnée n'est touchée ; le gestionnaire redevient
-- refusé sur les collectes de traiteurs tiers (le radar y est de nouveau
-- masqué). Ce retour arrière ferme un accès, il n'en ouvre aucun.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.f_benchmark_single_collecte(p_collecte_id uuid)
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
  v_lieu    uuid;
  v_date    date;
  -- Gestionnaire dont l'organisation est rattachée au lieu d'un événement daté :
  -- même borne que evt_gestionnaire_select, régime (b).
  v_gestionnaire_du_lieu boolean;
BEGIN
  -- Fail-closed : rôle métier absent du jeton ⇒ refus, AVANT toute lecture (ne
  -- pas livrer d'oracle d'existence sur p_collecte_id). `NOT IN` ne peut pas
  -- porter ce cas : NULL NOT IN (…) vaut NULL, donc ne déclenche aucun IF.
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Role applicatif absent (acces refuse)';
  END IF;

  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible)
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, e.pax, e.type_evenement_id,
         e.lieu_id, e.date_evenement
    INTO v_evt_org, v_evt_top, v_pax, v_type, v_lieu, v_date
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte not accessible';
  END IF;

  -- admin_savr / ops_savr voient tout le parc : `organisation_id` n'a pour eux
  -- aucun sens et ne doit donc PAS être exigé (un test NULL en bloc, en tête,
  -- les refuserait à tort). Le contrôle d'organisation reste cantonné aux rôles
  -- clients, sous lesquels une organisation absente est désormais un refus
  -- EXPLICITE : `IS DISTINCT FROM` le fermait déjà (il est NULL-safe et rend
  -- TRUE face à NULL), mais l'invariant reposait alors sur cette subtilité au
  -- lieu d'être énoncé — et le message reçu ne disait pas la vraie cause.
  IF v_role NOT IN ('admin_savr', 'ops_savr') THEN
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Organisation applicative absente (acces refuse)';
    END IF;
    -- Rôle et organisation sont non NULL ici : chaque terme est un booléen
    -- défini, jamais NULL (une garde qui vaudrait NULL ne lèverait pas).
    v_gestionnaire_du_lieu :=
      v_role = 'gestionnaire_lieux'
      AND v_date IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM plateforme.organisations_lieux ol
         WHERE ol.organisation_id = v_org
           AND ol.lieu_id = v_lieu
      );
    IF v_org IS DISTINCT FROM v_evt_org
       AND v_org IS DISTINCT FROM v_evt_top
       AND v_gestionnaire_du_lieu IS NOT TRUE THEN
      RAISE EXCEPTION 'Collecte not accessible';
    END IF;
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
