-- =============================================================================
-- Pack Anti-Gaspi : le crédit est décompté dès la programmation (Val 2026-11-02)
-- =============================================================================
-- Avant : le crédit n'était décompté qu'au passage à `realisee` (ou à une
-- annulation tardive) ; la programmation, puis l'envoi au transporteur, ne
-- posaient qu'une réservation. Un client qui programmait toutes ses collectes
-- d'un coup en programmait plus que son pack ne couvrait, le compteur restant
-- immobile jusqu'aux réalisations.
--
-- Après (arbitrages Val 2026-11-02, fiche _Divergences/M2.1_20261102) :
--   1. Débit : une collecte AG qui devient `programmee` (création confirmée,
--      brouillon confirmé, collecte refusée renvoyée par l'Admin) débite le
--      pack actif de l'organisation programmatrice. Sans crédit, elle n'est pas
--      rattachée et sera facturée à l'unité (jamais de blocage, 2026-10-16).
--   2. Annulation 4 h ou plus avant le créneau, ou incident non imputable au
--      client : le crédit est rendu.
--   3. Annulation tardive (< 4 h) imputable au client : le crédit reste
--      décompté (trace d'audit inchangée, `pack_debite_annulation_tardive`).
--      Collecte sans pack : aucun débit, plein tarif unitaire (facturé à la
--      main), alerte `ag_annulee_tardive_sans_pack_actif` comme avant.
--   4. Refus définitif du prestataire (`rejetee_par_prestataire`) : le crédit
--      est rendu ; il est repris si l'Admin renvoie la collecte (point 1).
--   5. Réalisation : plus aucun débit. Une collecte réalisée sans pack lève
--      l'alerte `ag_realisee_sans_pack_actif` (facturée à l'unité, ou rattachée
--      depuis sa fiche) comme avant.
--   6. `rpc_valider_attribution_ag` ne réserve plus de pack (la collecte porte
--      déjà le sien, ou aucun).
--   7. Rattachement après coup : ouvert aussi aux collectes à venir sans pack.
--   8. Reprise : les collectes AG à venir sont débitées, par organisation, dans
--      l'ordre de leur créneau, jusqu'à épuisement du pack actif.
--
-- `collectes.pack_antgaspi_id` signifie désormais « crédit décompté sur ce
-- pack » pour toute collecte non annulée.
-- =============================================================================

-- La reprise (point 9) ne se joue qu'au premier passage de ce fichier : rejouée,
-- elle détacherait des crédits réellement décomptés depuis, sans les rendre.
-- Premier passage = le déclencheur de débit à la programmation n'existe pas
-- encore. Lu ici, avant sa création ; relu par la reprise (même session).
SELECT set_config(
  'savr.reprise_pack_debit_programmation',
  CASE WHEN to_regprocedure('plateforme.fn_trg_pack_debit_programmation()') IS NULL
       THEN 'a_faire' ELSE 'deja_faite' END,
  false);

-- ─── 1. Débit d'un crédit sur le pack actif d'une organisation ───────────────
-- Verrou du pack actif (FOR UPDATE, jamais SKIP LOCKED : le pack est la
-- ressource partagée de l'organisation). Rend l'id du pack débité, NULL sans
-- pack actif. Alertes « épuisé » et « bientôt épuisé » comme les débits
-- existants. L'appelant pose `pack_antgaspi_id` et l'audit.
CREATE OR REPLACE FUNCTION plateforme.f_pack_debiter_credit(p_organisation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_pack_id     uuid;
  v_pack_statut plateforme.pack_statut;
  v_initiaux    integer;
  v_consommes   integer;
BEGIN
  IF p_organisation_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_pack_id
    FROM plateforme.packs_antgaspi
   WHERE organisation_id = p_organisation_id AND statut = 'actif'
   FOR UPDATE;

  IF v_pack_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE plateforme.packs_antgaspi
     SET credits_consommes = credits_consommes + 1,
         statut = CASE
           WHEN credits_consommes + 1 >= credits_initiaux THEN 'epuise'::plateforme.pack_statut
           ELSE statut
         END,
         updated_at = now()
   WHERE id = v_pack_id
  RETURNING statut, credits_initiaux, credits_consommes
       INTO v_pack_statut, v_initiaux, v_consommes;

  IF v_pack_statut = 'epuise' THEN
    PERFORM plateforme.f_upsert_alerte_admin(
      'pack_ag_epuise',
      'Pack Anti-Gaspi épuisé',
      'Le pack Anti-Gaspi ' || v_pack_id::text || ' est épuisé. Les prochaines collectes AG de l''organisation seront facturées à l''unité jusqu''à un nouveau pack.',
      'pack_antgaspi',
      v_pack_id
    );
  ELSE
    PERFORM plateforme.f_alerte_pack_bas(v_pack_id, v_initiaux, v_consommes);
  END IF;

  RETURN v_pack_id;
END;
$$;

COMMENT ON FUNCTION plateforme.f_pack_debiter_credit(uuid) IS
  'Débite un crédit du pack AG actif de l''organisation (verrou FOR UPDATE, bascule epuise, alertes). Rend l''id du pack, NULL sans pack actif. Décision Val 2026-11-02. service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.f_pack_debiter_credit(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_pack_debiter_credit(uuid) TO service_role;

-- ─── 2. Recrédit d'un pack ───────────────────────────────────────────────────
-- Même calcul que fn_trg_pack_recredit et rpc_annuler_credit_collecte : un pack
-- épuisé redevient actif seulement si aucun autre pack de l'organisation ne
-- l'est (uniq_pack_actif_par_org). Ré-arme les alertes pack et écrit l'audit.
CREATE OR REPLACE FUNCTION plateforme.f_pack_recrediter_credit(
  p_pack_id     uuid,
  p_collecte_id uuid,
  p_action      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_org       uuid;
  v_initiaux  integer;
  v_consommes integer;
  v_statut    plateforme.pack_statut;
BEGIN
  SELECT organisation_id INTO v_org
    FROM plateforme.packs_antgaspi
   WHERE id = p_pack_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE plateforme.packs_antgaspi
     SET credits_consommes = GREATEST(0, credits_consommes - 1),
         statut = CASE
           WHEN statut = 'epuise' AND (credits_consommes - 1) < credits_initiaux
             AND NOT EXISTS (
               SELECT 1 FROM plateforme.packs_antgaspi p2
                WHERE p2.organisation_id = v_org
                  AND p2.statut = 'actif'
                  AND p2.id <> p_pack_id
             )
             THEN 'actif'::plateforme.pack_statut
           ELSE statut
         END,
         updated_at = now()
   WHERE id = p_pack_id
  RETURNING credits_initiaux, credits_consommes, statut
       INTO v_initiaux, v_consommes, v_statut;

  PERFORM plateforme.f_rearm_alerte_pack(p_pack_id, v_initiaux, v_consommes);

  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', p_pack_id,
    p_action,
    jsonb_build_object('pack_antgaspi_id', p_pack_id, 'collecte_id_annulee', p_collecte_id),
    jsonb_build_object('nouveau_statut_pack', v_statut::text)
  );
END;
$$;

COMMENT ON FUNCTION plateforme.f_pack_recrediter_credit(uuid, uuid, text) IS
  'Rend un crédit au pack AG (réactivation si épuisé et aucun autre pack actif, ré-armement des alertes, audit). Décision Val 2026-11-02. service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.f_pack_recrediter_credit(uuid, uuid, text)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_pack_recrediter_credit(uuid, uuid, text) TO service_role;

-- ─── 3. Débit à la programmation (nouveau déclencheur) ───────────────────────
-- Une collecte AG devient `programmee` : à sa création confirmée (INSERT
-- direct en `programmee`), à la confirmation d'un brouillon, ou au renvoi par
-- l'Admin d'une collecte refusée par le prestataire. Une collecte qui porte
-- déjà un pack n'est jamais débitée deux fois.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_programmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v_organisation uuid;
  v_pack_id      uuid;
BEGIN
  IF NEW.type <> 'anti_gaspi'
     OR NEW.statut <> 'programmee'
     OR NEW.pack_antgaspi_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.statut NOT IN ('brouillon', 'rejetee_par_prestataire') THEN
    RETURN NEW;
  END IF;

  SELECT e.organisation_id INTO v_organisation
    FROM plateforme.evenements e
   WHERE e.id = NEW.evenement_id;

  v_pack_id := plateforme.f_pack_debiter_credit(v_organisation);
  IF v_pack_id IS NULL THEN
    -- Pas de crédit : facturée à l'unité, annoncé au formulaire (2026-10-16).
    RETURN NEW;
  END IF;

  NEW.pack_antgaspi_id := v_pack_id;

  INSERT INTO plateforme.audit_log (
    table_name, record_id, action, old_values, new_values
  ) VALUES (
    'packs_antgaspi', v_pack_id,
    'pack_debite_programmation',
    jsonb_build_object('collecte_id', NEW.id),
    jsonb_build_object('statut_avant', CASE WHEN TG_OP = 'UPDATE' THEN OLD.statut::text END)
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_pack_debit_programmation()
  FROM authenticated, anon, PUBLIC;

CREATE OR REPLACE TRIGGER trg_pack_debit_programmation
  BEFORE INSERT OR UPDATE OF statut ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_trg_pack_debit_programmation();

-- ─── 4. Réalisation : plus de débit ──────────────────────────────────────────
-- Le crédit a été décompté à la programmation. Une collecte qui arrive à
-- `realisee` sans pack (aucun crédit à sa programmation) reste facturée à
-- l'unité ; l'alerte invite l'Admin à la rattacher à un pack pris depuis.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_realisee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'plateforme', 'public'
AS $function$
BEGIN
  IF NEW.statut != 'realisee' OR OLD.statut = 'realisee' OR NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  IF NEW.pack_antgaspi_id IS NULL THEN
    -- Alerte Ops in-app (fonctionnelle, pas Slack — §07 Observabilité)
    PERFORM plateforme.f_upsert_alerte_admin(
      'ag_realisee_sans_pack_actif',
      'Collecte AG réalisée sans pack actif',
      'La collecte ' || NEW.id::text || ' est passée à réalisée sans crédit de pack AG : elle sera facturée à l''unité, ou rattachée depuis sa fiche à un pack pris plus tard.',
      'collecte',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 5. Annulation avant réalisation ─────────────────────────────────────────
-- Tardive (< 4 h, imputable au client ou sans incident) : le crédit reste
-- décompté. Sinon : il est rendu.
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_reference    timestamptz;
  v_tardive      boolean;
BEGIN
  -- Uniquement AG → annulee depuis un statut NON realisee (fn_trg_pack_recredit
  -- couvre l'annulation post-realisee).
  IF NEW.statut != 'annulee' OR OLD.statut = 'annulee' OR OLD.statut = 'realisee' THEN
    RETURN NEW;
  END IF;
  IF NEW.type != 'anti_gaspi' THEN
    RETURN NEW;
  END IF;

  -- Instant de référence (Val 2026-10-15) : une demande d'annulation confirmée
  -- par l'Admin (annulation_demandee → annulee) se juge à sa réception ; toute
  -- autre annulation, à l'instant où elle est faite.
  v_reference := CASE
    WHEN OLD.statut = 'annulation_demandee'
      THEN COALESCE(OLD.annulation_demandee_at, now())
    ELSE now()
  END;

  -- Tardive = < 4 h avant le créneau (heure de Paris, strict) ET imputable au
  -- client ou sans incident (RM-09 : un incident non imputable au client n'est
  -- jamais facturé).
  v_tardive := (
      NEW.incident_imputable_a IS NULL OR NEW.incident_imputable_a = 'client'
    ) AND (
      ((NEW.date_collecte + COALESCE(NEW.heure_collecte, '00:00:00'::time))
         AT TIME ZONE 'Europe/Paris')
      - INTERVAL '4 hours'
    ) < v_reference;

  IF NEW.pack_antgaspi_id IS NULL THEN
    -- Une collecte refusée par le prestataire a déjà rendu son crédit : son
    -- annulation n'est pas « sans pack » (rien à rattacher).
    IF v_tardive AND OLD.statut <> 'rejetee_par_prestataire' THEN
      -- Aucun crédit décompté à la programmation : plein tarif unitaire,
      -- facturé à la main par l'Admin (§05 §3 F3).
      PERFORM plateforme.f_upsert_alerte_admin(
        'ag_annulee_tardive_sans_pack_actif',
        'Annulation tardive AG sans pack actif',
        'La collecte ' || NEW.id::text || ' a été annulée tardivement sans crédit de pack AG : aucun crédit débité. La rattacher depuis sa fiche à un pack pris plus tard, ou imputer manuellement si nécessaire.',
        'collecte',
        NEW.id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF v_tardive THEN
    -- Le crédit décompté à la programmation est acquis. Trace lue par
    -- l'historique du pack (GET /api/v1/gestionnaire/pack-ag).
    INSERT INTO plateforme.audit_log (
      table_name, record_id, action, old_values, new_values
    ) VALUES (
      'packs_antgaspi', NEW.pack_antgaspi_id,
      'pack_debite_annulation_tardive',
      jsonb_build_object('collecte_id', NEW.id),
      jsonb_build_object(
        'motif_delai_court', true,
        'instant_reference', v_reference,
        'statut_apres', (SELECT statut::text FROM plateforme.packs_antgaspi
                          WHERE id = NEW.pack_antgaspi_id)
      )
    );
    RETURN NEW;
  END IF;

  PERFORM plateforme.f_pack_recrediter_credit(
    NEW.pack_antgaspi_id, NEW.id, 'pack_recredite_annulation_collecte');
  NEW.pack_antgaspi_id := NULL;
  RETURN NEW;
END;
$function$;

-- ─── 6. Recrédit : annulation après réalisation, refus du prestataire ────────
CREATE OR REPLACE FUNCTION plateforme.fn_trg_pack_recredit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'plateforme', 'public'
AS $function$
BEGIN
  IF NEW.type != 'anti_gaspi' OR OLD.pack_antgaspi_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Annulation d'une collecte déjà réalisée (inchangé).
  IF NEW.statut = 'annulee' AND OLD.statut = 'realisee' THEN
    PERFORM plateforme.f_pack_recrediter_credit(
      OLD.pack_antgaspi_id, OLD.id, 'pack_recredite_annulation_collecte');
    NEW.pack_antgaspi_id := NULL;
    RETURN NEW;
  END IF;

  -- Refus définitif du prestataire : la collecte n'aura pas lieu de son fait,
  -- le client récupère son crédit (Val 2026-11-02). Repris au renvoi.
  IF NEW.statut = 'rejetee_par_prestataire'
     AND OLD.statut <> 'rejetee_par_prestataire' THEN
    PERFORM plateforme.f_pack_recrediter_credit(
      OLD.pack_antgaspi_id, OLD.id, 'pack_recredite_rejet_prestataire');
    NEW.pack_antgaspi_id := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_pack_debit_realisee() FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_pack_debit_annulation_tardive() FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION plateforme.fn_trg_pack_recredit() FROM authenticated, anon, PUBLIC;

-- ─── 7. Rattachement après coup : aussi les collectes à venir ────────────────
CREATE OR REPLACE FUNCTION plateforme.f_collecte_rattachable_pack(p_collecte_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = plateforme, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM plateforme.collectes c
     WHERE c.id = p_collecte_id
       AND c.type = 'anti_gaspi'
       AND c.pack_antgaspi_id IS NULL
       AND c.annulee_cote_savr = false
       AND (
         c.statut IN ('programmee', 'validee', 'en_cours', 'annulation_demandee',
                      'realisee', 'realisee_sans_collecte', 'cloturee')
         OR (
           c.statut = 'annulee'
           AND EXISTS (
             SELECT 1
               FROM plateforme.alertes_admin a
              WHERE a.code = 'ag_annulee_tardive_sans_pack_actif'
                AND a.entity_type = 'collecte'
                AND a.entity_id = c.id
           )
         )
       )
  );
$$;

COMMENT ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid) IS
  'Collecte AG rattachable après coup au pack actif : sans pack, sans crédit annulé côté Savr, à venir (programmée sans crédit, Val 2026-11-02) ou réalisée/clôturée, ou annulée après une annulation tardive sans pack (trace : alerte ag_annulee_tardive_sans_pack_actif). service_role uniquement.';

REVOKE EXECUTE ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.f_collecte_rattachable_pack(uuid) TO service_role;

-- ─── 8. Attribution AG : plus de réservation de pack ─────────────────────────
CREATE OR REPLACE FUNCTION plateforme.rpc_valider_attribution_ag(p_collecte_id uuid, p_association_id uuid, p_transporteur_id uuid, p_branche_attribution text, p_mode_validation plateforme.mode_validation, p_valide_par uuid, p_motif_override text DEFAULT NULL::text, p_motif_override_libre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_collecte       record;
  v_event          record;
  v_pack_id        uuid;
  v_attribution_id uuid;
  v_outbox_id      uuid;
  v_presta_id      uuid;
  v_type_tms       plateforme.type_tms;
  v_consumer       text;
BEGIN
  -- Validation params
  IF p_association_id IS NULL OR p_transporteur_id IS NULL THEN
    RAISE EXCEPTION 'association_id et transporteur_id obligatoires' USING ERRCODE = 'P0040';
  END IF;

  IF p_mode_validation = 'manuel_override' AND p_motif_override IS NULL THEN
    RAISE EXCEPTION 'motif_override obligatoire en mode override' USING ERRCODE = 'P0041';
  END IF;

  -- Row lock collecte (CLAUDE.md R1 — ordering intra-agrégat)
  SELECT c.id, c.statut, c.statut_tms, c.type, c.evenement_id, c.pack_antgaspi_id
  INTO v_collecte
  FROM plateforme.collectes c
  WHERE c.id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collecte introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_collecte.type != 'anti_gaspi' THEN
    RAISE EXCEPTION 'Attribution AG applicable uniquement aux collectes anti_gaspi' USING ERRCODE = 'P0042';
  END IF;
  IF v_collecte.statut NOT IN ('programmee') THEN
    RAISE EXCEPTION 'Attribution AG uniquement possible depuis statut programmee (actuel: %)', v_collecte.statut
      USING ERRCODE = 'P0043';
  END IF;

  -- Vérifier qu'il n'existe pas déjà une attribution (UNIQUE collecte_id)
  IF EXISTS (
    SELECT 1 FROM plateforme.attributions_antgaspi
    WHERE collecte_id = p_collecte_id
  ) THEN
    RAISE EXCEPTION 'Attribution déjà existante pour cette collecte' USING ERRCODE = 'P0044';
  END IF;

  -- Récupérer l'organisation de l'événement
  SELECT e.organisation_id INTO v_event
  FROM plateforme.evenements e
  WHERE e.id = v_collecte.evenement_id;

  -- Plus de réservation (Val 2026-11-02) : le crédit a été décompté à la
  -- programmation (trg_pack_debit_programmation), la collecte porte déjà son
  -- pack, ou aucun (facturée à l'unité). Rendu tel quel dans `pack_id`.
  v_pack_id := v_collecte.pack_antgaspi_id;

  -- Résoudre le prestataire logistique + type_tms du transporteur choisi
  -- (pont V1-only). Sert à poser tournees.prestataire_logistique_id au dispatch
  -- et à dériver le consumer (route adapter).
  SELECT t.prestataire_logistique_id, t.type_tms
  INTO v_presta_id, v_type_tms
  FROM plateforme.transporteurs t
  WHERE t.id = p_transporteur_id;

  -- Dérivation du consumer (route worker → getLogistiqueProvider). ELSE = manuel :
  -- 'autre'/'par_mail'/'par_telephone' (+ tout inconnu) → provider_manual, JAMAIS
  -- d'auto-POST MTS-1 (fix du repli piège R5). 'mts1'/'a_toutes' inchangés.
  v_consumer := CASE v_type_tms
    WHEN 'mts1'     THEN 'adapter_mts1'
    WHEN 'a_toutes' THEN 'adapter_everest'
    ELSE 'provider_manual'
  END;

  -- Poser le prestataire logistique (dispatch). statut_tms reste non_envoye
  -- (CDC §3 : on saute a_attribuer ; l'adapter pose attribuee_en_attente_acceptation).
  UPDATE plateforme.collectes
  SET prestataire_logistique_id = COALESCE(v_presta_id, prestataire_logistique_id),
      updated_at = now()
  WHERE id = p_collecte_id;

  -- INSERT attributions_antgaspi
  INSERT INTO plateforme.attributions_antgaspi (
    collecte_id, association_id, transporteur_id, branche_attribution,
    mode_validation, valide_par, valide_at,
    motif_override, motif_override_libre
  ) VALUES (
    p_collecte_id, p_association_id, p_transporteur_id, p_branche_attribution,
    p_mode_validation, p_valide_par, now(),
    p_motif_override, p_motif_override_libre
  )
  RETURNING id INTO v_attribution_id;

  -- Audit override
  IF p_mode_validation = 'manuel_override' THEN
    INSERT INTO plateforme.audit_log (
      table_name, record_id, action, new_values
    ) VALUES (
      'attributions_antgaspi', v_attribution_id,
      'attribution_override',
      jsonb_build_object(
        'motif_code',  p_motif_override,
        'motif_texte', p_motif_override_libre,
        'association_choisie', p_association_id,
        'transporteur_choisi', p_transporteur_id
      )
    );
  END IF;

  -- INSERT outbox_events — E (emails async, cron process-attributions-ag).
  -- Même transaction — G4 garde-fou.
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    p_collecte_id,
    'attribution.validee',
    jsonb_build_object(
      'collecte_id',     p_collecte_id,
      'attribution_id',  v_attribution_id,
      'association_id',  p_association_id,
      'transporteur_id', p_transporteur_id,
      'branche',         p_branche_attribution,
      'mode_validation', p_mode_validation::text
    ),
    'attribution_job'
  )
  RETURNING id INTO v_outbox_id;

  -- INSERT outbox_events — DISPATCH (BL-P0-08). L'event collecte.creee est
  -- consommé par le worker outbox → getLogistiqueProvider(type_tms) → adapter.
  -- Le consumer est DÉRIVÉ du type_tms (jamais adapter_mts1 en dur). Émis APRÈS
  -- l'UPDATE collectes (lock tenu) → seq = ordre de commit (R1). Le worker
  -- no-op gracieusement si prestataire_logistique_id reste NULL.
  INSERT INTO plateforme.outbox_events (
    aggregate_type, aggregate_id, event_type, payload, consumer
  ) VALUES (
    'collecte',
    p_collecte_id,
    'collecte.creee',
    jsonb_build_object(
      'collecte_id',               p_collecte_id,
      'origine',                   'attribution_ag',
      'transporteur_id',           p_transporteur_id,
      'prestataire_logistique_id', v_presta_id
    ),
    v_consumer
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'attribution_id',  v_attribution_id,
    'outbox_id',       v_outbox_id,
    'pack_id',         v_pack_id,
    'consumer',        v_consumer
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text)
  FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.rpc_valider_attribution_ag(uuid, uuid, uuid, text, plateforme.mode_validation, uuid, text, text)
  TO service_role;

-- ─── 9. Reprise des collectes existantes ─────────────────────────────────────
-- Avant cette migration, une collecte à venir n'avait consommé aucun crédit :
-- le pack qu'elle porte éventuellement n'était qu'une réservation posée à
-- l'envoi au transporteur. Les réservations sont levées, puis chaque collecte
-- AG à venir est débitée sur le pack actif de son organisation, dans l'ordre
-- de son créneau, jusqu'à épuisement (Val 2026-11-02). Celles qui dépassent
-- restent sans pack : facturées à l'unité, rattachables plus tard.
-- `updated_at` n'est pas touché : la collecte elle-même ne change pas.
DO $$
DECLARE
  r         record;
  v_pack_id uuid;
  v_debits  integer := 0;
  v_sans    integer := 0;
BEGIN
  IF current_setting('savr.reprise_pack_debit_programmation', true)
       IS DISTINCT FROM 'a_faire' THEN
    RAISE NOTICE 'Reprise pack AG : déjà faite, rien à reprendre';
    RETURN;
  END IF;

  UPDATE plateforme.collectes
     SET pack_antgaspi_id = NULL
   WHERE type = 'anti_gaspi'
     AND pack_antgaspi_id IS NOT NULL
     AND statut IN ('programmee', 'validee', 'en_cours', 'annulation_demandee',
                    'rejetee_par_prestataire');

  FOR r IN
    SELECT c.id, e.organisation_id
      FROM plateforme.collectes c
      JOIN plateforme.evenements e ON e.id = c.evenement_id
     WHERE c.type = 'anti_gaspi'
       AND c.pack_antgaspi_id IS NULL
       AND c.annulee_cote_savr = false
       AND c.statut IN ('programmee', 'validee', 'en_cours', 'annulation_demandee')
     ORDER BY e.organisation_id, c.date_collecte,
              c.heure_collecte NULLS LAST, c.created_at, c.id
  LOOP
    -- Même ordre de verrous que les déclencheurs : la collecte, puis le pack.
    PERFORM 1 FROM plateforme.collectes WHERE id = r.id FOR UPDATE;
    v_pack_id := plateforme.f_pack_debiter_credit(r.organisation_id);
    IF v_pack_id IS NULL THEN
      v_sans := v_sans + 1;
      CONTINUE;
    END IF;
    UPDATE plateforme.collectes SET pack_antgaspi_id = v_pack_id WHERE id = r.id;
    INSERT INTO plateforme.audit_log (
      table_name, record_id, action, old_values, new_values
    ) VALUES (
      'packs_antgaspi', v_pack_id,
      'pack_debite_programmation',
      jsonb_build_object('collecte_id', r.id),
      jsonb_build_object('reprise', '20261102180000')
    );
    v_debits := v_debits + 1;
  END LOOP;
  RAISE NOTICE 'Reprise pack AG : % collecte(s) débitée(s), % sans crédit', v_debits, v_sans;
END;
$$;
