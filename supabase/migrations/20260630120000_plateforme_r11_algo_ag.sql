-- =============================================================================
-- R11 / BL-P1-ALGO-01, 03, 06 — Reste de l'algo d'attribution AG
-- =============================================================================
-- Cluster algo AG (CDC 09 - Flux algo attribution AG (Admin)). Trois maillons :
--
--   1. BL-P1-ALGO-01 — Top 3 transporteurs PROVINCE.
--      fn_calculer_algo_attribution_ag ne renvoyait qu'UN transporteur province
--      (LIMIT 1) alors que le CDC §2 (bloc province) + §05 R2 imposent un TOP 3
--      affiché à l'Admin pour arbitrage (l'asso est déjà en top 3). On renvoie
--      désormais un tableau `transporteurs` (top 3 trié distance ASC + charge ASC
--      en province ; 1 élément = la branche retenue en IDF). `transporteur`
--      (top 1) est conservé pour la rétro-compat des appelants existants.
--
--   2. BL-P1-ALGO-03 — Audit `attribution_manuelle_aucune_reco`.
--      RPC dédié (SECURITY DEFINER) appelé par la route de validation quand
--      l'Admin valide une attribution alors que l'algo n'avait proposé AUCUNE
--      association éligible (recherche libre) — CDC §2 « Cas aucune association
--      éligible » + scénario `aucune_association_disponible_message_et_log`.
--      RPC séparé pour ne PAS toucher la signature de rpc_valider_attribution_ag
--      (R5 + lib TS + types en dépendent).
--
--   3. BL-P1-ALGO-06 — Évaluation auto-accept.
--      config_auto_accept_ag (Bloc 7) n'était JAMAIS évaluée. RPC
--      rpc_evaluer_auto_accept_ag : lance l'algo, cherche une config active pour
--      (organisation programmatrice, association top 1, seuils pax) et, si match,
--      valide automatiquement (mode_validation='auto_accept', valide_par=NULL,
--      CDC §6) en réutilisant rpc_valider_attribution_ag ; SINON renvoie
--      auto_accepted=false (la collecte reste en file de validation manuelle).
--      DIV-7 (tracée M2.3) : la table réelle porte organisation_id + seuils pax
--      (pas type_evenement_id du DDL cible) → l'évaluation suit la DB réelle.
--
-- Garde-fou 3 : aucun appel direct MTS-1/Everest — l'algo et les RPC restent
-- purement SQL ; le dispatch passe par l'outbox (rpc_valider_attribution_ag, R5).
-- =============================================================================

-- ─── 1. BL-P1-ALGO-01 : fn_calculer_algo_attribution_ag — top 3 province ─────
-- CREATE OR REPLACE verbatim de 20260620100000 (ancrage TZ Europe/Paris du
-- délai conservé) + (a) province LIMIT 1 → top 3 agrégés dans `transporteurs`,
-- (b) IDF : `transporteurs` = tableau à 1 élément (la branche retenue),
-- (c) clé `transporteurs` ajoutée au résultat. SET search_path + REVOKE/GRANT
-- re-posés (CREATE OR REPLACE réinitialise les attributs hors corps).

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
  SELECT
    c.id,
    c.date_collecte,
    c.heure_collecte,
    c.volume_estime_repas,
    e.pax,
    e.organisation_id,
    e.type_evenement_id,
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
  v_region         := v_collecte.region;
  v_lieu_lat       := v_collecte.latitude;
  v_lieu_lon       := v_collecte.longitude;
  v_cp_dep2        := left(COALESCE(v_collecte.code_postal, ''), 2);
  v_type_vehicule_max := v_collecte.type_vehicule_max;

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
      -- Compatibilité horaires (null = toujours ouvert)
      CASE
        WHEN a.horaires_ouverture IS NULL THEN true
        ELSE (
          CASE EXTRACT(DOW FROM v_date_collecte)
            WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mer'
            WHEN 4 THEN 'jeu' WHEN 5 THEN 'ven' WHEN 6 THEN 'sam' ELSE 'dim'
          END
          IS NOT NULL
          AND a.horaires_ouverture->>(
            CASE EXTRACT(DOW FROM v_date_collecte)
              WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mer'
              WHEN 4 THEN 'jeu' WHEN 5 THEN 'ven' WHEN 6 THEN 'sam' ELSE 'dim'
            END
          ) IS NOT NULL
          AND v_heure_collecte >= (
            a.horaires_ouverture->(
              CASE EXTRACT(DOW FROM v_date_collecte)
                WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mer'
                WHEN 4 THEN 'jeu' WHEN 5 THEN 'ven' WHEN 6 THEN 'sam' ELSE 'dim'
              END
            )->>'debut'
          )::time
          AND v_heure_collecte < (
            a.horaires_ouverture->(
              CASE EXTRACT(DOW FROM v_date_collecte)
                WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mer'
                WHEN 4 THEN 'jeu' WHEN 5 THEN 'ven' WHEN 6 THEN 'sam' ELSE 'dim'
              END
            )->>'fin'
          )::time
        )
      END AS horaires_ok
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
        'distance_km', round(COALESCE(a.distance_km, 0)::numeric, 2),
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
        -- au moins un véhicule du transporteur ≤ type_vehicule_max du lieu (enum
        -- ordonné velo_cargo<camionnette<fourgon<vul<poids_lourd). NULL max = pas
        -- de contrainte. types_vehicules est text[] → cast vers l'enum pour le tri.
        AND (
          v_type_vehicule_max IS NULL
          OR EXISTS (
            SELECT 1 FROM unnest(t.types_vehicules) tv
            WHERE tv::plateforme.type_vehicule <= v_type_vehicule_max
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
    'nb_pax',           v_nb_pax
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid) TO authenticated, service_role;

-- ─── 2. BL-P1-ALGO-03 : audit attribution_manuelle_aucune_reco ───────────────
-- Émis quand l'Admin valide une attribution alors que l'algo n'avait proposé
-- AUCUNE association éligible (recherche libre). RPC dédié SECURITY DEFINER :
-- la route de validation (service_role, auth.uid()=NULL) ne peut pas écrire
-- audit_log avec le bon user_id sans passer par un DEFINER (réf mémoire
-- audit-write-service-role-rpc). p_user_id = Admin ayant validé (CDC §2).

CREATE OR REPLACE FUNCTION plateforme.rpc_log_attribution_aucune_reco(
  p_collecte_id    uuid,
  p_attribution_id uuid,
  p_user_id        uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
BEGIN
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, user_id, new_values
  ) VALUES (
    'attributions_antgaspi',
    p_attribution_id,
    'attribution_manuelle_aucune_reco',
    p_user_id,
    jsonb_build_object(
      'collecte_id',    p_collecte_id,
      'attribution_id', p_attribution_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.rpc_log_attribution_aucune_reco(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_log_attribution_aucune_reco(uuid, uuid, uuid) TO service_role;

-- ─── 3. BL-P1-ALGO-06 : évaluation auto-accept ───────────────────────────────
-- Lance l'algo, cherche une config_auto_accept_ag active pour (organisation
-- programmatrice, association top 1, seuils pax) et, si match, valide
-- automatiquement (mode_validation='auto_accept', valide_par=NULL, CDC §6) en
-- réutilisant rpc_valider_attribution_ag (qui émet l'outbox + le dispatch).
-- SINON renvoie auto_accepted=false → la collecte reste en validation manuelle.
-- DIV-7 : la table réelle porte organisation_id + seuils pax (pas
-- type_evenement_id du DDL cible) → l'évaluation suit la DB réelle.

CREATE OR REPLACE FUNCTION plateforme.rpc_evaluer_auto_accept_ag(
  p_collecte_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_collecte       record;
  v_org_id         uuid;
  v_algo           jsonb;
  v_top1_asso      uuid;
  v_transp_id      uuid;
  v_branche        text;
  v_pax            integer;
  v_config_id      uuid;
  v_res            jsonb;
BEGIN
  -- Pré-conditions (miroir de rpc_valider_attribution_ag — renvoie une raison
  -- propre plutôt qu'une exception, pour que l'appelant retombe en manuel).
  SELECT c.id, c.statut, c.type, c.evenement_id
  INTO v_collecte
  FROM plateforme.collectes c
  WHERE c.id = p_collecte_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'collecte_introuvable');
  END IF;
  IF v_collecte.type != 'anti_gaspi' THEN
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'type_non_ag');
  END IF;
  IF v_collecte.statut != 'programmee' THEN
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'statut_non_programmee');
  END IF;
  IF EXISTS (
    SELECT 1 FROM plateforme.attributions_antgaspi WHERE collecte_id = p_collecte_id
  ) THEN
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'deja_attribuee');
  END IF;

  -- Algo
  v_algo := plateforme.fn_calculer_algo_attribution_ag(p_collecte_id);

  IF (v_algo->>'no_asso')::boolean OR (v_algo->>'no_prestataire')::boolean THEN
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'aucune_reco');
  END IF;

  v_top1_asso := (v_algo->'associations'->0->>'id')::uuid;
  v_transp_id := (v_algo->'transporteur'->>'id')::uuid;
  v_branche   := v_algo->>'branche';
  v_pax       := (v_algo->>'nb_pax')::integer;

  SELECT e.organisation_id INTO v_org_id
  FROM plateforme.evenements e
  WHERE e.id = v_collecte.evenement_id;

  -- Config auto-accept active : organisation programmatrice + association top 1,
  -- transporteur (si renseigné dans la config) et fourchette pax respectés.
  SELECT id INTO v_config_id
  FROM plateforme.config_auto_accept_ag
  WHERE organisation_id = v_org_id
    AND association_id = v_top1_asso
    AND auto_accept_actif = true
    AND (transporteur_id IS NULL OR transporteur_id = v_transp_id)
    AND (seuil_pax_min IS NULL OR v_pax >= seuil_pax_min)
    AND (seuil_pax_max IS NULL OR v_pax <= seuil_pax_max)
  LIMIT 1;

  IF v_config_id IS NULL THEN
    -- Cas de non-déclenchement (CDC §6) → validation manuelle normale.
    RETURN jsonb_build_object('auto_accepted', false, 'reason', 'no_config_match');
  END IF;

  -- Validation automatique (zéro humain) : valide_par=NULL, mode auto_accept.
  v_res := plateforme.rpc_valider_attribution_ag(
    p_collecte_id,
    v_top1_asso,
    v_transp_id,
    v_branche,
    'auto_accept'::plateforme.mode_validation,
    NULL,            -- valide_par : aucun humain
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'auto_accepted',  true,
    'reason',         'config_match',
    'config_id',      v_config_id,
    'attribution_id', v_res->'attribution_id'
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.rpc_evaluer_auto_accept_ag(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_evaluer_auto_accept_ag(uuid) TO service_role;

-- ── ASSERTIONS DE SANITÉ ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'rpc_evaluer_auto_accept_ag'
      AND pronamespace = 'plateforme'::regnamespace
  ) THEN
    RAISE EXCEPTION 'R11 ASSERTION FAILED: rpc_evaluer_auto_accept_ag absente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'rpc_log_attribution_aucune_reco'
      AND pronamespace = 'plateforme'::regnamespace
  ) THEN
    RAISE EXCEPTION 'R11 ASSERTION FAILED: rpc_log_attribution_aucune_reco absente';
  END IF;
  RAISE NOTICE 'R11 OK: algo province top3 + audit aucune-reco + auto-accept eval posés';
END $$;
