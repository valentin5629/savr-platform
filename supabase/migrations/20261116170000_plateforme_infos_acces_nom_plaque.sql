-- Email « Accès chauffeur » : nom + plaque suffisent (décision Val 2026-11-16).
--
-- MTS-1 n'expose pas le téléphone du chauffeur (mesuré le 2026-11-16 sur le
-- compte de prod : la fiche transporteur de /v3/carrier ne porte que prénom,
-- nom et code) et Val renonce à le saisir en V1. Exiger nom + téléphone
-- bloquait donc l'email pour toute collecte MTS-1.
--
-- Un camion est complet quand il a un nom de chauffeur ET une plaque, ou à
-- défaut de plaque un téléphone : un vélo cargo (A Toute!) n'a jamais de
-- plaque, son coursier arrive avec son téléphone (webhook du transporteur vélo), comme
-- avant. Le reste de la fonction est inchangé (périmètre contrôle d'accès,
-- claim anti-double-envoi, destinataire, contenu rendu).
--
-- Corps seul : signature, SECURITY DEFINER et droits inchangés (service_role
-- seul, ré-affirmés ci-dessous).

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
      WHERE NULLIF(btrim(t.chauffeur_nom), '') IS NOT NULL
        AND (NULLIF(btrim(t.plaque_immatriculation), '') IS NOT NULL
             OR NULLIF(btrim(t.chauffeur_telephone), '') IS NOT NULL)
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

REVOKE ALL ON FUNCTION plateforme.fn_infos_acces_marquer_si_complet(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION plateforme.fn_infos_acces_marquer_si_complet(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION plateforme.fn_infos_acces_marquer_si_complet(uuid) TO service_role;
