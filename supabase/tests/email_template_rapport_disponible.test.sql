-- =============================================================================
-- pgTAP — template email « rapport_disponible » (CDC §06.02 §6, divergence M1.6)
-- =============================================================================
-- Scénario tests/06.02 `seed_slug_rapport_disponible_pas_bordereau` (couche db) :
-- après toutes les migrations (bloc8 seed + 20261002100000 renommage), la base
-- connaît `rapport_disponible` (actif, variables = liste §6) et plus
-- `bordereau_disponible` (slug seedé par erreur, jamais appelé).
-- =============================================================================

BEGIN;
SELECT plan(6);

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
  ARRAY['nom_evenement','date_collecte','prenom','lieu_nom','poids_total','co2_evite','taux_recyclage','lien_rapport']::text[],
  'rapport_disponible : variables citées (revue des emails 20261029150000)'
);

SELECT is(
  (SELECT sujet FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  'Rapport de recyclage disponible — {{#if nom_evenement}}{{nom_evenement}}, {{/if}}{{date_collecte}}',
  'rapport_disponible : objet validé à la revue des emails (Val 2026-10-29)'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{lien_rapport}}%' AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  'rapport_disponible : corps avec CTA {{lien_rapport}} et signature « L''équipe Savr »'
);

SELECT ok(
  (SELECT corps_html LIKE '%Téléchargez le rapport en PDF depuis la fiche de la collecte%'
      AND corps_html LIKE '%comparaison avec les autres événements Savr%'
      AND corps_html LIKE '%{{#if prenom}}%'
   FROM plateforme.email_templates WHERE code = 'rapport_disponible'),
  'rapport_disponible : le rapport se télécharge depuis la fiche, comparaison au choix, prénom facultatif (Val 2026-10-16 puis 2026-10-29)'
);

SELECT * FROM finish();
ROLLBACK;
