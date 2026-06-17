-- M3.3 — Espace client agence
-- Source : §06.11 (différence forcée #4 — workflow shadow / Cerfa) + décisions
--          F2/F3/F4 (test-scenarios lot ⑨, tranché Val 2026-06-07) + §04
--          (organisations.est_shadow / cree_par_organisation_id) + §06.04 (réplique).
--
-- Toute la RLS agence (evenements/collectes/organisations/users/factures/packs),
-- les contraintes shadow, le trigger anti entite_facturation shadow, la vue
-- whitelist v_referentiel_traiteurs (F5) et l'exclusion registre (F6) sont déjà
-- en place (migrations Niveau 0 : 171635, 171642, 180000, 180001, 180002).
-- Ce module n'ajoute que les 3 objets DB manquants du workflow shadow :
--   1. f_completer_siret_shadow(uuid,text) — RPC SECURITY DEFINER (F2)
--   2. trg_bordereau_gate_shadow_siret — Cerfa non finalisable tant que SIRET
--      du producteur shadow absent (diff #4)
--   3. trg_cerfa_debloque_siret — finalisation auto au remplissage SIRET (F4)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPC f_completer_siret_shadow (décision F2)
-- ─────────────────────────────────────────────────────────────────────────────
-- La modal de complétion SIRET (fiche collecte agence) appelle cette RPC plutôt
-- qu'un UPDATE RLS direct : §09 ne donne aucun droit UPDATE sur les fiches shadow
-- (org_agence_update = self only). SECURITY DEFINER, limité au SIRET, avec 5 gardes
-- internes. Émet la notification Admin in-app (F3, aucun email — catalogue inchangé).
CREATE OR REPLACE FUNCTION plateforme.f_completer_siret_shadow(
  p_org_id uuid,
  p_siret  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_role       text := auth.jwt()->>'role';
  v_caller_org uuid := (auth.jwt()->>'organisation_id')::uuid;
  v_org        plateforme.organisations;
BEGIN
  -- Garde 1 — rôle agence uniquement
  IF v_role IS DISTINCT FROM 'agence' THEN
    RAISE EXCEPTION 'Action réservée au rôle agence' USING ERRCODE = '42501';
  END IF;

  -- Garde 2 — format SIRET : 14 chiffres exactement
  IF p_siret IS NULL OR p_siret !~ '^[0-9]{14}$' THEN
    RAISE EXCEPTION 'Format SIRET invalide (14 chiffres requis)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM plateforme.organisations WHERE id = p_org_id;

  -- Garde 3 — la cible existe et est une fiche shadow
  IF NOT FOUND OR v_org.est_shadow IS NOT TRUE THEN
    RAISE EXCEPTION 'Organisation cible introuvable ou non shadow' USING ERRCODE = '22023';
  END IF;

  -- Garde 4 — fiche créée par l'organisation appelante
  IF v_org.cree_par_organisation_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'Fiche shadow non créée par votre organisation' USING ERRCODE = '42501';
  END IF;

  -- Garde 5 — écrasement interdit
  IF v_org.siret IS NOT NULL THEN
    RAISE EXCEPTION 'SIRET déjà renseigné' USING ERRCODE = '22023';
  END IF;

  UPDATE plateforme.organisations
  SET siret = p_siret, updated_at = now()
  WHERE id = p_org_id;

  -- Notification Admin in-app (F3) — dédupliquée, sans email
  PERFORM plateforme.f_upsert_alerte_admin(
    'shadow_siret_complete',
    'SIRET complété sur fiche traiteur shadow',
    format(
      'Le SIRET de la fiche traiteur shadow « %s » a été renseigné par l''agence.',
      COALESCE(v_org.raison_sociale, v_org.nom)
    ),
    'organisations',
    p_org_id
  );
END $$;

REVOKE EXECUTE ON FUNCTION plateforme.f_completer_siret_shadow(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_completer_siret_shadow(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION plateforme.f_completer_siret_shadow(uuid, text) IS
  'F2 §06.11 — complétion SIRET d''une fiche traiteur shadow par son agence créatrice (SECURITY DEFINER, 5 gardes, in-app alerte F3). Débloque le Cerfa via trg_cerfa_debloque_siret.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Gate : bordereau Cerfa non finalisable tant que SIRET producteur shadow absent
-- ─────────────────────────────────────────────────────────────────────────────
-- §06.11 diff #4 : « Seul le bordereau Cerfa reste en brouillon tant que le SIRET
-- du traiteur shadow n'est pas renseigné. » Le producteur du bordereau = traiteur
-- opérationnel (sinon l'organisation programmante). Si ce producteur est une fiche
-- shadow sans SIRET, toute tentative de sortie de 'brouillon' (batch J+1 / worker
-- PDF) est ramenée silencieusement à 'brouillon'. Les producteurs normaux ne sont
-- jamais affectés (est_shadow=false). Règle SQL-native (testable pgTAP, indépendante
-- du worker applicatif).
CREATE OR REPLACE FUNCTION plateforme.fn_trg_bordereau_gate_shadow_siret()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_bloque boolean;
BEGIN
  -- Rien à garder si on reste en brouillon
  IF NEW.statut = 'brouillon' THEN
    RETURN NEW;
  END IF;

  SELECT (o.est_shadow IS TRUE AND o.siret IS NULL)
  INTO v_bloque
  FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.organisations o
    ON o.id = COALESCE(e.traiteur_operationnel_organisation_id, e.organisation_id)
  WHERE c.id = NEW.collecte_id;

  IF COALESCE(v_bloque, false) THEN
    NEW.statut := 'brouillon';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bordereau_gate_shadow_siret ON plateforme.bordereaux_savr;
CREATE TRIGGER trg_bordereau_gate_shadow_siret
  BEFORE INSERT OR UPDATE ON plateforme.bordereaux_savr
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_bordereau_gate_shadow_siret();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger trg_cerfa_debloque_siret (décision F4)
-- ─────────────────────────────────────────────────────────────────────────────
-- AFTER UPDATE OF siret sur une fiche shadow (NULL → NOT NULL) : les bordereaux
-- Cerfa restés en 'brouillon' pour les collectes de ce traiteur shadow sont
-- finalisés (snapshot SIRET + statut 'emis' — le gate ci-dessus laisse passer
-- puisque o.siret est désormais renseigné) et le PDF est ré-enqueué avec le SIRET.
-- Idempotent : ne se déclenche que sur la transition NULL→NOT NULL.
--
-- Pourquoi un trigger et pas le batch J+1 : le batch (batch-pdf-j1.ts) ré-insère
-- un bordereau pour toute collecte sans bordereau « emis », or bordereaux_savr a
-- une contrainte UNIQUE(collecte_id) → un bordereau resté en brouillon ne peut PAS
-- être re-finalisé par le batch (violation d'unicité). La finalisation au remplissage
-- du SIRET doit donc être portée ici (F4 = zéro action humaine). Le payload PDF
-- reconstruit reprend exactement les clés du payload canonique du batch
-- (batch-pdf-j1.ts §bordereauPayload) pour éviter toute divergence de template.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_cerfa_debloque_siret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = plateforme, pg_catalog AS $$
DECLARE
  v_bord RECORD;
BEGIN
  -- Scope strict : fiche shadow, SIRET passant de NULL à NOT NULL
  IF NEW.est_shadow IS NOT TRUE
     OR OLD.siret IS NOT NULL
     OR NEW.siret IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_bord IN
    SELECT
      b.*,
      e.nom_evenement,
      e.date_evenement,
      e.pax,
      l.nom              AS lieu_nom,
      concat_ws(' ', l.adresse_acces, l.code_postal, l.ville) AS lieu_adresse
    FROM plateforme.bordereaux_savr b
    JOIN plateforme.collectes c   ON c.id = b.collecte_id
    JOIN plateforme.evenements e  ON e.id = c.evenement_id
    LEFT JOIN plateforme.lieux l  ON l.id = e.lieu_id
    WHERE b.statut = 'brouillon'
      AND COALESCE(e.traiteur_operationnel_organisation_id, e.organisation_id) = NEW.id
  LOOP
    UPDATE plateforme.bordereaux_savr
    SET producteur_siret = NEW.siret,
        statut           = 'emis',
        updated_at       = now()
    WHERE id = v_bord.id;

    -- Ré-enqueue du PDF — clés alignées sur le payload canonique du batch.
    INSERT INTO plateforme.jobs_pdf
      (type_document, entity_type, entity_id, payload, statut, attempts)
    VALUES (
      'bordereau-zd', 'bordereaux_savr', v_bord.id,
      jsonb_build_object(
        'numero',                    v_bord.numero,
        'date_emission',             v_bord.date_emission,
        'date_collecte',             v_bord.date_collecte,
        'date_evenement',            v_bord.date_evenement,
        'nom_evenement',             v_bord.nom_evenement,
        'lieu_nom',                  v_bord.lieu_nom,
        'lieu_adresse',              v_bord.lieu_adresse,
        'producteur_raison_sociale', v_bord.producteur_raison_sociale,
        'producteur_siret',          NEW.siret,
        'producteur_adresse',        v_bord.producteur_adresse,
        'transporteur_nom',          v_bord.transporteur_nom,
        'exutoire_nom',              v_bord.exutoire_nom,
        'nb_pax',                    v_bord.pax,
        'flux',                      v_bord.detail_flux,
        'poids_total_kg',            v_bord.poids_total_kg,
        'source',                    'siret_shadow_debloque'
      ),
      'pending', 0
    )
    -- anti-doublon (idx_jobs_pdf_anti_dupe) : un seul job actif par entité
    ON CONFLICT (entity_type, entity_id, type_document)
      WHERE statut IN ('pending', 'processing')
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cerfa_debloque_siret ON plateforme.organisations;
CREATE TRIGGER trg_cerfa_debloque_siret
  AFTER UPDATE OF siret ON plateforme.organisations
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_cerfa_debloque_siret();
