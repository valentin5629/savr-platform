-- =============================================================================
-- Refonte du formulaire de programmation, lot B2 (décisions Val 2026-10-22 C1–C8
-- et 2026-10-24 B2-Q1 à B2-Q4) : une programmation crée l'événement et ses N
-- collectes (une par carte du formulaire), chacune avec son type d'événement et
-- ses contacts.
-- =============================================================================
-- 1. fn_creer_collecte_carte : crée UNE collecte (confirmée par fn_creer_collecte,
--    ou brouillon) et pose dans la même transaction son type d'événement et ses
--    contacts (`collecte_contacts`, ligne créée par le déclencheur du lot A avec
--    les contacts de l'événement, puis mise à jour ici). L'ordre d'envoi E1 ne
--    porte pas les contacts : le transporteur les relit au traitement, après le
--    commit, donc ceux de la carte.
-- 2. fn_enregistrer_programmation : crée l'événement et toutes ses collectes en
--    UNE transaction (avant : la route insérait l'événement puis appelait
--    fn_creer_collecte collecte par collecte ; un échec à la 2e collecte laissait
--    l'événement et la 1re en base, le DELETE de rattrapage échouant faute de
--    cascade). Avec un identifiant d'événement, remplace un brouillon (reprise du
--    brouillon dans le formulaire, B2-Q2) : ses collectes brouillon sont
--    supprimées et recréées, éventuellement confirmées. Au plus 10 collectes
--    Zéro-Déchet et 10 Anti-Gaspi par appel (B2-Q4).
--    L'événement reçoit à l'insertion le type et les contacts de la première
--    carte (colonnes NOT NULL) ; la copie de sa collecte n°1 (B1-Q2) est ensuite
--    tenue par les déclencheurs du lot B1.
-- 3. Gabarit `collecte_programmee` : une ligne par collecte (B2-Q3).
-- Garde-fou TMS-Ready 4 : l'E1 de chaque collecte confirmée reste émis par
-- fn_creer_collecte, dans la même transaction. Aucune signature existante n'est
-- modifiée (fn_creer_collecte inchangée) ; les deux nouvelles fonctions sont
-- fermées aux rôles clients (service_role seul, comme fn_creer_collecte).
-- Retour arrière : DROP des deux fonctions, et rejeu de l'UPDATE du gabarit de
-- 20261008150000 ; aucune donnée à reprendre.
-- =============================================================================

DO $$
BEGIN
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migration à jouer sous un rôle qui contourne la RLS (rôle % soumis à la RLS)', current_user;
  END IF;
END $$;

-- ─── 1. fn_creer_collecte_carte ──────────────────────────────────────────────
-- p_carte : { type ('zd'|'ag'), date_collecte, heure_collecte, pax,
--             informations_supplementaires, type_evenement_id,
--             contact_principal_nom, contact_principal_telephone,
--             contact_secours_nom, contact_secours_telephone }
-- Les bornes des textes et le contact principal non vide sont tenus par les
-- CHECK de `collecte_contacts` et de `collectes` ; la route les refuse avant
-- (422).
CREATE FUNCTION plateforme.fn_creer_collecte_carte(
  p_evenement_id   uuid,
  p_carte          jsonb,
  p_controle_acces boolean,
  p_lieu_overrides jsonb,
  p_confirmer      boolean
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_id        uuid;
  v_type      text := p_carte->>'type';
  v_type_evt  uuid;
BEGIN
  IF v_type IS NULL OR v_type NOT IN ('zd', 'ag') THEN
    RAISE EXCEPTION 'TYPE_COLLECTE_INVALIDE: type de collecte attendu zd ou ag (reçu %)', v_type
      USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_carte->'type_evenement_id') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'TYPE_EVENEMENT_REQUIS: chaque collecte porte son type d''événement'
      USING ERRCODE = 'P0001';
  END IF;
  v_type_evt := (p_carte->>'type_evenement_id')::uuid;

  IF p_confirmer THEN
    v_id := plateforme.fn_creer_collecte(
      p_evenement_id   := p_evenement_id,
      p_type           := v_type,
      p_date_collecte  := (p_carte->>'date_collecte')::date,
      p_heure_collecte := (p_carte->>'heure_collecte')::time,
      p_nb_camions     := 1::smallint,
      p_controle_acces := p_controle_acces,
      p_notes          := NULL,
      p_info_suppl     := p_carte->>'informations_supplementaires',
      p_lieu_overrides := p_lieu_overrides,
      p_pax            := (p_carte->>'pax')::integer
    );
  ELSE
    -- Brouillon : aucun ordre au prestataire (E1 émis à la confirmation).
    IF (p_carte->>'pax')::integer IS NULL
       OR (p_carte->>'pax')::integer NOT BETWEEN 1 AND 100000 THEN
      RAISE EXCEPTION
        'PAX_INVALIDE: le nombre de convives doit être un entier de 1 à 100 000 (reçu %)', p_carte->>'pax'
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO plateforme.collectes (
      evenement_id, type, date_collecte, heure_collecte, statut, statut_tms,
      controle_acces_requis, informations_supplementaires, lieu_overrides,
      nb_camions_demande, pax, type_evenement_id
    ) VALUES (
      p_evenement_id,
      CASE v_type WHEN 'zd' THEN 'zero_dechet'::plateforme.collecte_type
                  ELSE 'anti_gaspi'::plateforme.collecte_type END,
      (p_carte->>'date_collecte')::date,
      (p_carte->>'heure_collecte')::time,
      'brouillon',
      'non_envoye',
      p_controle_acces,
      p_carte->>'informations_supplementaires',
      p_lieu_overrides,
      1,
      (p_carte->>'pax')::integer,
      v_type_evt
    ) RETURNING id INTO v_id;
  END IF;

  UPDATE plateforme.collectes
     SET type_evenement_id = v_type_evt
   WHERE id = v_id
     AND type_evenement_id IS DISTINCT FROM v_type_evt;

  UPDATE plateforme.collecte_contacts
     SET contact_principal_nom       = p_carte->>'contact_principal_nom',
         contact_principal_telephone = p_carte->>'contact_principal_telephone',
         contact_secours_nom         = p_carte->>'contact_secours_nom',
         contact_secours_telephone   = p_carte->>'contact_secours_telephone',
         updated_at                  = now()
   WHERE collecte_id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACTS_COLLECTE_ABSENTS: aucune ligne de contacts pour la collecte %', v_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_creer_collecte_carte(uuid, jsonb, boolean, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_creer_collecte_carte(uuid, jsonb, boolean, jsonb, boolean)
  TO service_role;

COMMENT ON FUNCTION plateforme.fn_creer_collecte_carte(uuid, jsonb, boolean, jsonb, boolean) IS
  'Crée une collecte (confirmée via fn_creer_collecte, ou brouillon) avec son type d''événement et ses contacts, en une transaction (refonte du formulaire, lot B2). Appelée par le service_role seul.';

-- ─── 2. fn_enregistrer_programmation ─────────────────────────────────────────
-- p_evenement : { organisation_id, traiteur_operationnel_organisation_id,
--                 entite_facturation_id, lieu_id, created_by, nom_evenement,
--                 nom_client_organisateur, logo_client_organisateur_url,
--                 reference_affaire, controle_acces_requis, lieu_overrides }
--   Pour un brouillon remplacé, organisation_id, entite_facturation_id et
--   created_by ne sont pas relus : ils restent ceux du brouillon.
-- p_collectes : tableau de cartes (cf. fn_creer_collecte_carte), dans l'ordre
--   du formulaire ; les identifiants rendus suivent cet ordre.
-- p_evenement_id : absent (NULL) = nouvel événement ; sinon brouillon à
--   remplacer.
CREATE FUNCTION plateforme.fn_enregistrer_programmation(
  p_evenement    jsonb,
  p_collectes    jsonb,
  p_confirmer    boolean,
  p_evenement_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'plateforme', 'public'
AS $function$
DECLARE
  v_evt        uuid := p_evenement_id;
  v_premiere   jsonb;
  v_controle   boolean := COALESCE((p_evenement->>'controle_acces_requis')::boolean, false);
  v_overrides  jsonb := NULLIF(NULLIF(p_evenement->'lieu_overrides', 'null'::jsonb), '{}'::jsonb);
  v_carte      jsonb;
  v_ids        uuid[] := ARRAY[]::uuid[];
  v_nb_zd      integer;
  v_nb_ag      integer;
  v_confirmees integer;
BEGIN
  IF jsonb_typeof(p_collectes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_collectes) = 0 THEN
    RAISE EXCEPTION 'COLLECTES_REQUISES: une programmation porte au moins une collecte'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) FILTER (WHERE c->>'type' = 'zd'), count(*) FILTER (WHERE c->>'type' = 'ag')
    INTO v_nb_zd, v_nb_ag
    FROM jsonb_array_elements(p_collectes) c;
  IF v_nb_zd > 10 OR v_nb_ag > 10 THEN
    RAISE EXCEPTION 'PLAFOND_COLLECTES: au plus 10 collectes Zéro-Déchet et 10 Anti-Gaspi par programmation'
      USING ERRCODE = 'P0001';
  END IF;
  -- Avant l'insertion de l'événement, qui reprend le type de la première carte
  -- (colonne NOT NULL) : refus explicite plutôt qu'une violation de contrainte.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_collectes) c
              WHERE jsonb_typeof(c->'type_evenement_id') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'TYPE_EVENEMENT_REQUIS: chaque collecte porte son type d''événement'
      USING ERRCODE = 'P0001';
  END IF;
  v_premiere := p_collectes->0;

  IF v_evt IS NULL THEN
    INSERT INTO plateforme.evenements (
      organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
      lieu_id, created_by, nom_evenement, nom_client_organisateur,
      logo_client_organisateur_url, reference_affaire,
      type_evenement_id, pax,
      contact_principal_nom, contact_principal_telephone,
      contact_secours_nom, contact_secours_telephone
    ) VALUES (
      (p_evenement->>'organisation_id')::uuid,
      (p_evenement->>'traiteur_operationnel_organisation_id')::uuid,
      (p_evenement->>'entite_facturation_id')::uuid,
      (p_evenement->>'lieu_id')::uuid,
      (p_evenement->>'created_by')::uuid,
      p_evenement->>'nom_evenement',
      p_evenement->>'nom_client_organisateur',
      p_evenement->>'logo_client_organisateur_url',
      p_evenement->>'reference_affaire',
      -- Valeurs de la première carte (colonnes NOT NULL) ; la copie de la
      -- collecte n°1 est tenue ensuite par les déclencheurs (lot B1).
      (v_premiere->>'type_evenement_id')::uuid,
      0,  -- calculé par trg_set_pax_evenement à l'insertion des collectes
      v_premiere->>'contact_principal_nom',
      v_premiere->>'contact_principal_telephone',
      v_premiere->>'contact_secours_nom',
      v_premiere->>'contact_secours_telephone'
    ) RETURNING id INTO v_evt;
  ELSE
    -- Reprise d'un brouillon : verrou de l'événement avant la garde (une
    -- confirmation ou une suppression concurrente attend).
    PERFORM 1 FROM plateforme.evenements WHERE id = v_evt FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'evenement_introuvable' USING ERRCODE = 'P0002';
    END IF;
    SELECT count(*) FILTER (WHERE statut <> 'brouillon') INTO v_confirmees
      FROM plateforme.collectes WHERE evenement_id = v_evt;
    IF v_confirmees > 0 THEN
      RAISE EXCEPTION 'Des collectes sont déjà confirmées'
        USING ERRCODE = '22023';
    END IF;

    UPDATE plateforme.evenements SET
      traiteur_operationnel_organisation_id = (p_evenement->>'traiteur_operationnel_organisation_id')::uuid,
      lieu_id                      = (p_evenement->>'lieu_id')::uuid,
      nom_evenement                = p_evenement->>'nom_evenement',
      nom_client_organisateur      = p_evenement->>'nom_client_organisateur',
      logo_client_organisateur_url = p_evenement->>'logo_client_organisateur_url',
      reference_affaire            = p_evenement->>'reference_affaire',
      updated_at                   = now()
     WHERE id = v_evt;

    -- Les collectes d'un brouillon n'ont émis aucun ordre : elles sont
    -- remplacées par celles du formulaire (même garde que fn_supprimer_brouillon).
    DELETE FROM plateforme.collectes WHERE evenement_id = v_evt;
  END IF;

  -- Contrôle d'accès : cascade vers le lieu, montante seulement (R9).
  IF v_controle THEN
    UPDATE plateforme.lieux
       SET controle_acces_requis_default = true
     WHERE id = (p_evenement->>'lieu_id')::uuid
       AND controle_acces_requis_default = false;
  END IF;

  FOR v_carte IN
    SELECT value FROM jsonb_array_elements(p_collectes) WITH ORDINALITY ORDER BY ordinality
  LOOP
    v_ids := v_ids || plateforme.fn_creer_collecte_carte(
      v_evt, v_carte, v_controle, v_overrides, p_confirmer);
  END LOOP;

  RETURN jsonb_build_object('evenement_id', v_evt, 'collecte_ids', to_jsonb(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid)
  TO service_role;

COMMENT ON FUNCTION plateforme.fn_enregistrer_programmation(jsonb, jsonb, boolean, uuid) IS
  'Crée un événement et ses collectes (une par carte), ou remplace un brouillon, en une transaction (refonte du formulaire, lot B2, décisions Val 2026-10-24). Au plus 10 collectes ZD et 10 AG. Appelée par le service_role seul.';

-- ─── 3. Gabarit collecte_programmee : une ligne par collecte (B2-Q3) ────────
-- `liste_collectes` est une liste HTML composée par le serveur (libellé, date,
-- heure, convives : aucun texte saisi par l'utilisateur). Le lien « Voir mes
-- collectes » est dans un bloc conditionnel : il n'est pas exigé à l'envoi.
UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>
<p>Votre événement « {{nom_evenement}} » est programmé. Nous réaliserons {{nombre_collectes}} :</p>
{{liste_collectes}}
<p>{{tarif_ligne}}</p>
{{#if lien_collectes}}<p><a href="{{lien_collectes}}">Voir mes collectes</a></p>{{/if}}
<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['nom_evenement', 'nombre_collectes', 'liste_collectes', 'tarif_ligne']::text[],
    updated_at = now()
WHERE code = 'collecte_programmee';

-- Contrôle de fin (table en FORCE ROW LEVEL SECURITY : compter la ligne dans
-- l'état attendu, comme 20261008150000).
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'collecte_programmee'
     AND position('{{liste_collectes}}' IN corps_html) > 0
     AND variables = ARRAY['nom_evenement', 'nombre_collectes', 'liste_collectes', 'tarif_ligne']::text[];
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne collecte_programmee au gabarit à plusieurs collectes, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;
