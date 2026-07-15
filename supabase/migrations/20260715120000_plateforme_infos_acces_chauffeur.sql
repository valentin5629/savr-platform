-- Infos accès chauffeur (« contrôle d'accès ») — workflow de bout en bout V1.
-- =============================================================================
-- Décision Val 2026-07-15 : réintroduire en V1 la notification client des infos
-- d'accès (nom + téléphone chauffeur [+ accompagnant]) pour les collectes dont
-- le lieu exige un contrôle d'accès (`collectes.controle_acces_requis`).
--
-- ⚠ Ce workflow avait été DESCOPÉ V1 (Q10 M05 2026-04-24) : template
-- `plaque_chauffeur` retiré, colonnes `collectes.recevoir_plaque_chauffeur` +
-- `collectes.email_plaque_envoye_at` supprimées, email client reporté V2
-- (TMS §05 R_M03.4 « Email client V2 »). Réavancé en V1 sur décision Val.
--   → Tracé : _Divergences/PLAQUES_20260715.md (type: ambigu).
--   → DDL cible reconcilié : _DDL-CIBLE-V2/schema_cible_v2.sql (accompagnant_* +
--     infos_acces_email_envoye_at) — la sémantique du contrôle d'accès existe en
--     V2 (R_M03.4 / R_M04.CONTROLE_ACCES), ces colonnes y appartiennent.
--
-- Réalités MTS-1 (as-built §6, garde-fou : ne rien inventer) : `GET /v3/carrier`
-- expose la plaque (`numberPlate`) + le nom chauffeur (firstname/lastname), mais
-- NI le téléphone chauffeur NI un 2e contact/accompagnant. En V1 le téléphone +
-- l'accompagnant sont donc saisis manuellement par l'Admin (fiche collecte), ce
-- qui déclenche l'email dès complétude — exactement le secours prévu (décision
-- Val #3/#4). Le point d'extension adapter reste prêt pour un futur provider.
--
-- Charte §06.02 : vouvoiement, FR, 0 emoji, signature « L'équipe Savr ».
-- Backward-compatible : ADD COLUMN nullable + CREATE OR REPLACE + seed
-- ON CONFLICT DO NOTHING. GRANT : les colonnes ajoutées héritent du GRANT
-- schema-wide `... ON ALL TABLES IN SCHEMA plateforme TO authenticated` (0.4a) —
-- aucun GRANT par colonne (règle post-0.4a = tables neuves uniquement).
-- =============================================================================

-- ─── 1. Colonnes : infos chauffeur par tournée + suivi d'envoi par collecte ───
-- `tournees.chauffeur_nom` + `chauffeur_telephone` existent déjà (bloc2). On
-- ajoute l'accompagnant (facultatif). `chauffeur_telephone` NON réintroduit.
ALTER TABLE plateforme.tournees
  ADD COLUMN IF NOT EXISTS accompagnant_nom        text,
  ADD COLUMN IF NOT EXISTS accompagnant_telephone  text;

COMMENT ON COLUMN plateforme.tournees.accompagnant_nom IS
  'Nom du 2e équipier (accompagnant), facultatif. Saisie Admin en V1 (MTS-1 ne l''expose pas).';
COMMENT ON COLUMN plateforme.tournees.accompagnant_telephone IS
  'Téléphone de l''accompagnant, facultatif. Saisie Admin en V1.';

-- Suivi d'envoi de l'email récapitulatif d'accès (réintroduit proprement la
-- sémantique de l'ex-`email_plaque_envoye_at`). Sert de garde anti-double-envoi
-- ET de discriminant KPI (« requis ET non encore envoyé »).
ALTER TABLE plateforme.collectes
  ADD COLUMN IF NOT EXISTS infos_acces_email_envoye_at timestamptz;

COMMENT ON COLUMN plateforme.collectes.infos_acces_email_envoye_at IS
  'Horodatage d''envoi de l''email « infos accès chauffeur » au programmateur. '
  'NULL tant que non envoyé (garde anti-double-envoi + sortie du KPI contrôle d''accès).';

-- ─── 2. Complétude + claim atomique de l'envoi ────────────────────────────────
-- Évalue si une collecte à contrôle d'accès a TOUTES ses tournées renseignées
-- (nom + téléphone chauffeur), et si oui « claim » l'envoi de façon atomique :
--   · lock FOR UPDATE de la collecte (sérialise poll ⟂ saisie Admin concurrents)
--   · si non requis / déjà envoyé / incomplet → RETURN NULL (rien à faire)
--   · si complet ET destinataire résoluble → stamp infos_acces_email_envoye_at
--     (le claim) + RETURN le payload nécessaire à l'email (best-effort côté TS).
--   · si complet mais destinataire introuvable → RETURN {erreur} SANS stamper
--     (la collecte reste dans le KPI, alerte Ops côté TS).
-- Le stamp = dédup (R22a) ; en cas d'échec d'envoi, le TS relâche le claim.
CREATE OR REPLACE FUNCTION plateforme.fn_infos_acces_marquer_si_complet(
  p_collecte_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = plateforme, public
AS $$
DECLARE
  v_controle_requis  boolean;
  v_deja_envoye      timestamptz;
  v_nb_attendu       int;
  v_evenement_id     uuid;
  v_date_collecte    date;
  v_heure_collecte   text;
  v_nb_tournees      int;
  v_nb_completes     int;
  v_to               text;
  v_prenom           text;
  v_lieu_nom         text;
  v_lieu_adresse     text;
  v_evenement_nom    text;
  v_chauffeurs       jsonb;
BEGIN
  -- Lock de l'agrégat collecte (anti double-envoi concurrent).
  SELECT c.controle_acces_requis, c.infos_acces_email_envoye_at,
         COALESCE(c.nb_camions_demande, 1), c.evenement_id,
         c.date_collecte, c.heure_collecte
    INTO v_controle_requis, v_deja_envoye, v_nb_attendu, v_evenement_id,
         v_date_collecte, v_heure_collecte
  FROM plateforme.collectes c
  WHERE c.id = p_collecte_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT v_controle_requis THEN RETURN NULL; END IF;
  IF v_deja_envoye IS NOT NULL THEN RETURN NULL; END IF;

  -- Complétude : chaque tournée (== nb_camions_demande) a nom + téléphone.
  SELECT
    count(*),
    count(*) FILTER (
      WHERE t.chauffeur_nom IS NOT NULL AND btrim(t.chauffeur_nom) <> ''
        AND t.chauffeur_telephone IS NOT NULL AND btrim(t.chauffeur_telephone) <> ''
    )
    INTO v_nb_tournees, v_nb_completes
  FROM plateforme.collecte_tournees ct
  JOIN plateforme.tournees t ON t.id = ct.tournee_id
  WHERE ct.collecte_id = p_collecte_id;

  IF v_nb_tournees < v_nb_attendu OR v_nb_completes < v_nb_attendu THEN
    RETURN NULL;  -- pas encore complet (tournées manquantes ou infos partielles)
  END IF;

  -- Destinataire = evenements.created_by (le programmateur).
  SELECT u.email, u.prenom, e.nom_evenement, l.nom, l.adresse_acces
    INTO v_to, v_prenom, v_evenement_nom, v_lieu_nom, v_lieu_adresse
  FROM plateforme.evenements e
  JOIN plateforme.users u ON u.id = e.created_by
  LEFT JOIN plateforme.lieux l ON l.id = e.lieu_id
  WHERE e.id = v_evenement_id;

  IF v_to IS NULL OR btrim(v_to) = '' THEN
    -- Complet mais destinataire introuvable : NE PAS stamper (reste au KPI).
    RETURN jsonb_build_object('erreur', 'destinataire_introuvable');
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'rang', ct.rang,
             'chauffeur_nom', t.chauffeur_nom,
             'chauffeur_telephone', t.chauffeur_telephone,
             'plaque', t.plaque_immatriculation,
             'accompagnant_nom', t.accompagnant_nom,
             'accompagnant_telephone', t.accompagnant_telephone
           ) ORDER BY ct.rang
         )
    INTO v_chauffeurs
  FROM plateforme.collecte_tournees ct
  JOIN plateforme.tournees t ON t.id = ct.tournee_id
  WHERE ct.collecte_id = p_collecte_id;

  -- Claim atomique : stamp SOUS le lock. Un envoi concurrent verra NON NULL.
  UPDATE plateforme.collectes
     SET infos_acces_email_envoye_at = now()
   WHERE id = p_collecte_id;

  RETURN jsonb_build_object(
    'to', v_to,
    'prenom', v_prenom,
    'evenement_nom', v_evenement_nom,
    'date_collecte', v_date_collecte,
    'heure_collecte', v_heure_collecte,
    'lieu_nom', v_lieu_nom,
    'lieu_adresse', v_lieu_adresse,
    'chauffeurs', COALESCE(v_chauffeurs, '[]'::jsonb)
  );
END;
$$;

-- Appelée uniquement par le code serveur (service-role). Fermer PUBLIC.
REVOKE ALL ON FUNCTION plateforme.fn_infos_acces_marquer_si_complet(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plateforme.fn_infos_acces_marquer_si_complet(uuid) TO service_role;

-- ─── 3. Template email `infos_acces_collecte` (catalogue §06.02) ──────────────
-- Data-only (INSERT ON CONFLICT DO NOTHING) — backward-compatible.
-- `chauffeurs_bloc` est pré-rendu côté TS (HTML par tournée) : interpolate() ne
-- sait pas boucler → une seule variable bloc. `accompagnant` / `evenement_nom` /
-- `lieu_adresse` sont conditionnels ({{#if}}) donc non requis.
INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
(
  'infos_acces_collecte',
  'Informations d''accès pour votre collecte du {{date_collecte}}',
  '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>'
  '<p>Voici les informations du ou des chauffeur(s) qui interviendront pour votre '
  'collecte{{#if evenement_nom}} « {{evenement_nom}} »{{/if}} prévue le '
  '<strong>{{date_collecte}}</strong> à <strong>{{heure_collecte}}</strong>'
  '{{#if lieu_nom}}, {{lieu_nom}}{{/if}}'
  '{{#if lieu_adresse}} ({{lieu_adresse}}){{/if}}.</p>'
  '<p>Merci de les transmettre au service de contrôle d''accès du site.</p>'
  '{{chauffeurs_bloc}}'
  '<p>Si ces informations changent, nous vous en tiendrons informé.</p>'
  '<p>L''équipe Savr</p>',
  true,
  'Récapitulatif des infos d''accès (nom + téléphone chauffeur, plaque, accompagnant) '
  'envoyé au programmateur d''une collecte à contrôle d''accès, dès complétude.',
  ARRAY['date_collecte','heure_collecte','chauffeurs_bloc']
)
ON CONFLICT (code) DO NOTHING;

-- ─── Rollback (manuel, si nécessaire) ─────────────────────────────────────────
-- Migration NON destructive (add-only). Reversal manuel : retirer la fonction
-- fn_infos_acces_marquer_si_complet(uuid), la ligne email_templates
-- code='infos_acces_collecte', puis les 3 colonnes nullable ajoutées
-- (tournees.accompagnant_nom, tournees.accompagnant_telephone,
-- collectes.infos_acces_email_envoye_at). Aucune donnée existante impactée.
