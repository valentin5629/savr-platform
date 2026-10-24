-- =============================================================================
-- Benchmark kg/pax et registre au grain de la COLLECTE (lot C1 de la refonte du
-- formulaire ; décisions Val 2026-10-22 C3, 2026-10-20 C4, 2026-10-24 Q4)
-- =============================================================================
-- CONSTAT. Depuis la refonte (lots A et B1), chaque collecte porte son type
-- d'événement (`collectes.type_evenement_id`) et son nombre de convives
-- (`collectes.pax`, 1 à 100 000 ; 0 = inconnu, reprise Bubble).
-- `evenements.type_evenement_id` n'est plus qu'une copie de la collecte n°1 et
-- `evenements.pax` un total dérivé (par jour le plus grand des totaux ZD et AG
-- des collectes non annulées, puis somme des jours). Les quatre objets ci-dessous
-- lisaient encore l'événement :
--   - une collecte « Repas assis » d'un événement « Cocktail » était comparée au
--     parc « Cocktail » ;
--   - pour un événement de deux soirées, chaque collecte était rangée et divisée
--     par le total des deux soirées : kg/pax et taille faux ;
--   - une collecte à 0 convive comptait dans le parc (taille XS, poids ajouté,
--     aucun convive) et gonflait le repère.
--
-- CHANGEMENT, objet par objet (seule la source du type et des convives change,
-- plus l'écart des collectes à 0 convive dans le parc) :
--   1. f_benchmark_kg_pax_zd : segment, filtres type et taille et Σ pax lus sur
--      la collecte ; collecte à `pax = 0` exclue du calcul (décision Val
--      2026-10-24, Q4 : « Collectes, 0 écartée »). Garde compétitive, garde de
--      périmètre du gestionnaire, k-anonymat (≥ 5 collectes, ≥ 3 acteurs de part
--      et d'autre), 7 paramètres et colonnes de sortie : recopiés de
--      20261006220000 mot pour mot.
--   2. f_benchmark_single_collecte : type et pax de la collecte (point « Vous » =
--      poids du flux / pax de la collecte ; NULL si pax = 0, comme avant pour un
--      pax nul). Gardes de tête, contrôle d'accès et droits d'exécution recopiés
--      de 20261020180000. AUCUNE DONNÉE NOUVELLE pour un rôle client : `pax` et
--      `type_evenement_id` de la collecte font partie du SELECT table-level de
--      `collectes` que sa propre session lit sous la policy `f_collecte_visible`.
--      Le pgTAP `benchmark_single_collecte_gestionnaire_lieux` mesure sous
--      `authenticated` que le ratio rendu est le quotient du poids du flux et du
--      pax de la collecte lus par la session (le grain collecte du point « Vous »
--      est prouvé par `benchmark_registre_grain_collecte`).
--   3. f_rapport_benchmark_zd (PDF, service_role seul) : défaut type + taille de
--      la collecte et ratio sur son pax. Corps et ACL recopiés de 20260922120000.
--   4. v_registre_dechets : `pax`, `taille_bracket` et `type_evenement_id` de la
--      collecte (mêmes noms, mêmes types, même ordre : CREATE OR REPLACE VIEW).
--      `security_invoker = false`, cloisonnement `f_collecte_visible` et
--      exclusion agence inchangés.
--
-- CE QUI NE CHANGE PAS : les signatures et les colonnes de sortie (la vue
-- matérialisée `mv_benchmark_kg_pax_zd_base`, qui lit la fonction, n'est pas
-- touchée ; son contenu suit au prochain rafraîchissement), la fonction
-- `taille_evenement_bracket`, les listes `f_benchmark_lieux_parc` /
-- `f_benchmark_traiteurs_parc`.
--
-- CETTE MIGRATION N'OUVRE AUCUN ACCÈS (CLAUDE.md §12 2bis) : CREATE OR REPLACE
-- conserve l'ACL des fonctions et les privilèges de la vue ; `SECURITY DEFINER`
-- et `SET search_path` sont ré-énoncés à l'identique, ainsi que les REVOKE /
-- GRANT de f_benchmark_single_collecte et f_rapport_benchmark_zd ;
-- f_benchmark_kg_pax_zd et la vue gardent les leurs, sans en ré-énoncer.
--
-- ROLLBACK : rejouer par CREATE OR REPLACE les corps de 20261006220000
-- (f_benchmark_kg_pax_zd), 20261020180000 (f_benchmark_single_collecte) et
-- 20260922120000 (f_rapport_benchmark_zd) ; pour v_registre_dechets, le corps du
-- §4 ci-dessous avec `e.pax`, `taille_evenement_bracket(e.pax)` et
-- `e.type_evenement_id` à la place des colonnes de la collecte (celui de
-- 20260619120000 ne se rejoue pas tel quel : il cite `collecte_statut_enum` et
-- `collecte_type_enum`, renommées depuis en `collecte_statut` / `collecte_type`).
-- Aucune donnée n'est touchée ; le benchmark et le registre reviennent au type et
-- au pax de l'événement.
-- =============================================================================

BEGIN;

-- ─── 1. f_benchmark_kg_pax_zd ────────────────────────────────────────────────
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
DECLARE
  v_org uuid;
BEGIN
  -- Garde compétitive (§04) : un rôle traiteur ne peut cibler des traiteurs nommés
  -- (sinon il déduirait la performance individuelle d'un concurrent).
  IF plateforme.f_app_role() IN ('traiteur_manager', 'traiteur_commercial')
     AND p_traiteur_ids IS NOT NULL
     AND array_length(p_traiteur_ids, 1) > 0 THEN
    RAISE EXCEPTION
      'Filtre traiteur_ids interdit pour le role traiteur (preservation competitive)';
  END IF;

  -- Garde de périmètre (§06.05, décision Val 2026-10-06) : un gestionnaire ne nomme
  -- que ses lieux rattachés et les traiteurs que `v_traiteurs_gestionnaire` lui
  -- rend. Un tableau NULL ou vide ne nomme rien et passe la garde : NULL laisse le
  -- repère sur tout le parc ; vide ne rend aucun segment, comme avant
  -- (`= ANY('{}')`). Un élément NULL est refusé. Un jeton sans organisation
  -- (absente ou vide) est refusé dès qu'il nomme un lieu ou un traiteur ; s'il ne
  -- nomme rien, il reçoit le repère « tout le parc », comme avant.
  -- Les deux messages commencent par « Filtre lieu_ids hors » / « Filtre
  -- traiteur_ids hors » : `loadBenchmark` les reconnaît à ce début pour rendre un
  -- 403 (tout autre 42501, droit d'exécution retiré par exemple, reste un 500).
  IF plateforme.f_app_role() = 'gestionnaire_lieux' THEN
    v_org := NULLIF(auth.jwt()->>'organisation_id', '')::uuid;
    IF EXISTS (
      SELECT 1
      FROM unnest(p_lieu_ids) AS demande(lieu_demande)
      WHERE NOT EXISTS (
        SELECT 1
        FROM plateforme.organisations_lieux ol
        WHERE ol.lieu_id = demande.lieu_demande
          AND ol.organisation_id = v_org)
    ) THEN
      RAISE EXCEPTION 'Filtre lieu_ids hors des lieux rattaches au gestionnaire'
        USING ERRCODE = '42501';
    END IF;
    IF cardinality(p_traiteur_ids) > 0 THEN
      -- Sans organisation, la vue ne peut rien rendre : refus posé d'abord, dans
      -- un IF séquentiel, pour ne jamais l'évaluer avec un jeton incomplet.
      IF v_org IS NULL THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      ELSIF EXISTS (
        SELECT 1
        FROM unnest(p_traiteur_ids) AS demande(traiteur_demande)
        WHERE NOT EXISTS (
          SELECT 1
          FROM plateforme.v_traiteurs_gestionnaire t
          WHERE t.id = demande.traiteur_demande)
      ) THEN
        RAISE EXCEPTION
          'Filtre traiteur_ids hors des traiteurs intervenus sur les lieux du gestionnaire'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Grain de sortie CDC §04 « Colonnes exposées » : un tuple par
  -- (flux × type d'événement × taille). Les paramètres p_* sont des FILTRES.
  -- Type et taille sont ceux de la COLLECTE (lot C1, C3 / C4) : chaque collecte
  -- est rangée et divisée par ses propres convives, jamais par le total de
  -- l'événement.
  RETURN QUERY
  SELECT
    fd.id,
    fd.code,
    c.type_evenement_id,
    plateforme.taille_evenement_bracket(c.pax) AS taille_evenement,
    -- Moyenne pondérée par tonnage : Σ poids du flux / Σ pax du segment
    -- (collectes plus lourdes pèsent proportionnellement plus — §04 Data Model).
    -- `uniq_collecte_flux` (collecte_id, flux_id) : chaque collecte compte son pax
    -- une fois par flux.
    (SUM(cf.poids_reel_kg) / NULLIF(SUM(c.pax), 0))::numeric AS kg_par_pax_moyen,
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
    -- Convives inconnus (0, reprise Bubble) : la collecte sort du parc — poids,
    -- convives et nombre de collectes (décision Val 2026-10-24, Q4).
    AND c.pax > 0
    AND (p_flux_id IS NULL OR fd.id = p_flux_id)
    AND (p_type_evenement_ids IS NULL
         OR c.type_evenement_id = ANY (p_type_evenement_ids))
    AND (p_taille_evenement_codes IS NULL
         OR plateforme.taille_evenement_bracket(c.pax) = ANY (p_taille_evenement_codes))
    AND (p_periode_debut IS NULL OR c.date_collecte >= p_periode_debut)
    AND (p_periode_fin   IS NULL OR c.date_collecte <= p_periode_fin)
    AND (p_lieu_ids IS NULL OR e.lieu_id = ANY (p_lieu_ids))
    AND (p_traiteur_ids IS NULL
         OR e.traiteur_operationnel_organisation_id = ANY (p_traiteur_ids))
  GROUP BY fd.id, fd.code, c.type_evenement_id, taille_evenement
  -- k-anonymat (§04, durci 2026-09-22) : segment masqué s'il porte moins de 5 collectes
  -- OU moins de 3 acteurs distincts, de part ET d'autre (programmateur / opérationnel).
  HAVING COUNT(DISTINCT c.id) >= 5
     AND COUNT(DISTINCT e.organisation_id) >= 3
     AND COUNT(DISTINCT e.traiteur_operationnel_organisation_id) >= 3;
END $$;

COMMENT ON FUNCTION plateforme.f_benchmark_kg_pax_zd(uuid, uuid[], text[], date, date, uuid[], uuid[]) IS
  'Benchmark parc kg/pax ZD — grain (flux x type_evenement x taille), type et taille de la COLLECTE (lot C1 2026-10-24), moyenne ponderee par tonnage (SUM poids / SUM collectes.pax), collecte a pax 0 exclue (Q4 Val 2026-10-24), 7 filtres CDC 04/11. k-anonymat DOUBLE (durci 2026-09-22) : >=5 collectes ET >=3 acteurs distincts sur les deux colonnes (organisation programmatrice ET traiteur operationnel). SECURITY DEFINER + garde competitive role traiteur + garde de perimetre gestionnaire_lieux (2026-10-06 : lieux rattaches et traiteurs de v_traiteurs_gestionnaire seulement, SQLSTATE 42501).';

-- ─── 2. f_benchmark_single_collecte ──────────────────────────────────────────
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

  -- Vérification de visibilité (RLS répliquée — fail fast si non accessible).
  -- Pax et type : ceux de la COLLECTE (lot C1, 2026-10-24) ; organisations, lieu
  -- et date restent ceux de l'événement (contrôle d'accès inchangé).
  SELECT e.organisation_id, e.traiteur_operationnel_organisation_id, c.pax, c.type_evenement_id,
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
    -- ratio kg/pax de la collecte courante, par flux (NULL si pax = 0 : convives
    -- inconnus, pas de point « Vous » — Q4 Val 2026-10-24)
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

-- ─── 3. f_rapport_benchmark_zd ───────────────────────────────────────────────
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
  -- Pax et type de la COLLECTE (lot C1, 2026-10-24), et non plus ceux de
  -- l'événement.
  SELECT c.pax, c.type_evenement_id
    INTO v_pax, v_type
  FROM plateforme.collectes c
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
  'Benchmark grain collecte pour le rapport RSE §1.2 (5 jauges kg/pax + point rouge parc). Wrapper SERVICE_ROLE de f_benchmark_kg_pax_zd, sans garde JWT (périmètre contrôlé en amont). Défaut = segment type+taille de la COLLECTE (lot C1 2026-10-24) ; filtres surchargés à la régénération. k-anonymat >=5 hérité. Agrégation des segments = moyenne PONDEREE par nb_collectes_segment, identique a aggregateBenchmarkPerFlux cote ecran (divergence M3.1 2026-09-22, option (a)).';

-- Ré-affirmation de l'ACL existante (identique à 20260922120000) : aucun élargissement.
REVOKE EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plateforme.f_rapport_benchmark_zd(uuid, date, date, uuid[], uuid[], text[]) TO service_role;

-- ─── 4. v_registre_dechets ───────────────────────────────────────────────────
-- Corps recopié de la définition en base (pg_get_viewdef sur savr-dev, = 20260619120000
-- aux énumérations près, renommées depuis en `collecte_statut` / `collecte_type`) ;
-- seules changent les colonnes `pax`,
-- `taille_bracket` et `type_evenement_id`, lues sur la collecte. Mêmes noms,
-- mêmes types (integer, text, uuid), même ordre : CREATE OR REPLACE VIEW garde
-- les privilèges. L'option `security_invoker = false` est ré-énoncée : un
-- CREATE OR REPLACE VIEW sans clause WITH remettrait les options à zéro.
CREATE OR REPLACE VIEW plateforme.v_registre_dechets WITH (security_invoker = false) AS
SELECT
  c.id                                            AS collecte_id,
  c.evenement_id,
  e.date_evenement,
  c.date_collecte,
  e.nom_evenement                                 AS evenement_nom,
  c.pax,
  plateforme.taille_evenement_bracket(c.pax)      AS taille_bracket,
  c.type_evenement_id,
  e.lieu_id,
  l.nom                                           AS lieu_nom,
  l.adresse_acces                                 AS lieu_adresse,
  e.organisation_id                               AS programmateur_organisation_id,
  e.traiteur_operationnel_organisation_id,
  -- Traiteur opérationnel = producteur juridique du déchet (F4), fiches shadow
  -- incluses (raison sociale sans SIRET) ; fallback nom si raison_sociale NULL.
  COALESCE(top.raison_sociale, top.nom)           AS traiteur_raison_sociale,
  c.prestataire_logistique_id,
  sp.nom                                          AS transporteur_nom,
  b.exutoire_nom,
  COALESCE(agg.poids_total_kg, 0)::numeric(12, 3) AS poids_total_kg,
  COALESCE(agg.flux_codes, ARRAY[]::text[])       AS flux_codes,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  b.id                                            AS bordereau_id,
  b.numero                                        AS bordereau_numero,
  b.statut                                        AS bordereau_statut,
  b.pdf_fichier_id                                AS bordereau_pdf_fichier_id,
  b.date_emission                                 AS bordereau_date_emission,
  b.version                                       AS bordereau_version,
  c.historique_partiel,
  c.realisee_at,
  c.created_at
FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.lieux l ON l.id = e.lieu_id
  LEFT JOIN plateforme.organisations top
    ON top.id = e.traiteur_operationnel_organisation_id
  LEFT JOIN shared.prestataires sp ON sp.id = c.prestataire_logistique_id
  LEFT JOIN plateforme.bordereaux_savr b ON b.collecte_id = c.id
  LEFT JOIN LATERAL (
    -- Poids total = SUM de TOUTES les pesées de la collecte (multi-pesées
    -- d'un même flux agrégées) ; flux_codes = badges distincts triés.
    SELECT
      SUM(cf.poids_reel_kg)                                AS poids_total_kg,
      array_agg(DISTINCT fd.code ORDER BY fd.code)         AS flux_codes
    FROM plateforme.collecte_flux cf
      JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = c.id
  ) agg ON true
WHERE c.statut = 'cloturee'::plateforme.collecte_statut
  AND c.type   = 'zero_dechet'::plateforme.collecte_type
  -- Exclusion agence (F6 2026-06-07) : donneuse d'ordre, non productrice → 0 ligne.
  AND plateforme.f_app_role() IS DISTINCT FROM 'agence'
  -- Cloisonnement par organisation (miroir policy collectes) : staff full,
  -- programmateur, traiteur opérationnel, client organisateur, gestionnaire
  -- de lieux via organisations_lieux. Source unique : f_collecte_visible.
  AND plateforme.f_collecte_visible(c.id);

COMMENT ON VIEW plateforme.v_registre_dechets IS
  'Registre réglementaire ZD (M4.2, §06.03). Grain collecte : poids_total_kg '
  'agrégé multi-pesées, flux_codes[] pour les badges ; pax, taille_bracket et '
  'type_evenement_id de la COLLECTE (lot C1 2026-10-24). SECURITY DEFINER + '
  'cloisonnement interne f_collecte_visible (la vue joint shared.prestataires '
  'admin-only → security_invoker impossible). Exclusion agence (F6). Périmètre '
  'V1 : collectes cloturee + zero_dechet uniquement (volet AG = V2).';

COMMIT;
