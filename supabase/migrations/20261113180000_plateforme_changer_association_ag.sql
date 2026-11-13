-- Changement de l'association d'une collecte Anti-Gaspi déjà attribuée
-- (décisions Val 2026-11-13).
--
-- L'Admin choisit une autre association sur la fiche collecte (« Modifier
-- l'attribution »). L'association est le point B de la commande transmise au
-- prestataire : le changement lui est renvoyé.
--   - MTS-1 : la commande en cours est ANNULÉE puis une nouvelle est CRÉÉE
--     (avec sa tournée unitaire). Les tournées sont réinitialisées ici, dans la
--     transaction du changement (comme une réattribution, 20260921220000), et
--     l'ordre `collecte.creee` porte les identifiants des anciennes commandes
--     (`commandes_a_annuler`), que l'adapter supprime avant de recréer.
--   - Autre prestataire avec une commande en cours (A Toute!) : un ordre
--     `collecte.modifiee`, qui renvoie l'adresse de fin de mission.
--   - Rien de commandé (ordre de création encore en file, prestataire manuel) :
--     aucun ordre logistique, la création en file lira la nouvelle association.
-- Toujours : la nouvelle association reçoit l'email d'attribution habituel
-- (`attribution.validee`, famille `attribution_job`) ; rien à l'ancienne.
-- Collecte programmée ou validée seulement (jamais une fois la mission
-- commencée). Le motif (choix ≠ n°1 de l'algo) et le rôle sont vérifiés par la
-- route ; la fonction est réservée à service_role.

CREATE OR REPLACE FUNCTION plateforme.fn_changer_association_ag(
  p_collecte_id          uuid,
  p_association_id       uuid,
  p_modifie_par          uuid,
  p_motif_override       text DEFAULT NULL,
  p_motif_override_libre text DEFAULT NULL
) RETURNS text   -- ordre logistique émis : 'collecte.creee' | 'collecte.modifiee' | 'aucun'
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'plateforme', 'public'
AS $$
DECLARE
  v_collecte     record;
  v_attribution  record;
  v_type_tms     plateforme.type_tms;
  v_consumer     text;
  v_commandes    text[];
  v_event_type   text := 'aucun';
BEGIN
  -- Row lock AVANT tout INSERT outbox (CLAUDE.md R1 — ordering intra-agrégat).
  SELECT c.id, c.type, c.statut, c.prestataire_logistique_id
  INTO v_collecte
  FROM plateforme.collectes c
  WHERE c.id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_collecte.type <> 'anti_gaspi' THEN
    RAISE EXCEPTION 'Changement d''association réservé aux collectes anti_gaspi'
      USING ERRCODE = 'P0042';
  END IF;
  IF v_collecte.statut NOT IN ('programmee', 'validee') THEN
    RAISE EXCEPTION 'Association modifiable seulement sur une collecte programmée ou validée (actuel : %)',
      v_collecte.statut USING ERRCODE = 'P0043';
  END IF;

  SELECT a.id, a.association_id, a.transporteur_id, a.branche_attribution,
         a.mode_validation, a.motif_override, a.motif_override_libre
  INTO v_attribution
  FROM plateforme.attributions_antgaspi a
  WHERE a.collecte_id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune attribution à modifier' USING ERRCODE = 'P0045';
  END IF;
  IF v_attribution.association_id = p_association_id THEN
    RAISE EXCEPTION 'Association inchangée' USING ERRCODE = 'P0046';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.associations s
    WHERE s.id = p_association_id AND s.actif
  ) THEN
    RAISE EXCEPTION 'Association inconnue ou inactive' USING ERRCODE = 'P0047';
  END IF;

  -- La collecte d'abord (lock déjà tenu) : seq outbox = ordre de commit.
  UPDATE plateforme.collectes SET updated_at = now() WHERE id = p_collecte_id;

  UPDATE plateforme.attributions_antgaspi
  SET association_id       = p_association_id,
      motif_override       = p_motif_override,
      motif_override_libre = p_motif_override_libre
  WHERE id = v_attribution.id;

  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, user_id, old_values, new_values
  ) VALUES (
    'attributions_antgaspi', v_attribution.id, 'CHANGEMENT_ASSOCIATION', p_modifie_par,
    jsonb_build_object(
      'association_id',       v_attribution.association_id,
      'motif_override',       v_attribution.motif_override,
      'motif_override_libre', v_attribution.motif_override_libre
    ),
    jsonb_build_object(
      'association_id',       p_association_id,
      'motif_override',       p_motif_override,
      'motif_override_libre', p_motif_override_libre
    )
  );

  SELECT t.type_tms INTO v_type_tms
  FROM plateforme.transporteurs t
  WHERE t.prestataire_logistique_id = v_collecte.prestataire_logistique_id
  LIMIT 1;

  v_consumer := CASE v_type_tms
    WHEN 'mts1'     THEN 'adapter_mts1'
    WHEN 'a_toutes' THEN 'adapter_everest'
    ELSE 'provider_manual'
  END;

  IF v_type_tms = 'mts1'
     AND plateforme.fn_collecte_commandee_chez_provider(p_collecte_id) THEN
    -- Commandes MTS-1 en cours, lues avant leur réinitialisation.
    SELECT array_agg(t.external_ref_commande ORDER BY ct.rang)
    INTO v_commandes
    FROM plateforme.tournees t
    JOIN plateforme.collecte_tournees ct ON ct.tournee_id = t.id
    WHERE ct.collecte_id = p_collecte_id
      AND t.external_ref_commande IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM plateforme.transporteurs tr
        WHERE tr.prestataire_logistique_id = t.prestataire_logistique_id
          AND tr.type_tms = 'mts1'
      );

    -- Réinitialisées en place, nouvelle tentative (suffixe -rN de la clé),
    -- comme une réattribution (20260921220000).
    UPDATE plateforme.tournees t
    SET
      external_ref_commande  = NULL,
      tms_reference          = NULL,
      statut                 = 'planifiee',
      plaque_immatriculation = NULL,
      plaque_saisie_at       = NULL,
      chauffeur_nom          = NULL,
      chauffeur_telephone    = NULL,
      accompagnant_nom       = NULL,
      accompagnant_telephone = NULL,
      heure_debut_reelle     = NULL,
      heure_fin_reelle       = NULL,
      reference_interne      = regexp_replace(t.reference_interne, '-r[0-9]+$', '')
                               || '-r'
                               || (COALESCE(substring(t.reference_interne FROM '-r([0-9]+)$')::int, 1) + 1),
      updated_at             = now()
    FROM plateforme.collecte_tournees ct
    WHERE ct.tournee_id = t.id
      AND ct.collecte_id = p_collecte_id
      AND t.external_ref_commande IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM plateforme.transporteurs tr
        WHERE tr.prestataire_logistique_id = t.prestataire_logistique_id
          AND tr.type_tms = 'mts1'
      );

    UPDATE plateforme.collectes
    SET tms_reference = NULL,
        statut_tms    = 'non_envoye',
        statut_tms_at = now()
    WHERE id = p_collecte_id;

    v_event_type := 'collecte.creee';
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte', p_collecte_id, v_event_type,
      jsonb_build_object(
        'collecte_id',               p_collecte_id,
        'origine',                   'changement_association',
        'prestataire_logistique_id', v_collecte.prestataire_logistique_id,
        'commandes_a_annuler',       to_jsonb(v_commandes)
      ),
      v_consumer
    );
  ELSIF v_consumer <> 'provider_manual'
     AND plateforme.fn_collecte_commandee_chez_provider(p_collecte_id) THEN
    v_event_type := 'collecte.modifiee';
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte', p_collecte_id, v_event_type,
      jsonb_build_object(
        'collecte_id', p_collecte_id,
        'origine',     'changement_association'
      ),
      v_consumer
    );
  END IF;

  -- Email d'attribution à la nouvelle association (même job qu'à la validation).
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte', p_collecte_id, 'attribution.validee',
    jsonb_build_object(
      'collecte_id',     p_collecte_id,
      'attribution_id',  v_attribution.id,
      'association_id',  p_association_id,
      'transporteur_id', v_attribution.transporteur_id,
      'branche',         v_attribution.branche_attribution,
      'mode_validation', v_attribution.mode_validation::text,
      'origine',         'changement_association'
    ),
    'attribution_job'
  );

  RETURN v_event_type;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_changer_association_ag(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_changer_association_ag(uuid, uuid, uuid, text, text)
  TO service_role;
