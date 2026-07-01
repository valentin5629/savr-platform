-- =============================================================================
-- R16a (BL-P1-RM-09) — Seed du template email `admin_incident_collecte`.
-- =============================================================================
-- Template au catalogue §06.02 item 10 (slug `admin_incident_collecte`) mais ABSENT
-- du seed (grep 0). C'est un seed MANQUANT (conforme V1), pas un nouveau template.
-- Destinataire = admin_savr. Vouvoiement, FR, 0 emoji, signature « L'équipe Savr ».
-- Utilisé par le flux incident (route admin/collectes/[id]/incident, RM-09).
-- ON CONFLICT (code) DO NOTHING : rejouable, ne réécrit pas un seed existant.
-- =============================================================================

INSERT INTO plateforme.email_templates (code, sujet, corps_html, actif, description, variables) VALUES
  ('admin_incident_collecte',
   '[Admin] Incident collecte — {{type_incident}} — {{date_collecte}}',
   '<p>Un incident a été signalé sur une collecte.</p>'
   || '<ul>'
   || '<li>Collecte : {{lieu_nom}} — {{date_collecte}}</li>'
   || '<li>Type d''incident : {{type_incident}}</li>'
   || '<li>Imputable à : {{imputable_a}}</li>'
   || '<li>Description : {{description}}</li>'
   || '</ul>'
   || '<p>Action requise : évaluation et suite à donner (avoir, réattribution, contestation).</p>'
   || '<p><a href="{{lien_collecte}}">Voir la collecte</a></p>'
   || '<p>L''équipe Savr</p>',
   true,
   'Alerte Admin — incident sur une collecte (collecte manquée, refus, pesée). §06.02 item 10.',
   ARRAY['lieu_nom', 'date_collecte', 'type_incident', 'imputable_a', 'description', 'lien_collecte'])
ON CONFLICT (code) DO NOTHING;
