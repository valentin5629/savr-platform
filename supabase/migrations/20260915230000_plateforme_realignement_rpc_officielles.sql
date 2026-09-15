-- =============================================================================
-- Réalignement prod ↔ dépôt : rétablir les définitions officielles des 3 RPC
-- =============================================================================
-- CE QUI S'EST PASSÉ (2026-09-15)
-- Les migrations 20260915210000 et 20260915220000 ont été appliquées à la base
-- de PRODUCTION alors qu'elles n'appartenaient à aucune branche mergée (PR #320,
-- jamais relue ni validée). Elles sont adoptées telles quelles dans ce dépôt par
-- les deux fichiers qui précèdent — non pour les entériner, mais parce que la
-- production les porte : les taire laisserait `supabase db push` en échec
-- permanent (« remote migration versions not found in local migrations
-- directory ») et interdirait d'appliquer toute migration ultérieure.
--
-- CE QUE CELLE-CI FAIT
-- Rétablit `fn_collecte_commandee_chez_provider`, `fn_dispatcher_collecte` et
-- `fn_modifier_collecte` dans leur définition officielle — celle de
-- 20260915140000 (#315), seule relue et validée. Copie conforme de ce fichier,
-- à l'exclusion de son backfill `UPDATE plateforme.collectes` (non rejouable) et
-- de `fn_modifier_evenement`, que 20260915220000 n'a pas touchée.
--
-- POURQUOI REVENIR EN ARRIÈRE PLUTÔT QUE D'ENTÉRINER
-- 20260915220000 restreint le prédicat d'émission de E2 aux commandes passées
-- chez le provider VERS LEQUEL la collecte est actuellement dispatchée. Sur une
-- collecte re-dispatchée d'un transporteur à l'autre, E2 n'est alors plus émise
-- du tout — et c'est précisément le cas où l'adapter doit être réveillé : son
-- filtre par provider (#323) écarte la tournée de l'autre transporteur et lève
-- l'alerte Ops `tournee_autre_provider`, qui signale une commande restée vivante
-- là-bas. Le prédicat restreint supprime cette alerte en même temps que l'event.
-- Le prédicat large est donc le bon : il émet, et c'est le consommateur qui
-- décide — en alertant s'il y a lieu.
--
-- NATURE : non destructive. Aucun DROP, aucun backfill, aucune ouverture
-- d'accès : les REVOKE/GRANT repris sont identiques à ceux déjà en vigueur.
-- =============================================================================

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Rectification du commentaire : le prédicat n'est PAS le miroir du consommateur
-- ─────────────────────────────────────────────────────────────────────────────
-- La formule « miroir exact de la garde du consommateur côté adapter » date de
-- #315 ; elle est devenue fausse avec #323, qui filtre les tournées par provider.
-- L'écart est délibéré, et c'est lui qui rend l'anomalie visible : le prédicat
-- émet large, le consommateur affine et alerte.
COMMENT ON FUNCTION plateforme.fn_collecte_commandee_chez_provider(uuid) IS
  'Vrai si au moins une commande existe pour cette collecte (>= 1 tournee avec '
  'external_ref_commande), quel que soit le provider qui l''a passee. Predicat UNIQUE '
  'd''emission de E2 collecte.modifiee. VOLONTAIREMENT PLUS LARGE que la garde du '
  'consommateur, qui filtre les tournees par type_tms (#323) : sur une collecte '
  're-dispatchee, l''event DOIT partir pour que l''adapter constate la tournee '
  'residuelle de l''autre transporteur et leve l''alerte Ops tournee_autre_provider. '
  'Restreindre ce predicat au provider courant supprimerait l''alerte avec l''event. '
  'Ne JAMAIS regater sur collectes.tms_reference (valeur d''affichage, cf. COMMENT '
  'de la colonne).';
