-- M2.1 — Packs AG : triggers complets
-- Remplace/complète le trigger partiel de M0.3 (fn_trg_pack_debit_annulation_tardive).
-- Ajoute : trg_pack_debit_realisee, trg_pack_recredit.
-- Utilise f_upsert_alerte_admin (créée en M1.6) pour les alertes in-app.

-- ============================================================
-- Trigger 1 — Débit nominal à la réalisation AG (BEFORE)
-- Condition : collecte AG passe à 'realisee', pack actif trouvé
-- BEFORE pour pouvoir écrire NEW.pack_antgaspi_id
-- ============================================================

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

  -- Trouver le pack actif avec lock (FOR UPDATE SKIP LOCKED = pas de blocage si concurrent)
  SELECT id INTO v_pack_id
  FROM plateforme.packs_antgaspi
  WHERE organisation_id = v_organisation AND statut = 'actif'
  FOR UPDATE SKIP LOCKED;

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

DROP TRIGGER IF EXISTS trg_pack_debit_realisee ON plateforme.collectes;
CREATE TRIGGER trg_pack_debit_realisee
  BEFORE UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_debit_realisee();

-- ============================================================
-- Trigger 2 — Débit tardif à l'annulation (BEFORE)
-- Condition : AG annulée (depuis non-realisee) avec < 12h OU prestataire mandaté
-- Remplace la version incomplète de M0.3
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_pack_statut  plateforme.pack_statut_enum;
  v_delai_court  boolean;
  v_mandat_actif boolean;
BEGIN
  -- Uniquement AG → annulee depuis un statut NON realisee (trigger 3 couvre l'annulation post-realisee)
  IF NEW.statut != 'annulee' OR OLD.statut = 'annulee' OR OLD.statut = 'realisee' THEN
    RETURN NEW;
  END IF;
  IF NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- Condition 1 : < 12h avant la collecte
  v_delai_court := (
    NEW.date_collecte::timestamptz
    + COALESCE(NEW.heure_collecte, '00:00:00'::time)
    - INTERVAL '12 hours'
  ) <= now();

  -- Condition 2 : prestataire mandaté (ordre déjà envoyé au TMS)
  v_mandat_actif := (
    OLD.statut_tms IS NOT NULL
    AND OLD.statut_tms NOT IN ('non_envoye', 'a_attribuer')
  );

  IF NOT (v_delai_court OR v_mandat_actif) THEN
    RETURN NEW; -- pas de débit si annulation en avance sans mandat
  END IF;

  -- Condition tardive remplie mais aucun pack attaché → alerte Admin (§05 §3 F3)
  IF OLD.pack_antgaspi_id IS NULL THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_annulee_tardive_sans_pack_actif',
      'Annulation tardive AG sans pack attaché',
      'La collecte ' || NEW.id::text || ' a été annulée tardivement sans pack AG attaché. Vérifier et imputer manuellement si nécessaire.',
      'collecte',
      NEW.id
    );
    RETURN NEW;
  END IF;

  -- Débit
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = credits_consommes + 1,
    statut = CASE
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut_enum
      ELSE statut
    END,
    updated_at = now()
  WHERE id = OLD.pack_antgaspi_id
  RETURNING statut INTO v_pack_statut;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || OLD.pack_antgaspi_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      OLD.pack_antgaspi_id
    );
  END IF;

  -- Audit
  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', OLD.pack_antgaspi_id,
    'pack_debite_annulation_tardive',
    jsonb_build_object('collecte_id', NEW.id),
    jsonb_build_object(
      'motif_delai_court', v_delai_court,
      'motif_mandat', v_mandat_actif,
      'statut_apres', v_pack_statut
    )
  );

  RETURN NEW;
END;
$$;

-- Remplacer l'ancien trigger (créé en M0.3 avec fn incomplète)
DROP TRIGGER IF EXISTS trg_pack_debit_annulation_tardive ON plateforme.collectes;
CREATE TRIGGER trg_pack_debit_annulation_tardive
  BEFORE UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive();

-- ============================================================
-- Trigger 3 — Recrédit automatique (annulee après realisee) (BEFORE)
-- Condition : AG realisee → annulee
-- Mutuellement exclusif avec trigger 2 (OLD.statut = realisee ici)
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_pack_id uuid;
BEGIN
  -- Uniquement AG passant à annulee DEPUIS realisee
  IF NEW.statut != 'annulee' OR OLD.statut != 'realisee' OR NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  v_pack_id := OLD.pack_antgaspi_id;
  IF v_pack_id IS NULL THEN RETURN NEW; END IF;

  -- Recrédit avec GREATEST(0,...) comme filet de sécurité
  UPDATE plateforme.packs_antgaspi
  SET
    credits_consommes = GREATEST(0, credits_consommes - 1),
    statut = CASE
      WHEN statut = 'epuise' AND (credits_consommes - 1) < credits_initiaux
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

DROP TRIGGER IF EXISTS trg_pack_recredit ON plateforme.collectes;
CREATE TRIGGER trg_pack_recredit
  BEFORE UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_recredit();

-- ============================================================
-- RPC : annuler le crédit d'une collecte côté Savr (Bloc 6)
-- Distinct de l'annulation métier : collecte reste à realisee
-- ============================================================

CREATE OR REPLACE FUNCTION plateforme.rpc_annuler_credit_collecte(
  p_collecte_id uuid,
  p_motif text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, public AS $$
DECLARE
  v_collecte     record;
  v_pack_id      uuid;
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
    UPDATE plateforme.packs_antgaspi
    SET
      credits_consommes = GREATEST(0, credits_consommes - 1),
      statut = CASE
        WHEN statut = 'epuise' AND (credits_consommes - 1) < credits_initiaux
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

-- ============================================================
-- Seed : mettre à jour les tarifs_packs_ag avec les nouveaux champs
-- Les 4 lignes existantes (5/10/20/50 collectes) n'ont pas type_pack
-- car inséré en M0.3 avant que la colonne existe.
-- La migration 200000 a déjà fait le UPDATE via la logique conditionnelle.
-- Ce bloc recalcule montant_total_ht si manquant.
-- ============================================================

UPDATE plateforme.tarifs_packs_ag
SET montant_total_ht = ROUND((credits * prix_unitaire_ht)::numeric, 2)
WHERE montant_total_ht IS NULL AND credits IS NOT NULL AND prix_unitaire_ht IS NOT NULL;
