-- =============================================================================
-- Gabarits d'email « verification_email » et « invitation_utilisateur » : le lien
-- (décision Val 2026-10-28)
-- =============================================================================
-- Les deux gabarits posés par le seed (20260611171642) n'avaient qu'une phrase,
-- SANS le lien que le code fournit (`lien_verification` à l'inscription,
-- `lien_invitation` à l'invitation) : un nouvel inscrit ne pouvait pas activer son
-- compte, et un collaborateur invité ne pouvait pas rejoindre son équipe, depuis
-- l'email.
--
-- Nouveau texte (CDC §06.02 §12 et §17, objets du CDC) : lien d'action, une phrase
-- de contexte sur Savr, vouvoiement, signature « L'équipe Savr ». Aucune durée de
-- validité annoncée : celle du lien d'invitation n'est pas maîtrisée ici (lien de
-- récupération Supabase), à traiter à part. Les variables déclarées ne changent
-- pas ; le prénom passe dans un bloc conditionnel (« Bonjour, » s'il est vide).
--
-- Portée : deux lignes de référentiel (sujet, corps_html). Aucune structure, aucun
-- droit. Idempotent : un rejeu réécrit les mêmes valeurs.
--
-- Retour arrière : réécrire les corps posés par 20260611171642.
-- =============================================================================

UPDATE plateforme.email_templates
SET
  sujet = 'Activez votre compte Savr',
  corps_html =
    '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>'
    || '<p>Merci pour votre inscription sur Savr, la plateforme qui organise la '
    || 'collecte des surplus de vos événements : les repas non servis sont donnés '
    || 'à des associations (Anti-Gaspi), les déchets sont triés et recyclés '
    || '(Zéro Déchet).</p>'
    || '<p>Pour activer votre compte, confirmez votre adresse email :</p>'
    || '<p><a href="{{lien_verification}}">Activer mon compte</a></p>'
    || '<p>Si vous n''êtes pas à l''origine de cette inscription, ignorez simplement '
    || 'cet email : aucun compte ne sera activé.</p>'
    || '<p>À très vite,<br>L''équipe Savr</p>',
  updated_at = now()
WHERE code = 'verification_email';

UPDATE plateforme.email_templates
SET
  sujet = 'Invitation à rejoindre {{organisation_nom}} sur Savr',
  corps_html =
    '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>'
    || '<p>Vous êtes invité(e) à rejoindre l''espace de {{organisation_nom}} sur '
    || 'Savr.</p>'
    || '<p>Savr est la plateforme qu''utilise votre organisation pour programmer et '
    || 'suivre la collecte des surplus de ses événements : don des repas non servis '
    || 'à des associations (Anti-Gaspi) et recyclage des déchets (Zéro Déchet).</p>'
    || '<p>Pour accéder à votre espace, choisissez votre mot de passe :</p>'
    || '<p><a href="{{lien_invitation}}">Choisir mon mot de passe</a></p>'
    || '<p>Ce lien vous est personnel. Si vous ne vous attendiez pas à cette '
    || 'invitation, vous pouvez ignorer cet email.</p>'
    || '<p>Bienvenue,<br>L''équipe Savr</p>',
  updated_at = now()
WHERE code = 'invitation_utilisateur';

-- Contrôle de fin : les deux lignes portent leur lien (un UPDATE à 0 ligne
-- passerait sans erreur).
DO $$
DECLARE
  v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
  FROM plateforme.email_templates
  WHERE (code = 'verification_email'
         AND strpos(corps_html, '<a href="{{lien_verification}}">') > 0)
     OR (code = 'invitation_utilisateur'
         AND strpos(corps_html, '<a href="{{lien_invitation}}">') > 0);
  IF v_ok <> 2 THEN
    RAISE EXCEPTION 'email_templates : % gabarit(s) sur 2 portent leur lien', v_ok;
  END IF;
END $$;
