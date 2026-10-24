-- =============================================================================
-- pgTAP — template email « collecte_programmee » (CDC §06.02 §3, formule d'appel)
-- =============================================================================
-- Scénario `email_recap_bonjour_prenom` (couche db), demande Val 2026-10-08 :
-- après toutes les migrations (seed 20260614130000, corps 20260708120000, formule
-- d'appel 20261008150000, une ligne par collecte 20261024100000 — lot B2,
-- décision Val 2026-10-24 B2-Q3), l'email récapitulatif de programmation ouvre
-- par le prénom du programmeur, sans que `prenom` devienne une variable exigée,
-- et liste chaque collecte.
-- =============================================================================

BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'collecte_programmee' AND actif = true),
  1,
  'collecte_programmee : 1 template actif (récap envoyé au programmeur)'
);

SELECT ok(
  (SELECT starts_with(corps_html, '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>')
   FROM plateforme.email_templates WHERE code = 'collecte_programmee'),
  'collecte_programmee : le corps ouvre par « Bonjour Prénom, » (prénom en bloc conditionnel)'
);

SELECT is(
  (SELECT variables FROM plateforme.email_templates WHERE code = 'collecte_programmee'),
  ARRAY['nom_evenement','nombre_collectes','liste_collectes','tarif_ligne']::text[],
  'collecte_programmee : variables exigées — événement, nombre et liste des collectes, tarif (prénom et lien non exigés à l’envoi)'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{nom_evenement}}%'
      AND corps_html LIKE '%Nous réaliserons {{nombre_collectes}} :%'
      AND corps_html LIKE '%{{liste_collectes}}%'
      AND corps_html LIKE '%{{tarif_ligne}}%'
      AND corps_html LIKE '%{{#if lien_collectes}}%'
      AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'collecte_programmee'),
  'collecte_programmee : une ligne par collecte (événement, liste, tarif, lien facultatif, signature)'
);

SELECT * FROM finish();
ROLLBACK;
