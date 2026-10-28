-- =============================================================================
-- pgTAP — les emails d'activation et d'invitation portent leur lien
-- =============================================================================
-- Le seed avait posé deux corps d'une phrase, sans le lien que le code fournit :
-- personne ne pouvait activer son compte ni rejoindre son équipe depuis l'email
-- (corrigé par 20261028190000).
-- =============================================================================

BEGIN;
SELECT plan(7);

-- strpos, pas LIKE : « _ » vaut n'importe quel caractère dans un motif LIKE.
SELECT ok(
  (SELECT strpos(corps_html, '<a href="{{lien_verification}}">Activer mon compte</a>') > 0
   FROM plateforme.email_templates WHERE code = 'verification_email' AND actif),
  'verification_email : lien d''activation présent'
);

SELECT ok(
  (SELECT strpos(corps_html, '<a href="{{lien_invitation}}">Choisir mon mot de passe</a>') > 0
   FROM plateforme.email_templates WHERE code = 'invitation_utilisateur' AND actif),
  'invitation_utilisateur : lien d''invitation présent'
);

SELECT is(
  (SELECT sujet FROM plateforme.email_templates WHERE code = 'verification_email'),
  'Activez votre compte Savr',
  'verification_email : objet du CDC §12'
);

SELECT is(
  (SELECT sujet FROM plateforme.email_templates WHERE code = 'invitation_utilisateur'),
  'Invitation à rejoindre {{organisation_nom}} sur Savr',
  'invitation_utilisateur : objet du CDC §17'
);

-- Les variables déclarées restent celles que le code fournit.
SELECT is(
  (SELECT variables FROM plateforme.email_templates WHERE code = 'verification_email'),
  ARRAY['prenom','lien_verification']::text[],
  'verification_email : variables inchangées'
);

SELECT ok(
  (SELECT bool_and(strpos(corps_html, 'L''équipe Savr') > 0
                   AND starts_with(corps_html, '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>'))
   FROM plateforme.email_templates
   WHERE code IN ('verification_email', 'invitation_utilisateur')),
  'les deux : prénom facultatif et signature « L''équipe Savr »'
);

-- 20261028210000 : lien Savr valable 7 jours (CDC §06.02 §17).
SELECT ok(
  (SELECT strpos(corps_html, 'Ce lien vous est personnel et reste valable 7 jours.') > 0
   FROM plateforme.email_templates WHERE code = 'invitation_utilisateur'),
  'invitation_utilisateur : durée de 7 jours annoncée'
);

SELECT * FROM finish();
ROLLBACK;
