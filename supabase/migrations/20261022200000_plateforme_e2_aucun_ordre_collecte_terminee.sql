-- =============================================================================
-- E2 : aucun ordre de modification pour une collecte terminée ou annulée
-- (décision Val 2026-10-22, question Q1 de la fiche
-- `M1.2_20261022_pax-regle-du-jour-et-modification-admin`)
-- =============================================================================
-- DEMANDE : une correction faite après coup par l'équipe Savr (pax, date, heure,
-- informations) sur une collecte `realisee`, `realisee_sans_collecte`,
-- `cloturee` ou `annulee` reste interne à la plateforme : aucun E2
-- `collecte.modifiee`, même si une commande existe chez le prestataire (§05
-- « Cascade TMS », §08 « Déclencheur » E2).
--
-- CE QUE FAIT CETTE MIGRATION : `fn_modifier_collecte` (corps de
-- 20261021073000, une seule condition ajoutée) n'écrit plus d'E2 quand la
-- collecte est dans l'un de ces statuts AVANT ou APRÈS la modification : une
-- collecte qu'on rouvre ou qu'on clôt d'office ne relance pas une mission.
-- La transition vers `annulee` émet toujours son E3 (inchangé).
-- `fn_modifier_evenement` n'est pas modifiée : sa boucle ne parcourt déjà que
-- les collectes `programmee`, `validee`, `en_cours` (20261021073000).
--
-- ACCÈS : aucun droit ouvert. Fonction SECURITY DEFINER remplacée par CREATE
-- OR REPLACE (même signature, droits conservés) ; REVOKE à PUBLIC, anon,
-- authenticated et GRANT à service_role rejoués. La modification restreint
-- l'émission, elle n'élargit rien.
--
-- ROLLBACK : rejouer la définition de fn_modifier_collecte de 20261021073000.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_row            plateforme.collectes;
  v_commandee      boolean;
  v_old_statut     plateforme.collecte_statut;
  v_old_nb_camions smallint;
  v_old_date       date;
  v_old_heure      time;
  v_new_nb_camions smallint;
  v_passe_annulee  boolean;
  v_pax_invalide   boolean;
BEGIN
  -- Row lock + lecture de l'état courant (AVANT UPDATE et INSERT outbox). On lit
  -- aussi nb_camions_demande + date/heure pour les gardes RM-02/RM-05 sous le verrou.
  SELECT statut, nb_camions_demande, date_collecte, heure_collecte
  INTO   v_old_statut, v_old_nb_camions, v_old_date, v_old_heure
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- ── RM-02 : nb_camions_demande interdit hors (programmee, validee, en_cours) ──
  -- Jamais de régression d'un état terminal (§05 l.271, CLAUDE.md §4). Un camion
  -- après coup sur un statut terminal = flux incident Admin, pas une modif de N.
  IF p_updates ? 'nb_camions_demande'
     AND v_old_statut NOT IN ('programmee', 'validee', 'en_cours') THEN
    RAISE EXCEPTION
      'NB_CAMIONS_STATUT_TERMINAL: nb_camions_demande non modifiable au statut % (jamais de régression d''un état terminal)',
      v_old_statut USING ERRCODE = 'P0001';
  END IF;

  -- ── RM-05 : réduction de N bloquée à moins d'1h de la mission ────────────────
  -- date/heure sont des wall-clocks naïfs → AT TIME ZONE 'Europe/Paris' (bug E2).
  IF p_updates ? 'nb_camions_demande' THEN
    v_new_nb_camions := (p_updates->>'nb_camions_demande')::smallint;
    -- Garde de domaine : au moins 1 camion (la colonne n'a pas de CHECK >= 1).
    -- Évite une donnée absurde (0 camion) ET un faux positif RM-05 (0 < N_old).
    IF v_new_nb_camions < 1 THEN
      RAISE EXCEPTION
        'NB_CAMIONS_INVALIDE: nb_camions_demande doit être >= 1 (reçu %)', v_new_nb_camions
        USING ERRCODE = 'P0001';
    END IF;
    IF v_new_nb_camions < COALESCE(v_old_nb_camions, 1)
       AND (((v_old_date + COALESCE(v_old_heure, '00:00:00'::time))
              AT TIME ZONE 'Europe/Paris') - interval '1 hour') <= now() THEN
      RAISE EXCEPTION
        'REDUCTION_CANCEL_WINDOW_CLOSED: réduction du nombre de camions bloquée à moins d''1h avant la mission'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Pax de la collecte (décision Val 2026-10-20) : entier de 1 à 100 000 ───
  -- La colonne admet 0 (reprise Bubble sans pax) ; une modification, jamais.
  -- CASE (et non OR) : l'ordre d'évaluation d'un OR n'est pas garanti en SQL, et
  -- le cast d'une valeur non numérique sortirait en 22P02 au lieu de ce refus.
  -- Calculé à part : dans un IF, PL/pgSQL couperait la condition au THEN du CASE.
  v_pax_invalide := CASE WHEN jsonb_typeof(p_updates->'pax') = 'number'
                         THEN (p_updates->>'pax')::numeric < 1
                           OR (p_updates->>'pax')::numeric > 100000
                           OR (p_updates->>'pax')::numeric <> trunc((p_updates->>'pax')::numeric)
                         ELSE true
                    END;
  IF p_updates ? 'pax' AND v_pax_invalide THEN
    RAISE EXCEPTION
      'PAX_INVALIDE: le nombre de convives doit être un entier de 1 à 100 000 (reçu %)', p_updates->'pax'
      USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE avec CASE WHEN pour honorer les mises à null explicites
  UPDATE plateforme.collectes c SET
    date_collecte = CASE WHEN p_updates ? 'date_collecte'
      THEN (p_updates->>'date_collecte')::date ELSE c.date_collecte END,
    heure_collecte = CASE WHEN p_updates ? 'heure_collecte'
      THEN (p_updates->>'heure_collecte')::time ELSE c.heure_collecte END,
    nb_camions_demande = CASE WHEN p_updates ? 'nb_camions_demande'
      THEN (p_updates->>'nb_camions_demande')::smallint ELSE c.nb_camions_demande END,
    pax = CASE WHEN p_updates ? 'pax'
      THEN (p_updates->>'pax')::integer ELSE c.pax END,
    controle_acces_requis = CASE WHEN p_updates ? 'controle_acces_requis'
      THEN (p_updates->>'controle_acces_requis')::boolean ELSE c.controle_acces_requis END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE c.notes_internes END,
    informations_supplementaires = CASE WHEN p_updates ? 'informations_supplementaires'
      THEN p_updates->>'informations_supplementaires' ELSE c.informations_supplementaires END,
    prestataire_logistique_id = CASE WHEN p_updates ? 'prestataire_logistique_id'
      THEN (p_updates->>'prestataire_logistique_id')::uuid ELSE c.prestataire_logistique_id END,
    motif_override_prestataire = CASE WHEN p_updates ? 'motif_override_prestataire'
      THEN p_updates->>'motif_override_prestataire' ELSE c.motif_override_prestataire END,
    statut = CASE WHEN p_updates ? 'statut'
      THEN (p_updates->>'statut')::plateforme.collecte_statut ELSE c.statut END,
    annulee_cote_savr = CASE WHEN p_updates ? 'annulee_cote_savr'
      THEN (p_updates->>'annulee_cote_savr')::boolean ELSE c.annulee_cote_savr END,
    annulee_cote_savr_motif = CASE WHEN p_updates ? 'annulee_cote_savr_motif'
      THEN p_updates->>'annulee_cote_savr_motif' ELSE c.annulee_cote_savr_motif END,
    lieu_overrides = CASE WHEN p_updates ? 'lieu_overrides'
      THEN p_updates->'lieu_overrides' ELSE c.lieu_overrides END,
    -- RM-09 : champs incident (flux collecte manquée / imputabilité §05 §4bis)
    incident_imputable_a = CASE WHEN p_updates ? 'incident_imputable_a'
      THEN (p_updates->>'incident_imputable_a')::plateforme.incident_imputable ELSE c.incident_imputable_a END,
    motif_incident = CASE WHEN p_updates ? 'motif_incident'
      THEN p_updates->>'motif_incident' ELSE c.motif_incident END,
    collecte_remplacee_id = CASE WHEN p_updates ? 'collecte_remplacee_id'
      THEN (p_updates->>'collecte_remplacee_id')::uuid ELSE c.collecte_remplacee_id END,
    updated_at = now()
  WHERE c.id = p_id
  RETURNING * INTO v_row;

  -- Gate E2 : « une commande existe deja chez le prestataire CIBLE ». Lu sous le
  -- verrou de l'agregat (pris en tete), et APRES l'UPDATE : le patch peut changer
  -- `prestataire_logistique_id`, auquel cas la question porte sur le nouveau.
  v_commandee := plateforme.fn_collecte_commandee_chez_provider(p_id);

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3).
  v_passe_annulee := (p_updates ? 'statut'
                      AND p_updates->>'statut' = 'annulee'
                      AND v_old_statut <> 'annulee');

  -- Outbox E2 si une commande existe chez le prestataire — jamais quand le patch
  -- pose statut='annulee' (E3 prend le relais — condition originale conservée),
  -- et jamais pour une collecte réalisée, réalisée sans collecte, clôturée ou
  -- annulée, avant OU après la modification (décision Val 2026-10-22, §05
  -- Cascade TMS, §08 Déclencheur E2) : une correction faite après coup reste
  -- interne à la plateforme.
  IF v_commandee
     AND NOT (p_updates ? 'statut' AND p_updates->>'statut' = 'annulee')
     AND v_old_statut NOT IN ('realisee', 'realisee_sans_collecte', 'cloturee', 'annulee')
     AND v_row.statut NOT IN ('realisee', 'realisee_sans_collecte', 'cloturee', 'annulee')
  THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.modifiee',
      jsonb_build_object(
        'collecte_id',    p_id,
        'champs_modifies', to_jsonb(p_champs_modifies)
      ),
      'adapter_mts1'
    );
  END IF;

  -- E3 collecte.annulee émise INLINE (pattern RPC, plus de trigger).
  IF v_passe_annulee THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.annulee',
      jsonb_build_object('collecte_id', p_id, 'type', v_row.type::text),
      'adapter_mts1'
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) TO service_role;
