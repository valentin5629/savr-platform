-- =============================================================================
-- Refonte du formulaire de programmation, lot B1 (décisions Val 2026-10-22 C1–C2
-- et 2026-10-23 B1-Q1 à B1-Q3) : le type d'événement et les contacts se
-- modifient sur CHAQUE collecte ; l'événement n'en garde qu'une copie, celle de
-- sa collecte n°1, tenue par la base.
-- =============================================================================
-- 1. Les contacts de l'événement ne partent plus au prestataire (le transporteur
--    lit `collecte_contacts`, lot A) : un changement de ces contacts — désormais
--    une simple copie — n'arme plus `dirty_tms` sur toutes les collectes
--    (fn_evenement_marque_collectes_modifiees ramenée à ne rien faire ; le
--    déclencheur est gardé, aucun DROP).
-- 2. Un changement de contacts sur `collecte_contacts` arme `dirty_tms` sur CETTE
--    collecte seule, aux mêmes conditions (demande déjà partie, collecte encore à
--    réaliser).
-- 3. Copie collecte n°1 → événement (B1-Q2) : la collecte n°1 est la première
--    collecte non annulée, Zéro-Déchet avant Anti-Gaspi, puis par date, heure et
--    création. Recalculée à chaque création, suppression, annulation, changement
--    de type, de date, d'heure ou de type d'événement d'une collecte, et à chaque
--    changement de ses contacts. Événement sans collecte non annulée : copie
--    laissée telle quelle.
-- 4. fn_modifier_collecte accepte `type_evenement_id` (jamais NULL) et les quatre
--    contacts ; un E2 part pour cette collecte seule si elle est commandée (règles
--    d'émission inchangées : jamais pour une collecte terminée ou annulée), sauf
--    quand seul le type d'événement change (il ne part pas au prestataire).
-- 5. fn_modifier_evenement refuse le type d'événement et les contacts (B1-Q1) ; la
--    recopie de transition du lot A et la boucle d'E2 de l'événement (qui ne
--    servait qu'aux contacts) disparaissent.
-- Garde-fou TMS-Ready 4 : l'E2 d'un changement de contact est émis par la RPC de
-- la mutation (fn_modifier_collecte), dans la même transaction.
-- =============================================================================

DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migration à jouer sous un rôle qui contourne la RLS (rôle % soumis à la RLS)', current_user;
  END IF;
END $$;

-- ─── 1. Les contacts de l'événement ne pilotent plus dirty_tms ─────────────
CREATE OR REPLACE FUNCTION plateforme.fn_evenement_marque_collectes_modifiees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  -- Depuis le lot B1 (2026-10-23), les contacts de l'événement sont une copie de
  -- ceux de sa collecte n°1 ; le prestataire reçoit ceux de chaque collecte
  -- (collecte_contacts), qui arment dirty_tms collecte par collecte
  -- (fn_collecte_contacts_marque_collecte_modifiee). Rien à faire ici.
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_evenement_marque_collectes_modifiees()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_evenement_marque_collectes_modifiees() IS
  'Sans effet depuis le lot B1 (2026-10-23) : les contacts de l''événement sont une copie de sa collecte n°1 ; dirty_tms est armé par collecte (fn_collecte_contacts_marque_collecte_modifiee). Déclencheur conservé (aucun DROP).';

-- ─── 2. Contacts d'une collecte modifiés : dirty_tms de cette collecte ──────
CREATE OR REPLACE FUNCTION plateforme.fn_collecte_contacts_marque_collecte_modifiee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF (OLD.contact_principal_nom IS DISTINCT FROM NEW.contact_principal_nom
      OR OLD.contact_principal_telephone IS DISTINCT FROM NEW.contact_principal_telephone
      OR OLD.contact_secours_nom IS DISTINCT FROM NEW.contact_secours_nom
      OR OLD.contact_secours_telephone IS DISTINCT FROM NEW.contact_secours_telephone)
  THEN
    UPDATE plateforme.collectes c
       SET dirty_tms = true
     WHERE c.id = NEW.collecte_id
       AND c.dirty_tms = false
       AND c.statut IN ('programmee', 'validee', 'en_cours')
       AND (c.statut_tms <> 'non_envoye'
            OR c.tms_reference IS NOT NULL
            OR c.prestataire_logistique_id IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM plateforme.attributions_antgaspi a
              WHERE a.collecte_id = c.id
            ));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collecte_contacts_marque_collecte_modifiee()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collecte_contacts_marque_collecte_modifiee ON plateforme.collecte_contacts;
CREATE TRIGGER trg_collecte_contacts_marque_collecte_modifiee
  AFTER UPDATE ON plateforme.collecte_contacts
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collecte_contacts_marque_collecte_modifiee();

COMMENT ON FUNCTION plateforme.fn_collecte_contacts_marque_collecte_modifiee() IS
  'Arme collectes.dirty_tms de LA collecte dont un contact change, si sa demande est déjà partie vers le prestataire et qu''elle est encore à réaliser (programmee, validee, en_cours) — lot B1, 2026-10-23. Remis à false par fn_dispatcher_collecte.';

-- ─── 3. Copie collecte n°1 → événement (B1-Q2) ──────────────────────────────
-- SECURITY INVOKER, comme fn_set_pax_evenement : ses écrivains sont les RPC
-- SECURITY DEFINER et service_role. Verrou FOR NO KEY UPDATE de l'événement
-- (même motif que fn_set_pax_evenement : deux créations simultanées sur un même
-- événement ne s'interbloquent pas, et la seconde recalcule avec la première).
CREATE OR REPLACE FUNCTION plateforme.fn_evenement_suit_collecte_n1(p_evenement_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
DECLARE
  v record;
BEGIN
  IF p_evenement_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM plateforme.evenements WHERE id = p_evenement_id FOR NO KEY UPDATE;

  SELECT c.type_evenement_id,
         cc.contact_principal_nom, cc.contact_principal_telephone,
         cc.contact_secours_nom, cc.contact_secours_telephone
    INTO v
    FROM plateforme.collectes c
    JOIN plateforme.collecte_contacts cc ON cc.collecte_id = c.id
   WHERE c.evenement_id = p_evenement_id
     AND c.statut <> 'annulee'
   ORDER BY (c.type = 'zero_dechet') DESC,
            c.date_collecte NULLS LAST,
            c.heure_collecte NULLS LAST,
            c.created_at,
            c.id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;  -- aucune collecte non annulée : la copie reste telle quelle
  END IF;

  UPDATE plateforme.evenements e SET
    type_evenement_id           = COALESCE(v.type_evenement_id, e.type_evenement_id),
    contact_principal_nom       = v.contact_principal_nom,
    contact_principal_telephone = v.contact_principal_telephone,
    contact_secours_nom         = v.contact_secours_nom,
    contact_secours_telephone   = v.contact_secours_telephone,
    updated_at                  = now()
   WHERE e.id = p_evenement_id
     AND (e.type_evenement_id, e.contact_principal_nom, e.contact_principal_telephone,
          e.contact_secours_nom, e.contact_secours_telephone)
         IS DISTINCT FROM
         (COALESCE(v.type_evenement_id, e.type_evenement_id), v.contact_principal_nom,
          v.contact_principal_telephone, v.contact_secours_nom, v.contact_secours_telephone);
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_evenement_suit_collecte_n1(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION plateforme.fn_evenement_suit_collecte_n1(uuid) IS
  'Copie le type d''événement et les contacts de la collecte n°1 sur l''événement (décision Val 2026-10-23, B1-Q2) : première collecte non annulée, Zéro-Déchet avant Anti-Gaspi, puis date, heure, création. Sans collecte non annulée : rien.';

-- Déclencheur sur collectes : création, suppression, et changements qui peuvent
-- changer la collecte n°1 ou sa valeur.
CREATE OR REPLACE FUNCTION plateforme.fn_collectes_evenement_suit_n1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM plateforme.fn_evenement_suit_collecte_n1(OLD.evenement_id);
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.type_evenement_id IS NOT DISTINCT FROM NEW.type_evenement_id
     AND OLD.statut IS NOT DISTINCT FROM NEW.statut
     AND OLD.type IS NOT DISTINCT FROM NEW.type
     AND OLD.date_collecte IS NOT DISTINCT FROM NEW.date_collecte
     AND OLD.heure_collecte IS NOT DISTINCT FROM NEW.heure_collecte
     AND OLD.evenement_id IS NOT DISTINCT FROM NEW.evenement_id THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.evenement_id IS DISTINCT FROM NEW.evenement_id THEN
    PERFORM plateforme.fn_evenement_suit_collecte_n1(OLD.evenement_id);
  END IF;
  PERFORM plateforme.fn_evenement_suit_collecte_n1(NEW.evenement_id);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collectes_evenement_suit_n1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collectes_evenement_suit_n1 ON plateforme.collectes;
CREATE TRIGGER trg_collectes_evenement_suit_n1
  AFTER INSERT OR UPDATE OR DELETE ON plateforme.collectes
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collectes_evenement_suit_n1();

-- Déclencheur sur collecte_contacts : ligne créée (déclencheur du lot A) ou
-- contacts modifiés.
CREATE OR REPLACE FUNCTION plateforme.fn_collecte_contacts_evenement_suit_n1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plateforme, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.contact_principal_nom IS NOT DISTINCT FROM NEW.contact_principal_nom
     AND OLD.contact_principal_telephone IS NOT DISTINCT FROM NEW.contact_principal_telephone
     AND OLD.contact_secours_nom IS NOT DISTINCT FROM NEW.contact_secours_nom
     AND OLD.contact_secours_telephone IS NOT DISTINCT FROM NEW.contact_secours_telephone THEN
    RETURN NULL;
  END IF;
  PERFORM plateforme.fn_evenement_suit_collecte_n1(
    (SELECT c.evenement_id FROM plateforme.collectes c WHERE c.id = NEW.collecte_id));
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_collecte_contacts_evenement_suit_n1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_collecte_contacts_evenement_suit_n1 ON plateforme.collecte_contacts;
CREATE TRIGGER trg_collecte_contacts_evenement_suit_n1
  AFTER INSERT OR UPDATE ON plateforme.collecte_contacts
  FOR EACH ROW EXECUTE FUNCTION plateforme.fn_collecte_contacts_evenement_suit_n1();

-- Reprise : chaque événement prend la copie de sa collecte n°1 (après le lot A,
-- toutes les collectes portent les valeurs de leur événement : aucun changement
-- attendu), avec contrôle de fin.
DO $$
DECLARE
  v_id uuid;
  v_ecarts integer;
BEGIN
  FOR v_id IN SELECT id FROM plateforme.evenements LOOP
    PERFORM plateforme.fn_evenement_suit_collecte_n1(v_id);
  END LOOP;

  SELECT count(*) INTO v_ecarts
    FROM plateforme.evenements e
    JOIN LATERAL (
      SELECT c.type_evenement_id, cc.contact_principal_nom, cc.contact_principal_telephone,
             cc.contact_secours_nom, cc.contact_secours_telephone
        FROM plateforme.collectes c
        JOIN plateforme.collecte_contacts cc ON cc.collecte_id = c.id
       WHERE c.evenement_id = e.id AND c.statut <> 'annulee'
       ORDER BY (c.type = 'zero_dechet') DESC, c.date_collecte NULLS LAST,
                c.heure_collecte NULLS LAST, c.created_at, c.id
       LIMIT 1
    ) n1 ON true
   WHERE (e.contact_principal_nom, e.contact_principal_telephone,
          e.contact_secours_nom, e.contact_secours_telephone)
         IS DISTINCT FROM
         (n1.contact_principal_nom, n1.contact_principal_telephone,
          n1.contact_secours_nom, n1.contact_secours_telephone)
      OR (n1.type_evenement_id IS NOT NULL AND e.type_evenement_id IS DISTINCT FROM n1.type_evenement_id);
  IF v_ecarts > 0 THEN
    RAISE EXCEPTION 'reprise copie collecte n°1 : % événement(s) encore en écart', v_ecarts;
  END IF;
END $$;

-- ─── 4. fn_modifier_collecte : type d'événement et contacts ─────────────────
-- Corps de 20261022200000 ; ajouts : garde et UPDATE de type_evenement_id,
-- écriture des contacts sur collecte_contacts, pas d'E2 quand seul le type
-- d'événement change.
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
  v_pax_invalide   boolean;
  v_type_seul      boolean;
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

  -- ── Pax de la collecte (décision Val 2026-10-20) : entier de 1 à 100 000 ───
  -- La colonne admet 0 (reprise Bubble sans pax) ; une modification, jamais.
  -- CASE (et non OR) : l'ordre d'évaluation d'un OR n'est pas garanti en SQL, et
  -- le cast d'une valeur non numérique sortirait en 22P02 au lieu de ce refus.
  -- Calculé à part : dans un IF, PL/pgSQL couperait la condition au THEN du CASE.
  v_pax_invalide := CASE WHEN jsonb_typeof(p_updates->'pax') = 'number'
                         THEN (p_updates->>'pax')::numeric < 1
                           OR (p_updates->>'pax')::numeric > 100000
                           OR (p_updates->>'pax')::numeric <> trunc((p_updates->>'pax')::numeric)
                         ELSE true
                    END;
  IF p_updates ? 'pax' AND v_pax_invalide THEN
    RAISE EXCEPTION
      'PAX_INVALIDE: le nombre de convives doit être un entier de 1 à 100 000 (reçu %)', p_updates->'pax'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Type d'événement de la collecte (lot B1) : jamais vidé ─────────────────
  IF p_updates ? 'type_evenement_id'
     AND jsonb_typeof(p_updates->'type_evenement_id') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION
      'TYPE_EVENEMENT_REQUIS: le type d''événement d''une collecte ne peut pas être vidé'
      USING ERRCODE = 'P0001';
  END IF;

  -- UPDATE avec CASE WHEN pour honorer les mises à null explicites
  UPDATE plateforme.collectes c SET
    date_collecte = CASE WHEN p_updates ? 'date_collecte'
      THEN (p_updates->>'date_collecte')::date ELSE c.date_collecte END,
    heure_collecte = CASE WHEN p_updates ? 'heure_collecte'
      THEN (p_updates->>'heure_collecte')::time ELSE c.heure_collecte END,
    nb_camions_demande = CASE WHEN p_updates ? 'nb_camions_demande'
      THEN (p_updates->>'nb_camions_demande')::smallint ELSE c.nb_camions_demande END,
    pax = CASE WHEN p_updates ? 'pax'
      THEN (p_updates->>'pax')::integer ELSE c.pax END,
    type_evenement_id = CASE WHEN p_updates ? 'type_evenement_id'
      THEN (p_updates->>'type_evenement_id')::uuid ELSE c.type_evenement_id END,
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

  -- ── Contacts de la collecte (lot B1) : sur collecte_contacts ───────────────
  -- La ligne existe depuis l'insertion de la collecte (déclencheur du lot A) ;
  -- les bornes sont celles de la table (CHECK), le contact principal NOT NULL.
  IF p_updates ?| ARRAY['contact_principal_nom', 'contact_principal_telephone',
                        'contact_secours_nom', 'contact_secours_telephone'] THEN
    UPDATE plateforme.collecte_contacts cc SET
      contact_principal_nom = CASE WHEN p_updates ? 'contact_principal_nom'
        THEN p_updates->>'contact_principal_nom' ELSE cc.contact_principal_nom END,
      contact_principal_telephone = CASE WHEN p_updates ? 'contact_principal_telephone'
        THEN p_updates->>'contact_principal_telephone' ELSE cc.contact_principal_telephone END,
      contact_secours_nom = CASE WHEN p_updates ? 'contact_secours_nom'
        THEN p_updates->>'contact_secours_nom' ELSE cc.contact_secours_nom END,
      contact_secours_telephone = CASE WHEN p_updates ? 'contact_secours_telephone'
        THEN p_updates->>'contact_secours_telephone' ELSE cc.contact_secours_telephone END,
      updated_at = now()
     WHERE cc.collecte_id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTACTS_COLLECTE_ABSENTS: aucune ligne de contacts pour la collecte %', p_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Gate E2 : « une commande existe deja chez le prestataire CIBLE ». Lu sous le
  -- verrou de l'agregat (pris en tete), et APRES l'UPDATE : le patch peut changer
  -- `prestataire_logistique_id`, auquel cas la question porte sur le nouveau.
  v_commandee := plateforme.fn_collecte_commandee_chez_provider(p_id);

  -- Transition vers 'annulee' (miroir exact de l'ex-trigger trg_collecte_annulee_e3).
  v_passe_annulee := (p_updates ? 'statut'
                      AND p_updates->>'statut' = 'annulee'
                      AND v_old_statut <> 'annulee');

  -- Le type d'événement ne part pas au prestataire (lot B1) : une modification
  -- qui ne porte que sur lui n'écrit pas d'E2.
  v_type_seul := cardinality(p_champs_modifies) > 0
                 AND p_champs_modifies <@ ARRAY['type_evenement_id']::text[];

  -- Outbox E2 si une commande existe chez le prestataire — jamais quand le patch
  -- pose statut='annulee' (E3 prend le relais — condition originale conservée),
  -- et jamais pour une collecte réalisée, réalisée sans collecte, clôturée ou
  -- annulée, avant OU après la modification (décision Val 2026-10-22, §05
  -- Cascade TMS, §08 Déclencheur E2) : une correction faite après coup reste
  -- interne à la plateforme.
  IF v_commandee
     AND NOT v_type_seul
     AND NOT (p_updates ? 'statut' AND p_updates->>'statut' = 'annulee')
     AND v_old_statut NOT IN ('realisee', 'realisee_sans_collecte', 'cloturee', 'annulee')
     AND v_row.statut NOT IN ('realisee', 'realisee_sans_collecte', 'cloturee', 'annulee')
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

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_collecte(uuid, jsonb, text[]) TO service_role;

-- ─── 5. fn_modifier_evenement : type et contacts refusés (B1-Q1) ────────────
-- Corps de 20261022210000 ; retirés : type et contacts de l'UPDATE, recopie de
-- transition, boucle d'E2 (les contacts étaient ses seuls champs transmis).
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
  v_evt plateforme.evenements;
BEGIN
  -- Le pax n'est plus un champ de l'événement (décision Val 2026-10-20) : il se
  -- modifie sur chaque collecte (fn_modifier_collecte), et le pax de l'événement
  -- en est calculé (fn_set_pax_evenement). Refus explicite plutôt qu'ignoré.
  IF p_updates ? 'pax' THEN
    RAISE EXCEPTION
      'PAX_SUR_COLLECTE: le nombre de convives se modifie sur chaque collecte'
      USING ERRCODE = 'P0001';
  END IF;

  -- Le type d'événement et les contacts se modifient sur chaque collecte
  -- (décision Val 2026-10-23, B1-Q1) ; l'événement garde la copie de sa collecte
  -- n°1 (fn_evenement_suit_collecte_n1). Refus explicite plutôt qu'ignoré.
  IF p_updates ?| ARRAY['type_evenement_id', 'contact_principal_nom',
                        'contact_principal_telephone', 'contact_secours_nom',
                        'contact_secours_telephone'] THEN
    RAISE EXCEPTION
      'TYPE_CONTACTS_SUR_COLLECTE: le type d''événement et les contacts se modifient sur chaque collecte'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── UPDATE événement (whitelist via CASE WHEN — honore les mises à null) ──
  -- lieu_id verrouillé côté programmation (§05 l.314 / §06.04 l.459) : changer le
  -- lieu = annuler + reprogrammer. organisation_id / traiteur_operationnel /
  -- entite_facturation : immuables (jamais exposés). lieu_id / date_evenement :
  -- exposés UNIQUEMENT au back-office Admin (route admin/evenements). Aucun champ
  -- de l'événement ne part plus au prestataire : aucun E2 ici.
  UPDATE plateforme.evenements e SET
    nom_evenement = CASE WHEN p_updates ? 'nom_evenement'
      THEN p_updates->>'nom_evenement' ELSE e.nom_evenement END,
    lieu_id = CASE WHEN p_updates ? 'lieu_id'
      THEN (p_updates->>'lieu_id')::uuid ELSE e.lieu_id END,
    date_evenement = CASE WHEN p_updates ? 'date_evenement'
      THEN (p_updates->>'date_evenement')::date ELSE e.date_evenement END,
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

  RETURN to_jsonb(v_evt);
END;
$function$
;

REVOKE EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_modifier_evenement(uuid, jsonb, text[]) TO service_role;
