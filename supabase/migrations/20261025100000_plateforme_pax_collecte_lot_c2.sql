-- =============================================================================
-- Lot C2 — pax de LA collecte : algorithme AG, déchets labo, bordereau refait
-- au SIRET (décisions Val du 2026-10-24, Q2, Q3, Q5, Q6)
-- =============================================================================
-- Le pax est porté par la collecte depuis le 2026-10-20 (`collectes.pax`, 1 à
-- 100 000, 0 = inconnu, reprise Bubble) ; `evenements.pax` en est calculé (par
-- jour, max(Σ pax ZD, Σ pax AG) des collectes non annulées, puis somme des
-- jours). Trois fonctions lisaient encore le pax de l'événement :
--
-- 1. `fn_calculer_algo_attribution_ag` (Q2) : seuil « grand volume »
--    (`regle_ag_seuil_pax_velo`, 600) et `nb_pax` rendu — lu aussi par
--    `rpc_evaluer_auto_accept_ag` pour la fourchette de pax de
--    `config_auto_accept_ag` — passent au pax de la collecte AG. Une soirée de
--    300 convives dans un événement de 900 ne part plus en camion grand volume.
--    Seul changement vs 20260929100000 : `c.pax` à la place de `e.pax`, et la
--    lecture de `e.type_evenement_id`, jamais utilisée, retirée (aucun filtre
--    par type n'existe ; Q1 : la configuration de l'auto-acceptation reste
--    traiteur × association, transporteur, fourchette de pax).
--
-- 2. `f_dechets_labo_estimes` (§05 R_dechets_labo_estimes) : reste une valeur
--    d'ÉVÉNEMENT (pax de l'événement × coefficient, Q3 : la liste Collectes
--    calcule la part de la collecte côté route). Deux écarts au CDC fermés :
--    - « pax = 0 → estimation = NULL » (arbitrage Val du 2026-09-21, fiche
--      M3.2_20260921_dechets-labo-pax-zero) : garde `e.pax > 0` ;
--    - coefficient de « l'année de l'événement − 1 », sans repli sur une autre
--      année (Q6) : jointure sur `annee_reference`, à la place de
--      `ORDER BY annee_reference DESC LIMIT 1`. `uniq_coeff_labo_org_annee`
--      garantit au plus une ligne. Événement sans date : aucune ligne, NULL.
--
-- 3. `fn_trg_cerfa_debloque_siret` (Q5) : le bordereau ZD refait quand le
--    SIRET d'un traiteur shadow arrive imprime les convives de la collecte,
--    comme le batch J+1 ; 0 (inconnu) → NULL, mention omise par le gabarit.
--
-- SÉCURITÉ — aucun droit ouvert ni élargi (hors STOP CLAUDE.md §12-2bis) :
--   `CREATE OR REPLACE` conserve propriétaire et privilèges. Les trois
--   fonctions gardent `SECURITY DEFINER` et leur `search_path`, recopiés à
--   l'identique (le remplacement réécrit `proconfig`). L'ACL de l'algorithme est
--   ré-émise à l'identique de 20260929100000 (service_role seul) ; celles des
--   deux autres ne sont pas touchées. Garde de périmètre de
--   `f_dechets_labo_estimes` inchangée : un appel qui rendait NULL rend
--   toujours NULL (aucun passage de NULL à une valeur, mesuré sous
--   `authenticated` et `anon`) ; pour un appelant autorisé, la valeur suit la
--   règle (coefficient de l'année − 1, NULL à pax 0), et le coefficient qu'il
--   peut en déduire (valeur / pax) est celui de l'année − 1, plus le plus
--   récent.
--
-- Backward-compatible et non destructive : signatures inchangées, aucun objet
-- créé, renommé ni supprimé. Hors du diff structurel DDL cible V2 (corps de
-- fonctions).
--
-- RETOUR ARRIÈRE : rejouer les définitions de 20260929100000 (algorithme),
-- 20260921190000 (déchets labo) et 20260617130000 (bordereau), en conservant
-- leurs `SECURITY DEFINER` et `search_path`.
-- =============================================================================

-- ─── 1. Algorithme d'attribution AG ─────────────────────────────────────────

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
  v_region         := v_collecte.region;
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
    'nb_pax',           v_nb_pax
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_calculer_algo_attribution_ag(uuid)
  TO service_role;

-- ─── 2. Déchets labo estimés ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION plateforme.f_dechets_labo_estimes(p_evenement_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS
$$
  -- NULL (et non 0) quand le pax de l'événement vaut 0, quand le traiteur
  -- opérationnel n'a pas de coefficient pour l'année de l'événement − 1, ou
  -- quand l'événement est hors périmètre de l'appelant.
  SELECT e.pax * c.coefficient_kg_couvert
  FROM plateforme.evenements e
  JOIN plateforme.coefficients_perte_labo c
    ON c.organisation_id = e.traiteur_operationnel_organisation_id
   AND c.annee_reference = EXTRACT(YEAR FROM e.date_evenement)::integer - 1
  WHERE e.id = p_evenement_id
    AND e.pax > 0
    AND (
      plateforme.f_is_staff()
      OR e.lieu_id IN (
        SELECT lieu_id FROM plateforme.organisations_lieux
        WHERE organisation_id = (auth.jwt()->>'organisation_id')::uuid
      )
      OR e.organisation_id = (auth.jwt()->>'organisation_id')::uuid
    )
$$;

COMMENT ON FUNCTION plateforme.f_dechets_labo_estimes(uuid) IS
  'Estimation kg des déchets labo amont (§05 R_dechets_labo_estimes) = pax de '
  'l''événement × coefficient du traiteur opérationnel pour l''année de '
  'l''événement − 1. NULL = pax 0, coefficient non communiqué pour cette année '
  'OU événement hors périmètre → UI affiche « — ». Coefficient = 0 reste 0 kg, '
  'distinct de NULL. Le coefficient brut n''est jamais exposé.';

-- ─── 3. Bordereau ZD refait quand le SIRET du traiteur arrive ──────────────

CREATE OR REPLACE FUNCTION plateforme.fn_trg_cerfa_debloque_siret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_bord RECORD;
BEGIN
  -- Scope strict : fiche shadow, SIRET passant de NULL à NOT NULL
  IF NEW.est_shadow IS NOT TRUE
     OR OLD.siret IS NOT NULL
     OR NEW.siret IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_bord IN
    SELECT
      b.*,
      e.nom_evenement,
      e.date_evenement,
      NULLIF(c.pax, 0) AS pax,  -- convives de LA collecte, 0 = inconnu (Val Q5 du 2026-10-24)
      l.nom              AS lieu_nom,
      concat_ws(' ', l.adresse_acces, l.code_postal, l.ville) AS lieu_adresse
    FROM plateforme.bordereaux_savr b
    JOIN plateforme.collectes c   ON c.id = b.collecte_id
    JOIN plateforme.evenements e  ON e.id = c.evenement_id
    LEFT JOIN plateforme.lieux l  ON l.id = e.lieu_id
    WHERE b.statut = 'brouillon'
      AND COALESCE(e.traiteur_operationnel_organisation_id, e.organisation_id) = NEW.id
  LOOP
    UPDATE plateforme.bordereaux_savr
    SET producteur_siret = NEW.siret,
        statut           = 'emis',
        updated_at       = now()
    WHERE id = v_bord.id;

    -- Ré-enqueue du PDF — clés alignées sur le payload canonique du batch.
    INSERT INTO plateforme.jobs_pdf
      (type_document, entity_type, entity_id, payload, statut, attempts)
    VALUES (
      'bordereau-zd', 'bordereaux_savr', v_bord.id,
      jsonb_build_object(
        'numero',                    v_bord.numero,
        'date_emission',             v_bord.date_emission,
        'date_collecte',             v_bord.date_collecte,
        'date_evenement',            v_bord.date_evenement,
        'nom_evenement',             v_bord.nom_evenement,
        'lieu_nom',                  v_bord.lieu_nom,
        'lieu_adresse',              v_bord.lieu_adresse,
        'producteur_raison_sociale', v_bord.producteur_raison_sociale,
        'producteur_siret',          NEW.siret,
        'producteur_adresse',        v_bord.producteur_adresse,
        'transporteur_nom',          v_bord.transporteur_nom,
        'exutoire_nom',              v_bord.exutoire_nom,
        'nb_pax',                    v_bord.pax,
        'flux',                      v_bord.detail_flux,
        'poids_total_kg',            v_bord.poids_total_kg,
        'source',                    'siret_shadow_debloque'
      ),
      'pending', 0
    )
    -- anti-doublon (idx_jobs_pdf_anti_dupe) : un seul job actif par entité
    ON CONFLICT (entity_type, entity_id, type_document)
      WHERE statut IN ('pending', 'processing')
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;
