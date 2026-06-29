-- =============================================================================
-- R9 — Concurrence outbox (cluster C7). Tickets BL-P1-OUTBOX-01/02 + BL-P2-35/36.
-- =============================================================================
-- 1. OUTBOX-02 — Head-of-line : un event 'dead' DOIT bloquer son agrégat.
--    La garde de claim utilisait `e2.statut NOT IN ('done','dead')` → un E1 mort
--    laissait passer E2/E3 du MÊME aggregate_id (sémantique INVERSE du CDC §08
--    §3bis « head-of-line blocking par collecte »). On bloque sur tout statut
--    `<> 'done'` (seul 'done' est non bloquant ; 'dead' bloque jusqu'à requeue/skip
--    via les RPC DLQ ci-dessous).
--    ⚠ CREATE OR REPLACE réinitialise search_path → on RÉ-INCLUT
--    `SET search_path` (durcissement posé en 20260622140000, sinon perdu).
--
-- 2. OUTBOX-36 — E3 collecte.annulee émis INLINE dans la RPC (pattern requis :
--    les events collecte viennent d'une RPC, jamais d'un trigger AFTER UPDATE).
--    On capte v_old_statut sous le row lock et on émet `collecte.annulee` quand
--    statut→annulee (miroir EXACT du trigger trg_collecte_annulee_e3, désormais
--    DROP). Tous les passages à 'annulee' transitent par fn_modifier_collecte
--    (vérifié : routes traiteur/agence/admin). Le trigger pack-debit reste.
--
-- 3. P2-35 — RLS pesees_tournees : pt_admin FOR ALL → FOR SELECT (l'admin lit,
--    n'écrit jamais en direct : l'écriture passe par l'adapter MTS-1 service_role
--    ou la saisie manuelle tracée cf_update_staff sur collecte_flux).
--
-- 4. OUTBOX-01 — 3 RPC de déblocage DLQ (requeue / skip motivé / resolve), toutes
--    SECURITY DEFINER, réservées admin_savr (via f_assert_audit_context : motif
--    >= 5 caractères + auteur admin_savr actif), tracées dans audit_log. Sans
--    elles, un event 'dead' bloque définitivement son agrégat (E1 dead → E3 jamais
--    poussée → camion sur collecte annulée).
-- =============================================================================

-- ─── 1. OUTBOX-02 : head-of-line bloque sur 'dead' ───────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_batch(
  p_limit integer DEFAULT 10,
  p_lease_duration interval DEFAULT interval '2 minutes'
)
RETURNS TABLE (
  id                      uuid,
  aggregate_type          text,
  aggregate_id            uuid,
  event_type              text,
  payload                 jsonb,
  consumer                text,
  attempts                integer,
  requires_reconciliation boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  WITH eligibles AS (
    SELECT e.id
    FROM plateforme.outbox_events e
    WHERE e.statut IN ('pending', 'failed')
      AND (e.next_retry_at IS NULL OR e.next_retry_at <= now())
      -- A3b : API bigint (cohérente avec la colonne txid).
      AND e.txid < txid_snapshot_xmin(txid_current_snapshot())
      AND NOT EXISTS (
        -- head-of-line blocking PAR collecte (aggregate_id) : un event antérieur
        -- NON 'done' bloque. OUTBOX-02 : 'dead' bloque AUSSI (seul 'done' libère)
        -- — sinon E2/E3 seraient poussés au-delà d'un E1 mort (sémantique CDC).
        SELECT 1
        FROM plateforme.outbox_events e2
        WHERE e2.aggregate_id = e.aggregate_id
          AND e2.seq < e.seq
          AND e2.statut <> 'done'
      )
    ORDER BY e.seq
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE plateforme.outbox_events oe
  SET
    statut        = 'processing',
    claimed_until = now() + p_lease_duration,
    attempts      = oe.attempts + 1   -- claim-before-POST (§04 l.2328) : conservé
  FROM eligibles
  WHERE oe.id = eligibles.id
  RETURNING
    oe.id,
    oe.aggregate_type,
    oe.aggregate_id,
    oe.event_type,
    oe.payload,
    oe.consumer,
    oe.attempts,
    oe.requires_reconciliation;
END;
$$;

-- ─── 2. OUTBOX-36 : E3 collecte.annulee émise inline (corps verbatim ─────────
--      20260623100000, seule la gestion annulation change) ────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_row           plateforme.collectes;
  v_tms_reference text;
  v_old_statut    plateforme.collecte_statut;
  v_passe_annulee boolean;
BEGIN
  -- Row lock + lecture tms_reference + statut courant (AVANT UPDATE et INSERT outbox)
  SELECT tms_reference, statut INTO v_tms_reference, v_old_statut
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

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3 :
  -- NEW.statut='annulee' AND OLD.statut != 'annulee').
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

  -- OUTBOX-36 : E3 collecte.annulee émise INLINE (pattern RPC, plus de trigger).
  -- Émise quel que soit tms_reference (E3 sans external_ref = no-op succès côté
  -- worker, consumer='noop_no_remote') — sémantique identique à l'ex-trigger.
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

-- OUTBOX-36 : retrait du pattern interdit (event collecte émis par trigger).
DROP TRIGGER IF EXISTS trg_collecte_annulee_e3 ON plateforme.collectes;
DROP FUNCTION IF EXISTS plateforme._fn_trg_outbox_collecte_annulee();

-- ─── 3. P2-35 : pesees_tournees pt_admin FOR ALL → FOR SELECT ────────────────
-- L'admin ne doit jamais écrire pesees_tournees en direct (contournement du
-- chemin tracé). Écriture = adapter MTS-1 (service_role, bypass RLS) ou saisie
-- manuelle escaladée via cf_update_staff (§06.06) sur collecte_flux.
DROP POLICY IF EXISTS pt_admin ON plateforme.pesees_tournees;
CREATE POLICY pt_admin ON plateforme.pesees_tournees AS PERMISSIVE FOR SELECT TO public
  USING (((plateforme.f_app_role()) = 'admin_savr'::text));

-- ─── 4. OUTBOX-01 : RPC de déblocage DLQ (requeue / skip / resolve) ──────────
-- Garde commune : auteur admin_savr actif + motif >= 5 caractères + event 'dead'.
-- (Réutilise f_assert_audit_context — précédent R3, pose les GUC savr.audit_*.)

-- Helper interne : valide auteur+motif, charge l'event 'dead' sous lock, renvoie
-- l'ancien statut. RAISE si l'event n'existe pas ou n'est pas 'dead'.
CREATE OR REPLACE FUNCTION plateforme._f_assert_outbox_dead(p_event_id uuid)
RETURNS plateforme.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_evt plateforme.outbox_events;
BEGIN
  SELECT * INTO v_evt FROM plateforme.outbox_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox event introuvable : %', p_event_id USING ERRCODE = 'P0002';
  END IF;
  IF v_evt.statut <> 'dead' THEN
    RAISE EXCEPTION 'event % non DLQ (statut=%) — seuls les events dead sont déblocables',
      p_event_id, v_evt.statut USING ERRCODE = '22023';
  END IF;
  RETURN v_evt;
END;
$$;

REVOKE ALL ON FUNCTION plateforme._f_assert_outbox_dead(uuid) FROM PUBLIC;

-- 4.1 — Re-queue : redonne une chance au worker. Réconciliation OBLIGATOIRE avant
-- tout re-POST (requires_reconciliation=true, §08 §3bis.9). attempts remis à 0
-- (cycle de retry complet redonné par décision admin explicite).
CREATE OR REPLACE FUNCTION plateforme.fn_admin_requeue_outbox(
  p_event_id uuid,
  p_auteur   uuid,
  p_motif    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_evt plateforme.outbox_events;
BEGIN
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_motif);
  v_evt := plateforme._f_assert_outbox_dead(p_event_id);

  UPDATE plateforme.outbox_events SET
    statut                  = 'pending',
    attempts                = 0,
    claimed_until           = NULL,
    next_retry_at           = NULL,
    requires_reconciliation = true,
    last_error              = NULL
  WHERE id = p_event_id;

  INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, old_values, new_values, motif)
  VALUES (p_auteur, 'admin_savr', 'outbox_requeue', 'outbox_events', p_event_id,
          jsonb_build_object('statut', v_evt.statut, 'attempts', v_evt.attempts),
          jsonb_build_object('statut', 'pending', 'requires_reconciliation', true),
          p_motif);

  RETURN jsonb_build_object('id', p_event_id, 'statut', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_admin_requeue_outbox(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_admin_requeue_outbox(uuid, uuid, text) TO service_role;

-- 4.2 — Skip motivé : abandonne l'event (jamais traité) → 'done' pour débloquer
-- l'agrégat (head-of-line). Réservé aux events devenus sans objet (ex : E1 mort
-- d'une collecte depuis annulée). Motif obligatoire (audit).
CREATE OR REPLACE FUNCTION plateforme.fn_admin_skip_outbox(
  p_event_id uuid,
  p_auteur   uuid,
  p_motif    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_evt plateforme.outbox_events;
BEGIN
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_motif);
  v_evt := plateforme._f_assert_outbox_dead(p_event_id);

  UPDATE plateforme.outbox_events SET
    statut        = 'done',
    claimed_until = NULL,
    processed_at  = now(),
    last_error    = 'SKIP admin: ' || p_motif
  WHERE id = p_event_id;

  INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, old_values, new_values, motif)
  VALUES (p_auteur, 'admin_savr', 'outbox_skip', 'outbox_events', p_event_id,
          jsonb_build_object('statut', v_evt.statut, 'attempts', v_evt.attempts),
          jsonb_build_object('statut', 'done'),
          p_motif);

  RETURN jsonb_build_object('id', p_event_id, 'statut', 'done');
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_admin_skip_outbox(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_admin_skip_outbox(uuid, uuid, text) TO service_role;

-- 4.3 — Résolution manuelle MTS-1 : l'admin a traité l'effet côté MTS-1 (création
-- manuelle de la commande, annulation par téléphone…) → marque 'done' (débloque
-- l'agrégat) en consignant que la résolution est externe.
CREATE OR REPLACE FUNCTION plateforme.fn_admin_resolve_outbox(
  p_event_id uuid,
  p_auteur   uuid,
  p_motif    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_evt plateforme.outbox_events;
BEGIN
  PERFORM plateforme.f_assert_audit_context(p_auteur, p_motif);
  v_evt := plateforme._f_assert_outbox_dead(p_event_id);

  UPDATE plateforme.outbox_events SET
    statut        = 'done',
    claimed_until = NULL,
    processed_at  = now(),
    consumer      = 'manual',
    last_error    = 'RESOLVE manuel MTS-1: ' || p_motif
  WHERE id = p_event_id;

  INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, old_values, new_values, motif)
  VALUES (p_auteur, 'admin_savr', 'outbox_resolve', 'outbox_events', p_event_id,
          jsonb_build_object('statut', v_evt.statut, 'attempts', v_evt.attempts, 'consumer', v_evt.consumer),
          jsonb_build_object('statut', 'done', 'consumer', 'manual'),
          p_motif);

  RETURN jsonb_build_object('id', p_event_id, 'statut', 'done');
END;
$$;

REVOKE ALL ON FUNCTION plateforme.fn_admin_resolve_outbox(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_admin_resolve_outbox(uuid, uuid, text) TO service_role;
