-- =============================================================================
-- Fix Lot B — Packs AG : concurrence débit (M6) + recrédit anti-violation index (M7)
-- =============================================================================
-- Remplace 3 fonctions de 20260615200100 (corps repris VERBATIM, seules les
-- lignes visées changent — méthode E2).
--
-- M6 — fn_trg_pack_debit_realisee : le SELECT du pack actif passait en
--   `FOR UPDATE SKIP LOCKED`. Si l'unique pack actif de l'org est verrouillé par
--   une tx concurrente (2 collectes AG de la même org passant à `realisee` en
--   parallèle au batch terminal 6h), SKIP LOCKED ne retourne RIEN → « aucun pack
--   actif » → débit OMIS + fausse alerte → 1 seul crédit débité pour 2 réalisations.
--   Fix : `FOR UPDATE` (le pack est une ressource partagée qu'il FAUT attendre ;
--   la 2e tx lit le compteur déjà incrémenté par la 1re après son commit).
--
-- M7 — fn_trg_pack_recredit + rpc_annuler_credit_collecte : repassaient le pack
--   `epuise → actif` dès que credits_consommes-1 < credits_initiaux, SANS vérifier
--   qu'aucun AUTRE pack de l'org n'est déjà actif. Si l'org a renouvelé (nouveau
--   pack actif), réactiver l'ancien viole l'index partiel unique
--   `uniq_pack_actif_par_org (organisation_id) WHERE statut='actif'` → l'UPDATE
--   échoue → toute l'annulation/recrédit échoue. Fix : recréditer le compteur
--   mais ne repasser 'actif' que s'il n'existe pas déjà un autre pack actif de
--   l'org ; sinon laisser 'epuise'.
-- =============================================================================

-- ─── M6 : fn_trg_pack_debit_realisee — FOR UPDATE (attente, plus de SKIP LOCKED) ─
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_realisee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_pack_id      uuid;
  v_organisation uuid;
  v_pack_statut  plateforme.pack_statut_enum;
BEGIN
  -- Uniquement AG passant à realisee (depuis un statut différent)
  IF NEW.statut != 'realisee' OR OLD.statut = 'realisee' OR NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- Résoudre l'organisation via l'événement
  SELECT e.organisation_id INTO v_organisation
  FROM plateforme.evenements e
  WHERE e.id = NEW.evenement_id;

  IF v_organisation IS NULL THEN RETURN NEW; END IF;

  -- M6 : FOR UPDATE (et NON FOR UPDATE SKIP LOCKED) — le pack actif est l'unique
  -- ressource partagée de l'org ; sous concurrence (batch 6h), il FAUT attendre le
  -- verrou plutôt que de le sauter (sauter = débit perdu + fausse alerte).
  SELECT id INTO v_pack_id
  FROM plateforme.packs_antgaspi
  WHERE organisation_id = v_organisation AND statut = 'actif'
  FOR UPDATE;

  IF v_pack_id IS NULL THEN
    -- Aucun pack actif : alerte Ops in-app (fonctionnelle, pas Slack — §07 Observabilité)
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_realisee_sans_pack_actif',
      'Collecte AG réalisée sans pack actif',
      'La collecte ' || NEW.id::text || ' est passée à réalisée sans pack AG actif. Vérifier et imputer manuellement.',
      'collecte',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- Décrémenter + basculer epuise si dernier crédit
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut_enum
      ELSE statut
    END,
    updated_at = now()
  WHERE id = v_pack_id
  RETURNING statut INTO v_pack_statut;

  -- Rattacher la collecte au pack
  NEW.pack_antgaspi_id := v_pack_id;

  -- Alerte si pack épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || v_pack_id::text || ' est épuisé. Renouvellement requis avant la prochaine programmation AG.',
      'pack_antgaspi',
      v_pack_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ─── M7 : fn_trg_pack_recredit — réactivation gardée par unicité du pack actif ─
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_pack_id uuid;
  v_org     uuid;
BEGIN
  -- Uniquement AG passant à annulee DEPUIS realisee
  IF NEW.statut != 'annulee' OR OLD.statut != 'realisee' OR NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  v_pack_id := OLD.pack_antgaspi_id;
  IF v_pack_id IS NULL THEN RETURN NEW; END IF;

  -- M7 : organisation du pack pour garder la réactivation.
  SELECT organisation_id INTO v_org
  FROM plateforme.packs_antgaspi WHERE id = v_pack_id;

  -- Recrédit avec GREATEST(0,...) comme filet de sécurité.
  -- M7 : ne repasser 'actif' que si AUCUN autre pack de l'org n'est déjà actif
  -- (sinon violation de uniq_pack_actif_par_org → échec de toute l'annulation).
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = GREATEST(0, credits_consommes - 1),
    statut = CASE
      WHEN statut = 'epuise' AND (credits_consommes - 1) < credits_initiaux
        AND NOT EXISTS (
          SELECT 1 FROM plateforme.packs_antgaspi p2
          WHERE p2.organisation_id = v_org
            AND p2.statut = 'actif'
            AND p2.id <> v_pack_id
        )
        THEN 'actif'::plateforme.pack_statut_enum
      ELSE statut
    END,
    updated_at = now()
  WHERE id = v_pack_id;

  -- Désattacher la collecte du pack
  NEW.pack_antgaspi_id := NULL;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', v_pack_id,
    'pack_recredite_annulation_collecte',
    jsonb_build_object('pack_antgaspi_id', v_pack_id, 'collecte_id_annulee', OLD.id),
    jsonb_build_object('nouveau_statut_pack',
      (SELECT statut::text FROM plateforme.packs_antgaspi WHERE id = v_pack_id))
  );

  RETURN NEW;
END;
$$;

-- ─── M7 : rpc_annuler_credit_collecte — même garde de réactivation ───────────
CREATE OR REPLACE FUNCTION plateforme.rpc_annuler_credit_collecte(
  p_collecte_id uuid,
  p_motif text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_collecte     record;
  v_pack_id      uuid;
  v_org          uuid;
BEGIN
  IF p_motif IS NULL OR length(trim(p_motif)) < 10 THEN
    RAISE EXCEPTION 'motif obligatoire (≥ 10 caractères)' USING ERRCODE = 'P0001';
  END IF;

  -- Lock et lecture collecte
  SELECT id, statut, type, annulee_cote_savr, pack_antgaspi_id
  INTO v_collecte
  FROM plateforme.collectes
  WHERE id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte non trouvée' USING ERRCODE = 'P0002';
  END IF;

  IF v_collecte.statut != 'realisee' THEN
    RAISE EXCEPTION 'Annulation crédit possible uniquement sur une collecte réalisée' USING ERRCODE = 'P0003';
  END IF;

  IF v_collecte.type != 'anti_gaspi' THEN
    RAISE EXCEPTION 'Annulation crédit applicable uniquement aux collectes AG' USING ERRCODE = 'P0004';
  END IF;

  IF v_collecte.annulee_cote_savr THEN
    RAISE EXCEPTION 'Crédit déjà annulé pour cette collecte' USING ERRCODE = 'P0005';
  END IF;

  v_pack_id := v_collecte.pack_antgaspi_id;

  -- Marquer la collecte (statut reste realisee)
  UPDATE plateforme.collectes
  SET annulee_cote_savr = true,
      annulee_cote_savr_motif = p_motif,
      updated_at = now()
  WHERE id = p_collecte_id;

  -- Recrédit du pack si rattaché
  IF v_pack_id IS NOT NULL THEN
    -- M7 : organisation du pack pour garder la réactivation.
    SELECT organisation_id INTO v_org
    FROM plateforme.packs_antgaspi WHERE id = v_pack_id;

    UPDATE plateforme.packs_antgaspi
    SET
      credits_consommes = GREATEST(0, credits_consommes - 1),
      statut = CASE
        WHEN statut = 'epuise' AND (credits_consommes - 1) < credits_initiaux
          AND NOT EXISTS (
            SELECT 1 FROM plateforme.packs_antgaspi p2
            WHERE p2.organisation_id = v_org
              AND p2.statut = 'actif'
              AND p2.id <> v_pack_id
          )
          THEN 'actif'::plateforme.pack_statut_enum
        ELSE statut
      END,
      updated_at = now()
    WHERE id = v_pack_id;

    UPDATE plateforme.collectes
    SET pack_antgaspi_id = NULL
    WHERE id = p_collecte_id;
  END IF;

  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'collectes', p_collecte_id,
    'annulation_credit_cote_savr',
    jsonb_build_object('pack_antgaspi_id', v_pack_id),
    jsonb_build_object('annulee_cote_savr', true, 'motif', p_motif)
  );

  RETURN jsonb_build_object('ok', true, 'pack_antgaspi_id', v_pack_id);
END;
$$;

REVOKE ALL ON FUNCTION plateforme.rpc_annuler_credit_collecte(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_annuler_credit_collecte(uuid, text) TO service_role;
