# 06.02 - Templates emails V1

**Statut** : Draft V1 (proposition Claude, à valider Val)
**Dernière mise à jour** : 2026-06-07 (**Session test-scenarios §06.02 — 4 specs floues tranchées Val** : **F1** `email_templates` + `emails_envoyes` intégrées §04 + policies §09 (write SERVICE_ROLE seul, SELECT admin_savr) · **F2** 3 templates ajoutés (20 `collecte_programmee_tiers`, 21 `collecte_modifiee_tiers` — couvre aussi l'annulation par tiers via `type_changement`, 22 `admin_collecte_annulee`) pour solder l'écart matrice §05 §9 ↔ templates ; total 16 → **19 actifs** · **F3** cycle échecs spécifié §08 §4 (statut `echec`, 3 retries 1min/10min/1h, signature svix, event inconnu = 200 + log, variable manquante = refus + log) · **F4** alerte pack bas déclenchée **au franchissement seul** (transition > 10 % → ≤ 10 %, recrédit ré-arme). Scénarios : `tests/06.02-templates-emails-scenarios.md`.)
*(historique 2026-06-03 ci-dessous)* (**Revue de sobriété §06.02 (skill `cdc-review-sobriete`) — 6 items appliqués zéro dette** : **A1** UI Admin d'édition des templates + colonne `version` reportées V1.1 (templates en seed DB V1, éditables via SQL/migration sans redéploiement) · **A2** template 2 `completion_profil_requise` retiré V1 (gate déjà in-app, modal §05 §888) · **A3** template 8 `admin_orga_a_valider` retiré V1 (alerte purement informative, onboarding 100% auto sans gating → liste back-office) · **B1** templates 9 `admin_pack_ag_bas` + 14bis `admin_pack_epuise` fusionnés en `admin_pack_ag_etat` (variable `niveau` `bas`/`epuise`) · **C1** compteur corrigé (13 → **16 templates actifs**, dérive jamais recomptée depuis 2026-05-04) · **D1** colonne `email_templates.destinataire_type` supprimée (enum descriptif, adresse résolue au déclenchement, aucun comportement applicatif distinct). **C2 écarté** (faux positif : template 13 `admin_demande_ajout_lieu` cohérent avec le workflow « Normaliser un lieu » toujours actif §06.06). **3 fichiers App édités** : §06.02 + §05 (matrice notifications) + §03 + §00 Index. Cross-CDC : 0 divergence (templates internes Plateforme).)

---

## Principe

Templates stockés en base (table `email_templates`) pour édition sans redéploiement. Variables interpolées via `{{variable}}`. Chaque template a un slug unique (ex: `collecte_programmee`).

**Charte éditoriale** :
- Vouvoiement systématique (adapté cible traiteurs/agences/grands comptes)
- Ton direct et chaleureux, sans formule creuse
- Signature : "L'équipe Savr"
- Pas d'emojis
- Max 180 mots corps du message (hors récap data)
- Call-to-action unique par email (bouton "Voir sur mon espace Savr")

---

## 1. Email de bienvenue (après vérification email)

**Slug** : `bienvenue`
**Destinataire** : user venant de vérifier son email
**Objet** : Bienvenue chez Savr, {{prenom}}

```
Bonjour {{prenom}},

Votre compte Savr est activé. Vous pouvez dès à présent vous connecter à votre espace.

Avant de programmer votre première collecte, il vous faudra compléter les informations de votre organisation : SIRET, TVA et adresse de facturation. Comptez 3 minutes.

Si vous avez la moindre question, répondez directement à cet email, nous vous accompagnerons avec plaisir.

[Bouton : Accéder à mon espace]

À très vite,
L'équipe Savr
```

**Variables** : `prenom`, `lien_espace`

---

## 2. Email rappel completion profil entreprise **Retiré V1 (revue de sobriété 2026-06-03, A2)**

**Slug** : `completion_profil_requise`
**Statut** : retiré V1
**Motif** : le blocage de la programmation sans organisation complétée est déjà géré **in-app** (modal « Complétez votre profil entreprise » qui liste les champs manquants et redirige vers le formulaire de complétion — cf. [[../05 - Règles métier]] §9 UX). L'email doublait une information déjà affichée à l'instant T → confort. Décision Val 2026-06-03 : in-app uniquement, pas d'email V1.

---

## 3. Email récapitulatif programmation collecte

**Slug** : `collecte_programmee`
**Destinataire** : programmeur de la collecte (`collectes.created_by`)
**Objet** : Votre collecte est programmée — {{date_collecte}} à {{lieu_nom}}

```
Bonjour {{prenom}},

Votre collecte est bien programmée. Voici le récapitulatif :

— Date : {{date_collecte}}
— Horaire de collecte : {{horaire_collecte}}
— Lieu : {{lieu_nom}}, {{lieu_adresse}}
— Contact principal : {{contact_nom}} — {{contact_telephone}}
— Pax : {{pax}}
— Type : {{type_collecte}} ({{flux_list}})
— Tarif estimé : {{montant_ht}} € HT{{pack_info}}

Nous transmettons immédiatement l'ordre à notre équipe logistique. Vous recevrez un email dès que le rapport post-collecte sera disponible (au plus tard 24h après l'événement).

[Bouton : Voir la collecte]

Excellente journée,
L'équipe Savr
```

**Variables** : `prenom`, `date_collecte`, `horaire_collecte`, `lieu_nom`, `lieu_adresse`, `contact_nom`, `contact_telephone`, `pax`, `type_collecte`, `flux_list`, `montant_ht`, `pack_info`, `lien_collecte`

---

## 4. Email modification collecte

**Slug** : `collecte_modifiee`
**Destinataire** : programmeur de la collecte
**Objet** : Votre collecte a été modifiée — {{date_collecte}} à {{lieu_nom}}

```
Bonjour {{prenom}},

Votre collecte du {{date_collecte}} au {{lieu_nom}} vient d'être modifiée.

Modifications apportées :
{{diff_list}}

Assurez-vous que toutes les informations sont à jour. En cas d'erreur, modifiez à nouveau ou contactez-nous directement en répondant à cet email.

[Bouton : Voir la collecte]

L'équipe Savr
```

**Variables** : `prenom`, `date_collecte`, `lieu_nom`, `diff_list`, `lien_collecte`

---

## 5. Email annulation collecte (confirmation)

**Slug** : `collecte_annulee`
**Destinataire** : programmeur de la collecte
**Objet** : Votre collecte est annulée — {{date_collecte}} à {{lieu_nom}}

```
Bonjour {{prenom}},

Votre collecte du {{date_collecte}} au {{lieu_nom}} est annulée.

{{info_facturation}}

Si cette annulation est une erreur, contactez-nous au plus vite en répondant à cet email.

L'équipe Savr
```

**Variables** : `prenom`, `date_collecte`, `lieu_nom`, `info_facturation` (adaptatif : "Aucune facturation ne sera émise." OU — ZD : "L'annulation intervenant à moins de 12h du créneau, le plein tarif sera facturé conformément aux CGV." OU — AG sous pack : "L'annulation intervenant à moins de 12h du créneau, un crédit de votre pack Anti-Gaspi est décompté conformément aux CGV." *(variante AG ajoutée 2026-06-07 — F2 test scenarios §06.01)*)

---

## 6. Email rapport post-collecte disponible

**Slug** : `rapport_disponible`
**Destinataire** : programmeur de la collecte
**Objet** : Votre rapport RSE est disponible — {{date_collecte}} à {{lieu_nom}}

```
Bonjour {{prenom}},

Le rapport de votre collecte du {{date_collecte}} est prêt.

Résumé impact :
— {{poids_total}} kg détournés
— {{co2_evite}} kg CO₂e évités
— Taux de recyclage : {{taux_recyclage}} %

Vous pouvez consulter le rapport complet et le télécharger en PDF directement depuis votre espace.

[Bouton : Voir le rapport]

Belle suite,
L'équipe Savr
```

**Variables** : `prenom`, `date_collecte`, `lieu_nom`, `poids_total`, `co2_evite`, `taux_recyclage` *(renommé 2026-05-06 — ex `taux_valorisation`. Lecture directe `collectes.taux_recyclage` formule à captation par filière)*, `lien_rapport`

---

## 7. Email plaque d'immatriculation chauffeur **Retiré V1 (propagation Q10 M05 2026-04-24)**

**Retiré V1 (propagation Q10 M05 2026-04-24)** — suppression totale de la notification client "plaque chauffeur T+3h". La plaque reste saisie côté TMS (bloquante checklist pré-départ M05 pour véhicules motorisés, non bloquante pour vélos cargo A Toutes!) pour traçabilité interne, registre transport, audit M08 rapprochement factures. Webhook S7 `tms/plaque-saisie` conservé côté contrat API pour log Plateforme + monitoring Admin, sans trigger Resend. Si le besoin client réapparaît, à reconsidérer V1.1 avec un template dédié et un opt-in par organisation (pas par collecte). Contenu historique préservé ci-dessous pour traçabilité.




























---

## 8. Email alerte Admin — Nouvelle organisation à valider **Retiré V1 (revue de sobriété 2026-06-03, A3)**

**Slug** : `admin_orga_a_valider`
**Statut** : retiré V1
**Motif** : alerte purement informative (l'email lui-même précisait « l'organisation est déjà active, cette alerte sert à vérifier a posteriori »). L'onboarding est 100% automatisé sans validation amont (§05 §851) → aucun gating, aucune action requise à l'instant T. Le push email génère du bruit à volume. La vérification de cohérence a posteriori se fait via le **filtre « nouvelles organisations » du back-office** (orgs déjà listées, revue à la cadence Admin). Décision Val 2026-06-03.

---

## 9. Email alerte Admin — État pack AG (bas / épuisé) *(fusion 2026-06-03, B1)*

**Slug** : `admin_pack_ag_etat`
**Destinataire** : tous les `admin_savr`
**Déclencheurs** (un seul template, variable `niveau`) :
- `niveau = bas` : **franchissement** du seuil 10 % — transition `> 10 %` → `≤ 10 %` des crédits initiaux restants. Pas de répétition à chaque décrément sous le seuil ; un recrédit qui repasse au-dessus de 10 % ré-arme le déclencheur *(F4 tranchée Val 2026-06-07)*
- `niveau = epuise` : `packs_antgaspi.statut` passe à `epuise` (`credits_consommes = credits_initiaux`)

> **Sobriété B1 2026-06-03** : fusion des ex-templates 9 (`admin_pack_ag_bas`) et 14bis (`admin_pack_epuise`) — même destinataire, même objet métier (consommation de pack), CTA identique. Le bloc « programmation bloquée » est conditionnel sur `niveau = epuise`.

**Objet** : `[Admin] Pack AG {{etat_libelle}} — {{organisation_nom}}` *(`etat_libelle` = « bientôt épuisé » si `bas`, « épuisé » si `epuise`)*

```
Le pack Anti-Gaspi de {{organisation_nom}} est {{etat_libelle}}.

— Type de pack : {{type_pack}}
— Crédits restants : {{credits_restants}} / {{credits_initiaux}} ({{pct_restant}} %)
— Dernière collecte : {{derniere_collecte_date}}

{{#if niveau_bas}}
Il est temps de lancer la négociation du pack suivant.
{{/if}}
{{#if niveau_epuise}}
La programmation de nouvelles collectes Anti-Gaspi est désormais bloquée pour cette organisation jusqu'à l'acquisition d'un nouveau pack.
{{/if}}

[Bouton : Voir la fiche organisation]
```

**Variables** : `niveau` (`bas`/`epuise`), `etat_libelle`, `organisation_nom`, `type_pack`, `credits_restants`, `credits_initiaux`, `pct_restant`, `derniere_collecte_date`, `niveau_bas` (bool), `niveau_epuise` (bool), `lien_fiche_org`

---

## 10. Email alerte Admin — Incident collecte

**Slug** : `admin_incident_collecte`
**Destinataire** : tous les `admin_savr`
**Objet** : [Admin] Incident collecte — {{type_incident}} — {{date_collecte}}

```
Un incident a été signalé sur une collecte.

— Collecte : {{lieu_nom}} — {{date_collecte}}
— Type d'incident : {{type_incident}}
— Imputable à : {{imputable_a}}
— Description : {{description}}

Action requise : évaluation et suite à donner (avoir, réattribution, contestation).

[Bouton : Voir la collecte]
```

**Variables** : `lieu_nom`, `date_collecte`, `type_incident`, `imputable_a`, `description`, `lien_collecte`

---

## 11. Email récupération mot de passe

**Slug** : `reset_password`
**Destinataire** : user demandeur
**Objet** : Réinitialisez votre mot de passe Savr

```
Bonjour {{prenom}},

Vous avez demandé la réinitialisation de votre mot de passe Savr.

Ce lien est valide pendant 1 heure.

[Bouton : Réinitialiser mon mot de passe]

Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — rien n'aura changé sur votre compte.

L'équipe Savr
```

**Variables** : `prenom`, `lien_reset`

---

## 12. Email vérification email à l'inscription

**Slug** : `verification_email`
**Destinataire** : nouveau user
**Objet** : Activez votre compte Savr

```
Bonjour {{prenom}},

Merci pour votre inscription sur Savr. Cliquez sur le lien ci-dessous pour activer votre compte. Le lien est valide pendant 24 heures.

[Bouton : Activer mon compte]

À très vite,
L'équipe Savr
```

**Variables** : `prenom`, `lien_activation`

---

## 13. Email alerte Admin — Nouvelle demande lieu

**Slug** : `admin_demande_ajout_lieu`
**Destinataire** : tous les `admin_savr`
**Objet** : [Admin] Nouveau lieu à normaliser — {{lieu_nom}}

```
Un utilisateur a saisi un nouveau lieu manuellement lors d'une programmation de collecte.

— Nom du lieu : {{lieu_nom}}
— Adresse : {{lieu_adresse}}
— Saisi par : {{user_nom}} ({{organisation_nom}})
— Collecte associée : {{date_collecte}}

Action requise : vérifier, compléter et valider la fiche lieu (passage de `actif = false` à `actif = true`).

[Bouton : Normaliser le lieu]
```

**Variables** : `lieu_nom`, `lieu_adresse`, `user_nom`, `organisation_nom`, `date_collecte`, `lien_lieu`

---

## 14. Email Admin — Demande de renouvellement pack AG

**Slug** : `admin_demande_renouvellement_pack`
**Destinataire** : tous les `admin_savr`
**Déclencheur** : traiteur clique "Demander un renouvellement" depuis son espace client
**Objet** : [Admin] Demande de renouvellement pack AG — {{organisation_nom}}

```
Un traiteur a soumis une demande de renouvellement de pack Anti-Gaspi.

— Organisation : {{organisation_nom}}
— Pack souhaité : {{pack_souhaite}}
— Crédits restants actuels : {{credits_restants}}
— Message : {{message_traiteur}}

[Bouton : Créer le pack]
```

**Variables** : `organisation_nom`, `pack_souhaite`, `credits_restants`, `message_traiteur` (peut être vide)

---

## 14bis. Email Admin — Pack AG épuisé **Fusionné dans le template 9 (revue de sobriété 2026-06-03, B1)**

**Slug** : → remplacé par `admin_pack_ag_etat` avec `niveau = epuise` (voir template 9).
**Motif** : doublon fonctionnel avec l'alerte pack bas (même destinataire, même objet métier, même CTA). Le cas « épuisé » devient une variante `niveau` du template unifié, avec son bloc « programmation bloquée » conditionnel.

---

## 15. Email relance facture en retard **Retiré V1 (revue de sobriété 2026-05-08)**

**Slug** : `facture_relance`
**Statut** : retiré V1
**Motif** : les relances de factures en retard sont gérées **directement dans Pennylane** (décision 2026-04-28). Aucun flux relance V1 côté plateforme Savr — donc pas de template email Savr associé. Voir [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]] §8.

---

## 16. Email attribution AG — Association bénéficiaire

**Slug** : `ag_attribution_association`
**Destinataire** : adresse(s) de contact de l'association (`associations.email_contact`)
**Déclencheur** : validation de l'attribution par Admin Savr (ou auto-accept)
**Objet** : Collecte Anti-Gaspi confirmée — {{nom_evenement}} · {{date_collecte}}

```
Bonjour,

Nous avons le plaisir de vous confirmer une collecte Anti-Gaspi assignée à votre association.

— Événement : {{nom_evenement}}
— Date et heure : {{date_collecte}} à {{heure_collecte}}
— Lieu : {{lieu_nom}}, {{lieu_adresse_complete}}
— Volume estimé : {{volume_estime_repas}} repas

{{#si_transporteur}}
Un transporteur sera présent pour assurer le transfert des denrées :
— {{transporteur_nom}} · Contact : {{transporteur_contact}}
{{/si_transporteur}}

Pour toute question, contactez notre équipe à hello@gosavr.io

L'équipe Savr
```

**Variables** : `nom_evenement`, `date_collecte`, `heure_collecte`, `lieu_nom`, `lieu_adresse_complete`, `volume_estime_repas`, `transporteur_nom` (conditionnel), `transporteur_contact` (conditionnel)

---

## 17. Email invitation collaborateur

**Slug** : `invitation_utilisateur` *(corrigé M3.1 2026-06-17 — le slug seedé est `invitation_utilisateur`, pas `invitation_collaborateur`)*
**Destinataire** : collaborateur invité par un manager
**Déclencheur** : action "Inviter un collaborateur" depuis l'espace "Mon organisation"
**Objet** : {{inviteur_prenom}} vous invite à rejoindre {{organisation_nom}} sur Savr

```
Bonjour {{prenom}},

{{inviteur_prenom}} {{inviteur_nom}} vous invite à rejoindre l'équipe {{organisation_nom}} sur Savr.

Savr est la plateforme utilisée par votre organisation pour programmer et suivre les collectes Zéro-Déchet et Anti-Gaspi.

[Bouton : Créer mon compte]

Ce lien est valide pendant 7 jours. Pour toute question, contactez-nous à hello@gosavr.io

L'équipe Savr
```

**Variables** : `prenom`, `inviteur_prenom`, `inviteur_nom`, `organisation_nom`, `lien_activation`

---

## 18. Email attribution AG — Transporteur

**Slug** : `ag_attribution_transporteur`
**Destinataire** : adresse de contact du transporteur (`transporteurs.email_contact`)
**Déclencheur** : validation de l'attribution par Admin Savr (ou auto-accept), uniquement si transporteur != A Toutes!
**Objet** : Mission de transport Anti-Gaspi — {{date_collecte}}

```
Bonjour,

Vous êtes mandaté pour assurer le transport d'une collecte Anti-Gaspi.

— Date et heure de prise en charge : {{date_collecte}} à {{heure_collecte}}
— Lieu de collecte : {{lieu_adresse_complete}}
— Adresse de livraison (association) : {{association_adresse}}
— Association bénéficiaire : {{association_nom}}
— Volume estimé : {{volume_estime_repas}} repas

Pour toute question ou en cas d'empêchement, contactez notre équipe à hello@gosavr.io dans les meilleurs délais.

L'équipe Savr
```

**Variables** : `date_collecte`, `heure_collecte`, `lieu_adresse_complete`, `association_nom`, `association_adresse`, `volume_estime_repas`

---

## 18bis. Email Admin Savr — Recalcul branche AG IDF post-modif `nb_pax` *(supprimé audit sobriété 2026-05-09 A2)*

> **Refonte audit sobriété 2026-05-09 A2** : ce template (`ag_recalcul_branche`) est supprimé. Le cas particulier "modification `nb_pax` post-attribution franchissant 600" était un edge case rare en pratique. Le workflow standard suffit : si l'Admin souhaite changer de transporteur après modif `nb_pax`, il rouvre l'écran d'attribution et applique un override (motif libre `autre`). Cf. [[09 - Flux algo attribution AG (Admin)#2.3. Règles d'attribution transporteur AG — Île-de-France|§09 §2.3]].

---

## 18ter. Email Ops Savr — A Toutes! marqué indisponible *(ajout 2026-05-09)*

**Slug** : `ag_a_toutes_indispo`
**Destinataire** : Ops Savr (`ops@gosavr.io` ou alias configurable)
**Déclencheur** : bascule du flag `parametres_algo.a_toutes_indisponible` de `false` à `true` par un Admin Savr (cf. [[09 - Flux algo attribution AG (Admin)#7.2. Règles d'attribution transporteur IDF — branches §2.3|§09 §7.2]]). Toutes les nouvelles attributions IDF jour basculent vers Marathon (branche `ag_velo_fallback_marathon`). Email envoyé une fois à la bascule (pas de répétition).
**Objet** : `[AG IDF] A Toutes! marqué indisponible — bascule Marathon active`

```
Bonjour,

L'Admin Savr {{admin_nom}} a marqué A Toutes! comme indisponible à {{horodatage}}.

Motif : {{motif}}

Effet immédiat sur les nouvelles attributions AG en Île-de-France :
— Branche AG vélo jour (< {{seuil_pax_velo}} pax, plage {{plage_velo_debut}}-{{plage_velo_fin}}) : bascule sur Marathon
— Branches Marathon (nuit / grand événement) : inchangées

Les attributions déjà validées ne sont pas recalculées.

Pensez à rebasculer le flag à `false` une fois A Toutes! redevenu opérationnel (Back-office → Paramètres → Algorithme AG).

L'équipe Savr
```

**Variables** : `admin_nom`, `horodatage`, `motif`, `seuil_pax_velo`, `plage_velo_debut`, `plage_velo_fin`

---

## 19. Email Admin — Modification collecte par traiteur (refonte 2026-05-04)

**Slug** : `admin_modification_collecte_traiteur`
**Destinataire** : Admin Savr (alias Ops `ops@gosavr.io` ou liste configurable en base)
**Déclencheur** : tout `UPDATE` sur les champs métier d'une collecte initié par un user `traiteur_manager` ou `traiteur_commercial` (programmeur ou manager — les collègues partagés ne peuvent pas modifier). Statuts autorisés : voir [[../05 - Règles métier#Modification d'une collecte à venir]] (source unique).
**Objet** : `[Modification collecte] {{collecte_ref}} — {{evenement_nom}} le {{date_collecte}}`

> **Sobriété A3 2026-05-04** : un seul objet, une seule variante. L'urgence (modification < 12h) est portée par le **contenu** de l'email (bloc "ATTENTION" conditionnel) et non par un préfixe d'objet ou un en-tête `X-Priority`. Filtrage Ops via règle Gmail standard si besoin. Évite la logique de variantes côté envoyeur Resend.

```
Bonjour,

Le traiteur {{organisation_nom}} ({{user_prenom}} {{user_nom}}, {{user_role}}) a modifié la collecte ci-dessous.

— Collecte : {{collecte_ref}} (type {{type_collecte}})
— Événement : {{evenement_nom}}
— Date / heure : {{date_collecte}} à {{heure_collecte}}
— Lieu : {{lieu_nom}} ({{lieu_ville}})
— Statut actuel : {{statut_collecte}}
— Prestataire éventuel : {{prestataire_nom_ou_aucun}}

Champs modifiés :
{{liste_modifications}}

{{#if cascade_tms}}
Cette modification a été propagée au TMS via webhook collecte-update.
{{#if reacceptation_requise}}
Le prestataire {{prestataire_nom}} doit re-confirmer le créneau (date/heure modifiées sur collecte précédemment acceptée). La collecte est repassée au statut "attribuee" côté TMS.
{{/if}}
{{/if}}

{{#if priorite_urgence}}
ATTENTION : modification effectuée moins de 12h avant le créneau de collecte. Action manuelle Ops probable (relais prestataire, vérification logistique).
{{/if}}

[Bouton : Voir la collecte sur le back-office]

L'équipe Savr — alerte automatique
```

**Variables** : `collecte_ref`, `evenement_nom`, `date_collecte`, `heure_collecte`, `lieu_nom`, `lieu_ville`, `type_collecte` (ZD/AG), `statut_collecte`, `organisation_nom`, `user_prenom`, `user_nom`, `user_role`, `prestataire_nom_ou_aucun`, `liste_modifications` (texte formatté du diff `champ : ancien → nouveau`), `cascade_tms` (bool), `reacceptation_requise` (bool), `priorite_urgence` (bool), `lien_backoffice`

**Variantes** : un seul slug, un seul objet, un seul en-tête. Le flag `priorite_urgence` ne pilote que le contenu (bloc "ATTENTION" conditionnel) — pas l'objet, pas les en-têtes Resend (sobriété A3 2026-05-04).

**Cohérence inter-CDC** : ce template est l'alerte pendant que l'endpoint E2 `PATCH /collectes/:id` (cf. [[08 - APIs et intégrations]]) propage la donnée au TMS. Les deux mécanismes sont indépendants — l'email reste envoyé même en cas d'échec du webhook (Ops alertée pour fallback manuel).

---

## 20. Email traiteur opérationnel — Collecte programmée par un tiers *(ajout 2026-06-07, F2)*

**Slug** : `collecte_programmee_tiers`
**Destinataire** : manager + commerciaux du traiteur opérationnel (`traiteur_operationnel_organisation_id`)
**Déclencheur** : collecte programmée par une agence ou un gestionnaire de lieux — uniquement si `evenements.organisation_id ≠ traiteur_operationnel_organisation_id` ET si le traiteur opérationnel n'est pas une fiche shadow (shadow → silencieux). Info-only, aucune validation requise (règle 2026-05-07, matrice §05 §9).
**Objet** : Une collecte a été programmée chez vous — {{date_collecte}} à {{lieu_nom}}

```
Bonjour {{prenom}},

{{organisation_programmatrice}} a programmé une collecte vous concernant. Aucune action n'est requise de votre part — cet email est informatif.

— Date : {{date_collecte}}
— Horaire de collecte : {{horaire_collecte}}
— Lieu : {{lieu_nom}}, {{lieu_adresse}}
— Type : {{type_collecte}} ({{flux_list}})
— Programmé par : {{programmeur_nom}} ({{organisation_programmatrice}})

[Bouton : Voir la collecte]

L'équipe Savr
```

**Variables** : `prenom`, `organisation_programmatrice`, `programmeur_nom`, `date_collecte`, `horaire_collecte`, `lieu_nom`, `lieu_adresse`, `type_collecte`, `flux_list`, `lien_collecte`

---

## 21. Email traiteur opérationnel — Collecte modifiée ou annulée par un tiers *(ajout 2026-06-07, F2)*

**Slug** : `collecte_modifiee_tiers`
**Destinataire** : manager + commerciaux du traiteur opérationnel
**Déclencheur** : modification OU annulation effectuée par un programmateur ≠ traiteur opérationnel (mêmes gardes que template 20 : tiers + non-shadow). Variable `type_changement` (`modification`/`annulation`) pilote l'objet et le bloc conditionnel.
**Objet** : Collecte {{type_changement_libelle}} — {{date_collecte}} à {{lieu_nom}} *(`type_changement_libelle` = « modifiée » ou « annulée »)*

```
Bonjour {{prenom}},

La collecte programmée chez vous par {{organisation_programmatrice}} a été {{type_changement_libelle}}.

{{#if est_modification}}
Modifications apportées :
{{diff_list}}
{{/if}}
{{#if est_annulation}}
La collecte du {{date_collecte}} au {{lieu_nom}} n'aura pas lieu.
{{/if}}

Cet email est informatif — aucune action n'est requise de votre part.

[Bouton : Voir la collecte]

L'équipe Savr
```

**Variables** : `prenom`, `organisation_programmatrice`, `type_changement` (`modification`/`annulation`), `type_changement_libelle`, `est_modification` (bool), `est_annulation` (bool), `date_collecte`, `lieu_nom`, `diff_list` (si modification), `lien_collecte`

---

## 22. Email Admin — Collecte annulée *(ajout 2026-06-07, F2)*

**Slug** : `admin_collecte_annulee`
**Destinataire** : tous les `admin_savr`
**Déclencheur** : toute annulation de collecte (matrice §05 §9 — destinataire additionnel Admin). Envoyé en parallèle du template 5 client.
**Objet** : `[Admin] Collecte annulée — {{organisation_nom}} — {{date_collecte}}`

```
Une collecte a été annulée.

— Collecte : {{collecte_ref}} (type {{type_collecte}})
— Organisation : {{organisation_nom}}
— Date / lieu : {{date_collecte}} à {{lieu_nom}}
— Annulée par : {{user_nom}} ({{user_role}})
— Délai avant créneau : {{delai_avant_creneau}}
— Facturation : {{info_facturation}}

{{#if annulation_tardive}}
ATTENTION : annulation à moins de 12h du créneau — plein tarif applicable, vérifier le relais logistique.
{{/if}}

[Bouton : Voir la collecte sur le back-office]
```

**Variables** : `collecte_ref`, `type_collecte`, `organisation_nom`, `date_collecte`, `lieu_nom`, `user_nom`, `user_role`, `delai_avant_creneau`, `info_facturation`, `annulation_tardive` (bool), `lien_backoffice`

---

## Structure DB de la table `email_templates`

| Champ | Type | Description |
|-------|------|-------------|
| `id` | uuid | PK |
| `slug` | text unique | Identifiant stable (ex: `collecte_programmee`) |
| `objet` | text | Sujet email (avec variables) |
| `corps_html` | text | Corps HTML (avec variables) |
| `corps_text` | text | Version texte fallback |
| `variables` | jsonb | Liste des variables attendues (doc) |
| `actif` | boolean | Activable/désactivable |
| `created_at`, `updated_at` | | |

> **Sobriété D1 2026-06-03** : colonne `destinataire_type` (`user_programmeur`/`admin_savr`/`user_specifique`) supprimée. `user_specifique` était un fourre-tout (associations, transporteurs, alias Ops, collaborateur invité…) ; l'adresse réelle est résolue au déclenchement de l'envoi, jamais depuis cet enum → aucun comportement applicatif distinct.

**Édition (V1)** : templates livrés en **seed DB** (`email_templates`). Modifiables sans redéploiement par mise à jour SQL/migration de la ligne. **Reporté V1.1 (sobriété A1 2026-06-03)** : interface Admin d'édition + preview avec variables de test + colonne `version` (versioning des templates) — coût build moyen pour une fréquence de changement quasi nulle.

---

## Décisions prises

- **Vouvoiement systématique** sur tous les templates V1
- **Ton direct et chaleureux** (adapté à la cible B2B premium)
- **Retiré V1 (propagation Q10 M05 2026-04-24)** — template supprimé, notification client T+3h non retenue V1. La plaque reste saisie côté TMS pour traçabilité interne (registre transport, audit M08, monitoring Admin). Webhook S7 conservé sans trigger email.
- **Pas d'envoi automatique des factures V1** (Admin envoie manuellement depuis Pennylane)
- **12 templates V1 (propagation Q10 M05 2026-04-24)** — retrait du template `plaque_chauffeur`. Les 12 templates V1 actifs sont numérotés 1→13 dans ce document avec le slot 7 biffé pour préserver l'historique.
- **+1 template ajout 2026-05-04** : `admin_modification_collecte_traiteur` (n°19). Décision : variante "urgence" pilotée par flag, pas de slug séparé pour éviter duplication.
- **Compteur corrigé 2026-06-03 (sobriété C1)** : l'ancien total « 13 templates actifs » était une dérive jamais recomptée depuis le 2026-05-04 (les templates 14bis, 16, 17, 18, 18ter, 19 ont été ajoutés ensuite). **Total V1 = 16 templates actifs** après la revue de sobriété 2026-06-03 :
  1. `bienvenue` · 3. `collecte_programmee` · 4. `collecte_modifiee` · 5. `collecte_annulee` · 6. `rapport_disponible` · 9. `admin_pack_ag_etat` *(fusion bas+épuisé)* · 10. `admin_incident_collecte` · 11. `reset_password` · 12. `verification_email` · 13. `admin_demande_ajout_lieu` · 14. `admin_demande_renouvellement_pack` · 16. `ag_attribution_association` · 17. `invitation_utilisateur` · 18. `ag_attribution_transporteur` · 18ter. `ag_a_toutes_indispo` · 19. `admin_modification_collecte_traiteur` · 20. `admin_demande_annulation` *(ajouté M3.1 2026-06-17)*. **Total réel = 20 slugs actifs** (vérifier SELECT count(*) WHERE actif=true en dev).
  - **Slots retirés** : 2 (`completion_profil_requise`, A2) · 7 (`plaque_chauffeur`) · 8 (`admin_orga_a_valider`, A3) · 14bis (`admin_pack_epuise`, fusionné → 9) · 15 (`facture_relance`) · 18bis (`ag_recalcul_branche`).
- **+3 templates ajoutés 2026-06-07 (F2 tranchée Val, session test-scenarios)** : 20. `collecte_programmee_tiers` · 21. `collecte_modifiee_tiers` *(modification + annulation par tiers, variable `type_changement`)* · 22. `admin_collecte_annulee`. Ils soldent l'écart matrice §05 §9 (règle 2026-05-07 tiers + destinataire Admin annulation) ↔ templates. **Total V1 = 19 templates actifs.**

## Questions ouvertes

1. **Tranchée 2026-05-29 (Val) : signature générique "L'équipe Savr"** (conforme à la convention transverse en tête de document). Aucun mapping référent↔organisation n'existe en V1 ; une signature nominative imposerait ce mapping + sa maintenance pour un gain faible. Signature nominative reportée V2 si une logique de référent dédié est introduite.
2. **Anglais** : traduction EN de tous les templates pour gestionnaires anglophones V1 ou V1.1 ?
3. **Envoi automatique factures par email** : hors scope V1 acté, à trancher pour V1.1
4. **Template pour clients finaux (profil 6)** : mail de bienvenue spécifique lors de l'activation du rattachement à un événement ?
