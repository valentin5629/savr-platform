-- =============================================================================
-- pgTAP — gabarit d'email « attestation_don_disponible », nommé « Rapport de don »
-- (CDC §12 §1.3-bis, décision Val 2026-10-13)
-- =============================================================================
-- Après toutes les migrations (seed bloc8 + 20261013180000), la ligne porte
-- l'objet « Votre rapport de don est disponible », et ne déclare que les
-- variables fournies par le batch AG J+1 : l'ancienne liste (prenom,
-- association_nom, lien_pdf) faisait refuser chaque envoi.
-- =============================================================================

BEGIN;
SELECT plan(6);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'attestation_don_disponible' AND actif = true),
  1,
  'attestation_don_disponible : 1 gabarit actif (code envoyé par le batch AG J+1)'
);

SELECT is(
  (SELECT sujet FROM plateforme.email_templates WHERE code = 'attestation_don_disponible'),
  'Votre rapport de don est disponible — {{nom_evenement}}',
  'objet : « Votre rapport de don est disponible »'
);

SELECT is(
  (SELECT variables FROM plateforme.email_templates WHERE code = 'attestation_don_disponible'),
  ARRAY['nom_evenement','date_evenement','lien_rapport']::text[],
  'variables déclarées = celles que le batch AG fournit (plus de prenom, association_nom, lien_pdf exigés)'
);

SELECT ok(
  (SELECT corps_html LIKE '%<a href="{{lien_rapport}}">Voir le rapport de don</a>%'
          AND corps_html LIKE '%{{date_evenement}}%'
          AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'attestation_don_disponible'),
  'corps : date de l''événement, lien « Voir le rapport de don », signature « L''équipe Savr »'
);

SELECT ok(
  (SELECT starts_with(corps_html, '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>')
   FROM plateforme.email_templates WHERE code = 'attestation_don_disponible'),
  'corps : prénom en bloc conditionnel (non exigé à l''envoi)'
);

SELECT ok(
  (SELECT sujet NOT ILIKE '%attestation%' AND corps_html NOT ILIKE '%attestation%'
   FROM plateforme.email_templates WHERE code = 'attestation_don_disponible'),
  'objet et corps : plus aucun « attestation »'
);

SELECT * FROM finish();
ROLLBACK;
