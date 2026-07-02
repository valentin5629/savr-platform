-- R17 BOA-03 — seed du template email `admin_demande_ajout_lieu` (§06 Fonctionnalités
-- détaillées / 02 - Templates emails V1.md §13), manquant au seed bloc8 (backlog
-- BL-P1-BOA-03 : "email admin_demande_ajout_lieu ni seedé ni envoyé").
-- Vouvoiement, FR, 0 emoji, signature « L'équipe Savr » (charte §06.02).

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
(
  'admin_demande_ajout_lieu',
  '[Admin] Nouveau lieu à normaliser — {{lieu_nom}}',
  '<p>Bonjour,</p><p>Un utilisateur a saisi un nouveau lieu manuellement lors d''une programmation de collecte.</p><ul><li>Nom du lieu : {{lieu_nom}}</li><li>Adresse : {{lieu_adresse}}</li><li>Saisi par : {{user_nom}} ({{organisation_nom}})</li><li>Collecte associée : {{date_collecte}}</li></ul><p>Action requise : vérifier, compléter et valider la fiche lieu (passage de <code>actif = false</code> à <code>actif = true</code>).</p><p><a href="{{lien_lieu}}">Normaliser le lieu</a></p><p>L''équipe Savr</p>',
  true,
  'Notification Admin Savr — nouveau lieu saisi manuellement en programmation, à normaliser (§06 Back-office Admin « Action Normaliser un lieu »).',
  ARRAY['lieu_nom','lieu_adresse','user_nom','organisation_nom','date_collecte','lien_lieu']
)
ON CONFLICT (code) DO NOTHING;
