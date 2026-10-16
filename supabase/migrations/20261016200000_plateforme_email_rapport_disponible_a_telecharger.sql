-- =============================================================================
-- Gabarit d'email « rapport_disponible » : le rapport de recyclage se télécharge
-- sur la plateforme (décision Val 2026-10-16).
-- =============================================================================
-- Plus aucun rapport de recyclage n'est fabriqué automatiquement : l'utilisateur
-- le télécharge lui-même depuis la fiche de la collecte et choisit à ce moment-là
-- d'y inclure ou non le radar de comparaison. Le batch J+1 continue d'envoyer cet
-- email à la fin de l'embargo (choix de Val : « garder, reformulé », pas de PDF
-- joint, lien vers la collecte).
--
-- Le corps disait « Le rapport de votre collecte du … est prêt. » : il dit
-- désormais que le rapport peut être téléchargé sur la plateforme, et que le
-- radar se choisit au téléchargement. L'objet, les variables et le code ne
-- changent pas (le batch fournit toujours les mêmes variables).
--
-- Portée : une ligne de référentiel (corps, description). Aucune structure
-- modifiée, aucun droit touché. Idempotent : un rejeu réécrit les mêmes valeurs.
--
-- Retour arrière : réécrire le corps et la description posés par 20261002100000.
-- =============================================================================

UPDATE plateforme.email_templates
SET
  corps_html =
    '<p>Bonjour {{prenom}},</p>'
    || '<p>Le rapport de recyclage de votre collecte du {{date_collecte}} peut '
    || 'être téléchargé sur la plateforme.</p>'
    || '<p>Résumé impact :</p>'
    || '<ul>'
    || '<li>{{poids_total}} kg détournés</li>'
    || '<li>{{co2_evite}} kg CO₂e évités</li>'
    || '<li>Taux de recyclage : {{taux_recyclage}} %</li>'
    || '</ul>'
    || '<p>Depuis la fiche de la collecte, vous choisissez d''y inclure ou non le '
    || 'radar de comparaison avec les autres événements Savr, puis vous '
    || 'téléchargez le PDF.</p>'
    || '<p><a href="{{lien_rapport}}">Télécharger le rapport</a></p>'
    || '<p>Belle suite,<br>L''équipe Savr</p>',
  description =
    'Template 6 (§06.02 §6) — rapport de recyclage ZD téléchargeable. Envoyé par '
    || 'le batch J+1 6h (batch-pdf-j1.ts) à la fin de l''embargo, au programmeur '
    || 'de la collecte (organisations.email_principal de l''organisation '
    || 'programmatrice). Le PDF n''est pas joint : il est fabriqué au '
    || 'téléchargement, avec ou sans radar (décision Val 2026-10-16).'
WHERE code = 'rapport_disponible';
