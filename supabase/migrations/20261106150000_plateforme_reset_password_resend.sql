-- =============================================================================
-- Email « mot de passe oublié » envoyé par Resend (décision Val 2026-11-06).
-- =============================================================================
-- Constat mesuré le 2026-11-06 : Supabase Auth envoyait cet email depuis son
-- expéditeur par défaut, qui ne livre qu'aux membres de l'équipe du projet. Un
-- client ne l'aurait jamais reçu. La route `api/auth/reset-password` fabrique
-- désormais le lien (`auth.admin.generateLink`) et l'envoie avec ce gabarit,
-- comme l'inscription et l'invitation.
--
-- Le gabarit, désactivé par la revue des emails (20261029150000) parce qu'aucun
-- code ne l'envoyait, est réactivé, avec la salutation des autres gabarits.
-- Données seules, aucune structure ni aucun accès modifié.
-- =============================================================================

UPDATE plateforme.email_templates
SET sujet = $tpl$Réinitialisez votre mot de passe Savr$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Vous avez demandé la réinitialisation de votre mot de passe Savr.</p><p>Ce lien est valide pendant 1 heure.</p><p><a href="{{lien_reset}}">Réinitialiser mon mot de passe</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : rien n'aura changé sur votre compte.</p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['prenom','lien_reset']::text[],
    description = $tpl$Réinitialisation de mot de passe (CDC §06.02 tpl 11). Lien fabriqué par Supabase (generateLink), email envoyé par Resend (Val 2026-11-06).$tpl$,
    actif = true,
    updated_at = now()
WHERE code = 'reset_password';

-- Contrôle de fin : un UPDATE à 0 ligne passerait sans erreur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plateforme.email_templates
    WHERE code = 'reset_password' AND actif
      AND variables = ARRAY['prenom','lien_reset']::text[]
  ) THEN
    RAISE EXCEPTION 'email_templates : reset_password non réactivé';
  END IF;
END $$;
