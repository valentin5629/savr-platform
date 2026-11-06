-- Codes VIPARIS : code site sur le lieu, code affaire sur l'événement (Val 2026-11-02).
-- =============================================================================
-- VIPARIS, gestionnaire de lieux, demande deux codes pour rapprocher nos
-- collectes de ses propres référentiels :
--   1. lieux.code_site_viparis : code du site VIPARIS (PCP, PCC, CNIT2, CDL,
--      CHAMP, PDV, PNV, PLB). Saisi par l'Admin seul ; plusieurs lieux peuvent
--      porter le même code (un site regroupe plusieurs halls).
--   2. evenements.code_affaire_viparis : code affaire VIPARIS, 7 caractères
--      alphanumériques en majuscules (ex. 26SIAL1). Facultatif. Saisi par le
--      traiteur à la programmation, corrigeable par VIPARIS et l'Admin. Champ
--      DISTINCT de reference_affaire (référence interne du traiteur).
--   3. v_registre_dechets gagne les deux codes en fin de vue, pour l'export CSV
--      du registre réglementaire (Val 2026-11-02 : « ces codes apparaîtront dans
--      les extract des registres »).
--
-- Aucune confidentialité (Val 2026-11-02) : le traiteur peut lire ces codes.
-- AUCUN droit nouveau n'est accordé pour autant : lieux et evenements sont en
-- liste blanche de colonnes (20260617170000, 20261001103000) et un ADD COLUMN
-- n'hérite d'aucun privilège ; les routes lisent et écrivent ces colonnes en
-- service_role, après leurs propres gardes, comme reference_affaire. La vue
-- garde sa définition SECURITY DEFINER et son filtre f_collecte_visible : seules
-- deux colonnes s'ajoutent, en fin de liste (CREATE OR REPLACE VIEW l'exige).
--
-- ⚠ Divergence DDL cible (garde-fou 1) : les deux colonnes sont absentes du DDL
-- cible V2 → convergence V2 tracée dans
-- _Divergences/M3.2_20261102_codes-viparis-site-affaire.md.
-- =============================================================================

ALTER TABLE plateforme.lieux
  ADD COLUMN IF NOT EXISTS code_site_viparis text;

ALTER TABLE plateforme.lieux
  ADD CONSTRAINT chk_lieux_code_site_viparis
  CHECK (
    code_site_viparis IS NULL
    OR code_site_viparis IN ('PCP', 'PCC', 'CNIT2', 'CDL', 'CHAMP', 'PDV', 'PNV', 'PLB')
  );

COMMENT ON COLUMN plateforme.lieux.code_site_viparis IS
  'Code du site VIPARIS (liste fermée). Saisi par l''Admin ; exporté au registre.';

ALTER TABLE plateforme.evenements
  ADD COLUMN IF NOT EXISTS code_affaire_viparis text;

ALTER TABLE plateforme.evenements
  ADD CONSTRAINT chk_evenements_code_affaire_viparis
  CHECK (code_affaire_viparis IS NULL OR code_affaire_viparis ~ '^[A-Z0-9]{7}$');

COMMENT ON COLUMN plateforme.evenements.code_affaire_viparis IS
  'Code affaire VIPARIS, 7 caractères alphanumériques majuscules (ex. 26SIAL1). '
  'Facultatif ; distinct de reference_affaire. Exporté au registre.';

-- ─── fn_enregistrer_programmation : + code_affaire_viparis ───────────────────
-- Le formulaire de programmation saisit le code affaire : il est écrit dans la
-- MÊME transaction que l'événement et ses collectes (une programmation reste
-- une seule écriture). Définition reprise à l'identique de 20261024100000, à
-- deux lignes près (INSERT et UPDATE du brouillon) ; mêmes droits
-- (service_role seul). Le format est contrôlé par la route (422) et par
-- chk_evenements_code_affaire_viparis.
CREATE OR REPLACE FUNCTION plateforme.fn_enregistrer_programmation(
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
      logo_client_organisateur_url, reference_affaire, code_affaire_viparis,
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
      p_evenement->>'code_affaire_viparis',
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
      code_affaire_viparis         = p_evenement->>'code_affaire_viparis',
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
  'Crée un événement et ses collectes (une par carte), ou remplace un brouillon, en une transaction (refonte du formulaire, lot B2, décisions Val 2026-10-24). Au plus 10 collectes ZD et 10 AG. Appelée par le service_role seul. Code affaire VIPARIS écrit dans la même transaction (2026-11-02).';

CREATE OR REPLACE VIEW plateforme.v_registre_dechets WITH (security_invoker = false) AS
SELECT
  c.id                                            AS collecte_id,
  c.evenement_id,
  e.date_evenement,
  c.date_collecte,
  e.nom_evenement                                 AS evenement_nom,
  c.pax,
  plateforme.taille_evenement_bracket(c.pax)      AS taille_bracket,
  c.type_evenement_id,
  e.lieu_id,
  l.nom                                           AS lieu_nom,
  l.adresse_acces                                 AS lieu_adresse,
  e.organisation_id                               AS programmateur_organisation_id,
  e.traiteur_operationnel_organisation_id,
  -- Traiteur opérationnel = producteur juridique du déchet (F4), fiches shadow
  -- incluses (raison sociale sans SIRET) ; fallback nom si raison_sociale NULL.
  COALESCE(top.raison_sociale, top.nom)           AS traiteur_raison_sociale,
  c.prestataire_logistique_id,
  sp.nom                                          AS transporteur_nom,
  b.exutoire_nom,
  COALESCE(agg.poids_total_kg, 0)::numeric(12, 3) AS poids_total_kg,
  COALESCE(agg.flux_codes, ARRAY[]::text[])       AS flux_codes,
  c.taux_recyclage,
  c.co2_induit_kg,
  c.co2_evite_kg,
  c.co2_net_kg,
  b.id                                            AS bordereau_id,
  b.numero                                        AS bordereau_numero,
  b.statut                                        AS bordereau_statut,
  b.pdf_fichier_id                                AS bordereau_pdf_fichier_id,
  b.date_emission                                 AS bordereau_date_emission,
  b.version                                       AS bordereau_version,
  c.historique_partiel,
  c.realisee_at,
  c.created_at,
  l.code_site_viparis                             AS lieu_code_site_viparis,
  e.code_affaire_viparis                          AS evenement_code_affaire_viparis
FROM plateforme.collectes c
  JOIN plateforme.evenements e ON e.id = c.evenement_id
  JOIN plateforme.lieux l ON l.id = e.lieu_id
  LEFT JOIN plateforme.organisations top
    ON top.id = e.traiteur_operationnel_organisation_id
  LEFT JOIN shared.prestataires sp ON sp.id = c.prestataire_logistique_id
  LEFT JOIN plateforme.bordereaux_savr b ON b.collecte_id = c.id
  LEFT JOIN LATERAL (
    -- Poids total = SUM de TOUTES les pesées de la collecte (multi-pesées
    -- d'un même flux agrégées) ; flux_codes = badges distincts triés.
    SELECT
      SUM(cf.poids_reel_kg)                                AS poids_total_kg,
      array_agg(DISTINCT fd.code ORDER BY fd.code)         AS flux_codes
    FROM plateforme.collecte_flux cf
      JOIN plateforme.flux_dechets fd ON fd.id = cf.flux_id
    WHERE cf.collecte_id = c.id
  ) agg ON true
WHERE c.statut = 'cloturee'::plateforme.collecte_statut
  AND c.type   = 'zero_dechet'::plateforme.collecte_type
  -- Exclusion agence (F6 2026-06-07) : donneuse d'ordre, non productrice → 0 ligne.
  AND plateforme.f_app_role() IS DISTINCT FROM 'agence'
  -- Cloisonnement par organisation (miroir policy collectes) : staff full,
  -- programmateur, traiteur opérationnel, client organisateur, gestionnaire
  -- de lieux via organisations_lieux. Source unique : f_collecte_visible.
  AND plateforme.f_collecte_visible(c.id);
COMMENT ON VIEW plateforme.v_registre_dechets IS
  'Registre réglementaire ZD (M4.2, §06.03). Grain collecte : poids_total_kg '
  'agrégé multi-pesées, flux_codes[] pour les badges ; pax, taille_bracket et '
  'type_evenement_id de la COLLECTE (lot C1 2026-10-24). SECURITY DEFINER + '
  'cloisonnement interne f_collecte_visible (la vue joint shared.prestataires '
  'admin-only → security_invoker impossible). Exclusion agence (F6). Périmètre '
  'V1 : collectes cloturee + zero_dechet uniquement (volet AG = V2). Codes '
  'VIPARIS du lieu et de l''événement en fin de vue (2026-11-02).';
