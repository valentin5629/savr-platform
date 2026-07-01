-- =============================================================================
-- R16a (BL-P1-RM-02 + RM-05 + RM-09) — Gardes machine à états sur fn_modifier_collecte.
-- =============================================================================
-- Corps de base : DERNIÈRE def = 20260629100000 (R9, émission inline E2/E3). On la
-- reproduit VERBATIM en ajoutant 3 choses SOUS le row lock (jamais de régression) :
--
--  RM-02 — Garde statut sur `nb_camions_demande` : la RPC Ops de changement de N
--     exige `statut IN (programmee, validee, en_cours)` (CLAUDE.md §4 + §05 l.271 :
--     « interdit dès realisee — jamais de régression d'un état terminal »). Avant,
--     nb_camions_demande était posé sans garde → une modif sur realisee/cloturee
--     aurait perdu des pesées.
--
--  RM-05 — Garde fenêtre <1h sur RÉDUCTION de N : réduire le nombre de camions à
--     moins d'1h de la mission → RAISE `REDUCTION_CANCEL_WINDOW_CLOSED` (l'API
--     lève une alerte Ops et n'exécute aucun DELETE côté adapter). L'augmentation
--     reste permise (ajouter de la capacité last-minute est sûr). Fuseau métier
--     Europe/Paris (cohérent avec le trigger pack-debit, bug E2).
--
--  RM-09 — Champs incident dans le CASE WHEN : `incident_imputable_a`,
--     `motif_incident`, `collecte_remplacee_id` deviennent posables par la RPC →
--     supporte le flux incident (statut=annulee + imputabilité, §05 §4bis). Posés
--     dans le MÊME UPDATE que statut=annulee → le trigger pack-debit (RM-09) voit
--     NEW.incident_imputable_a et saute le débit si ≠ client.
--
-- ⚠ CREATE OR REPLACE réinitialise search_path → on RÉ-INCLUT `SET search_path`.
-- Émission E2/E3 STRICTEMENT identique à R9 (seules les gardes + champs changent).
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
-- Ré-appliquer le corps de fn_modifier_collecte tel qu'AVANT R16a, c.-à-d. le
-- CREATE OR REPLACE de 20260629100000_plateforme_r9_outbox_concurrence.sql (même
-- signature, sans les gardes RM-02/RM-05 ni les 3 champs incident) :
--   psql -f supabase/migrations/20260629100000_plateforme_r9_outbox_concurrence.sql
-- Effet : les gardes N + le flux incident (écriture incident_imputable_a/motif_incident)
-- sont désactivés ; l'émission E2/E3 est identique. Aucune donnée perdue (colonnes
-- incident déjà présentes depuis bloc4). CREATE OR REPLACE = non destructif.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_row            plateforme.collectes;
  v_tms_reference  text;
  v_old_statut     plateforme.collecte_statut;
  v_old_nb_camions smallint;
  v_old_date       date;
  v_old_heure      time;
  v_new_nb_camions smallint;
  v_passe_annulee  boolean;
BEGIN
  -- Row lock + lecture de l'état courant (AVANT UPDATE et INSERT outbox). On lit
  -- aussi nb_camions_demande + date/heure pour les gardes RM-02/RM-05 sous le verrou.
  SELECT tms_reference, statut, nb_camions_demande, date_collecte, heure_collecte
  INTO   v_tms_reference, v_old_statut, v_old_nb_camions, v_old_date, v_old_heure
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

  -- UPDATE avec CASE WHEN pour honorer les mises à null explicites
  UPDATE plateforme.collectes c SET
    date_collecte = CASE WHEN p_updates ? 'date_collecte'
      THEN (p_updates->>'date_collecte')::date ELSE c.date_collecte END,
    heure_collecte = CASE WHEN p_updates ? 'heure_collecte'
      THEN (p_updates->>'heure_collecte')::time ELSE c.heure_collecte END,
    nb_camions_demande = CASE WHEN p_updates ? 'nb_camions_demande'
      THEN (p_updates->>'nb_camions_demande')::smallint ELSE c.nb_camions_demande END,
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

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3).
  v_passe_annulee := (p_updates ? 'statut'
                      AND p_updates->>'statut' = 'annulee'
                      AND v_old_statut <> 'annulee');

  -- Outbox E2 si déjà envoyée à MTS-1 (tms_reference not null) — jamais quand le
  -- patch pose statut='annulee' (E3 prend le relais — condition originale conservée).
  IF v_tms_reference IS NOT NULL
     AND NOT (p_updates ? 'statut' AND p_updates->>'statut' = 'annulee')
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
