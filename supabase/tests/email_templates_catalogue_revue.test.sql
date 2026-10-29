-- =============================================================================
-- pgTAP — catalogue des gabarits d'email après la revue de Val (2026-10-29)
-- =============================================================================
-- Verrouille ce que la revue a validé (migration 20261029150000) : quels gabarits
-- partent encore, lesquels sont désactivés, et la cohérence de chaque gabarit
-- actif (variables déclarées, blocs conditionnels, signature).
-- =============================================================================

BEGIN;
SELECT plan(10);

SELECT is(
  (SELECT array_agg(code ORDER BY code) FROM plateforme.email_templates WHERE actif),
  ARRAY[
    'admin_collecte_annulee','admin_demande_ajout_lieu','admin_demande_annulation',
    'admin_demande_renouvellement_pack','admin_incident_collecte',
    'admin_modification_collecte_traiteur','admin_pack_ag_etat',
    'ag_attribution_association','annulation_collecte','attestation_don_disponible',
    'bienvenue_organisation','collecte_modifiee_tiers','collecte_programmee',
    'collecte_programmee_tiers','infos_acces_collecte','invitation_utilisateur',
    'rapport_disponible','siret_verification_echec','verification_email'
  ]::text[],
  'les 19 gabarits actifs sont exactement ceux que la revue a gardés'
);

SELECT is(
  (SELECT array_agg(code ORDER BY code) FROM plateforme.email_templates WHERE NOT actif),
  ARRAY[
    'ag_a_toutes_indispo','ag_attribution_transporteur','alerte_ops_collecte_non_transmise',
    'alerte_ops_pesee_anormale','attribution_association','attribution_transporteur',
    'avoir_emis','collecte_realisee','confirmation_collecte','facture_emise',
    'facture_relance_j15','pack_ag_active','rappel_collecte_j3','reset_password'
  ]::text[],
  'les 14 gabarits écartés par la revue sont désactivés (pas supprimés)'
);

-- Toute variable citée (objet ou corps) est déclarée, et inversement.
SELECT is(
  (SELECT count(*)::int FROM plateforme.email_templates t
   WHERE t.actif
     AND ARRAY(SELECT DISTINCT m[1]
                 FROM regexp_matches(t.sujet || t.corps_html,
                                     '\{\{(?:#if\s+)?(\w+)\}\}', 'g') AS m
                ORDER BY 1)
         <> ARRAY(SELECT v FROM unnest(t.variables) AS v ORDER BY 1)),
  0,
  'chaque gabarit actif déclare exactement les variables qu''il cite'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.email_templates
   WHERE actif
     AND (length(sujet || corps_html) - length(replace(sujet || corps_html, '{{#if', ''))) / 5
      <> (length(sujet || corps_html) - length(replace(sujet || corps_html, '{{/if}}', ''))) / 7),
  0,
  'chaque gabarit actif ferme ses blocs conditionnels'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.email_templates
   WHERE actif AND strpos(corps_html, 'L''équipe Savr') = 0),
  0,
  'chaque gabarit actif est signé « L''équipe Savr »'
);

SELECT is(
  (SELECT count(*)::int FROM plateforme.email_templates
   WHERE actif AND (sujet || corps_html) ~ '[\U0001F300-\U0001FAFF☀-➿]'),
  0,
  'aucun emoji dans les gabarits actifs'
);

-- Décisions de la revue, une par assertion.
SELECT ok(
  (SELECT strpos(corps_html, '07 61 91 29 97') = 0
          AND strpos(corps_html, 'N''oubliez pas de les programmer dès maintenant.</p>') > 0
          AND strpos(corps_html, '<a href="{{lien_evenement}}">') = 0
   FROM plateforme.email_templates WHERE code = 'collecte_programmee'),
  'récapitulatif : plus d''alerte 24 h, la phrase « plusieurs collectes » sans lien (Val 2026-10-29)'
);

SELECT ok(
  (SELECT strpos(corps_html, '{{#if est_modification}}<p>Modifications apportées :</p>{{liste_modifications}}{{/if}}') > 0
   FROM plateforme.email_templates WHERE code = 'collecte_modifiee_tiers'),
  'modifiée par un tiers : chaque champ modifié, avant et après (liste_modifications)'
);

SELECT ok(
  (SELECT strpos(corps_html, '<p><a href="{{lien_programmation_collecte}}">Programmer ma première collecte</a></p>') > 0
   FROM plateforme.email_templates WHERE code = 'bienvenue_organisation'),
  'bienvenue : lien seul dans son paragraphe, rendu en bouton par l''enveloppe commune'
);

SELECT ok(
  (SELECT strpos(sujet, 'Don de repas confirmé') = 1
          AND strpos(corps_html, '<ul><li>Collecte sur événement : le {{date_collecte}}') > 0
   FROM plateforme.email_templates WHERE code = 'ag_attribution_association'),
  'association : objet « Don de repas confirmé », liste bien formée'
);

SELECT * FROM finish();
ROLLBACK;
