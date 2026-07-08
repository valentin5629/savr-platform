-- =============================================================================
-- R12b — Formulaire de programmation (BL-P1-PROG-01 + BL-P1-PROG-03)
-- =============================================================================
-- PROG-03 (E1 payload incomplet, CDC §06.01 l.396 + §08 l.68) : le payload de
-- l'event outbox `collecte.creee` (E1) émis à la programmation ne portait que
-- {collecte_id, type, date_collecte[, evenement_id]}. Le contrat E1 (gelé cible
-- V2, garde-fou 2) exige `controle_acces_requis` + `informations_supplementaires`.
-- PROG-01 (override lieu, CDC §06.01 l.108-110) : la valeur `lieu_overrides` doit
-- être « transmise au TMS via E1 » — donc présente dans le payload, émis dans la
-- MÊME transaction que la création (l'ancien chemin l'écrivait par un UPDATE
-- séparé APRÈS l'INSERT outbox, donc jamais dans E1).
--
-- Cette migration enrichit le payload E1 des DEUX fonctions émettrices
-- (fn_creer_collecte, fn_confirmer_programmation_brouillon) et ajoute le paramètre
-- `p_lieu_overrides` à fn_creer_collecte pour que l'override soit écrit sur la
-- ligne ET dans le payload de façon atomique.
--
-- ⚠ CREATE OR REPLACE réinitialise search_path → SET search_path ré-inclus inline
--   sur chaque fonction (durcissement CWE-426, cf. 20260614000002).
-- ⚠ Signature de fn_creer_collecte modifiée (ajout p_lieu_overrides) → DROP + CREATE
--   (CREATE OR REPLACE ne peut pas changer la signature). REVOKE EXECUTE FROM PUBLIC
--   ré-appliqué sur la nouvelle signature (seul le service_role l'invoque).
-- Enrichissement additif du payload : `collecte_id` reste la seule clé porteuse
--   consommée par l'outbox-worker (re-fetch DB) — aucune clé existante retirée.
-- =============================================================================

-- ─── PROG-01 + PROG-03 : fn_creer_collecte (signature étendue) ────────────────

DROP FUNCTION IF EXISTS plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text
);

CREATE FUNCTION plateforme.fn_creer_collecte(
  p_evenement_id uuid,
  p_type text,
  p_date_collecte date,
  p_heure_collecte time without time zone,
  p_nb_camions smallint DEFAULT 1,
  p_controle_acces boolean DEFAULT false,
  p_notes text DEFAULT NULL::text,
  p_info_suppl text DEFAULT NULL::text,
  p_lieu_overrides jsonb DEFAULT NULL::jsonb
)
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
    informations_supplementaires, lieu_overrides, volume_estime_repas,
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
    p_lieu_overrides,
    v_volume_estime,
    'programmee',
    'non_envoye'
  ) RETURNING id INTO v_collecte_id;

  -- E1 uniquement pour ZD (AG reste non_envoye jusqu'à attribution Admin, module M1.4).
  -- Payload enrichi (PROG-03/PROG-01) : controle_acces_requis + informations_supplementaires
  -- + lieu_overrides, en plus des clés historiques. Contrat E1 §08 l.68 / §06.01 l.396+l.110.
  IF v_type_enum = 'zero_dechet' THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      v_collecte_id,
      'collecte.creee',
      jsonb_build_object(
        'collecte_id',                 v_collecte_id,
        'type',                        v_type_enum::text,
        'date_collecte',               p_date_collecte,
        'controle_acces_requis',       p_controle_acces,
        'informations_supplementaires', p_info_suppl,
        'lieu_overrides',              p_lieu_overrides
      ),
      'adapter_mts1'
    );
  END IF;

  RETURN v_collecte_id;
END;
$function$
;

-- Le service_role (superuser, routes Next.js) est le seul appelant autorisé.
REVOKE EXECUTE ON FUNCTION plateforme.fn_creer_collecte(
  uuid, text, date, time, smallint, boolean, text, text, jsonb
) FROM PUBLIC;

-- ─── PROG-03 : fn_confirmer_programmation_brouillon (payload enrichi) ─────────

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
    SELECT id, type, date_collecte,
           controle_acces_requis, informations_supplementaires, lieu_overrides
    FROM plateforme.collectes
    WHERE evenement_id = p_evenement_id
      AND statut = 'brouillon'
  ) LOOP
    UPDATE plateforme.collectes
    SET statut = 'programmee'
    WHERE id = v_collecte.id;

    -- E1 pour ZD uniquement — payload enrichi (PROG-03/PROG-01), cf. fn_creer_collecte.
    IF v_collecte.type = 'zero_dechet'::plateforme.collecte_type THEN
      INSERT INTO plateforme.outbox_events (
        aggregate_type, aggregate_id, event_type, payload, consumer
      ) VALUES (
        'collecte',
        v_collecte.id,
        'collecte.creee',
        jsonb_build_object(
          'collecte_id',                 v_collecte.id,
          'type',                        v_collecte.type::text,
          'date_collecte',               v_collecte.date_collecte,
          'evenement_id',                p_evenement_id,
          'controle_acces_requis',       v_collecte.controle_acces_requis,
          'informations_supplementaires', v_collecte.informations_supplementaires,
          'lieu_overrides',              v_collecte.lieu_overrides
        ),
        'adapter_mts1'
      );
    END IF;
  END LOOP;
END;
$function$
;

-- ─── PROG-04 : enrichissement du template `collecte_programmee` (tarif ZD) ────
-- Le seed d'origine (20260614130000, ON CONFLICT DO NOTHING) n'interpolait que
-- {{nom_evenement}} + {{date_collecte}}. CDC §06.01 l.180 : le tarif ZD calculé
-- en backend est communiqué dans l'email récap. UPDATE explicite (le ré-INSERT
-- ON CONFLICT DO NOTHING ne mettrait pas à jour un env déjà seedé).
UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour,</p>
<p>Votre collecte pour l'événement « {{nom_evenement}} » a bien été programmée pour le {{date_collecte}}.</p>
<p>{{tarif_ligne}}</p>
<p>Vous retrouverez le détail dans votre espace Savr.</p>
<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['nom_evenement', 'date_collecte', 'tarif_ligne']::text[]
WHERE code = 'collecte_programmee';
