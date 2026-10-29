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
  ARRAY['nom_evenement','prenom','date_evenement','association_nom','nb_repas','lien_rapport']::text[],
  'variables citées (revue des emails 20261029150000) ; prénom, association et repas en blocs conditionnels, jamais exigés'
);

-- strpos, pas LIKE : dans un motif LIKE, « _ » vaut n'importe quel caractère, et
-- « {{lien-rapport}} » (que le moteur n'interpole pas) passerait pour « {{lien_rapport}} ».
SELECT ok(
  (SELECT strpos(corps_html, '<a href="{{lien_rapport}}">Voir le rapport de don</a>') > 0
          AND strpos(corps_html, '{{date_evenement}}') > 0
          AND strpos(corps_html, 'L''équipe Savr') > 0
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
