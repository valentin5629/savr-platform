-- =============================================================================
-- Renommage du transporteur vélo cargo : « A Toutes! » → « A Toute! »
-- (demande Val 2026-11-10 : le nom s'écrit sans « s »).
--
-- Seul le NOM AFFICHÉ change. L'identifiant technique `a_toutes` (valeur de
-- l'enum `type_tms`, clé de paramètre `a_toutes_indisponible`, code d'email
-- `ag_a_toutes_indispo`) reste tel quel : aucune structure ne bouge.
--
-- Textes en base portant l'ancien nom, relevés en lecture seule le 2026-11-10,
-- identiques sur savr-dev et savr-prod :
--   1. plateforme.transporteurs.nom et shared.prestataires.nom (1 ligne chacun,
--      données de référentiel posées par le seed ou l'Admin, absentes d'une base
--      neuve) ;
--   2. plateforme.parametres_algo.description (a_toutes_indisponible,
--      everest_codes_postaux) ;
--   3. plateforme.email_templates.sujet (ag_a_toutes_indispo, désactivé) ;
--   4. deux messages d'erreur de plateforme.fn_accepter_mission_everest_manuelle,
--      et son commentaire.
--
-- La fonction est réécrite à l'identique (définition lue par pg_get_functiondef
-- sur dev et prod, identique sur les deux), hormis les deux messages. Elle reste
-- SECURITY INVOKER ; CREATE OR REPLACE garde ses droits (service_role seul).
--
-- Nature : textes seulement, aucune structure ni aucun droit touchés. Idempotent :
-- un rejeu ne trouve plus l'ancien texte. Contrôle de fin positif sur les
-- lignes que les migrations créent (paramètres, gabarit), négatif sur les
-- référentiels (absents d'une base neuve).
--
-- Retour arrière : remplacements inverses.
-- =============================================================================

UPDATE plateforme.transporteurs
SET nom = replace(nom, 'A Toutes', 'A Toute')
WHERE nom LIKE '%A Toutes%';

UPDATE shared.prestataires
SET nom = replace(nom, 'A Toutes', 'A Toute')
WHERE nom LIKE '%A Toutes%';

UPDATE plateforme.parametres_algo
SET description = replace(description, 'A Toutes!', 'A Toute!')
WHERE description LIKE '%A Toutes!%';

UPDATE plateforme.email_templates
SET sujet = replace(sujet, 'A Toutes!', 'A Toute!'),
    updated_at = now()
WHERE sujet LIKE '%A Toutes!%';

CREATE OR REPLACE FUNCTION plateforme.fn_accepter_mission_everest_manuelle(p_collecte_id uuid, p_reference text, p_contact text, p_user_id uuid, p_role text, p_commentaire text DEFAULT NULL::text, p_heure_appel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_statut          text;
  v_statut_tms      text;
  v_type_tms        text;
  v_tournee_id      uuid;
  v_ref_existante   text;
  v_mission_id      uuid;
  v_mission_statut  text;
  v_now             timestamptz := now();
BEGIN
  -- Defense en profondeur : la route valide deja, mais la RPC ne doit jamais
  -- poser un `created_manually` sans reference ni contact.
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'reference_obligatoire' USING ERRCODE = '22023';
  END IF;
  IF p_contact IS NULL OR btrim(p_contact) = '' THEN
    RAISE EXCEPTION 'contact_obligatoire' USING ERRCODE = '22023';
  END IF;

  -- 1. Row lock de l'agregat AVANT toute ecriture (CLAUDE.md R1) : serialise
  --    l'acceptation avec un dispatch, une modification ou une annulation
  --    concurrents sur la meme collecte.
  SELECT c.statut::text, c.statut_tms::text, tr.type_tms::text
    INTO v_statut, v_statut_tms, v_type_tms
    FROM plateforme.collectes c
    LEFT JOIN plateforme.transporteurs tr
      ON tr.prestataire_logistique_id = c.prestataire_logistique_id
   WHERE c.id = p_collecte_id
     FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  IF v_statut IN ('realisee', 'realisee_sans_collecte', 'cloturee', 'annulee') THEN
    RAISE EXCEPTION 'Collecte terminée ou annulée : acceptation manuelle impossible.' USING ERRCODE = 'P0003';
  END IF;

  -- Une collecte re-dispatchee vers un camion ne doit pas recevoir une
  -- reference velo : le gate d'emission la comparerait au MAUVAIS provider.
  IF v_type_tms IS DISTINCT FROM 'a_toutes' THEN
    RAISE EXCEPTION 'La collecte n''est pas attribuée à A Toute! : dispatchez-la d''abord vers ce transporteur.' USING ERRCODE = 'P0003';
  END IF;

  -- Un refus explicite du transporteur ne se requalifie pas en acceptation
  -- (§06.06 §3 Bloc 0, plan `acceptation_manuelle_everest_statut_depart`).
  -- Place avant toute ecriture, et avant le rejeu : rien n'est pose.
  IF v_statut_tms = 'rejetee_par_prestataire' THEN
    RAISE EXCEPTION 'A Toute! a refusé cette collecte : une acceptation manuelle ne peut pas remplacer ce refus. Réattribuez la collecte.' USING ERRCODE = 'P0003';
  END IF;

  -- 2. Tournee Everest de la collecte (rang le plus bas), verrouillee.
  SELECT t.id, t.external_ref_commande
    INTO v_tournee_id, v_ref_existante
    FROM plateforme.collecte_tournees ct
    JOIN plateforme.tournees t ON t.id = ct.tournee_id
    JOIN plateforme.transporteurs tr
      ON tr.prestataire_logistique_id = t.prestataire_logistique_id
   WHERE ct.collecte_id = p_collecte_id
     AND tr.type_tms = 'a_toutes'
   ORDER BY ct.rang
   LIMIT 1
     FOR UPDATE OF t;

  IF v_tournee_id IS NULL THEN
    RAISE EXCEPTION 'tournee_everest_introuvable' USING ERRCODE = 'P0002';
  END IF;

  SELECT m.id, m.statut_everest::text
    INTO v_mission_id, v_mission_statut
    FROM plateforme.everest_missions m
   WHERE m.tournee_id = v_tournee_id
     FOR UPDATE;

  -- 3. Une mission creee par l'API porte deja sa reference et son cycle de vie
  --    webhook : l'ecraser en `created_manually` effacerait la vraie mission.
  IF v_mission_id IS NOT NULL
     AND v_mission_statut NOT IN ('creation_failed', 'created_manually') THEN
    RAISE EXCEPTION 'Une mission a déjà été créée chez Everest pour cette collecte : aucune acceptation manuelle nécessaire.' USING ERRCODE = 'P0003';
  END IF;

  IF v_ref_existante IS NOT NULL THEN
    IF v_ref_existante = p_reference AND v_mission_statut = 'created_manually' THEN
      -- Rejeu (double clic, retry reseau) : deja fait, rien a reecrire.
      RETURN jsonb_build_object(
        'tournee_id', v_tournee_id, 'reference', p_reference, 'rejeu', true);
    END IF;
    RAISE EXCEPTION 'Une autre référence de mission est déjà enregistrée pour cette collecte.' USING ERRCODE = 'P0003';
  END IF;

  -- 4. La reference, a l'identique de `AdapterEverest.commitReferenceMission`.
  --    Une reference deja portee par une autre tournee viole
  --    `uniq_tournee_par_external_ref` : c'est le PREMIER ecrit, rien n'est donc
  --    encore pose, et le refus metier annule toute la fonction.
  BEGIN
    UPDATE plateforme.tournees
       SET external_ref_commande = p_reference
     WHERE id = v_tournee_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Cette référence de mission est déjà enregistrée sur une autre collecte. Vérifiez la saisie.'
      USING ERRCODE = 'P0003';
  END;

  IF v_mission_id IS NOT NULL THEN
    UPDATE plateforme.everest_missions
       SET statut_everest               = 'created_manually',
           everest_mission_id           = p_reference,
           manual_acceptance_at         = v_now,
           manual_acceptance_by_user_id = p_user_id,
           manual_acceptance_contact    = p_contact,
           manual_acceptance_commentaire = p_commentaire,
           payload_latest_update        = jsonb_build_object(
             'manual', true, 'heure_appel', p_heure_appel, 'ops_user_id', p_user_id),
           derniere_sync_at             = v_now
     WHERE id = v_mission_id;
  ELSE
    INSERT INTO plateforme.everest_missions (
      tournee_id, collecte_id, everest_mission_id, everest_service_id,
      statut_everest, manual_acceptance_at, manual_acceptance_by_user_id,
      manual_acceptance_contact, manual_acceptance_commentaire,
      payload_latest_update, derniere_sync_at
    ) VALUES (
      v_tournee_id, p_collecte_id, p_reference,
      71, -- service par defaut si inconnu (comportement historique de la route)
      'created_manually', v_now, p_user_id, p_contact, p_commentaire,
      jsonb_build_object(
        'manual', true, 'heure_appel', p_heure_appel, 'ops_user_id', p_user_id),
      v_now
    )
    RETURNING id INTO v_mission_id;
  END IF;

  -- Reference d'affichage : sort la collecte de la carte « non transmises » et
  -- fait basculer le bouton en « Renvoyer ». Jamais un predicat d'emission.
  UPDATE plateforme.collectes
     SET tms_reference = p_reference
   WHERE id = p_collecte_id;

  -- 5. Acceptation explicite du transporteur (signal positif, §04 `statut_tms`).
  --    Everest indisponible, l'E1 a echoue en TRANSIENT : la collecte est le plus
  --    souvent encore `non_envoye`.
  IF v_statut_tms IN ('non_envoye', 'a_attribuer', 'attribuee_en_attente_acceptation') THEN
    UPDATE plateforme.collectes
       SET statut_tms = 'acceptee'
     WHERE id = p_collecte_id;
  END IF;

  -- 6. Trace.
  INSERT INTO plateforme.audit_log (user_id, role, action, table_name, record_id, new_values)
  VALUES (
    p_user_id, p_role, 'MANUAL_ACCEPT', 'everest_missions', v_mission_id,
    jsonb_build_object(
      'collecte_id', p_collecte_id,
      'tournee_id', v_tournee_id,
      'statut_everest', 'created_manually',
      'external_ref_commande', p_reference,
      'manual_acceptance_contact', p_contact,
      'manual_acceptance_commentaire', p_commentaire,
      'heure_appel', p_heure_appel
    )
  );

  RETURN jsonb_build_object(
    'tournee_id', v_tournee_id, 'reference', p_reference, 'rejeu', false);
END;
$function$
;

COMMENT ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text) IS
  'Failover Ops (Everest indisponible) : enregistre une mission calee par telephone avec A Toute!. '
  'Ecrit ATOMIQUEMENT la reference de mission comme au dispatch normal '
  '(tournees.external_ref_commande + collectes.tms_reference + everest_missions.everest_mission_id), '
  'pose created_manually et statut_tms=acceptee. Consequences : la collecte sort des « non transmises », '
  'fn_collecte_commandee_chez_provider repond true (renvoi = E2), cancelCollecte retrouve la mission. '
  'service_role uniquement (route admin/everest/missions/manual-accept).';

DO $$
DECLARE n_ancien int; n_nouveau int;
BEGIN
  SELECT
      (SELECT count(*) FROM plateforme.transporteurs WHERE nom LIKE '%A Toutes%')
    + (SELECT count(*) FROM shared.prestataires WHERE nom LIKE '%A Toutes%')
    + (SELECT count(*) FROM plateforme.parametres_algo WHERE description LIKE '%A Toutes%')
    + (SELECT count(*) FROM plateforme.email_templates WHERE sujet LIKE '%A Toutes%')
    + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'plateforme' AND p.prosrc LIKE '%A Toutes%')
    + (SELECT count(*) FROM pg_description WHERE description LIKE '%A Toutes%')
  INTO n_ancien;
  SELECT
      (SELECT count(*) FROM plateforme.parametres_algo
        WHERE cle IN ('a_toutes_indisponible', 'everest_codes_postaux')
          AND description LIKE '%A Toute!%')
    + (SELECT count(*) FROM plateforme.email_templates
        WHERE code = 'ag_a_toutes_indispo' AND sujet LIKE '%A Toute!%')
  INTO n_nouveau;
  IF n_ancien > 0 OR n_nouveau <> 3 THEN
    RAISE EXCEPTION 'renommage A Toute! : % texte(s) gardent l''ancien nom, % texte(s) à jour (attendu 0 et 3)', n_ancien, n_nouveau;
  END IF;
END $$;
