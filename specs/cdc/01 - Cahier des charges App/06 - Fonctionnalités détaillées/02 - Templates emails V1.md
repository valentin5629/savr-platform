# 06.02 - Templates emails V1

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
- Un seul lien principal par email : tout lien est affiché en bouton (cf. « Enveloppe commune » ci-dessous)

**Enveloppe commune (revue des emails, Val 2026-10-29 ; remplacée par l'addendum A1 du 2026-10-29 au soir, migration `20261029200000`)** : les gabarits en base ne portent que le texte (ni style ni classe). À l'envoi, `sendEmail` ajoute la même présentation à tous (`packages/shared/src/email/enveloppe.ts`) :
- le vrai logo Savr (image PNG fournie par Val), joint à l'email en image intégrée (`cid:logo-savr`) et centré ; le transport joint ce logo seulement quand le HTML l'affiche, jamais une pièce jointe venue de l'appelant ;
- **tout lien devient un bouton** centré (fond bleu marine, texte blanc, flèche orange). Un lien placé au milieu d'une phrase en sort : la phrase reste en texte et le bouton la suit, son libellé sans point final. Dans les gabarits ci-dessous, « [Bouton : …] » désigne ce bouton ;
- espacements : 64 px sous le logo, 54 px au-dessus et 52 px au-dessous de chaque bouton ;
- un pied de page : « Savr — collecte et valorisation des surplus d'événements · contact@gosavr.io » puis « Vous recevez cet email parce que vous utilisez la plateforme Savr. » ;
- une version texte (liens écrits « libellé : adresse »), pour les messageries qui n'affichent pas le HTML (inchangée par A1).

**Moteur d'interpolation** :
- `{{variable}}` est remplacée telle quelle ; `{{#if variable}}…{{/if}}` (blocs non imbriqués) n'est gardé que si la variable est présente et non vide, et différente de `false`, `0` et `non` (sans tenir compte de la casse) : une valeur « 0 » masque donc le bloc. Un nombre qui peut valoir zéro est passé autrement (ex. « aucun » pour `credits_restants`, template 14).
- Le moteur n'échappe rien : toute valeur qui vient d'une saisie (nom, adresse, motif, message…) est échappée par l'appelant (`escapeHtml`) avant l'envoi. L'objet est ensuite remis en texte (`objetEnTexte`), pour que « Dupont & Fils » ne s'y lise pas « Dupont &amp; Fils ».
- Une variable déclarée et citée hors de tout bloc `{{#if}}` est exigée à l'envoi (refus si elle manque) ; une variable citée seulement dans un bloc est facultative.

**Formats** : dates au format JJ/MM/AAAA, y compris la liste des collectes du récapitulatif (template 3, Val 2026-11-02), heures HH:MM, adresses de lieu = adresse d'accès suivie du code postal et de la ville (« 12, rue de la Paix, 75002 Paris »), libellés lisibles (rôle, type de collecte, type de pack, imputabilité d'un incident) et jamais un code technique.

---

## 1. Email de bienvenue (après vérification email)

**Slug** : `bienvenue_organisation`
**Destinataire** : user venant de vérifier son email (envoyé seulement si son prénom est connu)
**Objet** : Bienvenue sur Savr

```
Bonjour {{prenom}},

Bienvenue sur la plateforme Savr.
Nous vous laissons la découvrir. N'hésitez pas à nous contacter à l'adresse contact@gosavr.io si vous avez des questions.

[Bouton : Programmer ma première collecte]

À bientôt sur des événements !

L'équipe Savr
```

**Variables** : `prenom`, `lien_programmation_collecte` (formulaire de programmation d'une collecte). *(Revue des emails, Val 2026-10-29 ; slug réel en base `bienvenue_organisation`, jamais `bienvenue`.)*

---

## 2. Email rappel completion profil entreprise **Retiré V1 (revue de sobriété 2026-06-03, A2)**

**Slug** : `completion_profil_requise`
**Motif** : le blocage de la programmation sans organisation complétée est déjà géré **in-app** (modal « Complétez votre profil entreprise » qui liste les champs manquants et redirige vers le formulaire de complétion — cf. [[../05 - Règles métier]] §9 UX). L'email doublait une information déjà affichée à l'instant T → confort. Décision Val 2026-06-03 : in-app uniquement, pas d'email V1.

---

## 3. Email récapitulatif programmation collecte

**Slug** : `collecte_programmee`
**Destinataire** : programmeur de la collecte (`collectes.created_by`)
**Objet** : Programmation confirmée — {{nom_evenement}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Merci, votre programmation pour l'événement « {{nom_evenement}} »{{#if lieu_nom}} au {{lieu_nom}}{{/if}} est bien enregistrée. Nous réaliserons {{nombre_collectes}} :
{{liste_collectes}}

Votre événement nécessite plusieurs collectes ? N'oubliez pas de les programmer dès maintenant.

La suite : notre équipe organise le passage du transporteur et confirme la collecte. Si le lieu impose un contrôle d'accès, vous recevrez le nom et le téléphone du chauffeur avant le jour J. Après l'événement, vous retrouverez votre rapport dans votre espace.

Vous pouvez modifier ou annuler une collecte depuis votre espace jusqu'à 4h avant la collecte.

{{#if lien_collectes}}
[Bouton : Voir mes collectes]
{{/if}}

Une question ? Écrivez-nous à contact@gosavr.io.

À bientôt,
L'équipe Savr
```

**Variables** : `prenom` (facultatif : « Bonjour, » sans prénom), `nom_evenement` (« Votre événement » si l'événement n'a pas de nom), `lieu_nom` (facultatif), `nombre_collectes` (« 3 collectes », « 1 collecte »), `liste_collectes` (une puce par collecte annoncée : « Collecte Zéro Déchet #1 — 12/11/2026 à 19:00 — 120 convives », libellé et numéro identiques à ceux de la page de confirmation ; date au format JJ/MM/AAAA, Val 2026-11-02 — dette code : le gabarit en base garde la date longue « jeudi 12 novembre 2026 »), `lien_collectes` (facultatif : liste Collectes de l'espace du programmeur). *(Revue des emails, Val 2026-10-29 : lieu, paragraphe « La suite ». Addendum A4, migration `20261029200000` : la phrase « Votre événement nécessite plusieurs collectes ? … » est du texte, sans lien ; l'alerte « moins de 24 heures » (07 61 91 29 97) et la ligne de tarif sont retirées de l'email — variables `collecte_sous_24h` et `tarif_ligne` sorties du gabarit. L'alerte < 24 h reste au formulaire (Val 2026-10-16) ; rallumer la facturation (V1.1) demandera de remettre la ligne de tarif dans ce gabarit. La migration fait foi pour la présence éventuelle de `lien_evenement`, qui ne porte plus de lien dans le texte.)*

*(Décision Val 2026-10-24, B2-Q3 : une ligne par collecte. Un email par programmation ; pour une collecte ajoutée à un événement existant, l'email annonce cette seule collecte, avec son numéro dans l'événement. Objet et corps alignés sur le gabarit en base, qui avait déjà quitté la forme d'origine ci-dessus.)* *(Remplacé par la revue des emails, Val 2026-10-29 et addendum A4 : texte ci-dessus ; date de chaque ligne au format JJ/MM/AAAA, Val 2026-11-02.)*

---

## 4. Email modification collecte **Retiré V1 (revue des emails, Val 2026-11-02)**

**Slug** :
**Motif** : aucune ligne `email_templates` ne porte ce code et aucun code ne l'envoie. Le programmateur qui modifie lui-même sa collecte ne reçoit pas d'email ; un programmateur agence ou gestionnaire de lieux est prévenu d'une modification faite par quelqu'un d'autre par le template 21 (`collecte_modifiee_tiers`). Ligne correspondante de la matrice §05 §9 retirée (point ouvert 4 de la fiche M0.5_20261029, tranché Val 2026-11-02).

---

## 5. Email annulation collecte (confirmation)

**Slug** : `annulation_collecte`
**Destinataire** : programmateur de la collecte (`evenements.created_by`). C'est le seul email qu'il reçoit pour une annulation, quel qu'en soit l'auteur (traiteur, agence, gestionnaire de lieux, équipe Savr) : jamais aussi le template 21 (décision Val 2026-10-29).
**Déclencheur** : toute annulation d'une collecte — directe (traiteur, agence), confirmation par l'Admin d'une demande d'annulation, annulation par l'Admin, déclaration d'un incident. *(La confirmation par l'Admin d'une demande d'annulation est un chemin historique, plus emprunté depuis l'annulation cliente directe, Val 2026-11-02.)*
**Objet** : Collecte annulée — {{date_collecte}}{{#if nom_evenement}} — {{nom_evenement}}{{/if}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Nous vous confirmons l'annulation de la collecte prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}}, pour l'événement « {{nom_evenement}} »{{/if}}. Si un transporteur était déjà prévu, il est prévenu.

{{#if motif}}
Motif : {{motif}}
{{/if}}

{{#if info_credit}}
{{info_credit}}
{{/if}}

S'il s'agit d'une erreur, contactez-nous au plus vite à contact@gosavr.io : nous ferons notre possible pour maintenir le passage.

L'équipe Savr
```

**Variables** : `date_collecte`, + facultatives `prenom`, `heure_collecte`, `lieu_nom`, `nom_evenement`, `motif`, `info_credit`.
- `motif` : le motif du client. Pour une demande d'annulation confirmée par l'Admin, celui de la demande, jamais le texte saisi par l'Admin pour forcer le statut. Incident : « Incident survenu lors de la collecte : <description>. » ; incident non imputable au client : le motif porte aussi « Cet incident ne vous sera pas facturé. »
- **Aucune phrase de facturation** (addendum A5, Val 2026-10-29, migration `20261029200000`) : variable `info_facturation` retirée du gabarit. L'équipe Savr est prévenue d'une annulation tardive par l'email Admin (§22). *(Slug réel en base `annulation_collecte`, jamais `collecte_annulee`.)*
- `info_credit` *(arbitrage 2026-11-02, Q4 du lot débit à la programmation — prime sur A5 pour ce seul cas)* : renseignée par l'appelant **uniquement** pour une collecte Anti-Gaspi dont le crédit est rendu (annulation à 4 h ou plus, ou incident non imputable au client) : « Le crédit de votre pack Anti-Gaspi décompté à la programmation vous est rendu. » Vide dans tous les autres cas (aucune phrase de facturation, A5 inchangé). Dette code : variable à ajouter au gabarit en base.

---

## 6. Email rapport post-collecte disponible

**Slug** : `rapport_disponible`
**Déclencheur** : clôture de la collecte ZD (48 h après la collecte) dont le bordereau est émis ; un seul envoi par collecte (décision Val 2026-11-04).
**Destinataire** : programmeur de la collecte — adresse résolue sur **`organisations.email_principal`** de l'organisation programmatrice *(précisé 2026-09-14 : `evenements.contact_principal_email` n'existe pas en V1)*

> ⚠ **Écart seed → code à corriger (divergence M1.6, tranché Val 2026-09-14)** : la base a été seedée avec le slug **`bordereau_disponible`**, que **rien n'appelle** ; le batch ZD envoie `rapport_disponible`, qui **n'existe dans aucune migration** → `TEMPLATE_NOT_FOUND`, **aucun email de rapport ZD n'est jamais parti**. Correctif retenu : `UPDATE plateforme.email_templates SET code = 'rapport_disponible' WHERE code = 'bordereau_disponible'` (dev + prod), alignement de `packages/shared/src/seed/constants.ts`, et **alignement des variables envoyées par `batch-pdf-j1.ts` sur celles listées ci-dessous** (il envoyait `nom_evenement` / `date_evenement`, absents du template → `sendEmail` refuserait l'envoi pour variables manquantes, contrôle §08 §4). **Le CDC fait foi, c'est le seed qui diverge.**
**Objet** : Rapport de recyclage disponible — {{#if nom_evenement}}{{nom_evenement}}, {{/if}}{{date_collecte}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

La collecte Zéro Déchet de votre événement{{#if nom_evenement}} « {{nom_evenement}} »{{/if}} du {{date_collecte}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}} est terminée et ses pesées sont validées. Son rapport de recyclage est prêt.

En résumé :
— {{poids_total}} kg de déchets collectés
— {{co2_evite}} kg CO₂e évités (estimation)
— Taux de recyclage : {{taux_recyclage}} %

Avant de télécharger le rapport en PDF, vous pouvez y ajouter une comparaison avec les autres événements Savr : pratique pour le partager avec votre client ou l'intégrer à votre bilan RSE. Le bordereau, justificatif des pesées, est disponible au même endroit.

[Bouton : Télécharger le rapport]

Merci d'avoir trié avec nous,
L'équipe Savr
```

**Variables** : `date_collecte` (JJ/MM/AAAA), `poids_total`, `co2_evite`, `taux_recyclage` *(renommé 2026-05-06 — ex `taux_valorisation`. Lecture directe `collectes.taux_recyclage` formule à captation par filière)*, `lien_rapport` *(URL absolue de la fiche collecte dans l'espace du programmeur — traiteur, agence ou gestionnaire de lieux selon `organisations.type` de l'organisation programmatrice ; page sous login, sans jeton ; le téléchargement du PDF se fait depuis cette fiche, disponible dès que les poids sont là, plus d'embargo depuis le 2026-11-04 — précisé 2026-10-02, validé Val)*, + facultatives `prenom` (prénom du programmeur s'il appartient à l'organisation destinataire, comme le rapport de don ; « Bonjour, » sinon), `nom_evenement`, `lieu_nom`. *(Revue des emails, Val 2026-10-29 ; phrase « Avant de télécharger… » : addendum A8, migration `20261029200000` fait foi.)*

---

## 7. Email plaque d'immatriculation chauffeur **Retiré V1 (propagation Q10 M05 2026-04-24)**

**Retiré V1 (propagation Q10 M05 2026-04-24)** — suppression totale de la notification client "plaque chauffeur T+3h". La plaque reste saisie côté TMS (bloquante checklist pré-départ M05 pour véhicules motorisés, non bloquante pour vélos cargo A Toute!) pour traçabilité interne, registre transport, audit M08 rapprochement factures. Webhook S7 `tms/plaque-saisie` conservé côté contrat API pour log Plateforme + monitoring Admin, sans trigger Resend. Si le besoin client réapparaît, à reconsidérer V1.1 avec un template dédié et un opt-in par organisation (pas par collecte). Contenu historique préservé ci-dessous pour traçabilité.




























---

## 8. Email alerte Admin — Nouvelle organisation à valider **Retiré V1 (revue de sobriété 2026-06-03, A3)**

**Slug** : `admin_orga_a_valider`
**Motif** : alerte purement informative (l'email lui-même précisait « l'organisation est déjà active, cette alerte sert à vérifier a posteriori »). L'onboarding est 100% automatisé sans validation amont (§05 §851) → aucun gating, aucune action requise à l'instant T. Le push email génère du bruit à volume. La vérification de cohérence a posteriori se fait via le **filtre « nouvelles organisations » du back-office** (orgs déjà listées, revue à la cadence Admin). Décision Val 2026-06-03.

---

## 9. Email alerte Admin — État pack AG (bas / épuisé) *(fusion 2026-06-03, B1)*

**Slug** : `admin_pack_ag_etat`
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io` (comme le template 19)
**Déclencheurs** (un seul template, variable `niveau`) :
- `niveau = bas` : **franchissement** du seuil 10 % — transition `> 10 %` → `≤ 10 %` des crédits initiaux restants. Pas de répétition à chaque décrément sous le seuil ; un recrédit qui repasse au-dessus de 10 % ré-arme le déclencheur *(F4 tranchée Val 2026-06-07)*
- `niveau = epuise` : `packs_antgaspi.statut` passe à `epuise` (`credits_consommes = credits_initiaux`)

> **Sobriété B1 2026-06-03** : fusion des ex-templates 9 (`admin_pack_ag_bas`) et 14bis (`admin_pack_epuise`) — même destinataire, même objet métier (consommation de pack), CTA identique. Le bloc « facturation à l'unité » est conditionnel sur `niveau = epuise`.

**Objet** : `[Admin] Pack Anti-Gaspi {{etat_libelle}} — {{organisation_nom}}` *(`etat_libelle` = « bientôt épuisé » si `bas`, « épuisé » si `epuise`)*

```
Hello les boss,

Le pack Anti-Gaspi de {{organisation_nom}} est {{etat_libelle}}.

— Pack : {{type_pack}}
— Crédits restants : {{credits_restants}} sur {{credits_initiaux}} ({{pct_restant}} %)
{{#if derniere_collecte_date}}— Dernière collecte : {{derniere_collecte_date}}{{/if}}

{{#if niveau_bas}}
C'est le bon moment pour proposer au client le renouvellement de son pack.
{{/if}}
{{#if niveau_epuise}}
Le client peut continuer à programmer : tant qu'aucun nouveau pack n'est actif, ses collectes Anti-Gaspi seront facturées à l'unité. Pensez à le prévenir.
{{/if}}

[Bouton : Voir la fiche organisation]

L'équipe Savr
```

**Variables** : `etat_libelle`, `organisation_nom`, `type_pack` (libellé long du type de pack, jamais le code), `credits_restants`, `credits_initiaux`, `pct_restant`, `derniere_collecte_date` (facultatif, JJ/MM/AAAA), `niveau_bas` (bool), `niveau_epuise` (bool), `lien_fiche_org`. Le niveau (`bas`/`epuise`) ne passe au gabarit que par `niveau_bas` / `niveau_epuise`. *(Revue des emails, Val 2026-10-29.)* *(Formule d'appel « Hello les boss, » : addendum A2, Val 2026-10-29.)*

---

## 10. Email alerte Admin — Incident collecte

**Slug** : `admin_incident_collecte`
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io`
**Objet** : [Admin] Incident sur une collecte — {{lieu_nom}} — {{date_collecte}}

```
Hello les boss,

Un incident a été déclaré sur la collecte du {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}} au {{lieu_nom}}{{#if organisation_nom}} ({{organisation_nom}}){{/if}}. La collecte est annulée et le client a reçu une confirmation d'annulation.

— Type d'incident : {{type_incident}}
— Imputable à : {{imputable_a}}
— Description : {{description}}

Suite à donner : décider d'un avoir, d'une nouvelle collecte ou d'une contestation auprès du responsable.

[Bouton : Voir la collecte]

L'équipe Savr
```

**Variables** : `lieu_nom`, `date_collecte`, `type_incident` (libellé : « Collecte manquée »), `imputable_a` (libellé : « le prestataire logistique », « le client », « l'association », « Savr », « une cause extérieure »), `description`, `lien_collecte`, + facultatives `heure_collecte`, `organisation_nom`. *(Revue des emails, Val 2026-10-29.)* *(Formule d'appel « Hello les boss, » : addendum A2, Val 2026-10-29.)*

---

## 11. Email récupération mot de passe

**Slug** : `reset_password`
**Destinataire** : user demandeur
**Objet** : Réinitialisez votre mot de passe Savr

> **Délivrance : Resend** (décision Val 2026-11-06, migration `20261106200000`). Supabase fabrique le lien (`auth.admin.generateLink`, type `recovery`) ; la plateforme l'envoie avec ce gabarit, comme l'inscription et l'invitation. Avant, Supabase l'envoyait lui-même depuis son expéditeur par défaut, qui ne livre qu'aux membres de l'équipe du projet. Le lien vise `/api/auth/reset-password/confirm?token_hash=…&type=recovery`, sur le domaine de `NEXT_PUBLIC_APP_URL`. Gabarit `reset_password` **actif**.

```
Bonjour {{prenom}},

Vous avez demandé la réinitialisation de votre mot de passe Savr.

Ce lien est valide pendant 1 heure.

[Bouton : Réinitialiser mon mot de passe]

Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — rien n'aura changé sur votre compte.

L'équipe Savr
```

**Variables** : `prenom` *(vide si inconnu : salutation « Bonjour, »)*, `lien_reset`

---

## 12. Email vérification email à l'inscription

**Slug** : `verification_email`
**Destinataire** : nouveau user
**Objet** : Activez votre compte Savr

```
Bonjour {{prenom}},

Merci pour votre inscription sur Savr, la plateforme qui organise la collecte des surplus de vos événements : les repas non servis sont donnés à des associations (Anti-Gaspi), les déchets triés sont collectés, pesés et envoyés vers leur filière de traitement (Zéro Déchet).

Pour activer votre compte, confirmez votre adresse email :

[Bouton : Activer mon compte]

À très vite,
L'équipe Savr
```

**Variables** : `prenom` (facultatif : « Bonjour, » sans prénom), `lien_verification` (nom réel dans le seed et le code, ex `lien_activation`). Aucune durée de validité n'est annoncée : celle du lien est la durée de la configuration d'authentification Supabase (Val 2026-11-02, fiche M0.5_20261028).

---

## 13. Email alerte Admin — Nouvelle demande lieu

**Slug** : `admin_demande_ajout_lieu`
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io`
**Objet** : [Admin] Nouveau lieu à valider — {{lieu_nom}}

```
Hello les boss,

{{user_nom}}{{#if organisation_nom}} ({{organisation_nom}}){{/if}} a créé un nouveau lieu en programmant une collecte :

— Nom : {{lieu_nom}}
— Adresse : {{lieu_adresse}}

Ce lieu n'est pas encore validé. Vérifiez son nom et son adresse, complétez les informations d'accès (stationnement, véhicule maximal, accès à l'office) : le transporteur en a besoin. Puis validez la fiche.

[Bouton : Ouvrir la fiche du lieu]

L'équipe Savr
```

**Variables** : `lieu_nom`, `user_nom`, `lieu_adresse` (adresse d'accès, code postal et ville), `lien_lieu`, + facultative `organisation_nom`. `date_collecte` retirée : le lieu est créé avant la collecte, la date n'est pas connue à l'envoi. *(Revue des emails, Val 2026-10-29.)* *(Formule d'appel « Hello les boss, » : addendum A2, Val 2026-10-29.)*

---

## 14. Email Admin — Demande de renouvellement pack AG

**Slug** : `admin_demande_renouvellement_pack`
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io`
**Déclencheur** : un utilisateur client (traiteur manager ou commercial, agence, gestionnaire de lieux ou client organisateur — Val 2026-11-02) clique "Demander un renouvellement" depuis son espace client (bloc du dashboard ou onglet « Mon pack Anti-Gaspi »). Le bouton n'apparaît que si l'organisation a, ou a eu, au moins un pack. Sans aucun pack : ni bouton ni email — l'onglet « Mon pack Anti-Gaspi » affiche « Votre organisation n'a pas de pack Anti-Gaspi. Contactez votre responsable Savr pour en souscrire un. » (pas de bouton « Demander l'activation d'un pack », décision Val 2026-11-02)
**Objet** : [Admin] Demande de renouvellement de pack Anti-Gaspi — {{organisation_nom}}

```
Hello les boss,

{{demandeur_nom}} ({{organisation_nom}}) demande le renouvellement de son pack Anti-Gaspi.

{{#if pack_souhaite}}— Pack souhaité : {{pack_souhaite}}{{/if}}
{{#if credits_restants}}— Crédits restants sur le pack actuel : {{credits_restants}}{{/if}}
— Contact : {{demandeur_email}}

{{#if message}}
Message : {{message}}
{{/if}}

Recontactez le client pour confirmer l'offre, puis créez le nouveau pack depuis la fiche de l'organisation. Une organisation n'a qu'un seul pack actif à la fois.

{{#if lien_fiche_org}}
[Bouton : Ouvrir la fiche organisation]
{{/if}}

L'équipe Savr
```

**Variables** : `organisation_nom`, `demandeur_nom`, `demandeur_email`, + facultatives `pack_souhaite`, `credits_restants` (crédits restants du pack le plus récent de l'organisation, actif ou épuisé ; « aucun » quand il n'en reste plus, car « 0 » masquerait la ligne ; vide sans pack), `message` (ex `message_traiteur`), `lien_fiche_org`. *(Revue des emails, Val 2026-10-29.)* *(Formule d'appel « Hello les boss, » : addendum A2, Val 2026-10-29.)*

---

## 14bis. Email Admin — Pack AG épuisé **Fusionné dans le template 9 (revue de sobriété 2026-06-03, B1)**

**Slug** : → remplacé par `admin_pack_ag_etat` avec `niveau = epuise` (voir template 9).
**Motif** : doublon fonctionnel avec l'alerte pack bas (même destinataire, même objet métier, même CTA). Le cas « épuisé » devient une variante `niveau` du template unifié, avec son bloc « facturation à l'unité » conditionnel.

---

## 15. Email relance facture en retard **Retiré V1 (revue de sobriété 2026-05-08)**

**Slug** : `facture_relance`
**Motif** : les relances de factures en retard sont gérées **directement dans Pennylane** (décision 2026-04-28). Aucun flux relance V1 côté plateforme Savr — donc pas de template email Savr associé. Voir [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]] §8.

---

## 16. Email attribution AG — Association bénéficiaire

**Slug** : `ag_attribution_association`
**Destinataire** : adresse de contact de l'association (`associations.contact_email`)
**Déclencheur** : validation de l'attribution par Admin Savr (ou auto-accept)
**Objet** : Don de repas confirmé — {{evenement_nom}}, {{date_collecte}}

```
Bonjour,

Nous avons le plaisir de vous confirmer un potentiel don de repas pour votre association. Nous nous attendons à ce que des repas ne soient pas servis lors d'un événement préparé par l'un de nos clients traiteurs.

— Collecte sur événement : le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}
— Volume estimé : environ {{volume_estime_repas}} repas

Le transporteur récupère les repas sur le lieu de l'événement puis vous les livre. Le volume est une estimation : il dépend de ce qui reste réellement en fin d'événement.

Merci de prévoir une personne pour réceptionner la livraison. Si vous ne pouvez pas recevoir ce don, prévenez-nous au plus vite à contact@gosavr.io : nous trouverons une autre association.

Merci pour votre engagement,
L'équipe Savr
```

**Variables** : `evenement_nom` (« Événement traiteur » si l'événement n'a pas de nom), `date_collecte` (JJ/MM/AAAA), `volume_estime_repas`, + facultative `heure_collecte`. Lieu, adresse et transporteur ne figurent plus dans l'email : le transporteur livre l'association. *(Revue des emails, Val 2026-10-29 ; objet « Don de repas confirmé » et puce « Collecte sur événement : » : addendum A7.)*

---

## 17. Email invitation collaborateur

**Slug** : `invitation_utilisateur` *(corrigé M3.1 2026-06-17 — le slug seedé est `invitation_utilisateur`, pas `invitation_collaborateur`)*
**Destinataire** : collaborateur invité par un manager
**Déclencheur** : action "Inviter un collaborateur" depuis « Paramètres > Membres » (ex « Mon organisation », décision Val 2026-10-31)
**Objet** : Invitation à rejoindre {{organisation_nom}} sur Savr

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Vous êtes invité(e) à rejoindre l'espace de {{organisation_nom}} sur Savr.

Savr est la plateforme qu'utilise votre organisation pour programmer et suivre la collecte des surplus de ses événements : don des repas non servis à des associations (Anti-Gaspi) et collecte des déchets triés (Zéro Déchet).

Pour accéder à votre espace, choisissez votre mot de passe :

[Bouton : Choisir mon mot de passe]

Ce lien vous est personnel et reste valable 7 jours. Si vous ne vous attendiez pas à cette invitation, vous pouvez ignorer cet email.

Bienvenue,
L'équipe Savr
```

**Variables** : `prenom`, `organisation_nom`, `lien_invitation` *(aligné sur la seed déployée — M0.5 2026-07-01, Option A : le nom de l'invitant n'est pas transmis en V1)*

**Lien** : lien Savr signé vers la page `/invitation` (choix du mot de passe), valable 7 jours et à usage unique ; ouvrir la page ne le consomme pas (protège des messageries qui analysent les liens). Lien expiré : la page propose de recevoir un lien d'accès (mot de passe oublié). Décision Val 2026-10-28.

---

## 18. Email attribution AG — Transporteur **Retiré V1 (revue des emails, Val 2026-10-28)**

**Motif** : la mission arrive au transporteur par l'outil du prestataire logistique (MTS-1, Everest) ou par l'équipe Savr, jamais par cet email. Gabarit désactivé (`actif = false`, migration `20261029150000`), plus aucun code ne l'envoie. Contenu historique conservé ci-dessous.

**Slug** : `ag_attribution_transporteur`
**Destinataire** : adresse de contact du transporteur (`transporteurs.email_contact`)
**Déclencheur** : validation de l'attribution par Admin Savr (ou auto-accept), uniquement si transporteur != A Toute!
**Objet** : Mission de transport Anti-Gaspi — {{date_collecte}}

```
Bonjour,

Vous êtes mandaté pour assurer le transport d'une collecte Anti-Gaspi.

— Date et heure de prise en charge : {{date_collecte}} à {{heure_collecte}}
— Lieu de collecte : {{lieu_adresse_complete}}
— Adresse de livraison (association) : {{association_adresse}}
— Association bénéficiaire : {{association_nom}}
— Volume estimé : {{volume_estime_repas}} repas

Pour toute question ou en cas d'empêchement, contactez notre équipe à contact@gosavr.io dans les meilleurs délais.

L'équipe Savr
```

**Variables** : `date_collecte`, `heure_collecte`, `lieu_adresse_complete`, `association_nom`, `association_adresse`, `volume_estime_repas`

---

## 18bis. Email Admin Savr — Recalcul branche AG IDF post-modif `nb_pax` *(supprimé audit sobriété 2026-05-09 A2)*

> **Refonte audit sobriété 2026-05-09 A2** : ce template (`ag_recalcul_branche`) est supprimé. Le cas particulier "modification `nb_pax` post-attribution franchissant 600" était un edge case rare en pratique. Le workflow standard suffit : si l'Admin souhaite changer de transporteur après modif `nb_pax`, il rouvre l'écran d'attribution et applique un override (motif libre `autre`). Cf. [[09 - Flux algo attribution AG (Admin)#2.3. Règles d'attribution transporteur AG — Île-de-France|§09 §2.3]].

---

## 18ter. Email Ops Savr — A Toute! marqué indisponible *(ajout 2026-05-09)* **Désactivé (revue des emails, Val 2026-10-29)**

**Motif** : aucun code ne l'envoie. Gabarit désactivé (`actif = false`, migration `20261029150000`). Contenu historique conservé ci-dessous.

**Slug** : `ag_a_toutes_indispo`
**Destinataire** : Ops Savr (`ops@gosavr.io` ou alias configurable)
**Déclencheur** : bascule du flag `parametres_algo.a_toutes_indisponible` de `false` à `true` par un Admin Savr (cf. [[09 - Flux algo attribution AG (Admin)#7.2. Règles d'attribution transporteur IDF — branches §2.3|§09 §7.2]]). Toutes les nouvelles attributions IDF jour basculent vers Marathon (branche `ag_velo_fallback_marathon`). Email envoyé une fois à la bascule (pas de répétition).
**Objet** : `[AG IDF] A Toute! marqué indisponible — bascule Marathon active`

```
Bonjour,

L'Admin Savr {{admin_nom}} a marqué A Toute! comme indisponible à {{horodatage}}.

Motif : {{motif}}

Effet immédiat sur les nouvelles attributions AG en Île-de-France :
— Branche AG vélo jour (< {{seuil_pax_velo}} pax, plage {{plage_velo_debut}}-{{plage_velo_fin}}) : bascule sur Marathon
— Branches Marathon (nuit / grand événement) : inchangées

Les attributions déjà validées ne sont pas recalculées.

Pensez à rebasculer le flag à `false` une fois A Toute! redevenu opérationnel (Back-office → Paramètres → Algorithme AG).

L'équipe Savr
```

**Variables** : `admin_nom`, `horodatage`, `motif`, `seuil_pax_velo`, `plage_velo_debut`, `plage_velo_fin`

---

## 19. Email Admin — Modification collecte par traiteur (refonte 2026-05-04)

**Slug** : `admin_modification_collecte_traiteur`
**Destinataire** : Admin Savr — boîte de contact `contact@gosavr.io` *(décision Val 2026-10-08 ; ex « alias Ops `ops@gosavr.io` ou liste configurable en base », jamais implémenté)*
**Déclencheur** : tout enregistrement du formulaire d'édition d'une collecte par un rôle programmateur — `traiteur_manager`, `traiteur_commercial`, `agence`, `gestionnaire_lieux` (décision Val 2026-10-09 ; les collègues partagés ne peuvent pas modifier) — qui change réellement au moins un champ de la collecte ou de son événement. Statuts autorisés : voir [[../05 - Règles métier#Modification d'une collecte à venir]] (source unique).
**Objet** : `Modification d'une collecte — {{organisation_nom}}`

> **Sobriété A3 2026-05-04** : un seul objet, une seule variante. L'urgence (modification < 12h) est portée par le **contenu** de l'email (bloc "ATTENTION" conditionnel) et non par un préfixe d'objet ou un en-tête `X-Priority`. Filtrage Ops via règle Gmail standard si besoin. Évite la logique de variantes côté envoyeur Resend.

```
Hello les boss,

{{organisation_nom}} a modifié la collecte {{#if type_collecte}}{{type_collecte}} {{/if}}initialement prévue le {{date_initiale}}{{#if pax_initial}} pour {{pax_initial}} convives{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (événement « {{nom_evenement}} »){{/if}}.

Modifications :
{{liste_modifications}}

{{#if programmateur}}
Programmateur : {{programmateur}}.
{{/if}}

Statut actuel de la collecte : « {{statut_collecte}} ».

{{#if priorite_urgence}}
**Urgent : la collecte a lieu dans moins de 12 h.** Prévenez le transporteur sans attendre et vérifiez la logistique.
{{/if}}

Si la commande est déjà chez le prestataire logistique, la modification lui est transmise automatiquement. Si la tournée a déjà été envoyée au transporteur, vérifiez qu'il en a bien connaissance.

{{#if lien_fiche}}
[Bouton : Ouvrir la fiche de la collecte]
{{/if}}

L'équipe Savr
```

**Variables** : `organisation_nom`, `type_collecte` (facultatif, « Zéro Déchet » / « Anti-Gaspi »), `nom_evenement` (facultatif), `date_initiale` (date de la collecte avant modification, JJ/MM/AAAA), `pax_initial` (pax de la collecte avant modification — décision Val 2026-10-20 ; omis s'il est vide), `lieu_nom` (nom du lieu de l'événement), `liste_modifications` (une ligne par champ réellement modifié, collecte ET événement : date « du … au … » ; nombre, heure, contrôle d'accès « de … à … » ; texte et contact « avant …. Maintenant … »), `programmateur` (prénom et nom de l'utilisateur qui a programmé la collecte, suivis de « , joignable au » et de son téléphone s'il en a un ; omis si le compte est introuvable), `statut_collecte` (libellé affiché à l'Admin), `priorite_urgence` (bool : l'ancien ou le nouveau créneau est à moins de 12 h), `lien_fiche` (adresse de la fiche Admin de la collecte). **Un seul email par enregistrement du formulaire d'édition (décision Val 2026-10-09)**, y compris quand seuls des champs de l'événement changent ; aucun email si aucun champ n'a réellement changé.

**Variantes** : un seul slug, un seul objet, un seul en-tête. Le flag `priorite_urgence` ne pilote que le contenu (bloc "ATTENTION" conditionnel) — pas l'objet, pas les en-têtes Resend (sobriété A3 2026-05-04).

**Cohérence inter-CDC** : ce template est l'alerte pendant que l'endpoint E2 `PATCH /collectes/:id` (cf. [[08 - APIs et intégrations]]) propage la donnée au TMS. Les deux mécanismes sont indépendants — l'email reste envoyé même en cas d'échec du webhook (Ops alertée pour fallback manuel).

---

## 20. Email traiteur opérationnel — Collecte programmée par un tiers *(ajout 2026-06-07, F2)*

**Slug** : `collecte_programmee_tiers`
**Destinataire** : les managers (`traiteur_manager`, comptes actifs) du traiteur opérationnel (`traiteur_operationnel_organisation_id`) ; les commerciaux ne le reçoivent plus (revue des emails, Val 2026-10-29)
**Déclencheur** : collecte programmée par une agence ou un gestionnaire de lieux — uniquement si `evenements.organisation_id ≠ traiteur_operationnel_organisation_id` ET si le traiteur opérationnel n'est pas une fiche shadow (shadow → silencieux). Info-only, aucune validation requise (règle 2026-05-07, matrice §05 §9).
**Objet** : Une collecte a été programmée chez vous — {{date_collecte}} à {{lieu_nom}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

{{organisation_programmatrice}} a programmé une collecte vous concernant. Aucune action n'est requise de votre part — cet email est informatif.

— Date : {{date_collecte}}
— Horaire de collecte : {{horaire_collecte}}
— Lieu : {{lieu_nom}}, {{lieu_adresse}}
— Type : {{type_collecte}}
— Programmé par : {{programmeur_nom}} ({{organisation_programmatrice}})

[Bouton : Voir la collecte]

L'équipe Savr
```

**Variables** : `organisation_programmatrice`, `programmeur_nom` (prénom et nom du programmeur ; nom de son organisation s'il est introuvable), `date_collecte` (JJ/MM/AAAA), `horaire_collecte` (HH:MM), `lieu_nom`, `lieu_adresse` (adresse d'accès, code postal et ville), `type_collecte` (libellé), `lien_collecte` (fiche collecte de l'espace traiteur), + facultative `prenom`. `flux_list` retirée.

---

## 21. Email programmateur tiers — Collecte modifiée par quelqu'un d'autre *(ajout 2026-06-07, F2 ; refonte revue des emails, Val 2026-10-28 et 2026-10-29)*

**Slug** : `collecte_modifiee_tiers`
**Destinataire** : uniquement le programmateur de la collecte (`evenements.created_by`), quand son compte est actif, a le rôle `agence` ou `gestionnaire_lieux` et n'appartient pas au traiteur opérationnel. Plus personne côté traiteur.
**Déclencheur** : tout enregistrement du formulaire d'édition qui envoie l'email Admin du template 19 (au moins un champ réellement modifié), fait par quelqu'un d'autre que ce programmateur (traiteur, équipe Savr). Aucun email quand le programmateur modifie lui-même. **Une annulation ne déclenche plus ce template** : le programmateur ne reçoit que la confirmation d'annulation (template 5, décision Val 2026-10-29).
**Objet** : Collecte {{type_changement_libelle}} — {{date_collecte}} — {{nom_evenement}} *(`type_changement_libelle` = « modifiée »)*

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

La collecte que vous avez programmée pour l'événement « {{nom_evenement}} »{{#if traiteur_nom}} (traiteur : {{traiteur_nom}}){{/if}}, prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}, a été {{type_changement_libelle}}{{#if auteur_nom}} par {{auteur_nom}}{{/if}}.

{{#if est_modification}}
Modifications apportées :
{{liste_modifications}}
{{/if}}

Si ce changement ne vous semble pas correct, corrigez-le depuis la fiche de la collecte ou écrivez-nous à contact@gosavr.io.

[Bouton : Pour accéder à la collecte, cliquez ici]

L'équipe Savr
```

**Variables** : `type_changement_libelle` (« modifiée »), `date_collecte` (JJ/MM/AAAA), `nom_evenement` (« Votre événement » si l'événement n'a pas de nom), `lien_collecte` (fiche de la collecte dans l'espace du programmateur), + facultatives `prenom`, `traiteur_nom` (nom du traiteur opérationnel), `heure_collecte` (HH:MM), `lieu_nom`, `auteur_nom` (prénom et nom de l'auteur ; « l'équipe Savr » quand il est de l'équipe Savr), `est_modification` (toujours vrai), `liste_modifications` (la même liste que le template 19 : une ligne par champ modifié, avant et après), branche `{{#if est_annulation}}` retirée du gabarit (Val 2026-11-02 ; dette code : la retirer aussi du gabarit en base, sans effet tant qu'elle reste). La phrase « corrigez-le depuis la fiche de la collecte » est maintenue (Val 2026-11-02). `organisation_programmatrice`, `type_changement` et `diff_list` retirées.

---

## 22. Email Admin — Collecte annulée *(ajout 2026-06-07, F2)*

**Slug** : `admin_collecte_annulee`
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io`
**Déclencheur** : toute annulation de collecte (matrice §05 §9 — destinataire additionnel Admin). Envoyé en parallèle du template 5 client.
**Objet** : `[Admin] Collecte annulée — {{organisation_nom}} — {{date_collecte}}`

```
Hello les boss,

{{user_nom}} ({{user_role}}) a annulé la collecte {{type_collecte}} de {{organisation_nom}}{{#if nombre_pax}} ({{nombre_pax}} pax){{/if}} prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (« {{nom_evenement}} »){{/if}}.

— Délai avant le créneau : {{delai_avant_creneau}}
{{#if motif}}— Motif : {{motif}}{{/if}}
{{#if info_facturation}}— Facturation : {{info_facturation}}{{/if}}

L'annulation est transmise automatiquement au prestataire logistique ; si la tournée était déjà partie chez le transporteur, vérifiez qu'il est prévenu.

{{#if annulation_tardive}}
**Annulation tardive (moins de 4 h avant le créneau).** En Zéro Déchet, la collecte reste due : facture à faire à la main. En Anti-Gaspi, un crédit du pack a été décompté automatiquement.
{{/if}}

[Bouton : Voir la collecte dans le back-office]

L'équipe Savr
```

**Variables** : `organisation_nom`, `date_collecte` (JJ/MM/AAAA), `user_nom` (prénom et nom de l'auteur ; libellé de son rôle s'il est introuvable), `user_role` (libellé lisible du rôle), `type_collecte` (libellé), `delai_avant_creneau` (« moins de 4 h » / « 4 h ou plus », jugé à l'heure de la demande pour une demande confirmée par l'Admin), `lien_backoffice`, + facultatives `nombre_pax` (addendum A3, omis si inconnu), `heure_collecte`, `lieu_nom`, `nom_evenement`, `motif` (motif du client, jamais le texte de l'Admin pour forcer le statut), `info_facturation`, `annulation_tardive` (bool). `collecte_ref` retirée. *(Revue des emails, Val 2026-10-29.)*

**Phrase Anti-Gaspi du bloc `annulation_tardive`** (point ouvert 1, tranché Val 2026-11-02) : « un crédit du pack a été décompté » n'est écrite que si la collecte est rattachée à un pack (crédit débité à la programmation, qui reste acquis) ; sans pack, la phrase indique que la collecte Anti-Gaspi sera facturée à l'unité. Le moteur n'imbrique pas les blocs `{{#if}}` : la phrase est choisie par l'appelant (dette code : le gabarit en base affirme toujours le décompte).

---

## 23. Email infos d'accès chauffeur *(ajout 2026-07-15, divergence PLAQUES — réintroduction V1)*

**Slug** : `infos_acces_collecte`
**Destinataire** : le programmateur de l'événement (`evenements.created_by`)
**Déclencheur** : complétude des infos d'accès chauffeur **par tournée** sur une collecte `controle_acces_requis = true` — les `nb_camions_demande` tournées ont chacune nom + téléphone chauffeur renseignés (**saisie Admin en V1**, RPC `fn_infos_acces_marquer_si_complet`). Anti-double-envoi = stamp `collectes.infos_acces_email_envoye_at` (dédup R22a). Remplace l'ex-template `plaque_chauffeur` (retiré Q10 M05).
**Email non remis** *(ajout 2026-10-08, décision Val)* : si l'email est perdu (4e tentative en échec, ou refus de la messagerie du programmateur), le stamp est retiré, la collecte revient dans la tuile « Infos accès à envoyer » et une alerte in-app `infos_acces_email_non_remis` pointe la fiche collecte. Sans attendre l'échec final (25 h après le premier essai), cette alerte est ouverte dès 2 tentatives en échec si la collecte a lieu dans les 24 h. Elle est close automatiquement si l'email finit par partir. **Renvoi manuel** : bouton « Renvoyer l'email » de la fiche collecte Admin — email non remis, ou coordonnées changées depuis l'envoi ; refusé pendant une reprise automatique.
**Objet** : Accès chauffeur pour votre collecte du {{date_collecte}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Voici le nom et le téléphone du ou des chauffeurs qui interviendront sur votre événement{{#if evenement_nom}} « {{evenement_nom}} »{{/if}}, le **{{date_collecte}}** à **{{heure_collecte}}**{{#if lieu_nom}}, {{lieu_nom}}{{/if}}{{#if lieu_adresse}} ({{lieu_adresse}}){{/if}}.

{{chauffeurs_bloc}}

Si ces informations changent, nous vous enverrons un nouvel email.

L'équipe Savr
```

**Variables** : `date_collecte` (JJ/MM/AAAA), `heure_collecte` (HH:MM), `chauffeurs_bloc` (bloc HTML pré-rendu côté TS — un bloc par tournée : nom, téléphone et plaque du chauffeur, + accompagnant si renseigné ; `interpolate()` ne boucle pas), + conditionnelles `prenom`, `evenement_nom`, `lieu_nom`, `lieu_adresse` (adresse d'accès, code postal et ville, relus côté serveur ; à défaut, l'adresse d'accès seule). **Vouvoiement, 0 emoji, signature « L'équipe Savr ».** *(Revue des emails, Val 2026-10-29 ; addendum A6 : phrase « service d'accueil ou de sécurité » retirée, bloc chauffeurs gardé.)*

---

## 24. Email Admin — Demande d'annulation à traiter *(régularisation, revue des emails, Val 2026-10-29)* **Désactivé (annulation cliente directe, Val 2026-11-02)**

**Slug** : `admin_demande_annulation` *(gabarit en base depuis M3.1 2026-06-17, jamais décrit ici)*
**Destinataire** : boîte de contact de l'équipe Savr `contact@gosavr.io`
**Déclencheur** : un traiteur, une agence ou un gestionnaire de lieux demande l'annulation d'une collecte déjà validée (passage en `annulation_demandee`).
**Objet** : `[Admin] Demande d'annulation à traiter — {{organisation_nom}} — {{date_collecte}}`

```
Hello les boss,

{{demandeur_nom}} ({{organisation_nom}}) demande l'annulation de la collecte{{#if nombre_pax}} pour {{nombre_pax}} pax{{/if}} prévue le {{date_collecte}}{{#if heure_collecte}} à {{heure_collecte}}{{/if}}{{#if lieu_nom}} au {{lieu_nom}}{{/if}}{{#if nom_evenement}} (« {{nom_evenement}} »){{/if}}.

Cette collecte est déjà validée : elle reste prévue tant que vous n'avez pas confirmé l'annulation.

{{#if motif}}
Motif indiqué : {{motif}}
{{/if}}

Confirmez ou refusez la demande depuis la fiche de la collecte. Pour savoir si l'annulation est tardive (moins de 4 h), c'est l'heure de cette demande qui compte, pas celle de votre confirmation.

{{#if lien_backoffice}}
[Bouton : Traiter la demande]
{{/if}}

L'équipe Savr
```

**Variables** : `organisation_nom`, `date_collecte` (JJ/MM/AAAA), `demandeur_nom`, + facultatives `nombre_pax` (addendum A3, omis si inconnu), `heure_collecte`, `lieu_nom`, `nom_evenement`, `motif`, `lien_backoffice` (fiche Admin de la collecte). *(Formule d'appel « Hello les boss, » : addendum A2, Val 2026-10-29.)*

---

## 25. Email SIRET non vérifié *(régularisation, revue des emails, Val 2026-10-29)*

**Slug** : `siret_verification_echec`
**Destinataire** : le premier utilisateur créé de l'organisation
**Déclencheur** : la revalidation planifiée du SIRET d'une entité de facturation le trouve inexistant ou inactif à l'INSEE.
**Objet** : Votre numéro SIRET n'a pas pu être vérifié

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Nous avons vérifié auprès de l'INSEE le numéro SIRET {{siret}} renseigné pour {{organisation_nom}}. Il y apparaît comme inexistant ou inactif.

Pouvez-vous le vérifier et le corriger si besoin dans votre espace, rubrique « Mon organisation » ? Il figure sur vos rapports de don et vos factures : il doit être exact. Vos collectes ne sont pas bloquées en attendant.

{{#if lien_organisation}}
[Bouton : Vérifier mon SIRET]
{{/if}}

Si le numéro est correct, répondez-nous à contact@gosavr.io : nous vérifierons de notre côté.

Merci,
L'équipe Savr
```

**Variables** : `siret`, `organisation_nom` (raison sociale de l'entité de facturation), + facultatives `prenom`, `lien_organisation` (page « Paramètres > Organisation » de l'espace du destinataire). *(Le texte en base dit encore « rubrique « Mon organisation » » : la rubrique s'appelle « Paramètres > Organisation » depuis le 2026-10-31 — dette code, retoucher le gabarit.)*

---

## 26. Email rapport de don disponible *(régularisation, revue des emails, Val 2026-10-29)*

**Slug** : `attestation_don_disponible`
**Destinataire** : `organisations.email_principal` de l'organisation programmatrice (décision Val 2026-09-14)
**Déclencheur** : clôture de la collecte AG (48 h après la collecte) dont le rapport de don est émis, ou émission du rapport de don après la clôture ; un seul envoi par collecte (décision Val 2026-11-04). Même règle pour l'email 6 `rapport_disponible` (ZD, bordereau émis).
**Objet** : Votre rapport de don est disponible — {{nom_evenement}}

```
Bonjour{{#if prenom}} {{prenom}}{{/if}},

Les repas non servis de votre événement « {{nom_evenement}} » du {{date_evenement}} ont bien été donnés{{#if association_nom}} à l'association {{association_nom}}{{/if}}{{#if nb_repas}}, soit environ {{nb_repas}} repas{{/if}}. Merci pour ce geste !

Le rapport de don est prêt. Vous pouvez le consulter et le télécharger en PDF depuis votre espace.

[Bouton : Voir le rapport de don]

Belle suite,
L'équipe Savr
```

**Variables** : `nom_evenement` (« Votre événement » si l'événement n'a pas de nom), `date_evenement`, `lien_rapport` (fiche collecte de l'espace du programmeur), + facultatives `prenom` (prénom du programmeur s'il appartient à l'organisation destinataire), `association_nom`, `nb_repas` (repas réellement donnés, s'il y en a au moins un).

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
  1. `bienvenue` · 3. `collecte_programmee` · 4. `collecte_modifiee` · 5. `collecte_annulee` · 6. `rapport_disponible` · 9. `admin_pack_ag_etat` *(fusion bas+épuisé)* · 10. `admin_incident_collecte` · 11. `reset_password` · 12. `verification_email` · 13. `admin_demande_ajout_lieu` · 14. `admin_demande_renouvellement_pack` · 16. `ag_attribution_association` · 17. `invitation_utilisateur` · 18. `ag_attribution_transporteur` · 18ter. `ag_a_toutes_indispo` · 19. `admin_modification_collecte_traiteur` · 20. `admin_demande_annulation` *(ajouté M3.1 2026-06-17 ; **désactivé** le 2026-11-02 — `actif = false`, ligne conservée au seed : plus envoyé depuis l'annulation cliente directe, l'Admin est prévenu par `admin_collecte_annulee`, décision Val 2026-11-01/02)*. **Total réel = 20 slugs actifs** (vérifier SELECT count(*) WHERE actif=true en dev).
- **+1 template ajouté au catalogue 2026-09-14 (régularisation, divergence M2.4)** : `attestation_don_disponible` — existait en base et était envoyé par le batch AG J+1 sans figurer dans ce catalogue. **Destinataire tranché Val 2026-09-14 : `organisations.email_principal` de l'organisation programmatrice**, par symétrie avec `rapport_disponible` (le batch lisait `evenements.contact_principal_email`, colonne inexistante → destinataire vide → **aucune attestation n'a jamais été envoyée**, sans trace). Déclencheur : émission de l'attestation de don AG au batch J+1 6h (depuis le 2026-11-04 : envoi unique à la clôture de la collecte, 48 h après, cf. §26). **Texte (décision Val 2026-10-13, document nommé « Rapport de don ») — remplacé par le §26 (revue des emails, Val 2026-10-29) ; ancien texte pour mémoire** — objet : « Votre rapport de don est disponible — {{nom_evenement}} » ; corps : « Bonjour {{prenom}}, » (prénom du programmeur s'il appartient à l'organisation destinataire ; « Bonjour, » sinon) / « Le rapport de don de votre événement « {{nom_evenement}} » du {{date_evenement}} est prêt. » / « Vous pouvez le consulter et le télécharger en PDF directement depuis votre espace. » / bouton « Voir le rapport de don » vers {{lien_rapport}} (fiche collecte de l'espace du programmeur) / « Belle suite, L'équipe Savr ». Variables exigées : `nom_evenement` (« Votre événement » si l'événement n'a pas de nom), `date_evenement`, `lien_rapport` ; `prenom` facultatif. L'ancien gabarit exigeait `prenom`, `association_nom` et `lien_pdf`, que le batch ne fournissait pas : aucun de ces emails n'était parti.
  - **Slots retirés** : 2 (`completion_profil_requise`, A2) · 7 (`plaque_chauffeur`) · 8 (`admin_orga_a_valider`, A3) · 14bis (`admin_pack_epuise`, fusionné → 9) · 15 (`facture_relance`) · 18bis (`ag_recalcul_branche`).
- **+3 templates ajoutés 2026-06-07 (F2 tranchée Val, session test-scenarios)** : 20. `collecte_programmee_tiers` · 21. `collecte_modifiee_tiers` *(modification + annulation par tiers, variable `type_changement`)* · 22. `admin_collecte_annulee`. Ils soldent l'écart matrice §05 §9 (règle 2026-05-07 tiers + destinataire Admin annulation) ↔ templates. **Total V1 = 19 templates actifs.**
- **+1 template ajouté 2026-07-15 (divergence PLAQUES, décision Val)** : 23. `infos_acces_collecte` — réintroduction V1 de la notification client des infos d'accès chauffeur (nom + téléphone + accompagnant), déclenchée à complétude par tournée, destinataire `evenements.created_by`. **Total V1 = 21 templates actifs** (20 slugs seed listés + `infos_acces_collecte`). *(NB : le compteur historique « 19 » ci-dessus est un résidu non recompté ; le seed §tests liste 20 slugs → 21 après ajout. Recompter en dev via `SELECT count(*) WHERE actif=true`.)*
- **Recompte 2026-11-02 (annulation cliente directe, décision Val)** : `admin_demande_annulation` est **désactivé** (`actif = false`, ligne conservée). Le seed réel porte 22 slugs actifs avant cette décision (les 21 ci-dessus + `attestation_don_disponible`, régularisé le 2026-09-14 — l'écart 19 / 20 / 21 / 22 des compteurs successifs venait de recomptes partiels). **Total V1 = 21 templates actifs** (22 − 1), liste exacte : scénario `seed_templates_complet_et_exact` (tests §06.02). *(Compteur remplacé par le catalogue ci-dessous.)*
- **Catalogue après la revue des emails (Val 2026-10-26 → 29, migrations `20261029150000` et `20261029200000`), l'annulation cliente directe (Val 2026-11-02) puis l'envoi par Resend de « mot de passe oublié » (Val 2026-11-06, migration `20261106200000`) — fait foi, remplace les listes et compteurs ci-dessus. Total V1 = 19 gabarits actifs, 14 désactivés (33 lignes en base)** : `admin_collecte_annulee` (22) · `admin_demande_ajout_lieu` (13) · `admin_demande_renouvellement_pack` (14) · `admin_incident_collecte` (10) · `admin_modification_collecte_traiteur` (19) · `admin_pack_ag_etat` (9) · `ag_attribution_association` (16) · `annulation_collecte` (5) · `attestation_don_disponible` (26) · `bienvenue_organisation` (1) · `collecte_modifiee_tiers` (21) · `collecte_programmee` (3) · `collecte_programmee_tiers` (20) · `infos_acces_collecte` (23) · `invitation_utilisateur` (17) · `rapport_disponible` (6) · `reset_password` (11) · `siret_verification_echec` (25) · `verification_email` (12).
  - **14 gabarits désactivés** (`actif = false`, lignes conservées, migrations non destructives ; un gabarit inactif n'est plus envoyé) : `admin_demande_annulation` (24 — annulation cliente directe, Val 2026-11-02) · `ag_attribution_transporteur` (18 — la mission arrive au transporteur par l'outil du prestataire logistique ou par l'équipe Savr, décision Val 2026-10-28) · `ag_a_toutes_indispo` (18ter) · et 11 lignes de seed qu'aucun code n'envoie, absentes de ce catalogue : `alerte_ops_collecte_non_transmise`, `alerte_ops_pesee_anormale`, `attribution_association`, `attribution_transporteur`, `avoir_emis`, `collecte_realisee`, `confirmation_collecte`, `facture_emise`, `facture_relance_j15`, `pack_ag_active`, `rappel_collecte_j3`.
  - Slugs anciens du catalogue sans ligne en base : `bienvenue` (= `bienvenue_organisation`), `collecte_annulee` (= `annulation_collecte`). `collecte_modifiee` (§4) est retiré du catalogue (aucun gabarit, jamais envoyé — Val 2026-11-02).
  - Les destinataires « tous les `admin_savr` » des templates 9, 10, 13, 14, 22 et 24 se lisent « boîte de contact `contact@gosavr.io` » (comme le template 19, décision Val 2026-10-08).
  - Verrou pgTAP `supabase/tests/email_templates_catalogue_revue.test.sql` : écrit pour 19 actifs / 14 inactifs (revue des emails) ; il compte 19 actifs / 14 inactifs (désactivation d'`admin_demande_annulation`, puis réactivation de `reset_password`, migration `20261106200000`).

## Questions ouvertes

1. **Tranchée 2026-05-29 (Val) : signature générique "L'équipe Savr"** (conforme à la convention transverse en tête de document). Aucun mapping référent↔organisation n'existe en V1 ; une signature nominative imposerait ce mapping + sa maintenance pour un gain faible. Signature nominative reportée V2 si une logique de référent dédié est introduite.
2. **Anglais** : traduction EN de tous les templates pour gestionnaires anglophones V1 ou V1.1 ?
3. **Envoi automatique factures par email** : hors scope V1 acté, à trancher pour V1.1
4. **Template pour clients finaux (profil 6)** : mail de bienvenue spécifique lors de l'activation du rattachement à un événement ?
