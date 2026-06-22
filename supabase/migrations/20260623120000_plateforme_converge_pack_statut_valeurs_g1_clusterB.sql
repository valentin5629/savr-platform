-- Convergence G1 (Frontière TMS-Ready) — CLUSTER B.1 : VALEURS de pack_statut_enum vers le DDL cible.
-- Suite des lots de RENOMMAGE (#83, 20260623100000) et de VALEURS cluster A (#84, 20260623110000).
-- Le cible (specs/ddl-cible/schema_cible_v2.sql L131) modélise un VRAI enum sans suffixe _enum :
--   plateforme.pack_statut AS ENUM ('actif','epuise','annule')
-- V1 a la valeur 'expire' EN TROP. Ce lot converge NOM + VALEURS en une fois.
--
-- ⚠ PROD LIVE : retirer une valeur d'enum casse les lignes qui la portent. Postgres ne sait pas
--   DROP VALUE -> on recrée le type cible et on migre la colonne avec un USING qui mappe l'ancienne
--   valeur. DÉCISION VAL (2026-06-22) : GO, mapping expire -> epuise (un pack « expiré » est terminal
--   par le temps ≈ épuisé). 'expire' est une valeur DÉFINIE-MAIS-MORTE : aucun trigger/RPC ne l'écrit
--   (grep SQL+TS = 0 writer). Le USING ci-dessous est donc un no-op si 0 ligne prod, sûr si > 0.
--   ⚠ Comptes prod (packs_antgaspi GROUP BY statut) = à collecter par Val avant le déploiement manuel
--   (accès prod interdit depuis dev — CLAUDE.md §11) ; la migration reste correcte quel que soit le compte.
--
-- Dépendances live du type (introspection pg_depend, 2026-06-22) :
--   • colonne packs_antgaspi.statut (DEFAULT 'actif')
--   • index partiel uniq_pack_actif_par_org (UNIQUE WHERE statut='actif') -> prédicat cast l'enum (bloquant)
--   • index plain idx_packs_statut (btree statut) -> reconstruit AUTOMATIQUEMENT par l'ALTER TYPE
--   • 4 fonctions castant ::pack_statut_enum (toutes actif/epuise, 0 réf à 'expire') :
--       fn_trg_pack_debit_realisee, fn_trg_pack_debit_annulation_tardive,
--       fn_trg_pack_recredit, rpc_annuler_credit_collecte
--   • 0 vue, 0 policy RLS référençant ces valeurs.
--
-- ⚠ PIÈGE corps PL/pgSQL (vécu #83) : un changement de type ne se propage PAS dans le TEXTE des
--   fonctions, et DROP TYPE n'échoue PAS sur ces références (corps non suivis par pg_depend) — il
--   laisse les corps cassés au runtime. -> CREATE OR REPLACE des 4 fonctions (cast ::pack_statut)
--   AVANT le DROP TYPE. Corps reproduits VERBATIM (pg_get_functiondef), seule substitution :
--   pack_statut_enum -> pack_statut. Signatures inchangées -> grants/posture sécurité préservés.

-- 1) Type cible
CREATE TYPE plateforme.pack_statut AS ENUM ('actif', 'epuise', 'annule');

-- 2) Lever la dépendance bloquante : index partiel dont le prédicat cast l'ancien type.
DROP INDEX IF EXISTS plateforme.uniq_pack_actif_par_org;

-- 3) Colonne : drop default (enum) -> type cible (mapping expire->epuise) -> re-set default.
--    Le CASE est total : actif/epuise/annule passent en clair, expire devient epuise. Aucune valeur
--    hors cible possible (l'ancien enum n'a que ces 4 valeurs) -> pas de garde-fou DO nécessaire.
ALTER TABLE plateforme.packs_antgaspi ALTER COLUMN statut DROP DEFAULT;
ALTER TABLE plateforme.packs_antgaspi
  ALTER COLUMN statut TYPE plateforme.pack_statut
  USING (CASE WHEN statut::text = 'expire' THEN 'epuise' ELSE statut::text END)::plateforme.pack_statut;
ALTER TABLE plateforme.packs_antgaspi ALTER COLUMN statut SET DEFAULT 'actif';

-- 4) Recréer les 4 fonctions avec le cast ::pack_statut (corps verbatim, substitution ciblée).
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_realisee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_id      uuid;
  v_organisation uuid;
  v_pack_statut  plateforme.pack_statut;
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
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
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
$function$;

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_statut  plateforme.pack_statut;
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
  -- < 12h avant l'heure de collecte (spec §05 L187/356 : strict « < 12h »).
  -- Ancrage fuseau métier Europe/Paris : date_collecte (date) + heure_collecte (time)
  -- sont des wall-clocks naïfs ; sans AT TIME ZONE ils seraient interprétés en UTC
  -- (session Supabase = UTC), décalant le seuil de 1-2h (DST) — bug E2.
  v_delai_court := (
    ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
       AT TIME ZONE 'Europe/Paris')
    - INTERVAL '12 hours'
  ) < now();

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
      WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
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
$function$;

CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
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
        THEN 'actif'::plateforme.pack_statut
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
$function$;

CREATE OR REPLACE FUNCTION plateforme.rpc_annuler_credit_collecte(p_collecte_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
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
          THEN 'actif'::plateforme.pack_statut
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
$function$;

-- 5) Plus aucun objet n'utilise l'ancien type -> drop.
DROP TYPE plateforme.pack_statut_enum;

-- 6) Recréer l'index partiel (prédicat sur la valeur cible 'actif' ; un seul pack actif par org).
CREATE UNIQUE INDEX uniq_pack_actif_par_org
  ON plateforme.packs_antgaspi (organisation_id)
  WHERE statut = 'actif';
