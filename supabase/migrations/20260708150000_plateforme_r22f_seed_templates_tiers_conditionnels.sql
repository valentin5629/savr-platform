-- R22f / BL-P2-22 — Templates emails tiers + conditionnels ({{#if}}).
-- =============================================================================
-- CDC §06.02 « Templates emails V1 » — 4 templates jamais seedés jusqu'ici :
--   · 20. collecte_programmee_tiers   (l.525) — info-only au traiteur opérationnel
--   · 21. collecte_modifiee_tiers     (l.552) — modif OU annulation par un tiers
--   · 22. admin_collecte_annulee      (l.583) — Admin, toute annulation
--   · 9.  admin_pack_ag_etat          (l.199) — Admin, pack AG bas / épuisé (fusion B1)
-- Copie fidèle du CDC (objet + corps + blocs {{#if}}). Corps en HTML (charte
-- §06.02 : vouvoiement, FR, 0 emoji, signature « L'équipe Savr » ; les CTA CDC
-- « [Bouton : …] » sont rendus en <a href="{{lien_*}}">).
-- L'interpolateur {{#if}} est câblé dans packages/shared/src/email/index.ts (R22f).
-- `variables` = liste documentée du CDC ; findMissingVariables exclut les
-- variables conditionnelles (booléens de bloc + contenu de branche) à l'envoi.
--
-- ÉMISSION : templates 20/21/22 câblés dans les routes programmation/modification/
-- annulation (ce même lot). Template 9 (admin_pack_ag_etat) = SEED SEUL — son
-- émission dépend de la détection de franchissement de seuil (débit pack → 10 % /
-- épuisé) qui est la surface de BL-P2-30 (R22e, M0.3) ; aujourd'hui seule l'alerte
-- in-app `pack_ag_epuise` existe (aucun seuil 10 %, aucun email). Décision R22f
-- (ticket délègue explicitement) : template disponible en DB, émission à BL-P2-30.
--
-- Data-only, additif, backward-compatible : INSERT ON CONFLICT (code) DO NOTHING
-- (même forme que le seed bloc8 et R16a/R17/R19). Aucune table/colonne modifiée.
-- =============================================================================

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
(
  'collecte_programmee_tiers',
  'Une collecte a été programmée chez vous — {{date_collecte}} à {{lieu_nom}}',
  '<p>Bonjour {{prenom}},</p>'
  '<p>{{organisation_programmatrice}} a programmé une collecte vous concernant. Aucune action n''est requise de votre part — cet email est informatif.</p>'
  '<ul>'
  '<li>Date : {{date_collecte}}</li>'
  '<li>Horaire de collecte : {{horaire_collecte}}</li>'
  '<li>Lieu : {{lieu_nom}}, {{lieu_adresse}}</li>'
  '<li>Type : {{type_collecte}} ({{flux_list}})</li>'
  '<li>Programmé par : {{programmeur_nom}} ({{organisation_programmatrice}})</li>'
  '</ul>'
  '<p><a href="{{lien_collecte}}">Voir la collecte</a></p>'
  '<p>L''équipe Savr</p>',
  true,
  'Template 20 (§06.02 l.525) — info-only au traiteur opérationnel quand une collecte est programmée par un tiers (agence/gestionnaire, org != traiteur op, non-shadow).',
  ARRAY['prenom','organisation_programmatrice','programmeur_nom','date_collecte','horaire_collecte','lieu_nom','lieu_adresse','type_collecte','flux_list','lien_collecte']
),
(
  'collecte_modifiee_tiers',
  'Collecte {{type_changement_libelle}} — {{date_collecte}} à {{lieu_nom}}',
  '<p>Bonjour {{prenom}},</p>'
  '<p>La collecte programmée chez vous par {{organisation_programmatrice}} a été {{type_changement_libelle}}.</p>'
  '{{#if est_modification}}<p>Modifications apportées :</p><p>{{diff_list}}</p>{{/if}}'
  '{{#if est_annulation}}<p>La collecte du {{date_collecte}} au {{lieu_nom}} n''aura pas lieu.</p>{{/if}}'
  '<p>Cet email est informatif — aucune action n''est requise de votre part.</p>'
  '<p><a href="{{lien_collecte}}">Voir la collecte</a></p>'
  '<p>L''équipe Savr</p>',
  true,
  'Template 21 (§06.02 l.552) — modification OU annulation d''une collecte par un tiers (variable type_changement pilote objet + bloc conditionnel), destinataire = traiteur opérationnel.',
  ARRAY['prenom','organisation_programmatrice','type_changement','type_changement_libelle','est_modification','est_annulation','date_collecte','lieu_nom','diff_list','lien_collecte']
),
(
  'admin_collecte_annulee',
  '[Admin] Collecte annulée — {{organisation_nom}} — {{date_collecte}}',
  '<p>Une collecte a été annulée.</p>'
  '<ul>'
  '<li>Collecte : {{collecte_ref}} (type {{type_collecte}})</li>'
  '<li>Organisation : {{organisation_nom}}</li>'
  '<li>Date / lieu : {{date_collecte}} à {{lieu_nom}}</li>'
  '<li>Annulée par : {{user_nom}} ({{user_role}})</li>'
  '<li>Délai avant créneau : {{delai_avant_creneau}}</li>'
  '<li>Facturation : {{info_facturation}}</li>'
  '</ul>'
  '{{#if annulation_tardive}}<p>ATTENTION : annulation à moins de 12h du créneau — plein tarif applicable, vérifier le relais logistique.</p>{{/if}}'
  '<p><a href="{{lien_backoffice}}">Voir la collecte sur le back-office</a></p>'
  '<p>L''équipe Savr</p>',
  true,
  'Template 22 (§06.02 l.583) — alerte Admin à toute annulation de collecte, en parallèle du template 5 client (annulation_collecte). Bloc conditionnel annulation_tardive (< 12h).',
  ARRAY['collecte_ref','type_collecte','organisation_nom','date_collecte','lieu_nom','user_nom','user_role','delai_avant_creneau','info_facturation','annulation_tardive','lien_backoffice']
),
(
  'admin_pack_ag_etat',
  '[Admin] Pack AG {{etat_libelle}} — {{organisation_nom}}',
  '<p>Le pack Anti-Gaspi de {{organisation_nom}} est {{etat_libelle}}.</p>'
  '<ul>'
  '<li>Type de pack : {{type_pack}}</li>'
  '<li>Crédits restants : {{credits_restants}} / {{credits_initiaux}} ({{pct_restant}} %)</li>'
  '<li>Dernière collecte : {{derniere_collecte_date}}</li>'
  '</ul>'
  '{{#if niveau_bas}}<p>Il est temps de lancer la négociation du pack suivant.</p>{{/if}}'
  '{{#if niveau_epuise}}<p>La programmation de nouvelles collectes Anti-Gaspi est désormais bloquée pour cette organisation jusqu''à l''acquisition d''un nouveau pack.</p>{{/if}}'
  '<p><a href="{{lien_fiche_org}}">Voir la fiche organisation</a></p>'
  '<p>L''équipe Savr</p>',
  true,
  'Template 9 (§06.02 l.199, fusion B1 bas+épuisé) — alerte Admin état pack AG (niveau bas / épuisé). SEED SEUL en R22f : émission = surface BL-P2-30 (détection seuil au débit).',
  ARRAY['niveau','etat_libelle','organisation_nom','type_pack','credits_restants','credits_initiaux','pct_restant','derniere_collecte_date','niveau_bas','niveau_epuise','lien_fiche_org']
)
ON CONFLICT (code) DO NOTHING;
