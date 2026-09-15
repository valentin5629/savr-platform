-- =============================================================================
-- `fn_collecte_commandee_chez_provider` : le predicat porte enfin son nom
-- =============================================================================
-- POURQUOI
-- Le predicat repondait « une commande existe-t-elle ? », jamais « ... CHEZ CE
-- PRESTATAIRE ? » : il ne joignait pas `tournees.prestataire_logistique_id` ->
-- `transporteurs.type_tms`. Or `tournees.external_ref_commande` est une colonne
-- PARTAGEE entre providers (chacun y ecrit sa propre reference).
--
-- Consequence, reproduite sur savr-dev (transaction annulee) : une collecte
-- dispatchee chez un transporteur, puis RE-dispatchee chez un transporteur de
-- l'autre type, voyait le predicat repondre `true` sur la tournee residuelle du
-- PREMIER — l'outbox emettait donc `collecte.modifiee` (E2) la ou il fallait
-- `collecte.creee` (E1).
--
-- Tant que les adapters lisaient les tournees sans filtre, ce mauvais type
-- d'event produisait un appel CROISE (une reference de l'autre provider
-- adressee au notre). Depuis que les adapters cloisonnent leurs lectures
-- (migration de code du meme lot), il produit pire : un NO-OP. E2 ne trouve
-- aucune tournee du provider cible, sort en `noop_no_remote`, et l'event est
-- marque `done` — la collecte est re-dispatchee dans l'UI, et rien n'est
-- commande nulle part. C'est pourquoi le filtre applicatif NE SUFFIT PAS : il
-- faut que l'event emis soit du bon TYPE.
--
-- Cote Everest le no-op est structurel (`updateCollecte` = alerte Ops, pas de
-- dispatch possible) : aucune correction cote adapter ne pourrait rattraper un
-- E2 recu a la place d'un E1. Le gate est donc le seul bon endroit.
--
-- REGLE POSEE
-- « Commandee chez le provider » = il existe une tournee AVEC reference de
-- commande dont le prestataire a le MEME `type_tms` que le prestataire porte par
-- la collecte. Comparaison sur le TYPE et non sur le prestataire : c'est
-- exactement la regle des adapters (le worker instancie l'adapter avec
-- « n'importe quel » transporteur du type), donc le predicat reste le miroir
-- exact de la garde du consommateur. Deux transporteurs MTS-1 (Strike,
-- Marathon) restent interchangeables de ce point de vue.
--
-- Collecte sans prestataire -> aucune ligne -> `false` -> E1. C'est le bon
-- resultat : le worker sort de toute facon en `noop_no_remote` faute de
-- prestataire a router.
--
-- ORDRE D'EVALUATION (le second volet de la correction)
-- Le predicat lit `collectes.prestataire_logistique_id`. Il doit donc etre
-- evalue APRES l'UPDATE qui peut changer ce prestataire, sinon il repond sur
-- l'ANCIEN provider et le bug persiste a l'identique. Deux RPC sont
-- concernees — `fn_dispatcher_collecte` (override Ops) et `fn_modifier_collecte`
-- (le PATCH Admin expose `prestataire_logistique_id`) : leur corps est repris
-- VERBATIM, seule la POSITION de la ligne `v_commandee := …` change. Le row lock
-- reste pris AVANT tout (CLAUDE.md R1 : lock de l'agregat avant l'INSERT outbox).
-- `fn_modifier_evenement` ne touche pas au prestataire : elle n'est pas modifiee.
--
-- NATURE DE LA MIGRATION
-- Non destructive : aucun DROP, aucun RENAME, aucune signature changee, aucun
-- backfill. N'OUVRE aucun acces : les trois fonctions gardent leurs REVOKE
-- (re-emis ici, `CREATE OR REPLACE` ne devant jamais etre l'occasion d'un
-- elargissement silencieux) et `SET search_path` est re-inclus a chaque corps.
-- =============================================================================

-- ─── 1. Le predicat ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION plateforme.fn_collecte_commandee_chez_provider(
  p_collecte_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'plateforme', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collectes c
    JOIN plateforme.transporteurs tr_cible
      ON tr_cible.prestataire_logistique_id = c.prestataire_logistique_id
    JOIN plateforme.collecte_tournees ct
      ON ct.collecte_id = c.id
    JOIN plateforme.tournees t
      ON t.id = ct.tournee_id
    JOIN plateforme.transporteurs tr_tournee
      ON tr_tournee.prestataire_logistique_id = t.prestataire_logistique_id
    WHERE c.id = p_collecte_id
      AND t.external_ref_commande IS NOT NULL
      AND tr_tournee.type_tms = tr_cible.type_tms
  );
$$;

COMMENT ON FUNCTION plateforme.fn_collecte_commandee_chez_provider(uuid) IS
  'Vrai si une commande existe DEJA chez le provider vers lequel la collecte est dispatchee : '
  'au moins une tournee avec external_ref_commande dont le prestataire a le meme type_tms que '
  'le prestataire porte par la collecte. Predicat UNIQUE d''emission de E2 collecte.modifiee — '
  'miroir exact de la garde du consommateur cote adapter (qui filtre par TYPE, pas par prestataire). '
  'external_ref_commande etant partagee entre providers, un predicat aveugle au provider faisait '
  'emettre E2 sur un re-dispatch vers l''autre transporteur — donc un no-op, la collecte n''etant '
  'commandee nulle part (corrige le 2026-09-15). A evaluer APRES tout UPDATE de '
  'collectes.prestataire_logistique_id. Ne JAMAIS regater sur collectes.tms_reference '
  '(valeur d''affichage, cf. COMMENT de la colonne).';

REVOKE EXECUTE ON FUNCTION plateforme.fn_collecte_commandee_chez_provider(uuid)
  FROM PUBLIC, anon, authenticated;

-- ─── 2. fn_dispatcher_collecte — gate evalue APRES l'UPDATE ──────────────────
-- Corps repris VERBATIM de 20260915140000 ; seule la position du calcul de
-- v_event_type change (il lit desormais le prestataire CIBLE, pose par l'UPDATE).
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
BEGIN
  -- Row lock AVANT INSERT outbox (CLAUDE.md R1 — garantit ordering intra-agregat)
  PERFORM 1 FROM plateforme.collectes WHERE id = p_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- UPDATE collecte (reset dirty_tms + override optionnel prestataire)
  UPDATE plateforme.collectes
  SET
    dirty_tms                  = false,
    updated_at                 = now(),
    prestataire_logistique_id  = COALESCE(p_prestataire_logistique_id, prestataire_logistique_id),
    motif_override_prestataire = COALESCE(p_motif_override, motif_override_prestataire)
  WHERE id = p_id;

  -- Gate E2 lu APRES l'UPDATE : sur un override de prestataire, la question est
  -- « une commande existe-t-elle chez le prestataire CIBLE ? ». Lu avant, il
  -- repondait sur l'ancien — et un basculement de transporteur emettait E2, que
  -- l'adapter du nouveau provider absorbe en no-op (rien de commande nulle part).
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

REVOKE EXECUTE ON FUNCTION plateforme.fn_dispatcher_collecte(uuid, uuid, text) FROM PUBLIC;

-- ─── 3. fn_modifier_collecte — gate evalue APRES l'UPDATE ────────────────────
-- Corps repris VERBATIM de 20260915140000 ; seule la position du calcul de
-- v_commandee change. Le PATCH Admin expose `prestataire_logistique_id`
-- (ALLOWED_FIELDS de la route admin/collectes/[id]) : lu avant l'UPDATE, le gate
-- repondait la aussi sur l'ancien provider.
-- Effet de bord bienvenu : `IF NOT FOUND` suit de nouveau IMMEDIATEMENT son
-- `SELECT … INTO … FOR UPDATE`, au lieu d'en etre separe par une affectation.
CREATE OR REPLACE FUNCTION plateforme.fn_modifier_collecte(p_id uuid, p_updates jsonb, p_champs_modifies text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_row            plateforme.collectes;
  v_commandee      boolean;
  v_old_statut     plateforme.collecte_statut;
  v_old_nb_camions smallint;
  v_old_date       date;
  v_old_heure      time;
  v_new_nb_camions smallint;
  v_passe_annulee  boolean;
BEGIN
  -- Row lock + lecture de l'état courant (AVANT UPDATE et INSERT outbox). On lit
  -- aussi nb_camions_demande + date/heure pour les gardes RM-02/RM-05 sous le verrou.
  SELECT statut, nb_camions_demande, date_collecte, heure_collecte
  INTO   v_old_statut, v_old_nb_camions, v_old_date, v_old_heure
  FROM plateforme.collectes
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collecte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- ── RM-02 : nb_camions_demande interdit hors (programmee, validee, en_cours) ──
  -- Jamais de régression d'un état terminal (§05 l.271, CLAUDE.md §4). Un camion
  -- après coup sur un statut terminal = flux incident Admin, pas une modif de N.
  IF p_updates ? 'nb_camions_demande'
     AND v_old_statut NOT IN ('programmee', 'validee', 'en_cours') THEN
    RAISE EXCEPTION
      'NB_CAMIONS_STATUT_TERMINAL: nb_camions_demande non modifiable au statut % (jamais de régression d''un état terminal)',
      v_old_statut USING ERRCODE = 'P0001';
  END IF;

  -- ── RM-05 : réduction de N bloquée à moins d'1h de la mission ────────────────
  -- date/heure sont des wall-clocks naïfs → AT TIME ZONE 'Europe/Paris' (bug E2).
  IF p_updates ? 'nb_camions_demande' THEN
    v_new_nb_camions := (p_updates->>'nb_camions_demande')::smallint;
    -- Garde de domaine : au moins 1 camion (la colonne n'a pas de CHECK >= 1).
    -- Évite une donnée absurde (0 camion) ET un faux positif RM-05 (0 < N_old).
    IF v_new_nb_camions < 1 THEN
      RAISE EXCEPTION
        'NB_CAMIONS_INVALIDE: nb_camions_demande doit être >= 1 (reçu %)', v_new_nb_camions
        USING ERRCODE = 'P0001';
    END IF;
    IF v_new_nb_camions < COALESCE(v_old_nb_camions, 1)
       AND (((v_old_date + COALESCE(v_old_heure, '00:00:00'::time))
              AT TIME ZONE 'Europe/Paris') - interval '1 hour') <= now() THEN
      RAISE EXCEPTION
        'REDUCTION_CANCEL_WINDOW_CLOSED: réduction du nombre de camions bloquée à moins d''1h avant la mission'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- UPDATE avec CASE WHEN pour honorer les mises à null explicites
  UPDATE plateforme.collectes c SET
    date_collecte = CASE WHEN p_updates ? 'date_collecte'
      THEN (p_updates->>'date_collecte')::date ELSE c.date_collecte END,
    heure_collecte = CASE WHEN p_updates ? 'heure_collecte'
      THEN (p_updates->>'heure_collecte')::time ELSE c.heure_collecte END,
    nb_camions_demande = CASE WHEN p_updates ? 'nb_camions_demande'
      THEN (p_updates->>'nb_camions_demande')::smallint ELSE c.nb_camions_demande END,
    controle_acces_requis = CASE WHEN p_updates ? 'controle_acces_requis'
      THEN (p_updates->>'controle_acces_requis')::boolean ELSE c.controle_acces_requis END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE c.notes_internes END,
    informations_supplementaires = CASE WHEN p_updates ? 'informations_supplementaires'
      THEN p_updates->>'informations_supplementaires' ELSE c.informations_supplementaires END,
    prestataire_logistique_id = CASE WHEN p_updates ? 'prestataire_logistique_id'
      THEN (p_updates->>'prestataire_logistique_id')::uuid ELSE c.prestataire_logistique_id END,
    motif_override_prestataire = CASE WHEN p_updates ? 'motif_override_prestataire'
      THEN p_updates->>'motif_override_prestataire' ELSE c.motif_override_prestataire END,
    statut = CASE WHEN p_updates ? 'statut'
      THEN (p_updates->>'statut')::plateforme.collecte_statut ELSE c.statut END,
    annulee_cote_savr = CASE WHEN p_updates ? 'annulee_cote_savr'
      THEN (p_updates->>'annulee_cote_savr')::boolean ELSE c.annulee_cote_savr END,
    annulee_cote_savr_motif = CASE WHEN p_updates ? 'annulee_cote_savr_motif'
      THEN p_updates->>'annulee_cote_savr_motif' ELSE c.annulee_cote_savr_motif END,
    lieu_overrides = CASE WHEN p_updates ? 'lieu_overrides'
      THEN p_updates->'lieu_overrides' ELSE c.lieu_overrides END,
    -- RM-09 : champs incident (flux collecte manquée / imputabilité §05 §4bis)
    incident_imputable_a = CASE WHEN p_updates ? 'incident_imputable_a'
      THEN (p_updates->>'incident_imputable_a')::plateforme.incident_imputable ELSE c.incident_imputable_a END,
    motif_incident = CASE WHEN p_updates ? 'motif_incident'
      THEN p_updates->>'motif_incident' ELSE c.motif_incident END,
    collecte_remplacee_id = CASE WHEN p_updates ? 'collecte_remplacee_id'
      THEN (p_updates->>'collecte_remplacee_id')::uuid ELSE c.collecte_remplacee_id END,
    updated_at = now()
  WHERE c.id = p_id
  RETURNING * INTO v_row;

  -- Gate E2 : « une commande existe deja chez le prestataire CIBLE ». Lu sous le
  -- verrou de l'agregat (pris en tete), et APRES l'UPDATE : le patch peut changer
  -- `prestataire_logistique_id`, auquel cas la question porte sur le nouveau.
  v_commandee := plateforme.fn_collecte_commandee_chez_provider(p_id);

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3).
  v_passe_annulee := (p_updates ? 'statut'
                      AND p_updates->>'statut' = 'annulee'
                      AND v_old_statut <> 'annulee');

  -- Outbox E2 si une commande existe chez le prestataire — jamais quand le patch
  -- pose statut='annulee' (E3 prend le relais — condition originale conservée).
  IF v_commandee
     AND NOT (p_updates ? 'statut' AND p_updates->>'statut' = 'annulee')
  THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.modifiee',
      jsonb_build_object(
        'collecte_id',    p_id,
        'champs_modifies', to_jsonb(p_champs_modifies)
      ),
      'adapter_mts1'
    );
  END IF;

  -- E3 collecte.annulee émise INLINE (pattern RPC, plus de trigger).
  IF v_passe_annulee THEN
    INSERT INTO plateforme.outbox_events (
      aggregate_type, aggregate_id, event_type, payload, consumer
    ) VALUES (
      'collecte',
      p_id,
      'collecte.annulee',
      jsonb_build_object('collecte_id', p_id, 'type', v_row.type::text),
      'adapter_mts1'
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) TO service_role;

-- ─── 4. Harnais pgTAP : la fixture doit modeliser un dispatch REEL ───────────
-- `tests.outbox_fixture_collecte` (20260915140000) monte l'etat post-dispatch :
-- une tournee portant `external_ref_commande`, liee par `collecte_tournees`.
-- Il y manquait ce que la production pose toujours : le TRANSPORTEUR du
-- prestataire, et `collectes.prestataire_logistique_id`. Sans eux, le gate
-- desormais provider-aware repond `false` et l'assertion « E2 collecte.modifiee »
-- de supabase/tests/outbox_par_mutation.test.sql (garde-fou 4 TMS-Ready) tombe —
-- non pas parce que l'emission est cassee, mais parce que la fixture decrit une
-- collecte dispatchee chez personne, etat qui n'existe pas en production.
--
-- Corps repris VERBATIM de 20260915140000, augmente de ces deux lignes. Le
-- contrat de non-complaisance est CONSERVE : `tms_reference` reste volontairement
-- NULL, et le helper n'emet toujours que le E1 de fn_creer_collecte.
CREATE OR REPLACE FUNCTION tests.outbox_fixture_collecte(p_type text DEFAULT 'zd')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_org_id        uuid := gen_random_uuid();
  v_user_id       uuid := gen_random_uuid();
  v_lieu_id       uuid;
  v_entite_id     uuid;
  v_type_evt_id   uuid;
  v_evt_id        uuid;
  v_collecte_id   uuid;
  v_presta_id     uuid;
  v_tournee_id    uuid;
  v_suffixe       text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  -- Organisation minimale
  INSERT INTO plateforme.organisations (id, nom, type, siret, created_at, updated_at)
  VALUES (v_org_id, 'FixtureOrg-G4', 'traiteur', '00000000000001', now(), now());

  -- User minimal (created_by NOT NULL sur evenements)
  INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, created_at)
  VALUES (v_user_id, v_org_id, 'fixture-g4@test.internal', 'Fixture', 'G4', 'traiteur_manager', now());

  -- Entite de facturation minimale (entite_facturation_id NOT NULL)
  INSERT INTO plateforme.entites_facturation (
    organisation_id, raison_sociale, siret,
    adresse_facturation, code_postal, ville, created_at, updated_at
  ) VALUES (
    v_org_id, 'FixtureEntite-G4', '00000000000001',
    '1 rue Fixture', '75001', 'Paris', now(), now()
  ) RETURNING id INTO v_entite_id;

  -- Type evenement minimal (type_evenement_id NOT NULL, code UNIQUE)
  INSERT INTO plateforme.types_evenements (code, libelle, created_at, updated_at)
  VALUES ('FIXTURE_G4', 'Fixture G4', now(), now())
  ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle
  RETURNING id INTO v_type_evt_id;

  -- Lieu minimal
  INSERT INTO plateforme.lieux (nom, adresse_acces, code_postal, ville, type_vehicule_max, created_at, updated_at)
  VALUES ('FixtureLieu-G4', '1 rue Test', '75001', 'Paris', 'fourgon', now(), now())
  RETURNING id INTO v_lieu_id;

  -- Evenement avec toutes les colonnes NOT NULL
  INSERT INTO plateforme.evenements (
    organisation_id,
    traiteur_operationnel_organisation_id,
    entite_facturation_id,
    lieu_id,
    created_by,
    type_evenement_id,
    nom_evenement,
    pax,
    contact_principal_nom,
    contact_principal_telephone,
    created_at, updated_at
  ) VALUES (
    v_org_id, v_org_id, v_entite_id, v_lieu_id, v_user_id, v_type_evt_id,
    'FixtureEvenement-G4', 100,
    'Contact Fixture', '0600000000',
    now(), now()
  ) RETURNING id INTO v_evt_id;

  -- Creation collecte via RPC (emet E1 atomiquement) — SEUL event pose par ce helper.
  v_collecte_id := plateforme.fn_creer_collecte(
    p_evenement_id   := v_evt_id,
    p_type           := p_type,
    p_date_collecte  := CURRENT_DATE + 30,
    p_heure_collecte := '09:00'::time
  );

  -- Etat POST-DISPATCH : une commande existe chez le prestataire. C'est exactement
  -- ce que l'adapter ecrit (upsertTournee + lien de rang), et c'est ce que lit
  -- desormais le gate E2. `tms_reference` reste volontairement NULL : le test doit
  -- rester vert SANS elle, sinon il redeviendrait complaisant.
  INSERT INTO shared.prestataires (nom, code, type_prestation, mode_integration, statut, created_at, updated_at)
  VALUES ('FixturePresta-G4', 'FIXTURE_G4', ARRAY['zd','ag'], 'manuel', 'actif', now(), now())
  -- DO UPDATE ... = shared.prestataires.nom : ne mute RIEN sur conflit (il faut un
  -- DO UPDATE pour que RETURNING renvoie l'id existant). Un prestataire reel qui
  -- porterait ce code ne serait jamais renomme par le harnais de test.
  ON CONFLICT (code) DO UPDATE SET nom = shared.prestataires.nom
  RETURNING id INTO v_presta_id;

  -- Le transporteur du prestataire : c'est lui qui porte le `type_tms` sur lequel
  -- le gate compare. ON CONFLICT DO NOTHING — le helper peut etre appele plusieurs
  -- fois dans une meme transaction de test, et `uniq_transporteur_par_prestataire`
  -- n'admet qu'un transporteur par prestataire.
  INSERT INTO plateforme.transporteurs (
    nom, siren, adresse, code_postal, ville, types_vehicules, type_tms,
    contact_nom, contact_email, contact_telephone, prestataire_logistique_id,
    code_transporteur_mts1, created_at
  ) VALUES (
    'FixtureTransporteur-G4', '999000001', '1 rue Fixture', '75001', 'Paris',
    ARRAY['fourgon'], 'mts1', 'Fixture', 'fixture-g4@test.internal', '+33600000000',
    v_presta_id, 'FIXTURE-G4-CODE', now()
  )
  ON CONFLICT (prestataire_logistique_id) WHERE prestataire_logistique_id IS NOT NULL
  DO NOTHING;

  -- Le dispatch pose le prestataire sur la collecte (fn_dispatcher_collecte) :
  -- sans lui, la collecte n'est « commandee » chez aucun provider.
  UPDATE plateforme.collectes
  SET prestataire_logistique_id = v_presta_id
  WHERE id = v_collecte_id;

  INSERT INTO plateforme.tournees (
    reference_interne, date_tournee, creneau, prestataire_logistique_id,
    statut, external_ref_commande, created_at, updated_at
  ) VALUES (
    'FIXTURE-G4-' || v_suffixe, CURRENT_DATE + 30, 'nuit', v_presta_id,
    'en_cours', 'FIXTURE-CMD-' || v_suffixe, now(), now()
  ) RETURNING id INTO v_tournee_id;

  INSERT INTO plateforme.collecte_tournees (collecte_id, tournee_id, rang, created_at, updated_at)
  VALUES (v_collecte_id, v_tournee_id, 1, now(), now());

  RETURN v_collecte_id;
END;
$$;
