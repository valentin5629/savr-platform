-- =============================================================================
-- Correction A2 : fn_creer_collecte ne doit émettre E1 que pour type='zd'
-- Divergence documentée dans _Divergences/M1.2_20260614.md
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
BEGIN
  IF p_type = 'ag' THEN
    SELECT pax INTO v_pax
    FROM plateforme.evenements
    WHERE id = p_evenement_id;
    IF v_pax IS NOT NULL THEN
      v_volume_estime := ROUND(0.1 * v_pax);
    END IF;
  END IF;

  INSERT INTO plateforme.collectes (
    evenement_id, type, date_collecte, heure_collecte,
    nb_camions_demande, controle_acces_requis, notes_internes,
    informations_supplementaires, volume_estime_repas,
    statut, statut_tms
  ) VALUES (
    p_evenement_id,
    p_type::plateforme.collecte_type_enum,
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

  -- E1 uniquement pour ZD (AG reste non_envoye jusqu'à attribution Admin, module M1.4)
  IF p_type = 'zd' THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      v_collecte_id,
      'collecte.creee',
      jsonb_build_object(
        'collecte_id', v_collecte_id,
        'type',        p_type,
        'date_collecte', p_date_collecte
      ),
      'adapter_mts1'
    );
  END IF;

  RETURN v_collecte_id;
END;
$$;
