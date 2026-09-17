-- =============================================================================
-- Réattribution vers le même type de transporteur : les tournées refusées sont
-- réinitialisées en place, la commande repart.
-- =============================================================================
-- DÉFAUT CORRIGÉ. `fn_collecte_commandee_chez_provider` répond « commandée » dès
-- qu'une tournée du même `type_tms` porte `external_ref_commande`, sans regarder
-- si la commande est encore vivante. Mesuré sur la base locale (transaction
-- annulée), après 20260917130000 :
--   A. AG refusée par A Toutes! (webhook mission_failed : référence committée,
--      mission `failed`) → réattribuée à A Toutes!           → collecte.modifiee
--   B. ZD MTS-1, tous tours KO (tournée `annulee`) → réattribuée à un autre
--      transporteur MTS-1                                     → collecte.modifiee
--   C. AG refusée par A Toutes! → réattribuée à MTS-1         → collecte.creee
-- E2 est un no-op côté vélo et modifie une commande annulée côté camion : rien
-- n'est recommandé. Côté MTS-1, un E1 ne suffirait pas non plus : la tournée
-- `annulee` sert de curseur de reprise (no-op), le rang est pris
-- (`uniq_collecte_tournee_rang`) et la clé `{collecte}-{rang}` est déjà portée
-- par la commande annulée.
--
-- RÈGLE (arbitrage Val 2026-09-17, « réinitialiser en place »). Lors de la
-- réattribution d'une collecte rejetée (même condition que 20260917130000 :
-- `statut_tms = rejetee_par_prestataire` et `statut ∈ {programmee,
-- rejetee_par_prestataire}`), chaque tournée liée dont la commande est MORTE est
-- remise à zéro :
--   • morte = tournée `annulee` (refus MTS-1 CANCELED/KO, posé par le polling),
--     ou mission A Toutes! `failed` / `cancelled_externally` (refus webhook) ;
--   • external_ref_commande, tms_reference, plaque, chauffeur, accompagnant,
--     heures réelles → NULL ; statut → `planifiee` ;
--   • `reference_interne` prend un suffixe de tentative `-r{n}` (n = 2, 3…).
--     L'adapter MTS-1 en dérive l'`orderNumber` de la nouvelle commande
--     (`{collecte}-{rang}-r{n}`) : sans lui, la réconciliation retrouverait la
--     commande annulée. Aucun DDL : la tentative vit dans une colonne existante.
-- Le prédicat, lu APRÈS, ne voit plus de commande sur ces rangs : E1 si plus
-- aucune commande vivante, E2 sinon (collecte multi-camions dont un seul camion
-- a été refusé — l'adapter recommande alors les rangs sans commande).
-- La trace de la commande refusée reste dans `integrations_logs` et l'audit.
--
-- GARDES.
--   • Une collecte non rejetée (renvoi Ops d'une collecte validée, etc.) n'est
--     jamais touchée : la réinitialisation est dans la même branche que le
--     retour `programmee`.
--   • Une tournée vivante (planifiee / en_cours / terminee, mission vivante)
--     n'est jamais touchée.
--   • Une tournée refusée qui porte déjà des pesées bloque la réattribution
--     (exception `reattribution_tournee_refusee_avec_pesees`) : l'effacer
--     ferait perdre des poids réels, la garder ferait compter ces poids dans la
--     nouvelle commande. Cas non observé ; il demande une décision Ops.
--   • `collectes.tms_reference` (référence d'affichage du rang 1) est remise à
--     NULL si la tournée du rang 1 est réinitialisée : la collecte réapparaît
--     comme « non transmise » tant que la nouvelle commande n'est pas validée.
-- Row lock pris AVANT tout (CLAUDE.md R1).
--
-- NATURE. CREATE OR REPLACE d'une fonction SECURITY DEFINER existante, corps de
-- 20260917130000 repris ; seuls changent la lecture de la condition de rejet
-- (sous le lock, avant l'UPDATE qui la modifie) et le bloc de réinitialisation.
-- Aucune table, colonne, policy ni signature touchée. Droits réaffirmés et
-- fermés : EXECUTE retiré à PUBLIC, anon et authenticated, accordé au seul
-- service_role.
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
  v_rejetee       boolean;
  v_rang1_reinit  boolean;
BEGIN
  -- Row lock AVANT INSERT outbox (CLAUDE.md R1 — garantit ordering intra-agregat).
  -- La condition de rejet est lue ici : l'UPDATE ci-dessous la modifie.
  SELECT statut_tms = 'rejetee_par_prestataire'
     AND statut IN ('programmee', 'rejetee_par_prestataire')
  INTO v_rejetee
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- UPDATE collecte (reset dirty_tms + override optionnel prestataire).
  -- Réattribution d'une collecte rejetée par le transporteur (arbitrage Val
  -- 2026-09-17) : retour `programmee` / `non_envoye`.
  UPDATE plateforme.collectes
  SET
    dirty_tms                  = false,
    updated_at                 = now(),
    prestataire_logistique_id  = COALESCE(p_prestataire_logistique_id, prestataire_logistique_id),
    motif_override_prestataire = COALESCE(p_motif_override, motif_override_prestataire),
    statut = CASE
      WHEN v_rejetee THEN 'programmee'::plateforme.collecte_statut
      ELSE statut
    END,
    statut_tms = CASE
      WHEN v_rejetee THEN 'non_envoye'::plateforme.collecte_statut_tms
      ELSE statut_tms
    END
  WHERE id = p_id;

  -- Réattribution : les tournées dont la commande est morte sont réinitialisées
  -- en place (arbitrage Val 2026-09-17), pour que la commande reparte.
  IF v_rejetee THEN
    IF EXISTS (
      SELECT 1
      FROM plateforme.collecte_tournees ct
      JOIN plateforme.tournees t ON t.id = ct.tournee_id
      JOIN plateforme.pesees_tournees p ON p.tournee_id = t.id
      WHERE ct.collecte_id = p_id
        AND t.external_ref_commande IS NOT NULL
        AND (
          t.statut = 'annulee'
          OR EXISTS (
            SELECT 1 FROM plateforme.everest_missions em
            WHERE em.tournee_id = t.id
              AND em.statut_everest IN ('failed', 'cancelled_externally')
          )
        )
    ) THEN
      RAISE EXCEPTION 'reattribution_tournee_refusee_avec_pesees'
        USING ERRCODE = 'P0001',
              HINT = 'Une tournée refusée porte des pesées : à traiter par Ops avant réattribution.';
    END IF;

    WITH reinit AS (
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
        AND ct.collecte_id = p_id
        AND t.external_ref_commande IS NOT NULL
        AND (
          t.statut = 'annulee'
          OR EXISTS (
            SELECT 1 FROM plateforme.everest_missions em
            WHERE em.tournee_id = t.id
              AND em.statut_everest IN ('failed', 'cancelled_externally')
          )
        )
      RETURNING ct.rang
    )
    SELECT COALESCE(bool_or(rang = 1), false) INTO v_rang1_reinit FROM reinit;

    IF v_rang1_reinit THEN
      UPDATE plateforme.collectes SET tms_reference = NULL WHERE id = p_id;
    END IF;
  END IF;

  -- Gate E2 lu APRES l'UPDATE et la réinitialisation : la question est « une
  -- commande vivante existe-t-elle chez le prestataire CIBLE ? ».
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
