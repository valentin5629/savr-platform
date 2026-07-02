-- R17b (décision Val 2026-07-02) — routing dispatch AG pour les nouveaux type_tms
-- 'par_mail' / 'par_telephone' (transporteurs hors TMS → validation MANUELLE Admin).
--
-- CREATE OR REPLACE VERBATIM de rpc_valider_attribution_ag (source : R5
-- 20260625000000) — SEULE différence = le CASE de dérivation du consumer :
--   AVANT : WHEN 'autre' THEN 'provider_manual' ELSE 'adapter_mts1' (repli piège :
--           un type_tms non listé — dont 'par_mail'/'par_telephone' — aurait été
--           routé vers l'API MTS-1 par erreur).
--   APRÈS : ELSE 'provider_manual' → 'autre', 'par_mail', 'par_telephone' ET tout
--           futur inconnu tombent sur le dispatch manuel (aucun appel API). Les
--           valeurs existantes 'mts1'/'a_toutes' gardent un routage IDENTIQUE.
-- Migration séparée (après 20260702020000 qui commit l'ajout des valeurs d'enum),
-- pour que les littéraux enum soient valides. SET search_path + REVOKE/GRANT re-posés.

CREATE OR REPLACE FUNCTION plateforme.rpc_valider_attribution_ag(
  p_collecte_id          uuid,
  p_association_id       uuid,
  p_transporteur_id      uuid,
  p_branche_attribution  text,
  p_mode_validation      plateforme.mode_validation,
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
  v_presta_id      uuid;
  v_type_tms       plateforme.type_tms;
  v_consumer       text;
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

  -- Résoudre le prestataire logistique + type_tms du transporteur choisi
  -- (pont V1-only). Sert à poser tournees.prestataire_logistique_id au dispatch
  -- et à dériver le consumer (route adapter).
  SELECT t.prestataire_logistique_id, t.type_tms
  INTO v_presta_id, v_type_tms
  FROM plateforme.transporteurs t
  WHERE t.id = p_transporteur_id;

  -- Dérivation du consumer (route worker → getLogistiqueProvider). ELSE = manuel :
  -- 'autre'/'par_mail'/'par_telephone' (+ tout inconnu) → provider_manual, JAMAIS
  -- d'auto-POST MTS-1 (fix du repli piège R5). 'mts1'/'a_toutes' inchangés.
  v_consumer := CASE v_type_tms
    WHEN 'mts1'     THEN 'adapter_mts1'
    WHEN 'a_toutes' THEN 'adapter_everest'
    ELSE 'provider_manual'
  END;

  -- Attacher le pack à la collecte (réservation — débit effectif à realisee via trg_pack_debit_realisee)
  -- + poser le prestataire logistique (dispatch). statut_tms reste non_envoye
  -- (CDC §3 : on saute a_attribuer ; l'adapter pose attribuee_en_attente_acceptation).
  UPDATE plateforme.collectes
  SET pack_antgaspi_id = COALESCE(v_pack_id, pack_antgaspi_id),
      prestataire_logistique_id = COALESCE(v_presta_id, prestataire_logistique_id),
      updated_at = now()
  WHERE id = p_collecte_id;

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

  -- INSERT outbox_events — E (emails async, cron process-attributions-ag).
  -- Même transaction — G4 garde-fou.
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

  -- INSERT outbox_events — DISPATCH (BL-P0-08). L'event collecte.creee est
  -- consommé par le worker outbox → getLogistiqueProvider(type_tms) → adapter.
  -- Le consumer est DÉRIVÉ du type_tms (jamais adapter_mts1 en dur). Émis APRÈS
  -- l'UPDATE collectes (lock tenu) → seq = ordre de commit (R1). Le worker
  -- no-op gracieusement si prestataire_logistique_id reste NULL.
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    p_collecte_id,
    'collecte.creee',
    jsonb_build_object(
      'collecte_id',               p_collecte_id,
      'origine',                   'attribution_ag',
      'transporteur_id',           p_transporteur_id,
      'prestataire_logistique_id', v_presta_id
    ),
    v_consumer
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'attribution_id',  v_attribution_id,
    'outbox_id',       v_outbox_id,
    'pack_id',         v_pack_id,
    'consumer',        v_consumer
  );
END;
$$;

-- Hardening re-posé (CREATE OR REPLACE réinitialise les attributs ; REVOKE/GRANT
-- persistent mais re-posés par sûreté — cf. 20260615240000 l.668-669).
REVOKE ALL ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text) TO service_role;
