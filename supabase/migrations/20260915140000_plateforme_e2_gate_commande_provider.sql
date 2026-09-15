-- =============================================================================
-- E2 `collecte.modifiee` n'etait JAMAIS emise — le gate portait sur une colonne
-- que rien n'ecrit en production (`plateforme.collectes.tms_reference`).
-- =============================================================================
-- CONSTAT (verifie sur savr-dev le 2026-09-15, lecture seule) :
--   653 collectes, dont 619 au statut_tms <> 'non_envoye' (= reellement
--   dispatchees) et 179 portant au moins une tournee avec `external_ref_commande`
--   → mais ZERO ligne avec `collectes.tms_reference` renseignee.
--   outbox_events : 32 `collecte.creee`, 0 `collecte.modifiee`.
--
--   Cause : `collectes.tms_reference` n'est ecrite par AUCUN code de production.
--   L'adapter ecrit `tournees.tms_reference` (le tourId du provider) et
--   `tournees.external_ref_commande` (la commande) ; la colonne homonyme de
--   `collectes` n'etait posee que par les fixtures pgTAP. Les 3 gardes
--   d'emission E2 etant `collectes.tms_reference IS NOT NULL`, leur predicat
--   etait TOUJOURS faux.
--
--   Consequence terrain : toute modification d'une collecte deja dispatchee
--   (date, heure, nombre de camions, controle d'acces, infos complementaires ;
--   cote evenement : contacts et pax) n'etait jamais poussee au transporteur.
--   Le filet manuel « Renvoyer au TMS » ne rattrapait rien : faute de reference,
--   fn_dispatcher_collecte emettait E1 `collecte.creee`, que l'adapter traite en
--   no-op idempotent sur une tournee deja dispatchee. Cote adapter_everest, dont
--   updateCollecte est un no-op qui LEVE une alerte Ops « reporter la
--   modification manuellement », l'alerte n'etait donc jamais levee : la
--   modification se perdait en silence.
--
-- ARBITRAGE VAL (2026-09-15, option C) — on separe les deux roles que la colonne
-- confondait :
--   • PREDICAT d'emission  → « au moins une commande existe chez le provider »,
--     soit EXISTS(collecte_tournees ⋈ tournees WHERE external_ref_commande NOT
--     NULL). C'est exactement le predicat qu'utilisent DEJA les consommateurs
--     (AdapterMts1.updateCollecte et son homologue velo-cargo : `avecRef.length
--     === 0 → noop_no_remote`) → plus jamais d'E2 emise pour rien, ni manquante.
--     Insensible au multi-camions : N tournees, un seul predicat.
--   • VALEUR d'affichage / rapprochement → `collectes.tms_reference`, que les
--     adapters posent desormais au rang 1 (§04 Data Model l.1509 « identifiant de
--     la collecte cote TMS, pour rapprochement » ; §06.06 bouton « Envoyer » vs
--     « Renvoyer au TMS » ; §11 carte « Collectes non transmises au TMS »).
--     La colonne reste donc bien V1 ACTIVE, conformement au CDC — mais elle
--     n'est plus jamais un predicat d'emission.
--
-- CONTENU :
--   1. Helper `fn_collecte_commandee_chez_provider` (source unique du predicat —
--      les 3 gardes divergeaient deja dans leur redaction).
--   2. CREATE OR REPLACE des 3 RPC portant le gate.
--   3. Backfill des collectes deja dispatchees (rang 1) + COMMENT de colonne.
--
-- NON DESTRUCTIF : 3 CREATE OR REPLACE a signature identique, 1 fonction creee,
-- 1 UPDATE borne aux lignes actuellement NULL. Aucun DROP, RENAME, GRANT elargi,
-- policy assouplie ni RLS desactivee.
--
-- ⚠ EFFET DE BORD DU BACKFILL (releve par la revue securite 2026-09-15) : 8 des 10
-- triggers de `collectes` ne partent pas (7 sont `UPDATE OF <colonne>` sur des
-- colonnes absentes du SET, les 2 CO2 sont conditionnes a statut='cloturee'), mais
-- DEUX sont declares `BEFORE UPDATE` sans liste de colonnes et partent donc :
--   • trg_set_collectes_dirty_tms : compare date/heure/controle acces/infos suppl./
--     lieu_overrides — toutes inchangees par ce SET → no-op verifie ;
--   • trg_set_volume_estime_repas : RECALCULE `volume_estime_repas` =
--     ROUND(0.10 * evenements.pax) sur toute collecte AG en statut non terminal.
--     Colonne entierement DERIVEE (aucun code de production ne l'ecrit ; le trigger
--     part deja a chaque INSERT/UPDATE, et R22c-4 asserte cette derivation comme la
--     semantique voulue) → le backfill la rafraichit, il ne corrompt aucune donnee
--     metier. Rayon mesure sur savr-dev : 179 lignes backfillees, dont 4 AG non
--     terminales → 4 recalculs.
-- Compter ce rayon AVANT d'appliquer sur un autre environnement :
--   SELECT count(*) FROM plateforme.collectes c
--    WHERE c.tms_reference IS NULL AND c.type = 'anti_gaspi'
--      AND c.statut NOT IN ('realisee','realisee_sans_collecte','cloturee')
--      AND EXISTS (SELECT 1 FROM plateforme.collecte_tournees ct
--                    JOIN plateforme.tournees t ON t.id = ct.tournee_id
--                   WHERE ct.collecte_id = c.id AND ct.rang = 1
--                     AND COALESCE(t.tms_reference, t.external_ref_commande) IS NOT NULL);
-- Verifie par ailleurs sur base jetable : `updated_at` inchange, `dirty_tms`
-- inchange, 0 outbox_event emis, aucun mouvement de pack, 2e passage = no-op strict.
--
-- ── ROLLBACK (down-migration, DoD §rollback) ────────────────────────────────
--   psql -f supabase/migrations/20260614000001_plateforme_outbox_atomic_rpcs.sql  -- fn_dispatcher_collecte
--   psql -f supabase/migrations/20260702000100_plateforme_r16a_fn_modifier_collecte_gardes.sql
--   psql -f supabase/migrations/20260708140000_plateforme_r22c_fn_modifier_evenement_en_cours.sql
--   DROP FUNCTION IF EXISTS plateforme.fn_collecte_commandee_chez_provider(uuid);
--   -- Annuler le backfill (toutes ces lignes etaient NULL avant cette migration) :
--   UPDATE plateforme.collectes c SET tms_reference = NULL
--   WHERE c.tms_reference IS NOT NULL
--     AND EXISTS (SELECT 1 FROM plateforme.collecte_tournees ct
--                   JOIN plateforme.tournees t ON t.id = ct.tournee_id
--                  WHERE ct.collecte_id = c.id AND ct.rang = 1
--                    AND COALESCE(t.tms_reference, t.external_ref_commande) = c.tms_reference);
-- Effet du rollback : E2 redevient muette (bug d'origine restaure), aucune perte
-- de donnee metier.
-- =============================================================================

-- ─── 1. Predicat partage ─────────────────────────────────────────────────────
-- STABLE + SECURITY INVOKER : appele DANS les 3 RPC SECURITY DEFINER, il herite
-- donc de leurs droits (proprietaire) — inutile et risque de le rendre DEFINER.
-- REVOKE PUBLIC : jamais appelable en RPC directe (defense en profondeur, meme
-- traitement que les trigger functions de 20260614000002).
--
-- Concurrence : lu APRES le row lock sur `collectes`, sans verrou sur les
-- tournees (l'adapter les ecrit hors de la transaction metier). Les deux courses
-- possibles sont sures :
--   • tournee creee APRES la lecture → E2 non emise, mais E1 est alors encore en
--     cours de traitement et l'adapter relit la collecte (deja modifiee) pour
--     construire son payload → la modification part quand meme.
--   • tournee creee AVANT mais commande pas encore posee → E2 emise, que le
--     consommateur resout en `noop_no_remote` (comportement nominal).
CREATE OR REPLACE FUNCTION plateforme.fn_collecte_commandee_chez_provider(
  p_collecte_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'plateforme', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plateforme.collecte_tournees ct
    JOIN plateforme.tournees t ON t.id = ct.tournee_id
    WHERE ct.collecte_id = p_collecte_id
      AND t.external_ref_commande IS NOT NULL
  );
$$;

COMMENT ON FUNCTION plateforme.fn_collecte_commandee_chez_provider(uuid) IS
  'Vrai si au moins une commande existe chez le prestataire logistique pour cette collecte (>= 1 tournee avec external_ref_commande). Predicat UNIQUE d''emission de E2 collecte.modifiee — miroir exact de la garde du consommateur cote adapter. Ne JAMAIS regater sur collectes.tms_reference (valeur d''affichage, cf. COMMENT de la colonne).';

REVOKE EXECUTE ON FUNCTION plateforme.fn_collecte_commandee_chez_provider(uuid)
  FROM PUBLIC, anon, authenticated;

-- ─── 2a. fn_dispatcher_collecte ──────────────────────────────────────────────
-- Corps repris VERBATIM de 20260614000001 ; seule la derivation de v_event_type
-- change. Le renvoi Ops d'une collecte deja commandee emet desormais E2 (donc un
-- PUT reel cote provider) au lieu d'un E1 que l'adapter absorbait en no-op.
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

  v_event_type := CASE
    WHEN plateforme.fn_collecte_commandee_chez_provider(p_id) THEN 'collecte.modifiee'
    ELSE 'collecte.creee'
  END;

  -- UPDATE collecte (reset dirty_tms + override optionnel prestataire)
  UPDATE plateforme.collectes
  SET
    dirty_tms                  = false,
    updated_at                 = now(),
    prestataire_logistique_id  = COALESCE(p_prestataire_logistique_id, prestataire_logistique_id),
    motif_override_prestataire = COALESCE(p_motif_override, motif_override_prestataire)
  WHERE id = p_id;

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

-- ─── 2b. fn_modifier_collecte ────────────────────────────────────────────────
-- Corps repris VERBATIM de 20260702000100 (R16a) ; seul le gate E2 change :
-- `v_tms_reference IS NOT NULL` → `v_commandee`. Les gardes RM-02/RM-05 (N camions)
-- et les champs incident RM-09 sont inchanges. ⚠ CREATE OR REPLACE reinitialise
-- search_path → on RE-INCLUT `SET search_path`.
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

  -- Gate E2 : « une commande existe deja chez le prestataire ». Lu sous le verrou
  -- de l'agregat, apres le lock (jamais avant — ordering seq intra-agregat).
  v_commandee := plateforme.fn_collecte_commandee_chez_provider(p_id);

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

-- ─── 2c. fn_modifier_evenement ───────────────────────────────────────────────
-- Corps repris VERBATIM de 20260708140000 (R22c) ; seul le gate E2 change. La
-- fenetre d'emission (programmee/validee/en_cours) et le set TMS-pertinent
-- (contacts + pax) sont inchanges.
CREATE OR REPLACE FUNCTION plateforme.fn_modifier_evenement(
  p_id              uuid,
  p_updates         jsonb,
  p_champs_modifies text[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_evt          plateforme.evenements;
  v_pax_modifie  boolean;
  v_tms_pertinent boolean;
  v_c            record;
BEGIN
  -- ── 1. UPDATE événement (whitelist via CASE WHEN — honore les mises à null) ──
  -- lieu_id et type_evenement n'incluent PAS lieu_id verrouillé (§05 l.314 / §06.04
  -- l.459) : changer le lieu = annuler + reprogrammer. organisation_id /
  -- traiteur_operationnel / entite_facturation : immuables (jamais exposés).
  -- lieu_id / date_evenement : exposés UNIQUEMENT au back-office Admin (route
  -- admin/evenements). La route programmation/ bloque lieu_id (EVENT_LOCKED_FIELDS).
  -- lieu_id n'est PAS dans le set TMS-pertinent → un changement de lieu n'émet jamais
  -- de PATCH lieu_id (interdit §08 l.158 ; flux normal = annuler + reprogrammer).
  UPDATE plateforme.evenements e SET
    nom_evenement = CASE WHEN p_updates ? 'nom_evenement'
      THEN p_updates->>'nom_evenement' ELSE e.nom_evenement END,
    lieu_id = CASE WHEN p_updates ? 'lieu_id'
      THEN (p_updates->>'lieu_id')::uuid ELSE e.lieu_id END,
    date_evenement = CASE WHEN p_updates ? 'date_evenement'
      THEN (p_updates->>'date_evenement')::date ELSE e.date_evenement END,
    pax = CASE WHEN p_updates ? 'pax'
      THEN (p_updates->>'pax')::integer ELSE e.pax END,
    type_evenement_id = CASE WHEN p_updates ? 'type_evenement_id'
      THEN (p_updates->>'type_evenement_id')::uuid ELSE e.type_evenement_id END,
    contact_principal_nom = CASE WHEN p_updates ? 'contact_principal_nom'
      THEN p_updates->>'contact_principal_nom' ELSE e.contact_principal_nom END,
    contact_principal_telephone = CASE WHEN p_updates ? 'contact_principal_telephone'
      THEN p_updates->>'contact_principal_telephone' ELSE e.contact_principal_telephone END,
    contact_secours_nom = CASE WHEN p_updates ? 'contact_secours_nom'
      THEN p_updates->>'contact_secours_nom' ELSE e.contact_secours_nom END,
    contact_secours_telephone = CASE WHEN p_updates ? 'contact_secours_telephone'
      THEN p_updates->>'contact_secours_telephone' ELSE e.contact_secours_telephone END,
    nom_client_organisateur = CASE WHEN p_updates ? 'nom_client_organisateur'
      THEN p_updates->>'nom_client_organisateur' ELSE e.nom_client_organisateur END,
    logo_client_organisateur_url = CASE WHEN p_updates ? 'logo_client_organisateur_url'
      THEN p_updates->>'logo_client_organisateur_url' ELSE e.logo_client_organisateur_url END,
    client_organisateur_organisation_id = CASE WHEN p_updates ? 'client_organisateur_organisation_id'
      THEN (p_updates->>'client_organisateur_organisation_id')::uuid ELSE e.client_organisateur_organisation_id END,
    reference_affaire = CASE WHEN p_updates ? 'reference_affaire'
      THEN p_updates->>'reference_affaire' ELSE e.reference_affaire END,
    notes_internes = CASE WHEN p_updates ? 'notes_internes'
      THEN p_updates->>'notes_internes' ELSE e.notes_internes END,
    updated_at = now()
  WHERE e.id = p_id
  RETURNING * INTO v_evt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evenement_introuvable' USING ERRCODE = 'P0002';
  END IF;

  v_pax_modifie := p_updates ? 'pax';

  -- TMS ne persiste de l'événement que : contacts + nb_pax (§08 l.156/l.411). Les
  -- autres champs (nom, type d'événement, notes, référence affaire) sont diffés mais
  -- ignorés côté TMS → inutile de réveiller l'outbox pour eux.
  v_tms_pertinent := p_champs_modifies && ARRAY[
    'contact_principal_nom', 'contact_principal_telephone',
    'contact_secours_nom', 'contact_secours_telephone', 'pax'
  ]::text[];

  -- ── 2. Par collecte ACTIVE de l'événement (R22c : programmee/validee/en_cours) ──
  -- lock (FOR UPDATE) AVANT toute écriture/INSERT outbox → ordering seq intra-agrégat.
  -- `en_cours` ajouté (R22c/BL-P2-10, Val 2026-07-08) : une édition Admin de contact/pax
  -- sur une collecte en cours d'exécution doit aussi être poussée au TMS. Les états
  -- terminaux (realisee, realisee_sans_collecte, cloturee, rejetee_par_prestataire)
  -- restent exclus — rien à mettre à jour sur une collecte terminée.
  FOR v_c IN
    SELECT id, type
    FROM plateforme.collectes
    WHERE evenement_id = p_id
      AND statut IN ('programmee', 'validee', 'en_cours')
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Recalcul volume_estime_repas si pax modifié : le trigger BEFORE UPDATE
    -- fn_set_volume_estime_repas relit evenements.pax (AG non terminale uniquement).
    IF v_pax_modifie THEN
      UPDATE plateforme.collectes SET updated_at = now() WHERE id = v_c.id;
    END IF;

    -- E2 collecte.modifiee si une commande existe chez le prestataire ET champ
    -- TMS-pertinent changé. Le gate est lu sous le verrou de la collecte (FOR
    -- UPDATE de la boucle), jamais avant — ordering seq intra-agrégat.
    IF plateforme.fn_collecte_commandee_chez_provider(v_c.id) AND v_tms_pertinent THEN
      INSERT INTO plateforme.outbox_events (
        aggregate_type, aggregate_id, event_type, payload, consumer
      ) VALUES (
        'collecte',
        v_c.id,
        'collecte.modifiee',
        jsonb_build_object(
          'collecte_id',     v_c.id,
          'champs_modifies', to_jsonb(p_champs_modifies),
          'source',          'evenement'
        ),
        'adapter_mts1'
      );
    END IF;
  END LOOP;

  RETURN to_jsonb(v_evt);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) TO service_role;

-- ─── 3. Valeur d'affichage : backfill + contrat de la colonne ────────────────
-- Les collectes deja dispatchees avant ce correctif ont une tournee mais pas de
-- `collectes.tms_reference` : sans backfill, le bouton resterait « Envoyer au
-- TMS » (au lieu de « Renvoyer »), la carte KPI « modifiees sans renvoi TMS »
-- resterait a 0 pour elles et la fiche afficherait « — ».
--
-- Source = la tournee de RANG 1 (la collecte a N tournees en multi-camions ; le
-- CDC §04 l.1509 parle d'UN identifiant de rapprochement). COALESCE car les deux
-- providers ne nomment pas la meme chose : adapter_mts1 pose un tourId dans
-- `tournees.tms_reference`, adapter_everest ne pose que `external_ref_commande`
-- (missionId, pas de notion de tour). C'est exactement ce que les adapters
-- ecriront desormais au dispatch.
--
-- Borne aux lignes actuellement NULL → re-executable sans effet, n'ecrase jamais
-- une valeur posee par un adapter. Volume concerne sur dev au 2026-09-15 : 179
-- collectes au maximum (nombre de collectes portant une tournee commandee).
UPDATE plateforme.collectes c
SET    tms_reference = src.ref
FROM  (SELECT ct.collecte_id,
              COALESCE(t.tms_reference, t.external_ref_commande) AS ref
       FROM   plateforme.collecte_tournees ct
       JOIN   plateforme.tournees t ON t.id = ct.tournee_id
       WHERE  ct.rang = 1
         AND  COALESCE(t.tms_reference, t.external_ref_commande) IS NOT NULL) src
WHERE c.id = src.collecte_id
  AND c.tms_reference IS NULL;

COMMENT ON COLUMN plateforme.collectes.tms_reference IS
  'Identifiant de la collecte cote prestataire logistique, pour RAPPROCHEMENT et AFFICHAGE uniquement (§04 Data Model l.1509, §06.06 bouton Envoyer/Renvoyer au TMS, §11 carte Collectes non transmises). Pose par l''adapter au dispatch du rang 1 (tourId, ou missionId quand le provider n''a pas de tour). N''est JAMAIS un predicat d''emission d''event : une collecte multi-camions a N tournees et le rang 1 peut echouer seul — utiliser plateforme.fn_collecte_commandee_chez_provider(id). Regression corrigee le 2026-09-15 : E2 collecte.modifiee gatee sur cette colonne, que rien n''ecrivait, n''etait jamais emise.';

-- ─── 4. Harnais pgTAP : retirer la fixture complaisante ──────────────────────
-- `tests.outbox_fixture_collecte` (20260614000003) posait `tms_reference` A LA MAIN
-- puis appelait fn_dispatcher_collecte. Consequence : l'assertion « E2 collecte.modifiee »
-- de supabase/tests/outbox_par_mutation.test.sql comptait en realite l'event du
-- DISPATCH — le garde-fou 4 TMS-Ready etait vert alors que le predicat E2 etait
-- toujours faux en production. C'est ce test complaisant qui a laisse passer la
-- regression corrigee par cette migration.
--
-- Nouveau contrat : le helper monte l'etat POST-DISPATCH tel que l'adapter le
-- produit (une tournee portant `external_ref_commande`, liee par `collecte_tournees`),
-- SANS poser `tms_reference` et SANS emettre d'event de dispatch. Le seul event
-- ecrit reste le E1 de `fn_creer_collecte` → le test doit desormais provoquer E2
-- lui-meme, via la RPC metier, pour que l'assertion porte sur ce qu'elle annonce.
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
