-- =============================================================================
-- pgTAP — template email « admin_modification_collecte_traiteur » (CDC §06.02 n°19)
-- =============================================================================
-- Scénario `email_modification_rendu` (couche db), demande Val 2026-10-09 :
-- après toutes les migrations (seed 20260705100000, corps 20261009160000),
-- l'email de modification liste les champs modifiés avec leurs valeurs, nomme le
-- programmateur et le statut, et ne garde de la priorité qu'une ligne ATTENTION
-- conditionnelle.
-- =============================================================================

BEGIN;
SELECT plan(5);

SELECT is(
  (SELECT COUNT(*)::integer FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur' AND actif = true),
  1,
  'admin_modification_collecte_traiteur : 1 template actif'
);

SELECT is(
  (SELECT variables FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur'),
  ARRAY['organisation_nom','date_initiale','pax_initial','liste_modifications','programmateur','statut_collecte','priorite_urgence']::text[],
  'admin_modification_collecte_traiteur : variables du nouveau corps'
);

SELECT ok(
  (SELECT corps_html LIKE '%L''organisation {{organisation_nom}} a modifié la collecte initialement prévue le {{date_initiale}}%'
      AND corps_html LIKE '%{{liste_modifications}}%'
      AND corps_html LIKE '%Le statut actuel de la collecte est « {{statut_collecte}} ».%'
      AND corps_html LIKE '%L''équipe Savr%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : organisation, date d''origine, liste des modifications, statut, signature'
);

SELECT ok(
  (SELECT corps_html LIKE '%{{#if pax_initial}} pour {{pax_initial}} pax{{/if}}%'
      AND corps_html LIKE '%{{#if programmateur}}<p>Le programmateur est {{programmateur}}.</p>%'
      AND corps_html LIKE '%{{#if priorite_urgence}}<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte.%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : pax, programmateur et ligne ATTENTION en blocs conditionnels'
);

SELECT ok(
  (SELECT corps_html NOT LIKE '%{{collecte_ref}}%'
      AND corps_html NOT LIKE '%{{demandeur_nom}}%'
      AND corps_html NOT LIKE '%{{champs_modifies}}%'
      AND corps_html NOT LIKE '%Priorité de traitement%'
   FROM plateforme.email_templates WHERE code = 'admin_modification_collecte_traiteur'),
  'admin_modification_collecte_traiteur : plus d''identifiant technique ni de ligne « Priorité de traitement »'
);

SELECT * FROM finish();
ROLLBACK;
