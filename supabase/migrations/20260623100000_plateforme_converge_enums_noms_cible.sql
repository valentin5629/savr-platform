-- Convergence G1 (Frontière TMS-Ready) — noms des types ENUM V1 vers le DDL cible V2.
-- Ces types avaient été créés avec un suffixe `_enum` que la cible figée
-- (specs/ddl-cible/schema_cible_v2.sql) n'utilise pas. Ici on ne touche QUE le NOM :
-- valeurs et structure inchangées (cluster valeurs/structure traité hors lot).
--
-- ALTER TYPE … RENAME TO est transactionnel (contrairement à ADD VALUE) : les 24 renames
-- sont commutatifs et tiennent dans une seule migration. Les colonnes/fonctions/RPC qui
-- référencent ces types le font par OID → mise à jour automatique, aucun downtime runtime.
-- Les références TEXTUELLES (casts pgTAP, commentaires) sont corrigées dans le même PR.
--
-- Les migrations historiques (CREATE TYPE / ADD VALUE) conservent les anciens noms : elles
-- s'exécutent AVANT cette migration sur une base fraîche, donc restent valides. NE PAS les éditer.
--
-- Hors lot — conservés tels quels (déjà conformes à la cible) : mode_facturation_zd_enum.
-- Hors lot — différés (valeurs/type divergents en plus du nom) : email_statut_enum,
--   facture_statut_enum, pack_statut_enum, outbox_statut_enum, job_statut_enum,
--   serie_facturation_enum, document_statut_enum.

-- Bloc 1 — orgs / users (+ shared)
ALTER TYPE shared.storage_provider_enum            RENAME TO storage_provider;
ALTER TYPE plateforme.organisation_type_enum       RENAME TO organisation_type;
ALTER TYPE plateforme.user_role_enum               RENAME TO user_role;
ALTER TYPE plateforme.siret_verification_enum      RENAME TO statut_verification_siret;
ALTER TYPE plateforme.tva_verification_enum        RENAME TO statut_verification_tva;
ALTER TYPE plateforme.mode_paiement_enum           RENAME TO mode_paiement;

-- Bloc 2 — référentiel
ALTER TYPE plateforme.region_enum                  RENAME TO region;
ALTER TYPE plateforme.difficulte_acces_enum        RENAME TO acces_difficulte;
ALTER TYPE plateforme.type_vehicule_enum           RENAME TO type_vehicule;
ALTER TYPE plateforme.tournee_creneau_enum         RENAME TO creneau;
ALTER TYPE plateforme.tournee_statut_enum          RENAME TO tournee_statut;
ALTER TYPE plateforme.tarif_negocie_activite_enum  RENAME TO activite_remise;
ALTER TYPE plateforme.tarif_negocie_scope_enum     RENAME TO scope_remise;
ALTER TYPE plateforme.flux_unite_enum              RENAME TO unite_mesure;
ALTER TYPE plateforme.flux_filiere_enum            RENAME TO filiere_valorisation;

-- Bloc 3 — paramètres / associations / transporteurs
ALTER TYPE plateforme.code_filiere_recyclage_enum  RENAME TO code_filiere;
ALTER TYPE plateforme.code_flux_co2_enum           RENAME TO code_flux;
ALTER TYPE plateforme.code_materiau_emballage_enum RENAME TO code_materiau;
ALTER TYPE plateforme.type_tms_enum                RENAME TO type_tms;

-- Bloc 4 — opérationnel
ALTER TYPE plateforme.collecte_type_enum               RENAME TO collecte_type;
ALTER TYPE plateforme.collecte_statut_enum             RENAME TO collecte_statut;
ALTER TYPE plateforme.statut_tms_enum                  RENAME TO collecte_statut_tms;
ALTER TYPE plateforme.incident_imputable_enum          RENAME TO incident_imputable;
ALTER TYPE plateforme.attribution_mode_validation_enum RENAME TO mode_validation;

-- ---------------------------------------------------------------------------
-- Corps de fonctions PL/pgSQL référençant les types renommés.
-- ⚠ Contrairement aux colonnes / arguments / contraintes / vues (suivis par OID),
-- le CORPS d'une fonction PL/pgSQL est stocké en TEXTE et re-parsé à l'exécution :
-- un RENAME de type n'y est PAS répercuté → toute mention textuelle de l'ancien nom
-- casse à l'exécution. Seuls `collecte_type_enum` / `collecte_statut_enum` apparaissent
-- dans des corps de fonctions (les 22 autres types renommés ne sont utilisés que comme
-- types de colonnes/arguments, donc OID-safe). Ci-dessous : CREATE OR REPLACE des 3
-- fonctions concernées, copie VERBATIM de la définition live, seuls les noms de types
-- substitués (collecte_type_enum→collecte_type, collecte_statut_enum→collecte_statut).
-- (fn_agreger_terminal_collecte n'est PAS recréée : l'ancien nom n'y figure que dans un
--  commentaire — aucun impact runtime, laissé tel quel comme les migrations historiques.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plateforme.fn_confirmer_programmation_brouillon(p_evenement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_collecte RECORD;
BEGIN
  -- Lock agrégat AVANT toute écriture (ordering seq + concurrence-safe)
  PERFORM id FROM plateforme.evenements WHERE id = p_evenement_id FOR UPDATE;

  FOR v_collecte IN (
    SELECT id, type, date_collecte
    FROM plateforme.collectes
    WHERE evenement_id = p_evenement_id
      AND statut = 'brouillon'
  ) LOOP
    UPDATE plateforme.collectes
    SET statut = 'programmee'
    WHERE id = v_collecte.id;

    -- E1 pour ZD uniquement
    IF v_collecte.type = 'zero_dechet'::plateforme.collecte_type THEN
      INSERT INTO plateforme.outbox_events (
        aggregate_type, aggregate_id, event_type, payload, consumer
      ) VALUES (
        'collecte',
        v_collecte.id,
        'collecte.creee',
        jsonb_build_object(
          'collecte_id',   v_collecte.id,
          'type',          v_collecte.type::text,
          'date_collecte', v_collecte.date_collecte,
          'evenement_id',  p_evenement_id
        ),
        'adapter_mts1'
      );
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION plateforme.fn_creer_collecte(p_evenement_id uuid, p_type text, p_date_collecte date, p_heure_collecte time without time zone, p_nb_camions smallint DEFAULT 1, p_controle_acces boolean DEFAULT false, p_notes text DEFAULT NULL::text, p_info_suppl text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_collecte_id    uuid;
  v_pax            integer;
  v_volume_estime  integer := NULL;
  v_type_enum      plateforme.collecte_type;
BEGIN
  -- Normalisation alias courts → valeurs de l'enum (conservée depuis 20260614000004)
  v_type_enum := CASE p_type
    WHEN 'zd'  THEN 'zero_dechet'::plateforme.collecte_type
    WHEN 'ag'  THEN 'anti_gaspi'::plateforme.collecte_type
    ELSE p_type::plateforme.collecte_type
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

  -- E1 uniquement pour ZD (AG reste non_envoye jusqu'à attribution Admin, module M1.4)
  IF v_type_enum = 'zero_dechet' THEN
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
  END IF;

  RETURN v_collecte_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
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
      THEN (p_updates->>'statut')::plateforme.collecte_statut ELSE c.statut END,
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
$function$
;

