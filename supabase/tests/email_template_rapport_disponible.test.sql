-- =============================================================================
-- pgTAP — template email « rapport_disponible » (CDC §06.02 §6, divergence M1.6)
-- =============================================================================
-- Scénario tests/06.02 `seed_slug_rapport_disponible_pas_bordereau` (couche db) :
-- après toutes les migrations (bloc8 seed + 20261002100000 renommage), la base
-- connaît `rapport_disponible` (actif, variables = liste §6) et plus
-- `bordereau_disponible` (slug seedé par erreur, jamais appelé).
-- =============================================================================

BEGIN;
SELECT plan(5);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'rapport_disponible' AND actif = true),
  1,
  'rapport_disponible : 1 template actif (slug envoyé par le batch ZD J+1)'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'bordereau_disponible'),
  0,
  'bordereau_disponible : absent (renommé — divergence M1.6, Val 2026-09-14)'
);

SELECT is(
  (SELECT variables FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  ARRAY['prenom','date_collecte','lieu_nom','poids_total','co2_evite','taux_recyclage','lien_rapport']::text[],
  'rapport_disponible : variables = liste exacte du CDC §06.02 §6'
);

SELECT is(
  (SELECT sujet FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  'Votre rapport RSE est disponible — {{date_collecte}} à {{lieu_nom}}',
  'rapport_disponible : objet du CDC §06.02 §6'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{lien_rapport}}%' AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  'rapport_disponible : corps avec CTA {{lien_rapport}} et signature « L''équipe Savr »'
);

SELECT * FROM finish();
ROLLBACK;
