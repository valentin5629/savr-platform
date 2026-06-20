-- Migration: fix timezone du seuil 12h AG (audit bug E2)
-- ------------------------------------------------------------------------------
-- CREATE OR REPLACE de 2 fonctions dont le calcul de délai utilisait un cast naïf
-- (date::timestamp[tz]) interprété dans le fuseau de session (UTC sur Supabase),
-- décalant l'échéance de 1-2h (DST). Ancrage explicite en Europe/Paris (fuseau
-- métier Savr — IDF). Débit annulation tardive : passage de '<=' à '<' strict,
-- aligné sur la spec §05 (« < 12h avant l'heure de collecte »).
--
-- Corps de fonctions copiés VERBATIM des migrations sources (M2.1 / M2.3),
-- seule la ligne de calcul du délai est modifiée. Triggers et appels RPC
-- inchangés (binding par nom, signature identique).
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_pack_statut  plateforme.pack_statut_enum;
  v_delai_court  boolean;
  v_mandat_actif boolean;
BEGIN
  -- Uniquement AG → annulee depuis un statut NON realisee (trigger 3 couvre l'annulation post-realisee)
  IF NEW.statut != 'annulee' OR OLD.statut = 'annulee' OR OLD.statut = 'realisee' THEN
    RETURN NEW;
  END IF;
  IF NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- Condition 1 : < 12h avant la collecte
  -- < 12h avant l'heure de collecte (spec §05 L187/356 : strict « < 12h »).
  -- Ancrage fuseau métier Europe/Paris : date_collecte (date) + heure_collecte (time)
  -- sont des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase = UTC), décalant le seuil de 1-2h (DST) — bug E2.
  v_delai_court := (
    ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '12 hours'
  ) < now();

  -- Condition 2 : prestataire mandaté (ordre déjà envoyé au TMS)
  v_mandat_actif := (
    OLD.statut_tms IS NOT NULL
    AND OLD.statut_tms NOT IN ('non_envoye', 'a_attribuer')
  );

  IF NOT (v_delai_court OR v_mandat_actif) THEN
    RETURN NEW; -- pas de débit si annulation en avance sans mandat
  END IF;

  -- Condition tardive remplie mais aucun pack attaché → alerte Admin (§05 §3 F3)
  IF OLD.pack_antgaspi_id IS NULL THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_annulee_tardive_sans_pack_actif',
      'Annulation tardive AG sans pack attaché',
      'La collecte ' || NEW.id::text || ' a été annulée tardivement sans pack AG attaché. Vérifier et imputer manuellement si nécessaire.',
      'collecte',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- Débit
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut_enum
      ELSE statut
    END,
    updated_at = now()
  WHERE id = OLD.pack_antgaspi_id
  RETURNING statut INTO v_pack_statut;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || OLD.pack_antgaspi_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      OLD.pack_antgaspi_id
    );
  END IF;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', OLD.pack_antgaspi_id,
    'pack_debite_annulation_tardive',
    jsonb_build_object('collecte_id', NEW.id),
    jsonb_build_object(
      'motif_delai_court', v_delai_court,
      'motif_mandat', v_mandat_actif,
      'statut_apres', v_pack_statut
    )
  );

  RETURN NEW;
END;
$$;

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
    l.code_postal
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
  -- Délai avant collecte (minutes). Ancrage Europe/Paris : v_date_collecte (date) +
  -- v_heure_collecte (time) sont des wall-clocks naïfs ; le cast ::timestamp les
  -- interprète en UTC (session Supabase), faussant le délai de 1-2h (DST) et donc le
  -- seuil express/programmé (regle_ag_seuil_h2_minutes) — bug E2.
  v_delai_minutes := EXTRACT(epoch FROM (
    ((v_date_collecte + v_heure_collecte) AT TIME ZONE 'Europe/Paris') - now()
  ))::integer / 60;

  -- =========================================================
  -- SÉLECTION ASSOCIATIONS (filtres binaires + tri Haversine)
  -- =========================================================
  -- Filtre 1 : actif = true
  -- Filtre 2 : region correspond (IDF → region='idf', province → même région)
  -- Filtre 3 : horaires_ouverture compatibles avec heure_collecte
  --            Format attendu : {"lun":{"debut":"07:00","fin":"20:00"}, ...}
  --            ou null = toujours ouvert
  -- Filtre 4 : capacite_max_beneficiaires * 2 > volume_estime_repas (strict)
  --
  -- Note : latitude/longitude NULL → Haversine retourne NULL → tri en queue

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
          -- Extraire le jour de semaine en français abrégé
          CASE EXTRACT(DOW FROM v_date_collecte)
            WHEN 1 THEN 'lun' WHEN 2 THEN 'mar' WHEN 3 THEN 'mer'
            WHEN 4 THEN 'jeu' WHEN 5 THEN 'ven' WHEN 6 THEN 'sam' ELSE 'dim'
          END
          -- Vérifier que l'heure est dans la plage
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
      -- Filtre région : normaliser IDF
      AND LOWER(TRIM(a.region::text)) = LOWER(TRIM(v_region))
      -- Filtre capacité strict : capacite_max * 2 > volume (NULL capacite = exclue)
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

    -- Trouver Marathon (type_tms='mts1', code_transporteur_mts1='MARATHON-MTS1')
    SELECT id, nom, type_tms INTO v_transp_marathon
    FROM plateforme.transporteurs
    WHERE actif = true
      AND type_tms = 'mts1'
      AND LOWER(nom) LIKE '%marathon%'
    LIMIT 1;

    -- Trouver A Toutes! (type_tms='a_toutes')
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
        -- Backup A Toutes! : urgent (<90 min) = camion express 77, sinon = backup 91
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
        -- Sous-branche délai
        IF v_delai_minutes < v_seuil_h2 THEN
          v_branche           := 'ag_velo_express';   -- service Everest 74
        ELSE
          v_branche           := 'ag_velo_programme'; -- service Everest 71
        END IF;
        v_transporteur_id   := v_transp_a_toutes.id;
        v_transporteur_nom  := v_transp_a_toutes.nom;
        v_transporteur_type := v_transp_a_toutes.type_tms;
      ELSIF v_transp_marathon.id IS NOT NULL THEN
        -- Fallback Marathon
        v_branche           := 'ag_velo_fallback_marathon';
        v_transporteur_id   := v_transp_marathon.id;
        v_transporteur_nom  := v_transp_marathon.nom;
        v_transporteur_type := v_transp_marathon.type_tms;
      ELSE
        v_branche   := 'aucun_prestataire';
        v_no_prest  := true;
      END IF;
    END IF;

  ELSE
    -- === PROVINCE : scoring distance + véhicule + rayon (§05 R2 province) ===
    SELECT t.id, t.nom, t.type_tms INTO v_transp_marathon
    FROM plateforme.transporteurs t
    JOIN shared.prestataires p ON p.id = (
      SELECT id FROM shared.prestataires
      WHERE LOWER(nom) = LOWER(t.nom)
      LIMIT 1
    )
    WHERE t.actif = true
      -- Exclure a_toutes (province = MTS-1 ou autre)
      AND t.type_tms != 'a_toutes'
      AND (
        -- Rayon d'intervention
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
    ORDER BY
      -- Tri 1 : distance ASC (Haversine)
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
      END ASC,
      -- Tri 2 : nb_collectes_6_mois_cache ASC (répartition charge)
      COALESCE(p.nb_collectes_6_mois_cache, 0) ASC
    LIMIT 1;

    IF v_transp_marathon.id IS NOT NULL THEN
      v_branche           := 'ag_province_proximite';
      v_transporteur_id   := v_transp_marathon.id;
      v_transporteur_nom  := v_transp_marathon.nom;
      v_transporteur_type := v_transp_marathon.type_tms;
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
    'branche',          v_branche,
    'is_idf',           v_is_idf,
    'no_asso',          v_no_asso,
    'no_prestataire',   v_no_prest,
    'delai_minutes',    v_delai_minutes,
    'nb_pax',           v_nb_pax
  );
END;
$$;
