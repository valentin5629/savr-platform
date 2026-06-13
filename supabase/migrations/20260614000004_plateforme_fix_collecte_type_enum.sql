-- =============================================================================
-- Fix : fn_creer_collecte — normalisation alias 'zd'/'ag' → collecte_type_enum
-- =============================================================================
-- La version initiale (20260614000001) castait directement p_type text
-- vers plateforme.collecte_type_enum sans traduction, ce qui provoquait :
--   ERROR: invalid input value for enum collecte_type_enum: "zd"
-- car l'enum ne contient que 'zero_dechet' et 'anti_gaspi'.
--
-- Fix : ajouter une normalisation en tête de fonction pour accepter les alias
-- courts 'zd'/'ag' utilisés par les helpers pgTAP (tests.outbox_fixture_collecte).
-- Les valeurs longues restent valides (idempotent).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_creer_collecte(
  p_evenement_id    uuid,
  p_type            text,
  p_date_collecte   date,
  p_heure_collecte  time,
  p_nb_camions      smallint  DEFAULT 1,
  p_controle_acces  boolean   DEFAULT false,
  p_notes           text      DEFAULT NULL,
  p_info_suppl      text      DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_collecte_id    uuid;
  v_pax            integer;
  v_volume_estime  integer := NULL;
  v_type_enum      plateforme.collecte_type_enum;
BEGIN
  -- Normalisation alias courts → valeurs de l'enum
  v_type_enum := CASE p_type
    WHEN 'zd'  THEN 'zero_dechet'::plateforme.collecte_type_enum
    WHEN 'ag'  THEN 'anti_gaspi'::plateforme.collecte_type_enum
    ELSE p_type::plateforme.collecte_type_enum   -- valeur longue déjà correcte
  END;

  -- Volume estimé repas pour AG (0,1 × pax de l'événement)
  IF v_type_enum = 'anti_gaspi' THEN
    SELECT pax INTO v_pax
    FROM plateforme.evenements
    WHERE id = p_evenement_id;
    IF v_pax IS NOT NULL THEN
      v_volume_estime := ROUND(0.1 * v_pax);
    END IF;
  END IF;

  -- INSERT collecte
  INSERT INTO plateforme.collectes (
    evenement_id, type, date_collecte, heure_collecte,
    nb_camions_demande, controle_acces_requis, notes_internes,
    informations_supplementaires, volume_estime_repas,
    statut, statut_tms
  ) VALUES (
    p_evenement_id,
    v_type_enum,
    p_date_collecte,
    p_heure_collecte,
    p_nb_camions,
    p_controle_acces,
    p_notes,
    p_info_suppl,
    v_volume_estime,
    'programmee',
    'non_envoye'
  ) RETURNING id INTO v_collecte_id;

  -- INSERT outbox E1 (même transaction → atomique)
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    v_collecte_id,
    'collecte.creee',
    jsonb_build_object(
      'collecte_id',   v_collecte_id,
      'type',          v_type_enum::text,
      'date_collecte', p_date_collecte
    ),
    'adapter_mts1'
  );

  RETURN v_collecte_id;
END;
$$;
