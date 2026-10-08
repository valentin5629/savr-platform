-- =============================================================================
-- pgTAP — template email « collecte_programmee » (CDC §06.02 §3, formule d'appel)
-- =============================================================================
-- Scénario `email_recap_bonjour_prenom` (couche db), demande Val 2026-10-08 :
-- après toutes les migrations (seed 20260614130000, corps 20260708120000, formule
-- d'appel 20261008150000), l'email récapitulatif de programmation ouvre par le
-- prénom du programmeur, sans que `prenom` devienne une variable exigée.
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
  ARRAY['nom_evenement','date_collecte','tarif_ligne']::text[],
  'collecte_programmee : variables exigées inchangées (prenom non exigé à l''envoi)'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{nom_evenement}}%'
      AND corps_html LIKE '%{{date_collecte}}%'
      AND corps_html LIKE '%{{tarif_ligne}}%'
      AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'collecte_programmee'),
  'collecte_programmee : reste du corps conservé (événement, date, tarif, signature)'
);

SELECT * FROM finish();
ROLLBACK;
