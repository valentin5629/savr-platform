-- M2.3 — Algo attribution AG
-- Contenu :
--   1. Seed parametres_algo AG (7 nouvelles clés)
--   2. Email templates AG (3 nouveaux)
--   3. Trigger poids_repas_kg → volume_repas_realise
--   4. Trigger mode_validation immuable post-INSERT
--   5. Fonction fn_calculer_algo_attribution_ag (moteur algo IDF+province)
--   6. RPC rpc_valider_attribution_ag (transaction synchrone)
--   7. GRANT tables post-M0.4a

-- ============================================================
-- 1. SEED parametres_algo AG
-- ============================================================

INSERT INTO plateforme.parametres_algo (cle, valeur, type_valeur, description) VALUES
  ('regle_ag_plage_velo_debut', '"07:00"'::jsonb, 'time',    'Début plage horaire vélo AG IDF (inclusive — heure >= debut = jour)'),
  ('regle_ag_plage_velo_fin',   '"20:00"'::jsonb, 'time',    'Fin plage horaire vélo AG IDF (exclusive — heure >= fin = nuit)'),
  ('regle_ag_seuil_pax_velo',   '600'::jsonb,     'int',     'Seuil PAX branche vélo vs Marathon IDF (>= seuil = Branche 2 Marathon)'),
  ('regle_ag_seuil_h2_minutes', '90'::jsonb,      'int',     'Seuil délai (min) avant collecte : vélo express (<seuil) vs programmé (>=seuil)'),
  ('poids_par_repas_kg',        '0.45'::jsonb,    'decimal', 'Poids moyen par repas (kg) — formule volume_repas_realise = ceil(poids/coef)'),
  ('a_toutes_indisponible',     'true'::jsonb,    'bool',    'Flag opérationnel go-live : A Toutes! indisponible, branches vélo → Marathon fallback'),
  ('everest_codes_postaux',     '["75","92","93"]'::jsonb, 'text[]', 'Codes postaux (2 premiers chiffres) couverts par Everest (A Toutes!)')
ON CONFLICT (cle) DO NOTHING;

-- ============================================================
-- 2. EMAIL TEMPLATES AG (3 nouveaux — portent le total à 22)
-- ============================================================

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
  (
    'ag_attribution_association',
    'Attribution Anti-Gaspi — {{ evenement_nom }}',
    '<p>Madame, Monsieur,</p><p>Nous avons le plaisir de vous informer que votre association a été sélectionnée pour recevoir les invendus alimentaires de l''événement <strong>{{ evenement_nom }}</strong>.</p><p><strong>Date et heure :</strong> {{ date_collecte }}<br><strong>Lieu :</strong> {{ lieu_adresse }}<br><strong>Volume estimé :</strong> {{ volume_estime_repas }} repas<br><strong>Transporteur :</strong> {{ transporteur_nom }}</p><p>Pour toute question, n''hésitez pas à nous contacter.<br>L''équipe Savr</p>',
    true,
    'Email envoyé à l''association bénéficiaire lors de l''attribution AG',
    ARRAY['evenement_nom', 'date_collecte', 'lieu_adresse', 'volume_estime_repas', 'transporteur_nom']
  ),
  (
    'ag_attribution_transporteur',
    'Mission Anti-Gaspi — {{ evenement_nom }} — {{ date_collecte }}',
    '<p>Madame, Monsieur,</p><p>Nous vous confirmons une mission de collecte Anti-Gaspi.</p><p><strong>Événement :</strong> {{ evenement_nom }}<br><strong>Date et heure de prise en charge :</strong> {{ date_collecte }}<br><strong>Adresse de collecte :</strong> {{ lieu_adresse }}<br><strong>Adresse de livraison :</strong> {{ association_adresse }}<br><strong>Volume estimé :</strong> {{ volume_estime_repas }} repas</p><p>Pour toute question, contactez l''équipe Savr.<br>L''équipe Savr</p>',
    true,
    'Email envoyé au transporteur mandaté lors de l''attribution AG',
    ARRAY['evenement_nom', 'date_collecte', 'lieu_adresse', 'association_adresse', 'volume_estime_repas']
  ),
  (
    'ag_a_toutes_indispo',
    '[Ops] A Toutes! — Flag indisponibilité activé',
    '<p>Le flag <strong>a_toutes_indisponible</strong> a été activé dans les paramètres algorithme.</p><p><strong>Modifié par :</strong> {{ user_email }}<br><strong>Motif :</strong> {{ motif }}</p><p>Toutes les prochaines attributions IDF de jour (branches vélo) basculeront automatiquement sur Marathon/MTS-1 jusqu''à désactivation du flag.<br>L''équipe Savr</p>',
    true,
    'Notification Ops lors de l''activation du flag a_toutes_indisponible',
    ARRAY['user_email', 'motif']
  )
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. TRIGGER poids_repas_kg → volume_repas_realise
-- Lit poids_par_repas_kg depuis parametres_algo
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_calc_volume_repas_realise()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_coef   numeric;
  v_volume integer;
BEGIN
  -- Uniquement quand poids_repas_kg est défini et change
  IF NEW.poids_repas_kg IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lire le coefficient depuis parametres_algo
  SELECT (valeur#>>'{}')::numeric
  INTO v_coef
  FROM plateforme.parametres_algo
  WHERE cle = 'poids_par_repas_kg';

  v_coef := COALESCE(v_coef, 0.45);

  IF v_coef <= 0 THEN
    RAISE EXCEPTION 'poids_par_repas_kg invalide (doit être > 0)' USING ERRCODE = 'P0020';
  END IF;

  v_volume := ceil(NEW.poids_repas_kg / v_coef);
  NEW.volume_repas_realise := v_volume;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'attributions_antgaspi',
    NEW.id,
    'poids_repas_saisi_ops',
    jsonb_build_object(
      'poids_repas_kg_old', OLD.poids_repas_kg,
      'volume_repas_realise_old', OLD.volume_repas_realise
    ),
    jsonb_build_object(
      'poids_repas_kg', NEW.poids_repas_kg,
      'volume_repas_realise', v_volume,
      'coef_utilise', v_coef
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calc_volume_repas_realise ON plateforme.attributions_antgaspi;
CREATE TRIGGER trg_calc_volume_repas_realise
  BEFORE UPDATE OF poids_repas_kg ON plateforme.attributions_antgaspi
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_calc_volume_repas_realise();

-- ============================================================
-- 4. TRIGGER mode_validation immuable post-INSERT
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_mode_validation_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode_validation IS DISTINCT FROM OLD.mode_validation THEN
    RAISE EXCEPTION 'mode_validation est immuable après création' USING ERRCODE = 'P0021';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mode_validation_immutable ON plateforme.attributions_antgaspi;
CREATE TRIGGER trg_mode_validation_immutable
  BEFORE UPDATE OF mode_validation ON plateforme.attributions_antgaspi
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_mode_validation_immutable();

-- ============================================================
-- 5. FONCTION fn_calculer_algo_attribution_ag
--    Moteur algo complet : associations top 3 + branches IDF/province
--    Retourne jsonb {
--      associations: [{id, nom, distance_km, capacite, is_top1}],
--      transporteur: {id, nom, type_tms} | null,
--      branche: text,
--      is_idf: bool,
--      no_asso: bool,
--      no_prestataire: bool
--    }
-- ============================================================

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
  v_delai_minutes := EXTRACT(epoch FROM (
    (v_date_collecte::timestamp + v_heure_collecte::interval) - now()
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
        -- Backup camion Everest (Branche 4 embedded in Branche 2 backup)
        v_branche           := 'ag_marathon_volume_backup_camion';
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

    -- Branche 4 : CAMION EXPRESS (nb_pax >= seuil, Marathon exclu, A Toutes! dispo, délai < 90min)
    -- Note : ce bloc est évalué UNIQUEMENT si Marathon est exclu (résultat 'aucun_prestataire' en Branche 2)
    IF v_branche = 'aucun_prestataire'
      AND v_nb_pax >= v_seuil_pax
      AND NOT v_a_toutes_indispo
      AND v_transp_a_toutes.id IS NOT NULL
      AND v_cp_dep2 = ANY(v_everest_cps)
      AND v_delai_minutes < v_seuil_h2 THEN
      v_branche           := 'ag_everest_camion_express'; -- service Everest 77
      v_transporteur_id   := v_transp_a_toutes.id;
      v_transporteur_nom  := v_transp_a_toutes.nom;
      v_transporteur_type := v_transp_a_toutes.type_tms;
      v_no_prest          := false;
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

REVOKE ALL ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid) TO authenticated, service_role;

-- ============================================================
-- 6. RPC rpc_valider_attribution_ag
--    Transaction synchrone : INSERT attributions_antgaspi +
--    réservation pack (pack_antgaspi_id) + INSERT outbox_events
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.rpc_valider_attribution_ag(
  p_collecte_id          uuid,
  p_association_id       uuid,
  p_transporteur_id      uuid,
  p_branche_attribution  text,
  p_mode_validation      plateforme.attribution_mode_validation_enum,
  p_valide_par           uuid,
  p_motif_override       text     DEFAULT NULL,
  p_motif_override_libre text     DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_collecte       record;
  v_event          record;
  v_pack_id        uuid;
  v_attribution_id uuid;
  v_outbox_id      uuid;
BEGIN
  -- Validation params
  IF p_association_id IS NULL OR p_transporteur_id IS NULL THEN
    RAISE EXCEPTION 'association_id et transporteur_id obligatoires' USING ERRCODE = 'P0040';
  END IF;

  IF p_mode_validation = 'manuel_override' AND p_motif_override IS NULL THEN
    RAISE EXCEPTION 'motif_override obligatoire en mode override' USING ERRCODE = 'P0041';
  END IF;

  -- Row lock collecte (CLAUDE.md R1 — ordering intra-agrégat)
  SELECT c.id, c.statut, c.statut_tms, c.type, c.evenement_id, c.pack_antgaspi_id
  INTO v_collecte
  FROM plateforme.collectes c
  WHERE c.id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_collecte.type != 'anti_gaspi' THEN
    RAISE EXCEPTION 'Attribution AG applicable uniquement aux collectes anti_gaspi' USING ERRCODE = 'P0042';
  END IF;
  IF v_collecte.statut NOT IN ('programmee') THEN
    RAISE EXCEPTION 'Attribution AG uniquement possible depuis statut programmee (actuel: %)', v_collecte.statut
      USING ERRCODE = 'P0043';
  END IF;

  -- Vérifier qu'il n'existe pas déjà une attribution (UNIQUE collecte_id)
  IF EXISTS (
    SELECT 1 FROM plateforme.attributions_antgaspi
    WHERE collecte_id = p_collecte_id
  ) THEN
    RAISE EXCEPTION 'Attribution déjà existante pour cette collecte' USING ERRCODE = 'P0044';
  END IF;

  -- Récupérer l'organisation de l'événement
  SELECT e.organisation_id INTO v_event
  FROM plateforme.evenements e
  WHERE e.id = v_collecte.evenement_id;

  -- Réserver le pack actif FIFO (FOR UPDATE — pas SKIP LOCKED pour garantir la réservation)
  SELECT p.id INTO v_pack_id
  FROM plateforme.packs_antgaspi p
  WHERE p.organisation_id = v_event.organisation_id
    AND p.statut = 'actif'
  ORDER BY p.created_at ASC
  LIMIT 1
  FOR UPDATE;

  -- Attacher le pack à la collecte (réservation — débit effectif à realisee via trg_pack_debit_realisee)
  IF v_pack_id IS NOT NULL THEN
    UPDATE plateforme.collectes
    SET pack_antgaspi_id = v_pack_id,
        updated_at = now()
    WHERE id = p_collecte_id;
  END IF;

  -- INSERT attributions_antgaspi
  INSERT INTO plateforme.attributions_antgaspi (
    collecte_id, association_id, transporteur_id, branche_attribution,
    mode_validation, valide_par, valide_at,
    motif_override, motif_override_libre
  ) VALUES (
    p_collecte_id, p_association_id, p_transporteur_id, p_branche_attribution,
    p_mode_validation, p_valide_par, now(),
    p_motif_override, p_motif_override_libre
  )
  RETURNING id INTO v_attribution_id;

  -- Audit override
  IF p_mode_validation = 'manuel_override' THEN
    INSERT INTO plateforme.audit_log (
      table_name, record_id, action, new_values
    ) VALUES (
      'attributions_antgaspi', v_attribution_id,
      'attribution_override',
      jsonb_build_object(
        'motif_code',  p_motif_override,
        'motif_texte', p_motif_override_libre,
        'association_choisie', p_association_id,
        'transporteur_choisi', p_transporteur_id
      )
    );
  END IF;

  -- INSERT outbox_events (même transaction — G4 garde-fou)
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    p_collecte_id,
    'attribution.validee',
    jsonb_build_object(
      'collecte_id',     p_collecte_id,
      'attribution_id',  v_attribution_id,
      'association_id',  p_association_id,
      'transporteur_id', p_transporteur_id,
      'branche',         p_branche_attribution,
      'mode_validation', p_mode_validation::text
    ),
    'attribution_job'
  )
  RETURNING id INTO v_outbox_id;

  RETURN jsonb_build_object(
    'ok',              true,
    'attribution_id',  v_attribution_id,
    'outbox_id',       v_outbox_id,
    'pack_id',         v_pack_id
  );
END;
$$;

REVOKE ALL ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.attribution_mode_validation_enum, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.attribution_mode_validation_enum, uuid, text, text) TO service_role;

-- ============================================================
-- 7. GRANT tables post-M0.4a (règle mémoire feedback-grant-new-tables.md)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON plateforme.config_auto_accept_ag TO authenticated;
GRANT SELECT, INSERT, UPDATE ON plateforme.attributions_antgaspi TO authenticated;

-- ============================================================
-- ASSERTIONS DE SANITÉ
-- ============================================================

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM plateforme.parametres_algo
  WHERE cle IN (
    'regle_ag_plage_velo_debut', 'regle_ag_plage_velo_fin',
    'regle_ag_seuil_pax_velo', 'regle_ag_seuil_h2_minutes',
    'poids_par_repas_kg', 'a_toutes_indisponible', 'everest_codes_postaux'
  );

  IF v_count < 7 THEN
    RAISE EXCEPTION 'M2.3 ASSERTION FAILED: % paramètres AG manquants (attendu 7)', 7 - v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM plateforme.email_templates
  WHERE code IN ('ag_attribution_association', 'ag_attribution_transporteur', 'ag_a_toutes_indispo');

  IF v_count < 3 THEN
    RAISE EXCEPTION 'M2.3 ASSERTION FAILED: % templates AG manquants (attendu 3)', 3 - v_count;
  END IF;

  RAISE NOTICE 'M2.3 OK: parametres_algo + email_templates AG seedés, triggers posés';
END $$;
