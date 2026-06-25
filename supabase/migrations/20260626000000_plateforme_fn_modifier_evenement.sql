-- =============================================================================
-- M1.2 / M1.5a — Édition des champs ÉVÉNEMENT par les rôles programmateurs
-- + émission E2 (collecte.modifiee) par collecte concernée.
-- =============================================================================
-- Décision produit Val 2026-06-26 : TOUS les rôles programmateurs (traiteur_manager,
-- traiteur_commercial, agence, gestionnaire_lieux) éditent les champs métier de
-- l'événement ET de la collecte sur la fenêtre brouillon/programmee/validee
-- (verrou dès en_cours). Source CDC : §06.04 (l.444 « tous les champs métier de la
-- collecte et de l'événement parent »), §06.05/§06.11 (parité), §05 §4 (fenêtre +
-- champs verrouillés type_collecte/lieu_id), §08 (E2 catch-all = champs événement
-- inclus, contacts ← evenements.contact_*, nb_pax ← evenements.pax).
--
-- Symétrie avec fn_modifier_collecte (20260623100000) : SECURITY DEFINER, row lock
-- de l'AGRÉGAT (collecte) AVANT l'INSERT outbox (garde-fou 4 / R1 transactional
-- outbox), search_path figé, REVOKE PUBLIC (appelée via service_role par la route).
--
-- Différence clé : une mutation d'événement peut concerner N collectes → on émet
-- UN E2 PAR COLLECTE déjà dispatchée (tms_reference IS NOT NULL), dans la même
-- transaction. Push silencieux côté TMS (§05 l.323 : pax/contacts = modifs mineures,
-- pas de réacceptation prestataire — aucun changement de `statut` collecte ici).
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_modifier_evenement(
  p_id              uuid,
  p_updates         jsonb,
  p_champs_modifies text[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_evt          plateforme.evenements;
  v_pax_modifie  boolean;
  v_tms_pertinent boolean;
  v_c            record;
BEGIN
  -- ── 1. UPDATE événement (whitelist via CASE WHEN — honore les mises à null) ──
  -- lieu_id et type_evenement n'incluent PAS lieu_id verrouillé (§05 l.314 / §06.04
  -- l.459) : changer le lieu = annuler + reprogrammer. organisation_id /
  -- traiteur_operationnel / entite_facturation : immuables (jamais exposés).
  -- lieu_id / date_evenement : exposés UNIQUEMENT au back-office Admin (route
  -- admin/evenements). La route programmation/ bloque lieu_id (EVENT_LOCKED_FIELDS).
  -- lieu_id n'est PAS dans le set TMS-pertinent → un changement de lieu n'émet jamais
  -- de PATCH lieu_id (interdit §08 l.158 ; flux normal = annuler + reprogrammer).
  UPDATE plateforme.evenements e SET
    nom_evenement = CASE WHEN p_updates ? 'nom_evenement'
      THEN p_updates->>'nom_evenement' ELSE e.nom_evenement END,
    lieu_id = CASE WHEN p_updates ? 'lieu_id'
      THEN (p_updates->>'lieu_id')::uuid ELSE e.lieu_id END,
    date_evenement = CASE WHEN p_updates ? 'date_evenement'
      THEN (p_updates->>'date_evenement')::date ELSE e.date_evenement END,
    pax = CASE WHEN p_updates ? 'pax'
      THEN (p_updates->>'pax')::integer ELSE e.pax END,
    type_evenement_id = CASE WHEN p_updates ? 'type_evenement_id'
      THEN (p_updates->>'type_evenement_id')::uuid ELSE e.type_evenement_id END,
    contact_principal_nom = CASE WHEN p_updates ? 'contact_principal_nom'
      THEN p_updates->>'contact_principal_nom' ELSE e.contact_principal_nom END,
    contact_principal_telephone = CASE WHEN p_updates ? 'contact_principal_telephone'
      THEN p_updates->>'contact_principal_telephone' ELSE e.contact_principal_telephone END,
    contact_secours_nom = CASE WHEN p_updates ? 'contact_secours_nom'
      THEN p_updates->>'contact_secours_nom' ELSE e.contact_secours_nom END,
    contact_secours_telephone = CASE WHEN p_updates ? 'contact_secours_telephone'
      THEN p_updates->>'contact_secours_telephone' ELSE e.contact_secours_telephone END,
    nom_client_organisateur = CASE WHEN p_updates ? 'nom_client_organisateur'
      THEN p_updates->>'nom_client_organisateur' ELSE e.nom_client_organisateur END,
    logo_client_organisateur_url = CASE WHEN p_updates ? 'logo_client_organisateur_url'
      THEN p_updates->>'logo_client_organisateur_url' ELSE e.logo_client_organisateur_url END,
    client_organisateur_organisation_id = CASE WHEN p_updates ? 'client_organisateur_organisation_id'
      THEN (p_updates->>'client_organisateur_organisation_id')::uuid ELSE e.client_organisateur_organisation_id END,
    reference_affaire = CASE WHEN p_updates ? 'reference_affaire'
      THEN p_updates->>'reference_affaire' ELSE e.reference_affaire END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE e.notes_internes END,
    updated_at = now()
  WHERE e.id = p_id
  RETURNING * INTO v_evt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evenement_introuvable' USING ERRCODE = 'P0002';
  END IF;

  v_pax_modifie := p_updates ? 'pax';

  -- TMS ne persiste de l'événement que : contacts + nb_pax (§08 l.156/l.411). Les
  -- autres champs (nom, type d'événement, notes, référence affaire) sont diffés mais
  -- ignorés côté TMS → inutile de réveiller l'outbox pour eux.
  v_tms_pertinent := p_champs_modifies && ARRAY[
    'contact_principal_nom', 'contact_principal_telephone',
    'contact_secours_nom', 'contact_secours_telephone', 'pax'
  ]::text[];

  -- ── 2. Par collecte ÉDITABLE de l'événement (fenêtre §05 l.305 = programmee/validee)
  -- lock (FOR UPDATE) AVANT toute écriture/INSERT outbox → ordering seq intra-agrégat.
  FOR v_c IN
    SELECT id, type, tms_reference
    FROM plateforme.collectes
    WHERE evenement_id = p_id
      AND statut IN ('programmee', 'validee')
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Recalcul volume_estime_repas si pax modifié : le trigger BEFORE UPDATE
    -- fn_set_volume_estime_repas relit evenements.pax (AG non terminale uniquement).
    IF v_pax_modifie THEN
      UPDATE plateforme.collectes SET updated_at = now() WHERE id = v_c.id;
    END IF;

    -- E2 collecte.modifiee si déjà transmise au TMS ET champ TMS-pertinent changé.
    IF v_c.tms_reference IS NOT NULL AND v_tms_pertinent THEN
      INSERT INTO plateforme.outbox_events (
        aggregate_type, aggregate_id, event_type, payload, consumer
      ) VALUES (
        'collecte',
        v_c.id,
        'collecte.modifiee',
        jsonb_build_object(
          'collecte_id',     v_c.id,
          'champs_modifies', to_jsonb(p_champs_modifies),
          'source',          'evenement'
        ),
        'adapter_mts1'
      );
    END IF;
  END LOOP;

  RETURN to_jsonb(v_evt);
END;
$function$
;

-- ── Durcissement sécurité (miroir fn_modifier_collecte, B2 search_path + REVOKE) ──
REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) TO service_role;
