-- =============================================================================
-- Template email « rapport_disponible » (CDC §06.02 template 6) — alignement seed.
-- =============================================================================
-- Divergence M1.6 (2026-09-11), tranchée Val 2026-09-14 (cdc-patch-divergences) :
-- la base a été seedée (bloc8) avec le slug `bordereau_disponible`, que AUCUN code
-- n'appelle ; le batch ZD J+1 (batch-pdf-j1.ts, étape 10) envoie `rapport_disponible`,
-- absent de toute migration → TEMPLATE_NOT_FOUND, aucun email de rapport ZD n'est
-- jamais parti. Constaté à nouveau sur savr-dev le 2026-10-02.
--
-- Correctif retenu par le CDC (§06.02 §6, « Écart seed → code à corriger ») :
-- renommer la ligne en base (dev + prod) en reprenant l'objet, le corps et la liste
-- de variables du §6. Le CDC fait foi, c'est le seed qui diverge.
--
-- Data-only, backward-compatible : UPDATE d'une ligne dormante (aucun code ne lit
-- `bordereau_disponible`), aucune structure modifiée, aucun droit touché. Idempotent :
-- no-op si la ligne est déjà renommée, et jamais de doublon si `rapport_disponible`
-- existait déjà (code UNIQUE).
-- Variables = liste §06.02 §6 ; findMissingVariables (shared/email) refuse l'envoi
-- si l'une d'elles manque — le batch les fournit toutes depuis ce même lot.
-- =============================================================================

UPDATE plateforme.email_templates
SET
  code = 'rapport_disponible',
  sujet = 'Votre rapport RSE est disponible — {{date_collecte}} à {{lieu_nom}}',
  corps_html =
    '<p>Bonjour {{prenom}},</p>'
    || '<p>Le rapport de votre collecte du {{date_collecte}} est prêt.</p>'
    || '<p>Résumé impact :</p>'
    || '<ul>'
    || '<li>{{poids_total}} kg détournés</li>'
    || '<li>{{co2_evite}} kg CO₂e évités</li>'
    || '<li>Taux de recyclage : {{taux_recyclage}} %</li>'
    || '</ul>'
    || '<p>Vous pouvez consulter le rapport complet et le télécharger en PDF '
    || 'directement depuis votre espace.</p>'
    || '<p><a href="{{lien_rapport}}">Voir le rapport</a></p>'
    || '<p>Belle suite,<br>L''équipe Savr</p>',
  description =
    'Template 6 (§06.02 §6) — rapport post-collecte ZD disponible. Envoyé par le '
    || 'batch J+1 6h (batch-pdf-j1.ts) au programmeur de la collecte, adresse '
    || 'organisations.email_principal de l''organisation programmatrice. '
    || 'Ex `bordereau_disponible` (seed bloc8, jamais appelé).',
  variables = ARRAY['prenom','date_collecte','lieu_nom','poids_total','co2_evite','taux_recyclage','lien_rapport']
WHERE code = 'bordereau_disponible'
  AND NOT EXISTS (
    SELECT 1 FROM plateforme.email_templates WHERE code = 'rapport_disponible'
  );
