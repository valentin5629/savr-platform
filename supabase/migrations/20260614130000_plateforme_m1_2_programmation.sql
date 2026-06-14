-- =============================================================================
-- M1.2 — Formulaire programmation collecte
-- RPCs : fn_confirmer_programmation_brouillon, fn_ajouter_collecte_evenement
-- Seed  : email_templates → collecte_programmee (stub minimal)
-- =============================================================================

-- ─── RPC : fn_confirmer_programmation_brouillon ──────────────────────────────
-- Transitions toutes les collectes brouillon d'un événement → programmee.
-- Émet E1 outbox uniquement pour les collectes ZD (G4 TMS-Ready).
-- Row-lock sur evenements en tête (ordering intra-agrégat, CLAUDE.md R1).

CREATE OR REPLACE FUNCTION plateforme.fn_confirmer_programmation_brouillon(
  p_evenement_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    IF v_collecte.type = 'zero_dechet'::plateforme.collecte_type_enum THEN
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
$$;

-- Appelée uniquement via createAdminSupabaseClient (service role) — même pattern B1
REVOKE EXECUTE ON FUNCTION plateforme.fn_confirmer_programmation_brouillon(uuid) FROM PUBLIC;
ALTER FUNCTION plateforme.fn_confirmer_programmation_brouillon(uuid)
  SET search_path = plateforme, public;

-- ─── RPC : fn_ajouter_collecte_evenement ─────────────────────────────────────
-- Ajoute une collecte à un événement existant (bouton "Ajouter une collecte").
-- Délègue à fn_creer_collecte (qui gère E1 pour ZD).

CREATE OR REPLACE FUNCTION plateforme.fn_ajouter_collecte_evenement(
  p_evenement_id   uuid,
  p_type           text,
  p_date_collecte  date,
  p_heure_collecte time,
  p_controle_acces boolean DEFAULT false,
  p_info_suppl     text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_collecte_id uuid;
BEGIN
  -- Vérifie que l'événement existe et est éditable
  IF NOT plateforme.f_collecte_editable(p_evenement_id) THEN
    RAISE EXCEPTION 'Événement non éditable (statut terminal)';
  END IF;

  v_collecte_id := plateforme.fn_creer_collecte(
    p_evenement_id   := p_evenement_id,
    p_type           := p_type,
    p_date_collecte  := p_date_collecte,
    p_heure_collecte := p_heure_collecte,
    p_controle_acces := p_controle_acces,
    p_info_suppl     := p_info_suppl
  );

  RETURN v_collecte_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_ajouter_collecte_evenement(uuid, text, date, time, boolean, text) FROM PUBLIC;
ALTER FUNCTION plateforme.fn_ajouter_collecte_evenement(uuid, text, date, time, boolean, text)
  SET search_path = plateforme, public;

-- ─── Seed : email_templates → collecte_programmee (stub M1.2) ────────────────
-- Template minimal ; sera enrichi dans le module emails.

INSERT INTO plateforme.email_templates (
  code, sujet, corps_html, actif, created_at, updated_at
) VALUES (
  'collecte_programmee',
  'Votre collecte a été programmée — Savr',
  '<p>Bonjour,</p>
<p>Votre collecte du <strong>{{date_collecte}}</strong> pour l''événement <strong>{{nom_evenement}}</strong> a bien été enregistrée.</p>
<p>Notre équipe reviendra vers vous pour confirmer les modalités.</p>
<p>Cordialement,<br>L''équipe Savr</p>',
  true,
  now(),
  now()
)
ON CONFLICT (code) DO NOTHING;
