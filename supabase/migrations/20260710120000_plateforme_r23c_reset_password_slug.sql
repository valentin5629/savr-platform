-- =============================================================================
-- R23c / BL-P3-11 — Slug catalogue « reset_password » (CDC §06.02 template 11).
-- =============================================================================
-- Constat audit : le slug CDC `reset_password` était absent du catalogue ; la ligne
-- existait sous le code français `reinitialisation_mot_de_passe` (seed bloc8).
--
-- Arbitrage Val (R23c) : la délivrance du reset RESTE GoTrue-native (CDC §09 « lien
-- magique signé par Supabase »), mais l'email porte désormais le contenu Savr brandé
-- via le recovery template GoTrue (supabase/config.toml → [auth.email.template.recovery]
-- + supabase/templates/recovery.html). La ligne `email_templates` est le reflet
-- CATALOGUE de §06.02 (non envoyée par le pipeline Resend) : on l'aligne sur le slug
-- CDC + l'objet §06.02. GoTrue n'expose pas le prénom → variable `prenom` retirée.
--
-- Renommage via UPDATE (backward-compatible : la ligne dort, aucun code d'envoi ne
-- la lit — reset = supabase.auth.resetPasswordForEmail). Aucune structure modifiée.
-- =============================================================================

UPDATE plateforme.email_templates
SET
  code = 'reset_password',
  sujet = 'Réinitialisez votre mot de passe Savr',
  corps_html =
    '<p>Vous avez demandé la réinitialisation de votre mot de passe Savr.</p>'
    || '<p>Ce lien est valide pendant 1 heure.</p>'
    || '<p><a href="{{lien_reset}}">Réinitialiser mon mot de passe</a></p>'
    || '<p>Si vous n''êtes pas à l''origine de cette demande, ignorez cet email — '
    || 'rien n''aura changé sur votre compte.</p>'
    || '<p>L''équipe Savr</p>',
  description =
    'Réinitialisation de mot de passe (CDC §06.02 tpl 11). Délivré par GoTrue '
    || '(lien magique signé Supabase, §09), contenu brandé via '
    || 'supabase/templates/recovery.html. Sans variable prénom (GoTrue).',
  variables = ARRAY['lien_reset']
WHERE code = 'reinitialisation_mot_de_passe';
