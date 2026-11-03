-- =============================================================================
-- Algorithme d'attribution AG : région du lieu déduite du code postal quand
-- elle est vide (choix C1, Val 2026-11-03)
-- =============================================================================
-- Constat (savr-dev, 2026-11-03) : un lieu créé depuis le formulaire de
-- programmation n'avait pas de région (`lieux.region` NULL). L'algorithme
-- filtrait alors les associations sur une région NULL (aucune) et prenait la
-- voie province pour le transporteur (aucun) : ni association ni transporteur
-- proposés, même à Courbevoie (92400).
--
-- Règle : département = 2 premiers caractères du code postal ; 75, 77, 78, 91,
-- 92, 93, 94, 95 → idf ; tout autre code postal non vide → province. La région
-- du lieu, quand elle est renseignée, reste prioritaire. Même règle côté
-- application à la création d'un lieu (`lib/lieux/region-code-postal.ts`).
--
-- Changements vs 20261025100000 (corps recopié à l'identique ailleurs) :
--   1. `v_region := COALESCE(région du lieu, région déduite du code postal)` ;
--   2. clé ajoutée au résultat : `region_inconnue` (vrai quand le lieu n'a ni
--      région ni code postal), lue par l'onglet Logistique Admin pour dire que
--      c'est le lieu qu'il faut compléter. Clés existantes inchangées.
--
-- SÉCURITÉ : aucun droit ouvert ni élargi. `CREATE OR REPLACE` conserve
-- propriétaire et privilèges ; `SECURITY DEFINER` et `search_path` recopiés à
-- l'identique ; ACL ré-émise à l'identique (service_role seul).
--
-- Backward-compatible et non destructive : signature inchangée, aucun objet
-- créé ni retiré, aucune donnée modifiée (les lieux existants sans région sont
-- couverts par le repli). Hors du diff structurel DDL cible V2 (corps de
-- fonction).
--
-- RETOUR ARRIÈRE : rejouer la définition de 20261025100000, en conservant son
-- `SECURITY DEFINER`, son `search_path` et son ACL.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_calculer_algo_attribution_ag(
  p_collecte_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  -- Collecte + lieu + événement
  v_collecte           record;
  v_lieu               record;
  v_nb_pax             integer;
  v_heure_collecte     time;
  v_date_collecte      date;
  v_region             text;
  v_lieu_lat           double precision;
  v_lieu_lon           double precision;
  v_cp_dep2            text;
  v_type_vehicule_max  plateforme.type_vehicule;   -- §05 R2 compat véhicule province
  v_vehicule_order     text[];                      -- labels enum ordonnés (compat véhicule)

  -- Paramètres algo
  v_plage_debut        time;
  v_plage_fin          time;
  v_seuil_pax          integer;
  v_seuil_h2           integer;
  v_a_toutes_indispo   boolean;
  v_everest_cps        text[];

  -- Résultats associations
  v_associations       jsonb := '[]'::jsonb;
  v_assoc_count        integer := 0;

  -- Résultats transporteur
  v_branche            text := 'aucun_prestataire';
  v_transporteur_id    uuid;
  v_transporteur_nom   text;
  v_transporteur_type  text;
  v_transporteurs      jsonb := '[]'::jsonb;   -- BL-P1-ALGO-01 : top 3 (province) / 1 (IDF)
  v_is_idf             boolean := false;
  v_no_asso            boolean := false;
  v_no_prest           boolean := false;

  -- Délai avant collecte en minutes
  v_delai_minutes      integer;

  -- Transporteurs IDF
  v_transp_marathon    record;
  v_transp_a_toutes    record;
BEGIN
  -- === Charger la collecte + événement + lieu ===
  -- Le pax est celui de la collecte (seuil grand volume, fourchette de
  -- l'auto-acceptation, nb_pax rendu) : décision Val Q2 du 2026-10-24.
  SELECT
    c.id,
    c.date_collecte,
    c.heure_collecte,
    c.volume_estime_repas,
    c.pax,                -- pax de LA collecte AG (Val Q2 du 2026-10-24)
    e.organisation_id,
    l.region,
    l.latitude,
    l.longitude,
    l.code_postal,
    l.type_vehicule_max
  INTO v_collecte
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.lieux l ON l.id = (
    SELECT lieu_id FROM plateforme.evenements WHERE id = c.evenement_id
  )
  WHERE c.id = p_collecte_id
    AND c.type = 'anti_gaspi';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte AG introuvable ou type incorrect' USING ERRCODE = 'P0030';
  END IF;

  v_heure_collecte := v_collecte.heure_collecte;
  v_date_collecte  := v_collecte.date_collecte;
  v_nb_pax         := COALESCE(v_collecte.pax, 0);
  -- Région du lieu, sinon déduite du code postal (C1, Val 2026-11-03).
  -- NULL seulement si le lieu n'a ni région ni code postal.
  v_region         := COALESCE(
    v_collecte.region::text,
    CASE
      WHEN NULLIF(TRIM(v_collecte.code_postal), '') IS NULL THEN NULL
      WHEN left(TRIM(v_collecte.code_postal), 2)
           IN ('75', '77', '78', '91', '92', '93', '94', '95') THEN 'idf'
      ELSE 'province'
    END
  );
  v_lieu_lat       := v_collecte.latitude;
  v_lieu_lon       := v_collecte.longitude;
  v_cp_dep2        := left(COALESCE(v_collecte.code_postal, ''), 2);
  v_type_vehicule_max := v_collecte.type_vehicule_max;
  -- Ordre des labels de l'enum véhicule (velo_cargo<camionnette<fourgon<vul<poids_lourd).
  -- Sert à comparer types_vehicules (text[]) au type_vehicule_max SANS cast direct :
  -- une valeur text hors-enum donne array_position = NULL → exclue (pas d'exception
  -- runtime, la colonne types_vehicules étant text[] sans CHECK enum).
  v_vehicule_order := enum_range(NULL::plateforme.type_vehicule)::text[];

  -- === Charger les paramètres algo ===
  SELECT
    MAX(CASE WHEN cle = 'regle_ag_plage_velo_debut' THEN (valeur#>>'{}')::time END),
    MAX(CASE WHEN cle = 'regle_ag_plage_velo_fin'   THEN (valeur#>>'{}')::time END),
    MAX(CASE WHEN cle = 'regle_ag_seuil_pax_velo'   THEN (valeur#>>'{}')::integer END),
    MAX(CASE WHEN cle = 'regle_ag_seuil_h2_minutes' THEN (valeur#>>'{}')::integer END),
    bool_or(CASE WHEN cle = 'a_toutes_indisponible'  THEN (valeur#>>'{}')::boolean END)
  INTO v_plage_debut, v_plage_fin, v_seuil_pax, v_seuil_h2, v_a_toutes_indispo
  FROM plateforme.parametres_algo
  WHERE cle IN (
    'regle_ag_plage_velo_debut', 'regle_ag_plage_velo_fin',
    'regle_ag_seuil_pax_velo', 'regle_ag_seuil_h2_minutes', 'a_toutes_indisponible'
  );

  -- Fallbacks sûrs
  v_plage_debut        := COALESCE(v_plage_debut, '07:00'::time);
  v_plage_fin          := COALESCE(v_plage_fin,   '20:00'::time);
  v_seuil_pax          := COALESCE(v_seuil_pax,   600);
  v_seuil_h2           := COALESCE(v_seuil_h2,    90);
  v_a_toutes_indispo   := COALESCE(v_a_toutes_indispo, true);

  -- Codes postaux Everest
  SELECT ARRAY(
    SELECT jsonb_array_elements_text(valeur)
    FROM plateforme.parametres_algo
    WHERE cle = 'everest_codes_postaux'
  ) INTO v_everest_cps;
  v_everest_cps := COALESCE(v_everest_cps, ARRAY['75', '92', '93']);

  -- === Délai avant collecte (minutes) ===
  -- Ancrage Europe/Paris (fuseau métier) : v_date_collecte + v_heure_collecte sont
  -- des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase), faussant le seuil express/programmé (bug E2, fix 20260620100000).
  v_delai_minutes := EXTRACT(epoch FROM (
    ((v_date_collecte + v_heure_collecte) AT TIME ZONE 'Europe/Paris') - now()
  ))::integer / 60;

  -- =========================================================
  -- SÉLECTION ASSOCIATIONS (filtres binaires + tri Haversine)
  -- =========================================================
  WITH assoc_candidats AS (
    SELECT
      a.id,
      a.nom,
      a.region,
      a.latitude,
      a.longitude,
      a.capacite_max_beneficiaires,
      a.horaires_ouverture,
      a.contact_email,
      -- Haversine (degrés → km) — NULL si coords manquantes
      CASE
        WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
             AND v_lieu_lat IS NOT NULL AND v_lieu_lon IS NOT NULL
        THEN (
          2 * 6371 * asin(sqrt(
            sin(radians((a.latitude  - v_lieu_lat)  / 2))^2 +
            cos(radians(v_lieu_lat)) * cos(radians(a.latitude)) *
            sin(radians((a.longitude - v_lieu_lon) / 2))^2
          ))
        )
        ELSE NULL
      END AS distance_km,
      -- Compatibilité horaires (§05 filtre éliminatoire) — lit le format écrit par
      -- l'éditeur Admin (tableau jour/ouvert/creneaux), cf. fn_association_ouverte.
      plateforme.fn_association_ouverte(
        a.horaires_ouverture, v_date_collecte, v_heure_collecte
      ) AS horaires_ok
    FROM plateforme.associations a
    WHERE a.actif = true
      AND LOWER(TRIM(a.region::text)) = LOWER(TRIM(v_region))
      AND a.capacite_max_beneficiaires IS NOT NULL
      AND a.capacite_max_beneficiaires * 2 > COALESCE(v_collecte.volume_estime_repas, 0)
  ),
  assoc_eligibles AS (
    SELECT * FROM assoc_candidats WHERE horaires_ok = true
  ),
  assoc_top3 AS (
    SELECT * FROM assoc_eligibles
    ORDER BY distance_km ASC NULLS LAST
    LIMIT 3
  )
  SELECT
    COUNT(*),
    jsonb_agg(
      jsonb_build_object(
        'id',          a.id,
        'nom',         a.nom,
        'distance_km', round(a.distance_km::numeric, 2),
        'capacite_max_beneficiaires', a.capacite_max_beneficiaires,
        'contact_email', a.contact_email,
        'horaires_ok', a.horaires_ok
      ) ORDER BY a.distance_km ASC NULLS LAST
    )
  INTO v_assoc_count, v_associations
  FROM assoc_top3 a;

  v_no_asso := (v_assoc_count = 0);

  -- =========================================================
  -- SÉLECTION TRANSPORTEUR
  -- =========================================================

  v_is_idf := (LOWER(TRIM(v_region)) = 'idf');

  IF v_is_idf THEN
    -- === IDF : 4 branches (§05 R2 — évaluées dans l'ordre) ===

    SELECT id, nom, type_tms INTO v_transp_marathon
    FROM plateforme.transporteurs
    WHERE actif = true
      AND type_tms = 'mts1'
      AND LOWER(nom) LIKE '%marathon%'
    LIMIT 1;

    SELECT id, nom, type_tms INTO v_transp_a_toutes
    FROM plateforme.transporteurs
    WHERE actif = true AND type_tms = 'a_toutes'
    LIMIT 1;

    -- Branche 1 : NUIT (heure < plage_debut OU heure >= plage_fin)
    IF v_heure_collecte < v_plage_debut OR v_heure_collecte >= v_plage_fin THEN
      IF v_transp_marathon.id IS NOT NULL THEN
        v_branche           := 'ag_marathon_nuit';
        v_transporteur_id   := v_transp_marathon.id;
        v_transporteur_nom  := v_transp_marathon.nom;
        v_transporteur_type := v_transp_marathon.type_tms;
      ELSE
        v_branche   := 'aucun_prestataire';
        v_no_prest  := true;
      END IF;

    -- Jour (plage_debut <= heure < plage_fin)
    ELSIF v_nb_pax >= v_seuil_pax THEN
      -- Branche 2 : GRAND VOLUME (nb_pax >= seuil)
      IF v_transp_marathon.id IS NOT NULL THEN
        v_branche           := 'ag_marathon_volume';
        v_transporteur_id   := v_transp_marathon.id;
        v_transporteur_nom  := v_transp_marathon.nom;
        v_transporteur_type := v_transp_marathon.type_tms;
      ELSIF NOT v_a_toutes_indispo
        AND v_transp_a_toutes.id IS NOT NULL
        AND v_cp_dep2 = ANY(v_everest_cps) THEN
        IF v_delai_minutes < v_seuil_h2 THEN
          v_branche := 'ag_everest_camion_express';   -- service Everest 77
        ELSE
          v_branche := 'ag_marathon_volume_backup_camion'; -- service Everest 91
        END IF;
        v_transporteur_id   := v_transp_a_toutes.id;
        v_transporteur_nom  := v_transp_a_toutes.nom;
        v_transporteur_type := v_transp_a_toutes.type_tms;
      ELSE
        v_branche   := 'aucun_prestataire';
        v_no_prest  := true;
      END IF;

    ELSE
      -- Branche 3 : VÉLO JOUR (nb_pax < seuil)
      IF NOT v_a_toutes_indispo
        AND v_transp_a_toutes.id IS NOT NULL
        AND v_cp_dep2 = ANY(v_everest_cps) THEN
        IF v_delai_minutes < v_seuil_h2 THEN
          v_branche           := 'ag_velo_express';   -- service Everest 74
        ELSE
          v_branche           := 'ag_velo_programme'; -- service Everest 71
        END IF;
        v_transporteur_id   := v_transp_a_toutes.id;
        v_transporteur_nom  := v_transp_a_toutes.nom;
        v_transporteur_type := v_transp_a_toutes.type_tms;
      ELSIF v_transp_marathon.id IS NOT NULL THEN
        v_branche           := 'ag_velo_fallback_marathon';
        v_transporteur_id   := v_transp_marathon.id;
        v_transporteur_nom  := v_transp_marathon.nom;
        v_transporteur_type := v_transp_marathon.type_tms;
      ELSE
        v_branche   := 'aucun_prestataire';
        v_no_prest  := true;
      END IF;
    END IF;

    -- IDF : la branche détermine un transporteur UNIQUE (pas de top 3).
    -- On expose néanmoins un tableau `transporteurs` à 1 élément pour une forme
    -- de résultat homogène avec la province (UI : liste vs bandeau).
    IF v_transporteur_id IS NOT NULL THEN
      v_transporteurs := jsonb_build_array(jsonb_build_object(
        'id',       v_transporteur_id,
        'nom',      v_transporteur_nom,
        'type_tms', v_transporteur_type
      ));
    END IF;

  ELSE
    -- === PROVINCE : top 3 (distance ASC + nb_collectes_6_mois ASC) — §05 R2 ===
    -- BL-P1-ALGO-01 : ex-LIMIT 1 → top 3 affiché à l'Admin pour arbitrage.
    WITH province_candidats AS (
      SELECT
        t.id, t.nom, t.type_tms,
        CASE
          WHEN t.latitude IS NOT NULL AND t.longitude IS NOT NULL
               AND v_lieu_lat IS NOT NULL AND v_lieu_lon IS NOT NULL
          THEN (
            2 * 6371 * asin(sqrt(
              sin(radians((t.latitude  - v_lieu_lat)  / 2))^2 +
              cos(radians(v_lieu_lat)) * cos(radians(t.latitude)) *
              sin(radians((t.longitude - v_lieu_lon) / 2))^2
            ))
          )
          ELSE 99999
        END AS distance_km,
        COALESCE(p.nb_collectes_6_mois_cache, 0) AS nb_collectes
      FROM plateforme.transporteurs t
      JOIN shared.prestataires p ON p.id = (
        SELECT id FROM shared.prestataires
        WHERE LOWER(nom) = LOWER(t.nom)
        LIMIT 1
      )
      WHERE t.actif = true
        AND t.type_tms != 'a_toutes'
        -- §05 R2 : prestataire habilité AG (sinon transporteur ZD-only exclu)
        AND 'ag' = ANY(p.type_prestation)
        -- §05 R2 : compatibilité véhicule/lieu (R_compatibilite_vehicule_lieu) —
        -- au moins un véhicule du transporteur ≤ type_vehicule_max du lieu (ordre
        -- enum velo_cargo<camionnette<fourgon<vul<poids_lourd). NULL max = pas de
        -- contrainte. Comparaison par position dans v_vehicule_order (exception-safe :
        -- une valeur text[] hors-enum → array_position NULL → exclue, jamais d'erreur).
        AND (
          v_type_vehicule_max IS NULL
          OR EXISTS (
            SELECT 1 FROM unnest(t.types_vehicules) tv
            WHERE array_position(v_vehicule_order, tv)
                  <= array_position(v_vehicule_order, v_type_vehicule_max::text)
          )
        )
        AND (
          p.rayon_intervention_km IS NULL
          OR (
            t.latitude IS NOT NULL AND t.longitude IS NOT NULL
            AND v_lieu_lat IS NOT NULL AND v_lieu_lon IS NOT NULL
            AND (
              2 * 6371 * asin(sqrt(
                sin(radians((t.latitude  - v_lieu_lat)  / 2))^2 +
                cos(radians(v_lieu_lat)) * cos(radians(t.latitude)) *
                sin(radians((t.longitude - v_lieu_lon) / 2))^2
              ))
            ) <= p.rayon_intervention_km
          )
        )
    ),
    province_top3 AS (
      SELECT * FROM province_candidats
      ORDER BY distance_km ASC, nb_collectes ASC
      LIMIT 3
    )
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'id',          id,
          'nom',         nom,
          'type_tms',    type_tms,
          'distance_km', round(distance_km::numeric, 2)
        ) ORDER BY distance_km ASC, nb_collectes ASC
      ),
      (array_agg(id       ORDER BY distance_km ASC, nb_collectes ASC))[1],
      (array_agg(nom      ORDER BY distance_km ASC, nb_collectes ASC))[1],
      (array_agg(type_tms::text ORDER BY distance_km ASC, nb_collectes ASC))[1]
    INTO v_transporteurs, v_transporteur_id, v_transporteur_nom, v_transporteur_type
    FROM province_top3;

    IF v_transporteur_id IS NOT NULL THEN
      v_branche  := 'ag_province_proximite';
    ELSE
      v_branche  := 'aucun_prestataire';
      v_no_prest := true;
    END IF;
  END IF;

  -- =========================================================
  -- RÉSULTAT FINAL
  -- =========================================================
  RETURN jsonb_build_object(
    'associations',     COALESCE(v_associations, '[]'::jsonb),
    'assoc_count',      v_assoc_count,
    'transporteur',     CASE
      WHEN v_transporteur_id IS NOT NULL THEN jsonb_build_object(
        'id',       v_transporteur_id,
        'nom',      v_transporteur_nom,
        'type_tms', v_transporteur_type
      )
      ELSE NULL
    END,
    'transporteurs',    COALESCE(v_transporteurs, '[]'::jsonb),
    'branche',          v_branche,
    'is_idf',           v_is_idf,
    'no_asso',          v_no_asso,
    'no_prestataire',   v_no_prest,
    'delai_minutes',    v_delai_minutes,
    'nb_pax',           v_nb_pax,
    -- Ni région ni code postal : l'Admin doit compléter le lieu.
    'region_inconnue',  v_region IS NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  TO service_role;

