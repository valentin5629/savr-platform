-- =============================================================================
-- Acceptation manuelle Everest : refus 409 depuis `statut_tms =
-- 'rejetee_par_prestataire'`.
-- =============================================================================
-- SOURCE. §06.06 §3 Bloc 0, « Détails de mise en œuvre » (divergence M2.5,
-- 2026-09-16) : `statut_tms` passe à `acceptee` depuis `non_envoye`,
-- `a_attribuer` ou `attribuee_en_attente_acceptation` — « Jamais depuis
-- `rejetee_par_prestataire` ». Plan du scénario
-- `acceptation_manuelle_everest_statut_depart` : ce départ = refus 409.
--
-- DÉFAUT CORRIGÉ. La version 20260916160000 ne mettait simplement pas
-- `statut_tms` à jour dans ce cas, mais écrivait tout le reste : un refus
-- SYNCHRONE d'A Toutes! (4xx à la création) laisse la mission en
-- `creation_failed` et la collecte en `rejetee_par_prestataire` ; l'acceptation
-- manuelle répondait alors 200, posait `created_manually` et la référence, et la
-- collecte restait « rejetée » avec une mission vivante. Mesuré sur une base
-- jetable (fixtures du pgTAP everest_acceptation_manuelle_reference) avant
-- correction : `programmee | rejetee_par_prestataire | EVR-REJ-1 | created_manually`.
-- (Le refus ASYNCHRONE, par webhook, passait déjà : la mission y est en
-- `failed`/`cancelled_externally`, écartée par la garde « mission déjà créée ».)
--
-- CE QUI CHANGE. Une garde P0003 (→ 409 côté route) avant toute écriture. Le
-- reste du corps est recopié à l'identique de 20260916160000.
--
-- NATURE. CREATE OR REPLACE d'une fonction SECURITY INVOKER, plus restrictive
-- qu'avant. Droits réaffirmés à l'identique : EXECUTE retiré à PUBLIC, anon et
-- authenticated, accordé au seul service_role. Aucune table, colonne, policy
-- ni donnée touchée.
-- =============================================================================

CREATE OR REPLACE FUNCTION plateforme.fn_accepter_mission_everest_manuelle(
  p_collecte_id  uuid,
  p_reference    text,
  p_contact      text,
  p_user_id      uuid,
  p_role         text,
  p_commentaire  text DEFAULT NULL,
  p_heure_appel  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'plateforme', 'public'
AS $$
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
    RAISE EXCEPTION 'La collecte n''est pas attribuée à A Toutes! : dispatchez-la d''abord vers ce transporteur.' USING ERRCODE = 'P0003';
  END IF;

  -- Un refus explicite du transporteur ne se requalifie pas en acceptation
  -- (§06.06 §3 Bloc 0, plan `acceptation_manuelle_everest_statut_depart`).
  -- Place avant toute ecriture, et avant le rejeu : rien n'est pose.
  IF v_statut_tms = 'rejetee_par_prestataire' THEN
    RAISE EXCEPTION 'A Toutes! a refusé cette collecte : une acceptation manuelle ne peut pas remplacer ce refus. Réattribuez la collecte.' USING ERRCODE = 'P0003';
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
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text)
  TO service_role;
