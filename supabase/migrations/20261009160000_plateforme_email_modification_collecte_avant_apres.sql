-- =============================================================================
-- Template email « admin_modification_collecte_traiteur » (CDC §06.02 n°19) —
-- champs modifiés avec leurs valeurs avant / après.
-- =============================================================================
-- Constat E2E de Val, 2026-10-09 : un traiteur change la date, le nombre de pax
-- et le contact d'une collecte ; l'email reçu par l'équipe Savr ne cite que
-- « date_collecte », et affiche l'identifiant de l'utilisateur et celui de la
-- collecte à la place d'un nom et d'une date lisible.
--
-- Nouveau texte, dicté par Val le 2026-10-09 : l'organisation, la date et le pax
-- d'origine, la liste des champs modifiés (ancienne puis nouvelle valeur), le
-- programmateur et son numéro, le statut actuel de la collecte. Arbitrages du
-- même jour : la ligne « Priorité de traitement » disparaît ; seule reste une
-- ligne « ATTENTION » à moins de 12 h du créneau (§05 « Modification d'une
-- collecte à venir », texte du CDC §06.02 n°19).
--
-- État mesuré avant écriture (2026-10-09, dev) : corps posé par 20260705100000,
-- variables = organisation_nom, demandeur_nom, collecte_ref, date_collecte,
-- champs_modifies, priorite.
--
-- `liste_modifications` est un bloc HTML construit par l'appelant (le moteur
-- d'interpolation ne sait pas boucler), valeurs échappées. `pax_initial`,
-- `programmateur` et `priorite_urgence` ne sont lus que dans un bloc
-- conditionnel : ils ne sont pas exigés à l'envoi (findMissingVariables,
-- shared/email) — une collecte sans pax, ou dont le programmateur n'a plus de
-- compte, reçoit quand même son email.
--
-- L'objet est inchangé. Backward-compatible : UPDATE d'une ligne de référentiel,
-- aucune structure modifiée, aucun droit touché. Idempotent : un rejeu réécrit
-- le même corps. Entre cette migration et le déploiement du code qui envoie les
-- nouvelles variables, l'email de modification n'est pas envoyé (variable
-- exigée absente = envoi refusé) ; la modification elle-même n'en dépend pas.
--
-- Retour arrière : rejouer le corps et la liste de variables de 20260705100000.
-- =============================================================================

UPDATE plateforme.email_templates
SET corps_html = $tpl$<p>Bonjour,</p>
<p>L'organisation {{organisation_nom}} a modifié la collecte initialement prévue le {{date_initiale}}{{#if pax_initial}} pour {{pax_initial}} pax{{/if}}.</p>
<p>Les champs modifiés sont :</p>
{{liste_modifications}}
{{#if programmateur}}<p>Le programmateur est {{programmateur}}.</p>
{{/if}}<p>Le statut actuel de la collecte est « {{statut_collecte}} ».</p>
{{#if priorite_urgence}}<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte. Action manuelle Ops probable (relais prestataire, vérification logistique).</p>
{{/if}}<p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p>
<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','date_initiale','pax_initial','liste_modifications','programmateur','statut_collecte','priorite_urgence'],
    description = 'Notification à l''équipe Savr — modification d''une collecte à venir par le traiteur : champs modifiés (avant / après), programmateur, statut actuel ; ligne ATTENTION à moins de 12h du créneau (§05).',
    updated_at = now()
WHERE code = 'admin_modification_collecte_traiteur';

-- Contrôle de fin, comme la migration 20261008150000 : la table est en FORCE
-- ROW LEVEL SECURITY, un rôle de migration sans BYPASSRLS mettrait à jour
-- 0 ligne sans erreur et la migration serait enregistrée. On compte la ligne
-- DANS L'ÉTAT ATTENDU (et non celle qui n'y est pas) : un rôle qui ne voit
-- aucune ligne échoue lui aussi.
DO $$
DECLARE
  v_a_jour integer;
BEGIN
  SELECT count(*) INTO v_a_jour
    FROM plateforme.email_templates
   WHERE code = 'admin_modification_collecte_traiteur'
     AND strpos(corps_html, '{{liste_modifications}}') > 0
     AND 'liste_modifications' = ANY (variables);
  IF v_a_jour <> 1 THEN
    RAISE EXCEPTION
      'email_templates : % ligne admin_modification_collecte_traiteur au nouveau corps, 1 attendue — le rôle de migration écrit-il sous RLS ?',
      v_a_jour;
  END IF;
END $$;
