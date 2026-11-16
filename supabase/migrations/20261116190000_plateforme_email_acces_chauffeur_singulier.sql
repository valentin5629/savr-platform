-- Email « Accès chauffeur » (infos_acces_collecte) : phrase d'introduction sur
-- nom + plaque d'immatriculation, au singulier pour un camion et au pluriel
-- pour plusieurs ; phrase de fin reformulée (Val 2026-11-16).
-- `un_chauffeur` / `plusieurs_chauffeurs` sont deux conditions exclusives
-- calculées par l'appelant (notify.ts) : le moteur n'a pas de {{else}}.
-- Données seules (UPDATE d'un gabarit), aucun droit ni structure touché.

UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>{{#if un_chauffeur}}Voici le nom et la plaque d'immatriculation du chauffeur qui interviendra{{/if}}{{#if plusieurs_chauffeurs}}Voici les noms et les plaques d'immatriculation des chauffeurs qui interviendront{{/if}} sur votre événement{{#if evenement_nom}} « {{evenement_nom}} »{{/if}}, le <strong>{{date_collecte}}</strong> à <strong>{{heure_collecte}}</strong>{{#if lieu_nom}}, {{lieu_nom}}{{/if}}{{#if lieu_adresse}} ({{lieu_adresse}}){{/if}}.</p>{{chauffeurs_bloc}}<p>Si ces informations étaient amenées à changer, nous vous enverrons un nouvel email dans les plus brefs délais.</p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['date_collecte','prenom','evenement_nom','heure_collecte','lieu_nom','lieu_adresse','chauffeurs_bloc','un_chauffeur','plusieurs_chauffeurs']::text[],
    updated_at = now()
WHERE code = 'infos_acces_collecte' AND actif;

-- Contrôle de fin : le gabarit actif porte le nouveau texte.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM plateforme.email_templates
   WHERE code = 'infos_acces_collecte' AND actif
     AND corps_html LIKE '%{{#if plusieurs_chauffeurs}}%'
     AND corps_html LIKE '%dans les plus brefs délais%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Email accès chauffeur : % gabarit mis à jour sur 1', n;
  END IF;
END $$;
