-- =============================================================================
-- Réattribution d'une collecte rejetée par le transporteur → retour `programmee`.
-- =============================================================================
-- SOURCE. §08 §3 V1 / §3bis.6 et §05 R_statut_collecte_multi_tournees : un refus
-- du transporteur pose `statut_tms` ET `collectes.statut` = rejetee_par_prestataire
-- (visibilité dashboard, décision Val 2026-06-15), retour file « Ops-driven ».
-- Arbitrage Val 2026-09-17 : la réattribution Ops remet la collecte en
-- `programmee` ; elle reprend alors le parcours normal.
--
-- DÉFAUT CORRIGÉ. Aucune fonction ne sortait une collecte de ce statut. Mesuré sur
-- la base locale (transaction annulée) : collecte rejetee_par_prestataire →
-- fn_dispatcher_collecte → statut inchangé ; nouveau transporteur `acceptee` → le
-- trigger fn_sync ne dérive `validee` que depuis `programmee` → inchangé ; tous
-- les tours terminés → fn_agreger_terminal_collecte renvoie 'realisee' mais
-- n'écrit rien (garde `statut IN (programmee, validee, en_cours)`). Ni
-- `realisee_at`, ni bordereau, ni attestation, ni facture.
--
-- CE QUI CHANGE. Dans l'UPDATE de fn_dispatcher_collecte, sous le row lock déjà
-- pris : si la collecte est rejetée (`statut_tms = rejetee_par_prestataire`) et
-- pas plus avancée que `programmee`, `statut` → `programmee` et `statut_tms` →
-- `non_envoye`. `non_envoye` = « avant succès E1 » (§04) : l'ordre de la
-- réattribution n'est pas encore parti ; l'adapter pose ensuite
-- `attribuee_en_attente_acceptation` à l'envoi. Sans ce reset, `programmee`
-- cohabiterait avec un `statut_tms` hors de ceux qu'il couvre (§04), et
-- l'acceptation manuelle A Toutes! refuserait toujours la nouvelle attribution.
-- `statut = programmee` + `statut_tms = rejetee_par_prestataire` (collectes
-- rejetées par A Toutes! avant ce correctif) est remis de la même façon.
-- Une collecte `validee`/`en_cours` dont un seul camion MTS-1 a été refusé
-- (`statut_tms` écrit par ordre) n'est PAS touchée : ce n'est pas un rejet de
-- la collecte.
-- Le reste du corps est recopié à l'identique de 20260915220000.
--
-- NATURE. CREATE OR REPLACE d'une fonction SECURITY DEFINER existante. Droits
-- réaffirmés et fermés : EXECUTE retiré à PUBLIC, anon et authenticated, accordé
-- au seul service_role. Aucune table, colonne, policy ni donnée touchée.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_dispatcher_collecte(
  p_id                        uuid,
  p_prestataire_logistique_id uuid   DEFAULT NULL,
  p_motif_override            text   DEFAULT NULL
) RETURNS text   -- 'collecte.creee' | 'collecte.modifiee'
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'plateforme', 'public'
AS $$
DECLARE
  v_event_type    text;
BEGIN
  -- Row lock AVANT INSERT outbox (CLAUDE.md R1 — garantit ordering intra-agregat)
  PERFORM 1 FROM plateforme.collectes WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- UPDATE collecte (reset dirty_tms + override optionnel prestataire).
  -- Réattribution d'une collecte rejetée par le transporteur (arbitrage Val
  -- 2026-09-17) : retour `programmee` / `non_envoye`. Les CASE lisent l'ancienne
  -- ligne : les deux colonnes sont évaluées sur la même condition.
  UPDATE plateforme.collectes
  SET
    dirty_tms                  = false,
    updated_at                 = now(),
    prestataire_logistique_id  = COALESCE(p_prestataire_logistique_id, prestataire_logistique_id),
    motif_override_prestataire = COALESCE(p_motif_override, motif_override_prestataire),
    statut = CASE
      WHEN statut_tms = 'rejetee_par_prestataire'
       AND statut IN ('programmee', 'rejetee_par_prestataire')
      THEN 'programmee'::plateforme.collecte_statut
      ELSE statut
    END,
    statut_tms = CASE
      WHEN statut_tms = 'rejetee_par_prestataire'
       AND statut IN ('programmee', 'rejetee_par_prestataire')
      THEN 'non_envoye'::plateforme.collecte_statut_tms
      ELSE statut_tms
    END
  WHERE id = p_id;

  -- Gate E2 lu APRES l'UPDATE : sur un override de prestataire, la question est
  -- « une commande existe-t-elle chez le prestataire CIBLE ? ». Lu avant, il
  -- repondait sur l'ancien — et un basculement de transporteur emettait E2, que
  -- l'adapter du nouveau provider absorbe en no-op (rien de commande nulle part).
  v_event_type := CASE
    WHEN plateforme.fn_collecte_commandee_chez_provider(p_id) THEN 'collecte.modifiee'
    ELSE 'collecte.creee'
  END;

  -- INSERT outbox (meme transaction → atomique)
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

REVOKE EXECUTE ON FUNCTION plateforme.fn_dispatcher_collecte(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_dispatcher_collecte(uuid, uuid, text) TO service_role;
