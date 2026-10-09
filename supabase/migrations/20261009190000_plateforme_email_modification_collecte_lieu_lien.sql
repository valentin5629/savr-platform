-- =============================================================================
-- Template email « admin_modification_collecte_traiteur » (CDC §06.02 n°19) —
-- lieu de la collecte et lien vers sa fiche.
-- =============================================================================
-- Arbitrages Val du 2026-10-09 (divergence
-- M3.1_20261009_email-modification-collecte) : l'email nomme le lieu et porte
-- un lien direct vers la fiche Admin, pour distinguer deux collectes d'une même
-- organisation le même jour ; il part aussi quand une agence ou un gestionnaire
-- de lieux modifie (le déclencheur est côté code, la description le dit).
--
-- Corps posé par 20261009160000, auquel s'ajoutent deux blocs conditionnels :
-- « (lieu : …) » en fin de première phrase, et le lien avant la signature.
--
-- `lieu_nom` et `lien_fiche` ne sont lus que dans un bloc conditionnel : ils ne
-- sont pas exigés à l'envoi (findMissingVariables, shared/email). Le code
-- déployé avant cette migration, qui ne les envoie pas, n'est donc pas refusé ;
-- le code de ce lot, joué sur l'ancien corps, envoie deux variables que le corps
-- ignore. Aucune fenêtre sans email, dans un ordre de mise en service comme
-- dans l'autre.
--
-- Backward-compatible : UPDATE d'une ligne de référentiel, aucune structure
-- modifiée, aucun droit touché. Idempotent : un rejeu réécrit le même corps.
-- Retour arrière : cf. le bloc en fin de fichier.
-- =============================================================================

UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour,</p>
<p>L'organisation {{organisation_nom}} a modifié la collecte initialement prévue le {{date_initiale}}{{#if pax_initial}} pour {{pax_initial}} pax{{/if}}{{#if lieu_nom}} (lieu : {{lieu_nom}}){{/if}}.</p>
<p>Les champs modifiés sont :</p>
{{liste_modifications}}
{{#if programmateur}}<p>Le programmateur est {{programmateur}}.</p>
{{/if}}<p>Le statut actuel de la collecte est « {{statut_collecte}} ».</p>
{{#if priorite_urgence}}<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte. Action manuelle Ops probable (relais prestataire, vérification logistique).</p>
{{/if}}<p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p>
{{#if lien_fiche}}<p><a href="{{lien_fiche}}">Ouvrir la fiche de la collecte</a></p>
{{/if}}<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','date_initiale','pax_initial','lieu_nom','liste_modifications','programmateur','statut_collecte','priorite_urgence','lien_fiche'],
    description = 'Notification à l''équipe Savr — modification d''une collecte à venir par un programmateur (traiteur, agence, gestionnaire de lieux) : lieu, champs modifiés (avant / après), programmateur, statut actuel, lien vers la fiche ; ligne ATTENTION si l''ancien ou le nouveau créneau est à moins de 12h (§05).',
    updated_at = now()
WHERE code = 'admin_modification_collecte_traiteur';

-- Contrôle de fin, comme la migration 20261009160000 : la table est en FORCE
-- ROW LEVEL SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour
-- 0 ligne sans erreur et la migration serait enregistrée. On compte la ligne
-- DANS L'ÉTAT ATTENDU : un rôle qui ne voit aucune ligne échoue lui aussi.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur'
     AND strpos(corps_html, '{{lien_fiche}}') > 0
     AND strpos(corps_html, '{{lieu_nom}}') > 0
     AND 'lien_fiche' = ANY (variables);
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne admin_modification_collecte_traiteur au corps avec lieu et lien, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;

-- =============================================================================
-- Retour arrière : le corps de 20261009160000. Il peut se jouer seul, le code de
-- ce lot fonctionne avec lui (les deux variables ajoutées sont alors ignorées).
--
--   UPDATE plateforme.email_templates
--   SET corps_html = '<p>Bonjour,</p>
--   <p>L''organisation {{organisation_nom}} a modifié la collecte initialement prévue le {{date_initiale}}{{#if pax_initial}} pour {{pax_initial}} pax{{/if}}.</p>
--   <p>Les champs modifiés sont :</p>
--   {{liste_modifications}}
--   {{#if programmateur}}<p>Le programmateur est {{programmateur}}.</p>
--   {{/if}}<p>Le statut actuel de la collecte est « {{statut_collecte}} ».</p>
--   {{#if priorite_urgence}}<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte. Action manuelle Ops probable (relais prestataire, vérification logistique).</p>
--   {{/if}}<p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p>
--   <p>L''équipe Savr</p>',
--       variables = ARRAY['organisation_nom','date_initiale','pax_initial','liste_modifications','programmateur','statut_collecte','priorite_urgence'],
--       description = 'Notification à l''équipe Savr — modification d''une collecte à venir par le traiteur : champs modifiés (avant / après), programmateur, statut actuel ; ligne ATTENTION à moins de 12h du créneau (§05).',
--       updated_at = now()
--   WHERE code = 'admin_modification_collecte_traiteur';
--   (les lignes du corps ci-dessus sont à recopier sans leur préfixe « --   »)
-- =============================================================================
