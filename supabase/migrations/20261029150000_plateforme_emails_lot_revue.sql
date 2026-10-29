-- =============================================================================
-- Gabarits d'email : lot de la revue des emails (décisions Val 2026-10-26 → 29)
-- =============================================================================
-- Val a relu et validé chaque email dans le cahier de revue (artifact « Cahier
-- des emails Savr »). Cette migration pose les textes validés et désactive les
-- gabarits que la revue a écartés. Le code qui fournit les nouvelles informations
-- (dates au format JJ/MM/AAAA, heure, lieu, événement, destinataires…) arrive
-- dans la même PR ; la mise en page commune (logo, bouton, pied de page) est
-- ajoutée à l'envoi par sendEmail, pas par ces gabarits.
--
-- `variables` = toutes les informations citées par le gabarit. sendEmail n'exige
-- que celles hors des blocs {{#if}} (les autres sont facultatives).
--
-- Désactivés (actif = false, non supprimés : migration non destructive) :
--   jamais envoyés par aucun code, ou écartés par Val : ag_a_toutes_indispo, ag_attribution_transporteur, alerte_ops_collecte_non_transmise, alerte_ops_pesee_anormale, attribution_association, attribution_transporteur, avoir_emis, collecte_realisee, confirmation_collecte, facture_emise, facture_relance_j15, pack_ag_active, rappel_collecte_j3, reset_password.
--   Un gabarit inactif n'est plus envoyé (sendEmail renvoie SKIP_INACTIF).
--
-- Portée : lignes de référentiel `plateforme.email_templates`. Aucune structure,
-- aucun droit. Idempotent. Retour arrière : réécrire les lignes depuis la
-- sauvegarde prod du 2026-10-28 (travail de session) ou les migrations
-- précédentes, et remettre actif = true.
-- =============================================================================

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Collecte annulée — {{organisation_nom}} — {{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Hello les boss,</p><p>{{user_nom}} ({{user_role}}) a annulé la collecte {{type_collecte}} de {{organisation_nom}} prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (« {{nom_evenement}} »){{/if}}.</p><ul><li>Délai avant le créneau : {{delai_avant_creneau}}</li>{{#if motif}}<li>Motif : {{motif}}</li>{{/if}}{{#if info_facturation}}<li>Facturation : {{info_facturation}}</li>{{/if}}</ul><p>L'annulation est transmise automatiquement au prestataire logistique ; si la tournée était déjà partie chez le transporteur, vérifiez qu'il est prévenu.</p>{{#if annulation_tardive}}<p><strong>Annulation tardive (moins de 4 h avant le créneau).</strong> En Zéro Déchet, la collecte reste due : facture à faire à la main. En Anti-Gaspi, un crédit du pack a été décompté automatiquement.</p>{{/if}}<p><a href="{{lien_backoffice}}">Voir la collecte dans le back-office</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','date_collecte','user_nom','user_role','type_collecte','heure_collecte','lieu_nom','nom_evenement','delai_avant_creneau','motif','info_facturation','annulation_tardive','lien_backoffice']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_collecte_annulee';

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Nouveau lieu à valider — {{lieu_nom}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>{{user_nom}}{{#if organisation_nom}} ({{organisation_nom}}){{/if}} a créé un nouveau lieu en programmant une collecte :</p><ul><li>Nom : {{lieu_nom}}</li><li>Adresse : {{lieu_adresse}}</li></ul><p>Ce lieu n'est pas encore validé. Vérifiez son nom et son adresse, complétez les informations d'accès (stationnement, véhicule maximal, accès à l'office) : le transporteur en a besoin. Puis validez la fiche.</p><p><a href="{{lien_lieu}}">Ouvrir la fiche du lieu</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['lieu_nom','user_nom','organisation_nom','lieu_adresse','lien_lieu']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_demande_ajout_lieu';

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Demande d'annulation à traiter — {{organisation_nom}} — {{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>{{demandeur_nom}} ({{organisation_nom}}) demande l'annulation de la collecte prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (« {{nom_evenement}} »){{/if}}.</p><p>Cette collecte est déjà validée : elle reste prévue tant que vous n'avez pas confirmé l'annulation.</p>{{#if motif}}<p>Motif indiqué : {{motif}}</p>{{/if}}<p>Confirmez ou refusez la demande depuis la fiche de la collecte. Pour savoir si l'annulation est tardive (moins de 4 h), c'est l'heure de cette demande qui compte, pas celle de votre confirmation.</p>{{#if lien_backoffice}}<p><a href="{{lien_backoffice}}">Traiter la demande</a></p>{{/if}}<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','date_collecte','demandeur_nom','heure_collecte','lieu_nom','nom_evenement','motif','lien_backoffice']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_demande_annulation';

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Demande de renouvellement de pack Anti-Gaspi — {{organisation_nom}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>{{demandeur_nom}} ({{organisation_nom}}) demande le renouvellement de son pack Anti-Gaspi.</p><ul>{{#if pack_souhaite}}<li>Pack souhaité : {{pack_souhaite}}</li>{{/if}}{{#if credits_restants}}<li>Crédits restants sur le pack actuel : {{credits_restants}}</li>{{/if}}<li>Contact : {{demandeur_email}}</li></ul>{{#if message}}<p>Message : {{message}}</p>{{/if}}<p>Recontactez le client pour confirmer l'offre, puis créez le nouveau pack depuis la fiche de l'organisation. Une organisation n'a qu'un seul pack actif à la fois.</p>{{#if lien_fiche_org}}<p><a href="{{lien_fiche_org}}">Ouvrir la fiche organisation</a></p>{{/if}}<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','demandeur_nom','pack_souhaite','credits_restants','demandeur_email','message','lien_fiche_org']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_demande_renouvellement_pack';

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Incident sur une collecte — {{lieu_nom}} — {{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>Un incident a été déclaré sur la collecte du {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}} au {{lieu_nom}}{{#if organisation_nom}} ({{organisation_nom}}){{/if}}. La collecte est annulée et le client a reçu une confirmation d'annulation.</p><ul><li>Type d'incident : {{type_incident}}</li><li>Imputable à : {{imputable_a}}</li><li>Description : {{description}}</li></ul><p>Suite à donner : décider d'un avoir, d'une nouvelle collecte ou d'une contestation auprès du responsable.</p><p><a href="{{lien_collecte}}">Voir la collecte</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['lieu_nom','date_collecte','heure_collecte','organisation_nom','type_incident','imputable_a','description','lien_collecte']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_incident_collecte';

UPDATE plateforme.email_templates
SET sujet = $tpl$Modification d'une collecte — {{organisation_nom}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>{{organisation_nom}} a modifié la collecte {{#if type_collecte}}{{type_collecte}} {{/if}}initialement prévue le {{date_initiale}}{{#if pax_initial}} pour {{pax_initial}} convives{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (événement « {{nom_evenement}} »){{/if}}.</p><p>Modifications :</p>{{liste_modifications}}{{#if programmateur}}<p>Programmateur : {{programmateur}}.</p>{{/if}}<p>Statut actuel de la collecte : « {{statut_collecte}} ».</p>{{#if priorite_urgence}}<p><strong>Urgent : la collecte a lieu dans moins de 12 h.</strong> Prévenez le transporteur sans attendre et vérifiez la logistique.</p>{{/if}}<p>Si la commande est déjà chez le prestataire logistique, la modification lui est transmise automatiquement. Si la tournée a déjà été envoyée au transporteur, vérifiez qu'il en a bien connaissance.</p>{{#if lien_fiche}}<p><a href="{{lien_fiche}}">Ouvrir la fiche de la collecte</a></p>{{/if}}<p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','type_collecte','date_initiale','pax_initial','lieu_nom','nom_evenement','liste_modifications','programmateur','statut_collecte','priorite_urgence','lien_fiche']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_modification_collecte_traiteur';

UPDATE plateforme.email_templates
SET sujet = $tpl$[Admin] Pack Anti-Gaspi {{etat_libelle}} — {{organisation_nom}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>Le pack Anti-Gaspi de {{organisation_nom}} est {{etat_libelle}}.</p><ul><li>Pack : {{type_pack}}</li><li>Crédits restants : {{credits_restants}} sur {{credits_initiaux}} ({{pct_restant}} %)</li>{{#if derniere_collecte_date}}<li>Dernière collecte : {{derniere_collecte_date}}</li>{{/if}}</ul>{{#if niveau_bas}}<p>C'est le bon moment pour proposer au client le renouvellement de son pack.</p>{{/if}}{{#if niveau_epuise}}<p>Le client peut continuer à programmer : tant qu'aucun nouveau pack n'est actif, ses collectes Anti-Gaspi seront facturées à l'unité. Pensez à le prévenir.</p>{{/if}}<p><a href="{{lien_fiche_org}}">Voir la fiche organisation</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['etat_libelle','organisation_nom','type_pack','credits_restants','credits_initiaux','pct_restant','derniere_collecte_date','niveau_bas','niveau_epuise','lien_fiche_org']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'admin_pack_ag_etat';

UPDATE plateforme.email_templates
SET sujet = $tpl$Don de repas prévu — {{evenement_nom}}, {{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Bonjour,</p><p>Nous avons le plaisir de vous confirmer un potentiel don de repas pour votre association. Nous nous attendons à ce que des repas ne soient pas servis lors d'un événement préparé par l'un de nos clients traiteurs.</p><ul><li>Collecte : le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}</li><li>Volume estimé : environ {{volume_estime_repas}} repas</li></ul><p>Le transporteur récupère les repas sur le lieu de l'événement puis vous les livre. Le volume est une estimation : il dépend de ce qui reste réellement en fin d'événement.</p><p>Merci de prévoir une personne pour réceptionner la livraison. Si vous ne pouvez pas recevoir ce don, prévenez-nous au plus vite à contact@gosavr.io : nous trouverons une autre association.</p><p>Merci pour votre engagement,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['evenement_nom','date_collecte','heure_collecte','volume_estime_repas']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'ag_attribution_association';

UPDATE plateforme.email_templates
SET sujet = $tpl$Collecte annulée — {{date_collecte}}{{#if nom_evenement}} — {{nom_evenement}}{{/if}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Nous vous confirmons l'annulation de la collecte prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}}, pour l'événement « {{nom_evenement}} »{{/if}}. Si un transporteur était déjà prévu, il est prévenu.</p>{{#if motif}}<p>Motif : {{motif}}</p>{{/if}}{{#if info_facturation}}<p>{{info_facturation}}</p>{{/if}}<p>S'il s'agit d'une erreur, contactez-nous au plus vite à contact@gosavr.io : nous ferons notre possible pour maintenir le passage.</p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['date_collecte','nom_evenement','prenom','heure_collecte','lieu_nom','motif','info_facturation']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'annulation_collecte';

UPDATE plateforme.email_templates
SET sujet = $tpl$Votre rapport de don est disponible — {{nom_evenement}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Les repas non servis de votre événement « {{nom_evenement}} » du {{date_evenement}} ont bien été donnés{{#if association_nom}} à l'association {{association_nom}}{{/if}}{{#if nb_repas}}, soit environ {{nb_repas}} repas{{/if}}. Merci pour ce geste !</p><p>Le rapport de don est prêt. Vous pouvez le consulter et le télécharger en PDF depuis votre espace.</p><p><a href="{{lien_rapport}}">Voir le rapport de don</a></p><p>Belle suite,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['nom_evenement','prenom','date_evenement','association_nom','nb_repas','lien_rapport']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'attestation_don_disponible';

UPDATE plateforme.email_templates
SET sujet = $tpl$Bienvenue sur Savr$tpl$,
    corps_html = $tpl$<p>Bonjour {{prenom}},<br><br>Bienvenue sur la plateforme Savr.<br>Nous vous laissons la découvrir. N'hésitez pas à nous contacter à l'adresse contact@gosavr.io si vous avez des questions.</p><p><a href="{{lien_programmation_collecte}}">Programmer ma première collecte</a></p><p>À bientôt sur des événements !</p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['prenom','lien_programmation_collecte']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'bienvenue_organisation';

UPDATE plateforme.email_templates
SET sujet = $tpl$Collecte {{type_changement_libelle}} — {{date_collecte}} — {{nom_evenement}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>La collecte que vous avez programmée pour l'événement « {{nom_evenement}} »{{#if traiteur_nom}} (traiteur : {{traiteur_nom}}){{/if}}, prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}, a été {{type_changement_libelle}}{{#if auteur_nom}} par {{auteur_nom}}{{/if}}.</p>{{#if est_modification}}<p>Modifications apportées :</p>{{liste_modifications}}{{/if}}{{#if est_annulation}}<p>Cette collecte n'aura donc pas lieu.</p>{{/if}}<p>Si ce changement ne vous semble pas correct, corrigez-le depuis la fiche de la collecte ou écrivez-nous à contact@gosavr.io.</p><p><a href="{{lien_collecte}}">Pour accéder à la collecte, cliquez ici</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['type_changement_libelle','date_collecte','nom_evenement','prenom','traiteur_nom','heure_collecte','lieu_nom','auteur_nom','est_modification','liste_modifications','est_annulation','lien_collecte']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'collecte_modifiee_tiers';

UPDATE plateforme.email_templates
SET sujet = $tpl$Programmation confirmée — {{nom_evenement}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Merci, votre programmation pour l'événement « {{nom_evenement}} »{{#if lieu_nom}} au {{lieu_nom}}{{/if}} est bien enregistrée. Nous réaliserons {{nombre_collectes}} :</p>{{liste_collectes}}{{#if lien_evenement}}<p>Votre événement nécessite plusieurs collectes ? <a href="{{lien_evenement}}">N'oubliez pas de les programmer dès maintenant.</a></p>{{/if}}{{#if tarif_ligne}}<p>{{tarif_ligne}}</p>{{/if}}{{#if collecte_sous_24h}}<p><strong>Une collecte a lieu dans moins de 24 heures : appelez-nous au 07 61 91 29 97 pour que nous confirmions qu'elle peut être assurée.</strong></p>{{/if}}<p>La suite : notre équipe organise le passage du transporteur et confirme la collecte. Si le lieu impose un contrôle d'accès, vous recevrez le nom et le téléphone du chauffeur avant le jour J. Après l'événement, vous retrouverez votre rapport dans votre espace.</p><p>Vous pouvez modifier ou annuler une collecte depuis votre espace jusqu'à 4h avant la collecte.</p>{{#if lien_collectes}}<p><a href="{{lien_collectes}}">Voir mes collectes</a></p>{{/if}}<p>Une question ? Écrivez-nous à contact@gosavr.io.</p><p>À bientôt,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['nom_evenement','prenom','lieu_nom','nombre_collectes','liste_collectes','lien_evenement','tarif_ligne','collecte_sous_24h','lien_collectes']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'collecte_programmee';

UPDATE plateforme.email_templates
SET sujet = $tpl$Une collecte a été programmée chez vous — {{date_collecte}} à {{lieu_nom}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>{{organisation_programmatrice}} a programmé une collecte vous concernant. Aucune action n'est requise de votre part — cet email est informatif.</p><ul><li>Date : {{date_collecte}}</li><li>Horaire de collecte : {{horaire_collecte}}</li><li>Lieu : {{lieu_nom}}, {{lieu_adresse}}</li><li>Type : {{type_collecte}}</li><li>Programmé par : {{programmeur_nom}} ({{organisation_programmatrice}})</li></ul><p><a href="{{lien_collecte}}">Voir la collecte</a></p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['date_collecte','lieu_nom','prenom','organisation_programmatrice','horaire_collecte','lieu_adresse','type_collecte','programmeur_nom','lien_collecte']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'collecte_programmee_tiers';

UPDATE plateforme.email_templates
SET sujet = $tpl$Accès chauffeur pour votre collecte du {{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Voici le nom et le téléphone du ou des chauffeurs qui interviendront sur votre événement{{#if evenement_nom}} « {{evenement_nom}} »{{/if}}, le <strong>{{date_collecte}}</strong> à <strong>{{heure_collecte}}</strong>{{#if lieu_nom}}, {{lieu_nom}}{{/if}}{{#if lieu_adresse}} ({{lieu_adresse}}){{/if}}.</p>{{chauffeurs_bloc}}<p>Merci de les transmettre au service d'accueil ou de sécurité du site, pour que le chauffeur puisse entrer sans attendre.</p><p>Si ces informations changent, nous vous enverrons un nouvel email.</p><p>L'équipe Savr</p>$tpl$,
    variables = ARRAY['date_collecte','prenom','evenement_nom','heure_collecte','lieu_nom','lieu_adresse','chauffeurs_bloc']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'infos_acces_collecte';

UPDATE plateforme.email_templates
SET sujet = $tpl$Invitation à rejoindre {{organisation_nom}} sur Savr$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Vous êtes invité(e) à rejoindre l'espace de {{organisation_nom}} sur Savr.</p><p>Savr est la plateforme qu'utilise votre organisation pour programmer et suivre la collecte des surplus de ses événements : don des repas non servis à des associations  ainsi que la collecte et le recyclage des déchets.</p><p>Pour accéder à votre espace, choisissez votre mot de passe :</p><p><a href="{{lien_invitation}}">Choisir mon mot de passe</a></p><p>Ce lien vous est personnel et reste valable 7 jours. Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email.</p><p>Bienvenue,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['organisation_nom','prenom','lien_invitation']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'invitation_utilisateur';

UPDATE plateforme.email_templates
SET sujet = $tpl$Rapport de recyclage disponible — {{#if nom_evenement}}{{nom_evenement}}, {{/if}}{{date_collecte}}$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>La collecte Zéro Déchet de votre événement{{#if nom_evenement}} « {{nom_evenement}} »{{/if}} du {{date_collecte}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}} est terminée et ses pesées sont validées. Son rapport de recyclage est prêt.</p><p>En résumé :</p><ul><li>{{poids_total}} kg de déchets détournés</li><li>{{co2_evite}} kg CO₂e évités</li><li>Taux de recyclage : {{taux_recyclage}} %</li></ul><p>Téléchargez le rapport en PDF depuis la fiche de la collecte. Vous pouvez y ajouter une comparaison avec les autres événements Savr : pratique pour le partager avec votre client ou l'intégrer à votre bilan RSE. Le bordereau, justificatif des pesées, est disponible au même endroit.</p><p><a href="{{lien_rapport}}">Télécharger le rapport</a></p><p>Merci d'avoir trié avec nous,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['nom_evenement','date_collecte','prenom','lieu_nom','poids_total','co2_evite','taux_recyclage','lien_rapport']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'rapport_disponible';

UPDATE plateforme.email_templates
SET sujet = $tpl$Votre numéro SIRET n'a pas pu être vérifié$tpl$,
    corps_html = $tpl$<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p><p>Nous avons vérifié auprès de l'INSEE le numéro SIRET {{siret}} renseigné pour {{organisation_nom}}. Il y apparaît comme inexistant ou inactif.</p><p>Pouvez-vous le vérifier et le corriger si besoin dans votre espace, rubrique « Mon organisation » ? Il figure sur vos rapports de don et vos factures : il doit être exact. Vos collectes ne sont pas bloquées en attendant.</p>{{#if lien_organisation}}<p><a href="{{lien_organisation}}">Vérifier mon SIRET</a></p>{{/if}}<p>Si le numéro est correct, répondez-nous à contact@gosavr.io : nous vérifierons de notre côté.</p><p>Merci,<br>L'équipe Savr</p>$tpl$,
    variables = ARRAY['prenom','siret','organisation_nom','lien_organisation']::text[],
    actif = true,
    updated_at = now()
WHERE code = 'siret_verification_echec';

UPDATE plateforme.email_templates
SET actif = false, updated_at = now()
WHERE code IN ('ag_a_toutes_indispo', 'ag_attribution_transporteur', 'alerte_ops_collecte_non_transmise', 'alerte_ops_pesee_anormale', 'attribution_association', 'attribution_transporteur', 'avoir_emis', 'collecte_realisee', 'confirmation_collecte', 'facture_emise', 'facture_relance_j15', 'pack_ag_active', 'rappel_collecte_j3', 'reset_password')
  AND actif;


-- Contrôle de fin : textes posés, désactivations faites (un UPDATE à 0 ligne
-- passerait sans erreur).
DO $$
DECLARE
  v_textes integer;
  v_inactifs integer;
BEGIN
  SELECT count(*) INTO v_textes FROM plateforme.email_templates
  WHERE code IN ('admin_collecte_annulee', 'admin_demande_ajout_lieu', 'admin_demande_annulation', 'admin_demande_renouvellement_pack', 'admin_incident_collecte', 'admin_modification_collecte_traiteur', 'admin_pack_ag_etat', 'ag_attribution_association', 'annulation_collecte', 'attestation_don_disponible', 'bienvenue_organisation', 'collecte_modifiee_tiers', 'collecte_programmee', 'collecte_programmee_tiers', 'infos_acces_collecte', 'invitation_utilisateur', 'rapport_disponible', 'siret_verification_echec') AND actif;
  SELECT count(*) INTO v_inactifs FROM plateforme.email_templates
  WHERE code IN ('ag_a_toutes_indispo', 'ag_attribution_transporteur', 'alerte_ops_collecte_non_transmise', 'alerte_ops_pesee_anormale', 'attribution_association', 'attribution_transporteur', 'avoir_emis', 'collecte_realisee', 'confirmation_collecte', 'facture_emise', 'facture_relance_j15', 'pack_ag_active', 'rappel_collecte_j3', 'reset_password') AND NOT actif;
  IF v_textes <> 18 OR v_inactifs <> 14 THEN
    RAISE EXCEPTION 'email_templates : % textes actifs sur 18, % désactivés sur 14', v_textes, v_inactifs;
  END IF;
END $$;
