-- =============================================================================
-- pgTAP — aucun gabarit d'email n'écrit une variable avec des espaces
-- =============================================================================
-- Le moteur d'interpolation ne remplit que `{{var}}`. Une variable écrite
-- `{{ var }}` part telle quelle chez le destinataire (cas des emails Anti-Gaspi à
-- l'association et au transporteur, corrigé par 20261026100000).
-- =============================================================================

BEGIN;
SELECT plan(3);

SELECT is(
  (SELECT count(*)::integer FROM plateforme.email_templates
   WHERE coalesce(sujet, '') || coalesce(corps_html, '') || coalesce(corps_texte, '')
         ~ '\{\{\s+\w+\s*\}\}|\{\{\w+\s+\}\}'),
  0,
  'aucun gabarit ne contient une variable écrite avec des espaces'
);

SELECT ok(
  (SELECT strpos(sujet, '{{evenement_nom}}, {{date_collecte}}') > 0
          AND strpos(corps_html, '{{volume_estime_repas}}') > 0
   FROM plateforme.email_templates WHERE code = 'ag_attribution_association'),
  'ag_attribution_association : objet et corps portent les variables sans espace (texte de la revue 20261029150000)'
);

SELECT ok(
  (SELECT NOT actif FROM plateforme.email_templates WHERE code = 'ag_attribution_transporteur'),
  'ag_attribution_transporteur : désactivé (Val 2026-10-29 : la mission passe par le TMS)'
);

SELECT * FROM finish();
ROLLBACK;
