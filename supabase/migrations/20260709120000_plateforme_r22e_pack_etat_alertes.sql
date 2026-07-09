-- ============================================================================
-- R22e / BL-P2-30 — Alerte Admin « pack AG bientôt épuisé » (franchissement ≤10%)
--                   + pont trigger→email pour le template 9 admin_pack_ag_etat.
-- ============================================================================
-- §05 Règles métier l.1018 : « Pack AG bientôt épuisé — FRANCHISSEMENT du seuil
--   ≤ 10 % des crédits initiaux restants (transition > 10 % → ≤ 10 %, pas de
--   répétition à chaque décrément ; recrédit ré-arme). » (F4 tranchée Val 2026-06-07)
-- §06.02 l.199-205 : template 9 admin_pack_ag_etat, niveau=bas (franchissement)
--   / niveau=epuise (statut passe à epuise).
--
-- Détection : au débit d'un crédit (collecte AG realisee, ou annulation tardive),
-- on émet l'alerte in-app pack_ag_bas quand le solde passe de > 10 % à ≤ 10 %
-- SANS être épuisé (l'épuisement conserve son alerte pack_ag_epuise préexistante).
-- Le franchissement n'est vrai que sur le décrément qui traverse le seuil → pas
-- de répétition. Le recrédit (>10 %) résout l'alerte ouverte → ré-arme (F4).
--
-- L'EMAIL (template 9) ne peut pas partir d'un trigger : le cron notify-pack-etat
-- scanne alertes_admin (pack_ag_bas / pack_ag_epuise non notifiées) et envoie.
-- La colonne email_notifie_at est le drapeau d'idempotence de ce cron.
--
-- alertes_admin est une table V1-only (hors DDL cible V2) : ajout de colonne libre.
-- ============================================================================

-- ─── 1. Drapeau d'idempotence email (pont trigger → cron tpl 9) ──────────────
ALTER TABLE plateforme.alertes_admin
  ADD COLUMN IF NOT EXISTS email_notifie_at timestamptz;

-- Le cron ne scanne que les alertes pack ouvertes non encore notifiées.
CREATE INDEX IF NOT EXISTS idx_alertes_admin_pack_a_notifier
  ON plateforme.alertes_admin (created_at)
  WHERE code IN ('pack_ag_bas', 'pack_ag_epuise')
    AND statut = 'ouverte'
    AND email_notifie_at IS NULL;

-- Durcissement (revue RLS R22e) : f_upsert_alerte_admin (créée M1.6) avait un
-- GRANT EXECUTE service_role SANS REVOKE PUBLIC → tout rôle authenticated/anon
-- pouvait insérer une alerte arbitraire via PostgREST (nuisance write-only ; la
-- RLS aa_admin bloque toujours la relecture, aucune fuite inter-org). On ferme
-- l'EXECUTE PUBLIC, comme les 2 helpers ci-dessous. Émission = triggers DEFINER
-- + crons/routes service_role uniquement.
REVOKE EXECUTE ON FUNCTION plateforme.f_upsert_alerte_admin(text, text, text, text, uuid) FROM PUBLIC;

-- ─── 2. Helper : émettre pack_ag_bas au franchissement du seuil 10 % ─────────
-- Émis uniquement si le décrément fait passer les crédits restants de > 10 % à
-- ≤ 10 % ET que le pack n'est pas épuisé (restants > 0). Idempotent via
-- f_upsert_alerte_admin (skip si alerte ouverte identique). SECURITY DEFINER :
-- appelé depuis les triggers de débit (déjà DEFINER).
CREATE OR REPLACE FUNCTION plateforme.f_alerte_pack_bas(
  p_pack_id        uuid,
  p_initiaux       integer,
  p_consommes_apres integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_restants_apres integer := p_initiaux - p_consommes_apres;
  v_restants_avant integer := p_initiaux - (p_consommes_apres - 1);
BEGIN
  IF p_initiaux IS NULL OR p_initiaux <= 0 THEN
    RETURN;
  END IF;

  -- Franchissement : avant > 10 % (restants*10 > initiaux) ET après ≤ 10 %
  -- (restants*10 ≤ initiaux) ET non épuisé (restants > 0). Arithmétique entière
  -- exacte (pas de flottant) : x ≤ 10 % ⟺ x*10 ≤ initiaux.
  IF v_restants_apres > 0
     AND (v_restants_avant * 10) > p_initiaux
     AND (v_restants_apres * 10) <= p_initiaux
  THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_bas',
      'Pack Anti-Gaspi bientôt épuisé',
      'Le pack Anti-Gaspi ' || p_pack_id::text || ' est bientôt épuisé ('
        || v_restants_apres::text || '/' || p_initiaux::text
        || ' crédits restants). Lancer la négociation du pack suivant.',
      'pack_antgaspi',
      p_pack_id
    );
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION plateforme.f_alerte_pack_bas(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_alerte_pack_bas(uuid, integer, integer) TO service_role;

-- ─── 3. Helper : ré-armer (résoudre) les alertes pack au recrédit ────────────
-- F4 : un recrédit qui repasse > 10 % ré-arme le déclencheur « bas » ; un pack
-- qui n'est plus épuisé (restants > 0) ré-arme le déclencheur « épuisé ».
-- Résoudre l'alerte ouverte permet à un futur franchissement de ré-émettre
-- (f_upsert_alerte_admin ne re-crée pas tant qu'une alerte ouverte existe).
CREATE OR REPLACE FUNCTION plateforme.f_rearm_alerte_pack(
  p_pack_id  uuid,
  p_initiaux integer,
  p_consommes integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_restants integer := p_initiaux - p_consommes;
BEGIN
  IF p_initiaux IS NULL OR p_initiaux <= 0 THEN
    RETURN;
  END IF;

  -- Plus épuisé (restants > 0) → résoudre l'alerte d'épuisement ouverte.
  IF v_restants > 0 THEN
    UPDATE plateforme.alertes_admin
    SET statut = 'resolue', resolue_at = now()
    WHERE entity_type = 'pack_antgaspi'
      AND entity_id   = p_pack_id
      AND code        = 'pack_ag_epuise'
      AND statut      = 'ouverte';
  END IF;

  -- Repassé au-dessus de 10 % → résoudre l'alerte « bas » ouverte (ré-arme F4).
  IF (v_restants * 10) > p_initiaux THEN
    UPDATE plateforme.alertes_admin
    SET statut = 'resolue', resolue_at = now()
    WHERE entity_type = 'pack_antgaspi'
      AND entity_id   = p_pack_id
      AND code        = 'pack_ag_bas'
      AND statut      = 'ouverte';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION plateforme.f_rearm_alerte_pack(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_rearm_alerte_pack(uuid, integer, integer) TO service_role;

-- ─── 4. Trigger débit sur collecte AG realisee (+ franchissement bas) ────────
-- Base = 20260623120000 (converge pack_statut) + ajout f_alerte_pack_bas.
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
  v_initiaux     integer;
  v_consommes    integer;
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
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

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
  ELSE
    -- BL-P2-30 (R22e) : franchissement du seuil « bientôt épuisé » ≤ 10 % (§05 l.1018)
    PERFORM plateforme.f_alerte_pack_bas(v_pack_id, v_initiaux, v_consommes);
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 5. Trigger débit annulation tardive (+ franchissement bas) ──────────────
-- Base = 20260702000300 (R16a incident guard) + ajout f_alerte_pack_bas.
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
  v_initiaux     integer;
  v_consommes    integer;
BEGIN
  -- Uniquement AG → annulee depuis un statut NON realisee (trigger 3 couvre l'annulation post-realisee)
  IF NEW.statut != 'annulee' OR OLD.statut = 'annulee' OR OLD.statut = 'realisee' THEN
    RETURN NEW;
  END IF;
  IF NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- RM-09 : incident NON imputable au client → collecte manquée non facturable
  -- (§05 §4bis « Pas de facturation au client, ni débit de pack AG »). Seule une
  -- annulation tardive imputable au CLIENT (ou une annulation sans incident) débite.
  IF NEW.incident_imputable_a IS NOT NULL AND NEW.incident_imputable_a <> 'client' THEN
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
  RETURNING statut, credits_initiaux, credits_consommes
    INTO v_pack_statut, v_initiaux, v_consommes;

  -- Alerte si épuisé
  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || OLD.pack_antgaspi_id::text || ' est épuisé suite à une annulation tardive.',
      'pack_antgaspi',
      OLD.pack_antgaspi_id
    );
  ELSE
    -- BL-P2-30 (R22e) : franchissement du seuil « bientôt épuisé » ≤ 10 % (§05 l.1018)
    PERFORM plateforme.f_alerte_pack_bas(OLD.pack_antgaspi_id, v_initiaux, v_consommes);
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

-- ─── 6. Trigger recrédit (+ ré-arme des alertes pack) ────────────────────────
-- Base = 20260623120000 + ajout f_rearm_alerte_pack.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_pack_id uuid;
  v_org     uuid;
  v_initiaux  integer;
  v_consommes integer;
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
  WHERE id = v_pack_id
  RETURNING credits_initiaux, credits_consommes INTO v_initiaux, v_consommes;

  -- BL-P2-30 (R22e) : le recrédit ré-arme les alertes pack (F4, §06.02 l.204).
  PERFORM plateforme.f_rearm_alerte_pack(v_pack_id, v_initiaux, v_consommes);

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

-- ─── 7. RPC annulation crédit côté Savr (+ ré-arme des alertes pack) ─────────
-- Base = 20260623120000 + ajout f_rearm_alerte_pack.
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
  v_initiaux     integer;
  v_consommes    integer;
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
    WHERE id = v_pack_id
    RETURNING credits_initiaux, credits_consommes INTO v_initiaux, v_consommes;

    -- BL-P2-30 (R22e) : le recrédit ré-arme les alertes pack (F4, §06.02 l.204).
    PERFORM plateforme.f_rearm_alerte_pack(v_pack_id, v_initiaux, v_consommes);

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

-- ============================================================================
-- ROLLBACK (down-migration, DoD §rollback) — migration purement additive,
-- annulable. Étapes (formulées en prose : ce fichier ne contient AUCUN statement
-- destructif exécuté, seulement des ajouts) :
--   1. Retirer la colonne alertes_admin.email_notifie_at (ALTER TABLE … IF EXISTS)
--      et l'index partiel idx_alertes_admin_pack_a_notifier (IF EXISTS).
--   2. Retirer les 2 fonctions helper f_alerte_pack_bas(uuid,int,int) et
--      f_rearm_alerte_pack(uuid,int,int) (IF EXISTS).
--   3. Ré-appliquer les corps ANTÉRIEURS des 4 fonctions réécrites :
--        - fn_trg_pack_debit_realisee, fn_trg_pack_recredit, rpc_annuler_credit_collecte
--            → verbatim 20260623120000_plateforme_converge_pack_statut_valeurs_g1_clusterB.sql
--        - fn_trg_pack_debit_annulation_tardive
--            → verbatim 20260702000300_plateforme_r16a_pack_debit_incident_guard.sql
--   4. NE PAS annuler le `REVOKE EXECUTE … f_upsert_alerte_admin … FROM PUBLIC`
--      (durcissement sécurité intentionnel ; le remettre rouvrirait la faille
--      write-only décrite en tête de fichier).
-- ============================================================================
