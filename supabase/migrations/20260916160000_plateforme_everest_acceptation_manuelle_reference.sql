-- =============================================================================
-- Acceptation manuelle d'une mission Everest : la reference de mission devient
-- OBLIGATOIRE et est ecrite comme au dispatch normal, atomiquement.
-- =============================================================================
-- POURQUOI (arbitrage Val 2026-09-16, divergence
-- M2.5_20260915_mission-acceptee-au-telephone-sans-reference ; §06.06 §3 Bloc 0
-- « Acceptation manuelle d'une mission Everest (A Toutes! indisponible) »)
--
-- Quand l'API Everest est indisponible, Ops cale la course par telephone et
-- l'enregistre dans le back-office. La route posait `everest_missions.statut_everest
-- = 'created_manually'` et rien d'autre : ni `tournees.external_ref_commande`, ni
-- `collectes.tms_reference`. La mission etait donc INVISIBLE au systeme :
--   · la collecte restait dans la carte « Collectes non transmises » (predicat
--     `statut_tms = 'non_envoye' AND tms_reference IS NULL`) alors qu'un velo
--     etait reserve ;
--   · `fn_collecte_commandee_chez_provider` (qui exige une reference de
--     commande) repondait `false` → « Renvoyer au TMS » emettait un E1, pas un E2 ;
--   · `AdapterEverest.cancelCollecte` filtre sur `external_ref_commande` → le
--     bouton Annuler sortait en `noop_no_remote`, et le velo se presentait sur
--     une collecte annulee cote Savr.
--
-- La route faisait en outre ses 3 a 4 ecritures SANS lire une seule `error` :
-- un contact absent violait `chk_everest_created_manually` en silence et la
-- route repondait `{ ok: true }` sans avoir rien ecrit.
--
-- CE QUE POSE CETTE MIGRATION
-- Une RPC unique, `fn_accepter_mission_everest_manuelle`, qui fait dans UNE
-- transaction, sous row lock de l'agregat (CLAUDE.md R1) :
--   1. garde : collecte existante, non terminale, dispatchee chez un
--      transporteur `a_toutes` ;
--   2. resolution de la tournee Everest (rang le plus bas) — meme regle que
--      l'adapter : le provider se lit sur `tournees.prestataire_logistique_id`
--      → `transporteurs.type_tms`, jamais sur la reference (partagee) ;
--   3. garde : pas de mission reellement creee par l'API (seuls
--      `creation_failed` et `created_manually` sont repris) ;
--   4. ecriture de la reference, a l'identique de `commitReferenceMission` :
--      `tournees.external_ref_commande` + `collectes.tms_reference`, plus
--      `everest_missions.everest_mission_id` (l'adapter annule par
--      `mission_id = external_ref_commande` : la reference EST l'identifiant de
--      mission, et le webhook Everest retrouve la mission par cette colonne) ;
--   5. `statut_tms` → `acceptee` (le trigger derive `statut = 'validee'`) ;
--   6. trace `audit_log`.
-- `uniq_tournee_par_external_ref` est respecte par construction : une reference
-- deja portee par une AUTRE tournee est refusee (P0003 → 409 cote route).
--
-- Refus metier en ERRCODE P0003 : le MESSAGE est un libelle FR ecrit ici, destine
-- a l'utilisateur (convention `businessError` de la route) — jamais un detail
-- Postgres.
--
-- Rejeu avec la MEME reference = no-op idempotent (double clic). Une reference
-- DIFFERENTE sur une mission deja acceptee = refus : la corriger reviendrait a
-- reattribuer la mission, ce qui n'est pas ce geste.
--
-- NATURE DE LA MIGRATION
-- Non destructive : aucun DROP, aucun RENAME, aucun backfill.
-- N'OUVRE aucun acces : fonction SECURITY INVOKER (appelee par la route sous
-- service_role, qui bypasse deja la RLS), EXECUTE revoque a PUBLIC, anon et
-- authenticated puis accorde au seul service_role.
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

COMMENT ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text) IS
  'Failover Ops (Everest indisponible) : enregistre une mission calee par telephone avec A Toutes!. '
  'Ecrit ATOMIQUEMENT la reference de mission comme au dispatch normal '
  '(tournees.external_ref_commande + collectes.tms_reference + everest_missions.everest_mission_id), '
  'pose created_manually et statut_tms=acceptee. Consequences : la collecte sort des « non transmises », '
  'fn_collecte_commandee_chez_provider repond true (renvoi = E2), cancelCollecte retrouve la mission. '
  'service_role uniquement (route admin/everest/missions/manual-accept).';

REVOKE EXECUTE ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_accepter_mission_everest_manuelle(uuid, text, text, uuid, text, text, text)
  TO service_role;
