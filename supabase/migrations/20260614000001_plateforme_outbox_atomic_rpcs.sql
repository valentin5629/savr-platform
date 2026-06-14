-- =============================================================================
-- Fonctions atomiques outbox G4 TMS-Ready
-- =============================================================================
-- Garantit que chaque mutation métier écrit son event outbox DANS LA MÊME
-- TRANSACTION (pas de perte si la seconde requête Supabase JS échoue).
--
-- E1 collecte.creee   → fn_creer_collecte()     (RPC métier)
-- E2 collecte.modifiee → fn_dispatcher_collecte() + fn_modifier_collecte() (RPC)
-- E3 collecte.annulee → trigger trg_collecte_annulee_e3 (state-change auto)
-- E5 lieu.champ_critique_modifie → trigger trg_lieu_champ_critique_e5
--
-- Helpers pgTAP : tests.outbox_fixture_collecte() + tests.outbox_fixture_lieu()
-- → activent le test G4 dormant (outbox_par_mutation.test.sql)
-- =============================================================================

-- ─── E1 : fn_creer_collecte ──────────────────────────────────────────────────

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
  -- Volume estimé repas pour AG (0,1 × pax de l'événement)
  IF p_type = 'ag' THEN
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

  -- INSERT outbox E1 (même transaction → atomique)
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

  RETURN v_collecte_id;
END;
$$;

-- ─── E1/E2 : fn_dispatcher_collecte ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION plateforme.fn_dispatcher_collecte(
  p_id                        uuid,
  p_prestataire_logistique_id uuid   DEFAULT NULL,
  p_motif_override            text   DEFAULT NULL
) RETURNS text   -- 'collecte.creee' | 'collecte.modifiee'
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tms_reference text;
  v_event_type    text;
BEGIN
  -- Row lock AVANT INSERT outbox (CLAUDE.md R1 — garantit ordering intra-agrégat)
  SELECT tms_reference INTO v_tms_reference
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  v_event_type := CASE
    WHEN v_tms_reference IS NOT NULL THEN 'collecte.modifiee'
    ELSE 'collecte.creee'
  END;

  -- UPDATE collecte (reset dirty_tms + override optionnel prestataire)
  UPDATE plateforme.collectes
  SET
    dirty_tms                  = false,
    updated_at                 = now(),
    prestataire_logistique_id  = COALESCE(p_prestataire_logistique_id, prestataire_logistique_id),
    motif_override_prestataire = COALESCE(p_motif_override, motif_override_prestataire)
  WHERE id = p_id;

  -- INSERT outbox (même transaction → atomique)
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    p_id,
    v_event_type,
    jsonb_build_object(
      'collecte_id',               p_id,
      'dispatch_manuel',           true,
      'prestataire_logistique_id', p_prestataire_logistique_id
    ),
    'adapter_mts1'
  );

  RETURN v_event_type;
END;
$$;

-- ─── E2 conditionnel : fn_modifier_collecte ──────────────────────────────────
-- Applique un patch JSONB sur une collecte et émet E2 si tms_reference non null.
-- Stratégie CASE WHEN p_updates ? 'champ' pour traiter les mises à null explicites.

CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(
  p_id              uuid,
  p_updates         jsonb,
  p_champs_modifies text[]
) RETURNS jsonb   -- collecte mise à jour (to_jsonb)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row           plateforme.collectes;
  v_tms_reference text;
BEGIN
  -- Row lock + lecture tms_reference (AVANT UPDATE et INSERT outbox)
  SELECT tms_reference INTO v_tms_reference
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
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
      THEN (p_updates->>'statut')::plateforme.collecte_statut_enum ELSE c.statut END,
    annulee_cote_savr = CASE WHEN p_updates ? 'annulee_cote_savr'
      THEN (p_updates->>'annulee_cote_savr')::boolean ELSE c.annulee_cote_savr END,
    annulee_cote_savr_motif = CASE WHEN p_updates ? 'annulee_cote_savr_motif'
      THEN p_updates->>'annulee_cote_savr_motif' ELSE c.annulee_cote_savr_motif END,
    lieu_overrides = CASE WHEN p_updates ? 'lieu_overrides'
      THEN p_updates->'lieu_overrides' ELSE c.lieu_overrides END,
    updated_at = now()
  WHERE c.id = p_id
  RETURNING * INTO v_row;

  -- Outbox E2 si déjà envoyée à MTS-1 (tms_reference not null)
  -- Ne pas émettre si statut vient de passer à 'annulee' (E3 géré par trigger)
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

  RETURN to_jsonb(v_row);
END;
$$;

-- ─── E3 : trigger collecte.annulee ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION plateforme._fn_trg_outbox_collecte_annulee()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    NEW.id,
    'collecte.annulee',
    jsonb_build_object('collecte_id', NEW.id, 'type', NEW.type::text),
    'adapter_mts1'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collecte_annulee_e3 ON plateforme.collectes;
CREATE TRIGGER trg_collecte_annulee_e3
  AFTER UPDATE ON plateforme.collectes
  FOR EACH ROW
  WHEN (NEW.statut = 'annulee' AND OLD.statut != 'annulee')
  EXECUTE FUNCTION plateforme._fn_trg_outbox_collecte_annulee();

-- ─── E5 : trigger lieu.champ_critique_modifie ────────────────────────────────
-- Champs critiques = adresse_acces, ville, latitude, longitude,
--                    type_vehicule_max, contraintes_horaires, flux_autorises.

CREATE OR REPLACE FUNCTION plateforme._fn_trg_outbox_lieu_critique()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'lieu',
    NEW.id,
    'lieu.champ_critique_modifie',
    jsonb_build_object('lieu_id', NEW.id, 'ville', NEW.ville),
    'adapter_mts1'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lieu_champ_critique_e5 ON plateforme.lieux;
CREATE TRIGGER trg_lieu_champ_critique_e5
  AFTER UPDATE ON plateforme.lieux
  FOR EACH ROW
  WHEN (
    NEW.adresse_acces        IS DISTINCT FROM OLD.adresse_acces     OR
    NEW.ville                IS DISTINCT FROM OLD.ville              OR
    NEW.latitude             IS DISTINCT FROM OLD.latitude           OR
    NEW.longitude            IS DISTINCT FROM OLD.longitude          OR
    NEW.type_vehicule_max    IS DISTINCT FROM OLD.type_vehicule_max  OR
    NEW.contraintes_horaires IS DISTINCT FROM OLD.contraintes_horaires OR
    NEW.flux_autorises       IS DISTINCT FROM OLD.flux_autorises
  )
  EXECUTE FUNCTION plateforme._fn_trg_outbox_lieu_critique();

-- ─── Helpers pgTAP (activent G4) ─────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS tests;

CREATE OR REPLACE FUNCTION tests.outbox_fixture_collecte(p_type text DEFAULT 'zd')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_org_id        uuid := gen_random_uuid();
  v_lieu_id       uuid;
  v_presta_id     uuid;
  v_evt_id        uuid;
  v_collecte_id   uuid;
BEGIN
  -- Organisation minimale
  INSERT INTO plateforme.organisations (id, nom, type, siret, created_at, updated_at)
  VALUES (v_org_id, 'FixtureOrg-G4', 'traiteur', '00000000000001', now(), now());

  -- Lieu minimal
  INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, created_at, updated_at)
  VALUES ('FixtureLieu-G4', '1 rue Test', '75001', 'Paris', 'fourgon', now(), now())
  RETURNING id INTO v_lieu_id;

  -- Événement minimal
  INSERT INTO plateforme.evenements (organisation_id, lieu_id, nom_evenement, pax, created_at, updated_at)
  VALUES (v_org_id, v_lieu_id, 'FixtureEvenement-G4', 100, now(), now())
  RETURNING id INTO v_evt_id;

  -- Création collecte via RPC (émet E1 atomiquement)
  v_collecte_id := plateforme.fn_creer_collecte(
    p_evenement_id   := v_evt_id,
    p_type           := p_type,
    p_date_collecte  := CURRENT_DATE + 30,
    p_heure_collecte := '09:00'::time
  );

  -- Simulation : tms_reference posée manuellement pour E2/E3
  UPDATE plateforme.collectes SET tms_reference = 'FIXTURE-REF-001' WHERE id = v_collecte_id;

  -- Dispatch (émet E2) — setup complet pour le test E2
  PERFORM plateforme.fn_dispatcher_collecte(p_id := v_collecte_id);

  RETURN v_collecte_id;
END;
$$;

CREATE OR REPLACE FUNCTION tests.outbox_fixture_lieu()
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_lieu_id uuid;
BEGIN
  INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, created_at, updated_at)
  VALUES ('FixtureLieu-E5', '1 avenue Fixture', '69001', 'Lyon', 'camion_20m3', now(), now())
  RETURNING id INTO v_lieu_id;
  RETURN v_lieu_id;
END;
$$;
