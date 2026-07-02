# 06.01 - Formulaire de programmation de collecte


---

## Contexte

Formulaire central de la Plateforme Savr. **Refonte 2026-05-21 — formulaire unique événement-centré** : un seul formulaire crée un **événement** puis, dans la même passe, une ou deux collectes (Zéro-Déchet et/ou Anti-Gaspi). Remplace l'ancien pattern à 2 boutons (ZD / AG) avec saisie séquentielle et rattachement automatique par matching textuel.

Utilisé par les 3 types d'organisations programmatrices :

- `traiteur_commercial`, `traiteur_manager` (programmation classique, traiteur=opérationnel)
- `agence` (programmation pour le compte d'un traiteur identifié, périmètre ouvert traiteur+lieu)
- `gestionnaire_lieux` (programmation sur ses propres lieux, pour un traiteur du référentiel Savr)
- `admin_savr` (programmation de support, tous périmètres)

Les **clients finaux** n'accèdent pas au formulaire (lecture seule).

Bloqué si l'organisation programmatrice n'a pas complété ses infos de facturation — règle bloquante identique pour les 3 types (voir [[05 - Règles métier#8. Onboarding]]).

**Langue V1** : français uniquement. Anglais reporté en V1.1 ou V2 selon besoins Sodexo Live.

---

## Modèle conceptuel : événement → collectes

Le traiteur raisonne en **événement** (un gala, un mariage, un sommet). Un événement physique peut nécessiter :

- une collecte **Zéro-Déchet** (pesées des déchets triés),
- une collecte **Anti-Gaspi** (don des excédents alimentaires),
- ou les deux.

**1 événement (`evenements`) → N collectes (`collectes`).** La table `evenements` est centrale ; les collectes lui sont rattachées explicitement via `collectes.evenement_id` (refonte 2026-05-21 — fin du rattachement par matching date+lieu+client, source de doublons).

**Une seule date : la date de collecte (refonte 2026-05-29)** :

- **Date + heure de collecte** (`collectes.date_collecte` + `collectes.heure_collecte`) : moment où le prestataire intervient. C'est la vérité logistique transmise au TMS et **l'unique date saisie par l'utilisateur**. Chaque collecte porte la sienne.
- `evenements.date_evenement` : champ **backend uniquement**, auto-calculé = `MIN(collectes.date_collecte)` de l'événement (trigger `fn_set_date_evenement`). Jamais affiché dans les formulaires. Sert de référence pour les rapports PDF client (§12).

**Retiré V1 (2026-05-29)** — le pax reste **unique au niveau événement** (`evenements.pax`), non modifiable par collecte. Le cas multi-jours à pax variable est reporté V2.

---

## Nouveau pattern V1 (refonte 2026-05-21)

1. **Point d'entrée unique** : bouton **"Programmer une collecte"** sur la page d'accueil **(refonte 2026-05-29 — anciennement "Programmer un événement")** — le concept exposé à l'utilisateur est la collecte, pas l'événement (conteneur purement technique).
2. **Formulaire en 3 étapes** :
   - **Étape 1 — Événement** : infos événement + choix du ou des types de collecte (☐ Zéro-Déchet ☐ Anti-Gaspi, au moins un coché).
   - **Étape 2 — Lieu, contacts, contrôle d'accès** : communs à l'événement (saisis une fois, hérités par toutes les collectes).
   - **Étape 3 — Spécificités par collecte + récapitulatif** : pour chaque type coché, sa date+heure de collecte et ses informations propres, puis récap et confirmation.
3. **Une soumission crée l'événement + 1 ou 2 collectes** (selon les types cochés), avec un appel webhook E1 `POST /collectes` par collecte vers le TMS.
4. **Ajout ultérieur** : une collecte peut être ajoutée à un événement existant après coup (cas ZD aujourd'hui, AG la semaine suivante) — voir §"Ajouter une collecte à un événement existant". *(Le cas « camion supplémentaire » est retiré — multi-camions interne TMS, révisé 2026-05-25 Sujet 1.)*

---

## Étape 1 — Informations événement

| #   | Champ                                     | Obligatoire | Composant                                           | Règle                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------- | ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Nom du client final** (= nom événement) | Oui         | Input text libre                                    | Ex: "Gala LVMH", "Mariage Dupont", "Sommet européen Dalloyau". Sert aussi de nom événement dans l'historique et les rapports.                                                                                                                                                  |
| 2   | **Nombre de pax**                         | Oui         | Input number                                        | ≥ 1. Pax par défaut de l'événement (repris en étape 3, modifiable par collecte si pax varie jour à jour). Base de la tarification ZD et du calcul auto **backend invisible** du volume AG (10% du pax — sert uniquement à l'algo d'attribution association, pas affiché côté traiteur).                                                                                            |
| 3   | **Type d'événement**                      | Oui         | Select (depuis `types_evenements`)                  | 4 catégories de **format de service** : Cocktail apéritif, Cocktail repas complet, Repas assis, Autre. **Refonte Sujet 4 (2026-05-26)** : « Autre » est une simple catégorie fourre-tout sélectionnable — **plus de champ texte libre ni de notification de normalisation** (`type_evenement_libre` + `R_type_evenement_libre` retirés V1). Le type ne porte plus de nombre ; la **taille** se dérive du `pax` (`taille_evenement_bracket()`). Référentiel extensible par ajout direct de ligne (Admin/Supabase).                            |
| 4   | **Référence client**                      | Non         | Input text libre                                    | Référence interne client (ex: numéro d'affaire Potel & Chabot). Reportée sur la facture Pennylane (champ "Référence") et sur le PDF Savr. → `evenements.reference_affaire`                                                                                                     |
| -   | Logo du client final                      | Non         | Upload image (JPG/PNG, max 2 Mo)                    | Logo affiché dans le rapport de recyclage PDF. Si le client final a un compte Savr avec logo renseigné (`organisations.logo_url`), ce logo prime automatiquement.                                                                                                              |

> **Refonte 2026-05-29** : plus de "Date de l'événement" en étape 1. La date est saisie **par collecte en étape 3** (champ `date_collecte`, obligatoire, sans défaut). `evenements.date_evenement` est auto-calculé en backend = `MIN(date_collecte)` des collectes de l'événement.

### Choix du ou des types de collecte (NOUVEAU 2026-05-21)

| Champ | Obligatoire | Composant | Règle |
| ----- | ----------- | --------- | ----- |
| **Type(s) de collecte** | Oui (au moins un) | 2 cases à cocher | ☐ **Zéro-Déchet** ☐ **Anti-Gaspi**. Au moins une cochée. Détermine les sous-blocs de spécificités affichés en étape 3. Si Anti-Gaspi coché → vérification pack AG actif (voir §"Sélection pack AG"). |

**Cas Agence / Gestionnaire de lieux** : le sélecteur "Traiteur opérant" apparaît ici (voir §"Cas Agence" et §"Cas Gestionnaire de lieux" ci-dessous).

**Action** : bouton "Continuer" → sauvegarde brouillon + étape 2.

---

## Étape 2 — Lieu, contacts et contrôle d'accès (niveau événement)

Ces informations sont **communes à l'événement** : saisies une fois, héritées par toutes les collectes générées (refonte 2026-05-21).

### 2.a — Lieu

| Champ | Obligatoire | Composant                                        | Règle                                                |
| ----- | ----------- | ------------------------------------------------ | ---------------------------------------------------- |
| Lieu  | Oui         | Combobox autocomplete sur le référentiel `lieux` | Recherche sur nom + adresse. Liste filtrée selon RLS |

**Cas "lieu hors référentiel"** : si le lieu cherché n'existe pas, l'utilisateur clique sur "Ajouter ce lieu manuellement" et remplit :

| Champ (saisie manuelle)             | Obligatoire | Règle                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom du lieu                         | Oui         | Ex: "Château de Saint-Cloud"                                                                                                                                                                                                                                                    |
| **Adresse accès livraison**         | Oui         | **Renommé 2026-05-08** (ex "Adresse accès"). Adresse logistique unique (collecte/livraison). Champ DB `adresse_acces` inchangé.                                                                                                                                                 |
| Code postal                         | Oui         |                                                                                                                                                                                                                                                                                 |
| Ville                               | Oui         |                                                                                                                                                                                                                                                                                 |
| **Stationnement**                   | Non         | **Refonte 2026-05-08** — Select enum (`facile` / `difficile` / `très difficile`).                                                                                                                                                                                               |
| **Type de véhicule max**            | Non         | **Refonte 2026-05-08** — Select enum (`vélo cargo` / `camionnette` / `fourgon` / `VUL` / `poids lourd`). Aligné sur enum véhicules transporteurs. Le lieu impose un max → tous les véhicules ≤ max sont compatibles (cf. [[05 - Règles métier#R_compatibilite_vehicule_lieu]]). |
| **Accès office**                    | Non         | **Refonte 2026-05-08** — Select enum (`facile` / `difficile` / `très difficile`).                                                                                                                                                                                               |

Le lieu saisi manuellement est créé avec `actif = false` côté référentiel : utilisable immédiatement pour les collectes en cours, puis validé/normalisé par l'Admin Savr en asynchrone (notification dédiée).

**Cas "lieu existant"** : à la sélection d'un lieu via la combobox, **tous les champs associés au lieu (sauf le nom du lieu) s'affichent en autocomplete pré-remplis et éditables**. Champs concernés : adresse accès livraison, code postal, ville, stationnement, type de véhicule max, accès office, contraintes horaires, flux acceptés (lecture/édition selon RLS).

**Champs admin/ops only NON visibles côté traiteur/agence/gestionnaire** : `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` (cf. [[05 - Règles métier#R_lieux_admin_only_fields]]).

Le **nom du lieu** reste figé (identifiant lieu). Tout autre champ modifié déclenche :

1. Stockage de la valeur saisie sur **chaque collecte courante** (`collectes.lieu_overrides` → utilisé immédiatement et transmis au TMS via E1).
2. **Notification Admin Savr** (signalement léger — le diff avant/après est lisible via `lieu_overrides` vs `lieux` officiel + tracé `audit_log`). Plus de table `lieux_modifications_en_attente` (supprimée — audit sobriété §04 2026-05-25 B1).
3. Le `lieux` officiel **n'est pas mis à jour** automatiquement (les autres programmeurs voient la valeur de référence) ; l'Admin l'édite ensuite directement dans le back-office lieux s'il juge la correction pérenne.

(Voir règle [[05 - Règles métier#R_lieu_modif_pending]].)

### 2.b — Contacts sur place

Référentiel autocomplete depuis `contacts_traiteurs` (scoped organisation). Niveau **événement** (`evenements.contact_principal_*` + `contact_secours_*`) — partagés par toutes les collectes.

| Champ             | Obligatoire | Composant                                                                              | Règle                               |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| Contact principal | Oui         | Combobox autocomplete (prenom + nom + téléphone) + option "Ajouter un nouveau contact" | Référentiel filtré par organisation |
| Contact secours   | Non         | Idem                                                                                   |                                     |

**Comportement "Ajouter un nouveau contact"** : sous-formulaire inline (prenom / nom / téléphone / fonction optionnelle) → enregistré dans `contacts_traiteurs` à la validation. Chaque sélection incrémente `contacts_traiteurs.utilise_nb_fois`.

### 2.c — Contrôle d'accès requis (plaque + nom chauffeur) — niveau événement

> **Refonte 2026-05-21** : le contrôle d'accès est désormais saisi **une fois au niveau événement** (le site exige plaque + nom chauffeur indépendamment du type de collecte ZD/AG). La valeur est **copiée sur chaque collecte générée** (`collectes.controle_acces_requis`). Modélisation plus juste : la contrainte vient du lieu/site, pas de la collecte.

**Contexte** : certains lieux (Viparis, sites VIP, sites sécurisés) exigent que la plaque du véhicule **et** le nom du chauffeur leur soient communiqués avant la livraison (contrôle SAS).

**Modèle** : flag `controle_acces_requis`.

- Source : `plateforme.lieux.controle_acces_requis_default` (booléen, défaut `false`).
- Pré-coché à la sélection du lieu, éditable. Copié à l'insertion de chaque collecte de l'événement (`COALESCE(saisie_evenement, lieux.controle_acces_requis_default)`).

**UX formulaire** :

> ☐ **Plaque d'immatriculation et nom du chauffeur requis pour ce lieu**
>
> Si coché, le prestataire devra communiquer la plaque + le nom du chauffeur via son portail dès qu'il aura assigné un chauffeur. Utilisé notamment pour les sites sécurisés (Viparis, etc.).
>
> Cocher cette case met à jour le référentiel du lieu pour les futures collectes (cascade upgrade-only).

**Règle de cascade lieu (R_controle_acces_cascade — upgrade-only)** :

- Traiteur **coche** alors que `lieux.controle_acces_requis_default = false` → **update lieu** à `true` (impacte tous les futurs traiteurs).
- Traiteur **décoche** alors que `lieux.controle_acces_requis_default = true` → **PAS d'update lieu** (les collectes de l'événement portent `false`, le lieu reste `true` pour les futurs). Downgrade = acte Admin uniquement.

**Cas vélo cargo A Toutes! (AG uniquement)** : si `controle_acces_requis = true` ET une collecte AG vélo cargo est générée (prestataire `integration_externe='everest'` + véhicule vélo cargo) → **message UX inline** sur le sous-bloc AG en étape 3 : "Vélo cargo — pas de plaque possible. La demande sera transmise mais le manager n'aura pas de plaque à saisir." Soumission autorisée. Côté TMS, le trigger `validate_tournee_controle_acces` autorise la validation via exception explicite sur le critère plaque (chauffeur reste obligatoire).

**Action** : bouton "Continuer" → étape 3.

---

## Étape 3 — Spécificités par collecte et récapitulatif

Pour **chaque type de collecte coché** en étape 1, un sous-bloc dédié est affiché. Une collecte distincte est créée par sous-bloc.

### 3.a — Sous-bloc commun à chaque collecte (ZD et AG)

| Champ | Obligatoire | Composant | Règle |
| ----- | ----------- | --------- | ----- |
| **Date de collecte** | Oui | Date picker | **Sans défaut (refonte 2026-05-29)** — saisie obligatoire, aucune valeur pré-remplie. (supprimé : `date_evenement` est désormais dérivé de cette date, pas l'inverse). ≥ aujourd'hui. Stockée dans `collectes.date_collecte`. |
| **Heure de collecte** | Oui | Time picker (pas de 15min) | Heure unique de présence prestataire (point fixe V1, pas de fenêtre). Stockée dans `collectes.heure_collecte`. Propre à chaque collecte. |
| **Informations supplémentaires concernant la collecte** | Non | Textarea (1000 car. max) | Texte libre, niveau **collecte**. Ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi". Stocké sur `collectes.informations_supplementaires`. Chaque collecte (ZD/AG) porte les siennes. |

**Visibilité aval des informations supplémentaires** :

- **Prestataire (manager + chauffeur)** : via webhook E1 (`POST /collectes`), affiché dans le TMS (M01, M03) et l'app mobile chauffeur (M05).
- **Admin Savr** : back-office.
- **Espace traiteur** : fiche collecte, modifiable post-programmation (cascade `PATCH /collectes/:id` E2 — voir [[04 - Espace client traiteur]]).
- **Pas visible** : Espace gestionnaire de lieu.

### 3.b — Sous-bloc spécifique Zéro-Déchet

Aucun champ ZD additionnel V1 au-delà du sous-bloc commun. Les flux sont peuplés à clôture via les pesées chauffeur (webhook S5 TMS), pas saisis en amont.

**Tarif non affiché dans le formulaire (décision Sujet 5, 2026-05-26)** : aucun montant ZD n'est présenté pendant la saisie ni au récapitulatif, pour réduire la friction au moment de programmer. Le tarif applicable (grille de base affectée à l'organisation `grilles_tarifaires_zd` × remises éligibles `tarifs_negocie`, cf. [[05 - Règles métier#Tarifs et remises — résolution du prix]]) est calculé en backend, puis communiqué **après confirmation** : dans l'email récap `collecte_programmee` ([[06 - Fonctionnalités détaillées/02 - Templates emails V1]]) et sur la facture.

> **Retiré V1 (Sujet 5, propagation 2026-05-26)** — contredisait le récap §3.d. Référence `tarifs_zd_par_gestionnaire` également obsolète (table remplacée par `tarifs_negocie` le 2026-04-28).

### 3.c — Sous-bloc spécifique Anti-Gaspi

| Champ | Obligatoire | Composant | Règle |
| ----- | --------- | --------- | ----- |
| Pack AG applicable | Auto | Affichage | Pack actif de l'orga programmatrice OU blocage si absent (voir §"Sélection pack AG"). |

**État du pack AG** : "Pack AG 50 crédits — il vous reste 12 crédits" ou (si pas de pack actif) blocage de la soumission AG.

> **Note** : le volume estimé de repas n'est pas saisi. Calculé en backend invisible `round(0.10 × evenements.pax)` à l'INSERT collecte AG, stocké dans `collectes.volume_estime_repas`, utilisé uniquement par l'algo d'attribution association (R_capacite_min_50pct). Le traiteur ne le voit jamais. Voir [[05 - Règles métier#R_volume_estime_ag_calcule]].

### 3.d — Récapitulatif et confirmation

Affichage fiche récap + bouton "Modifier" (retour étape 1 ou 2).

| Bloc récap                 | Contenu                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Client / Événement         | Nom du client final, pax, type, référence client. **Date de l'événement affichée uniquement si l'événement porte >1 collecte à dates différentes** (revue sobriété 2026-05-29, B1) — en mono-collecte `date_evenement = date_collecte`, l'afficher deux fois est redondant. |
| Lieu et contacts           | Lieu, adresses, contact principal, contact secours                                                     |
| Contrôle d'accès           | "Plaque + nom chauffeur requis" si `controle_acces_requis = true`, sinon ligne masquée                 |
| **Collecte Zéro-Déchet** (si cochée) | Date de collecte, heure de collecte, informations supplémentaires (masqué si vide), **tarif non affiché** (réduction friction — communiqué dans l'email récap après confirmation, cf. §3.b) |
| **Collecte Anti-Gaspi** (si cochée) | Date de collecte, heure de collecte, informations supplémentaires (masqué si vide), pack AG décompté |
| **Partage avec collègues** | Emails des collègues partagés (optionnel, voir §ci-dessous)                                            |

> **Note** : le récap distingue clairement la **date de l'événement** (bloc Client) des **dates de collecte** (par collecte) pour lever toute ambiguïté quand elles diffèrent.

### Section optionnelle — Partager avec un collègue → Reportée V1.1 *(audit sobriété §04 2026-05-25, A4)*

> ⚠ **Reportée V1.1 (A4 2026-05-25)** : le partage de collecte entre collègues (table `collecte_partages`) est retiré du périmètre V1 — le manager voit déjà toutes les collectes de l'organisation, le cas commercial↔commercial est marginal. Section non exposée au formulaire V1.

*(spec conservée pour réactivation V1.1)*

**Boutons** :

- "Enregistrer en brouillon" : statut `brouillon` (toutes collectes).
- "Confirmer la programmation" : statut `programmee` → création événement + collectes + envoi TMS + email récap.

> **Mention informative** sous le bouton de confirmation : "Toute collecte annulée à moins de 12h de l'heure de collecte donne lieu à facturation plein tarif — pour une collecte Anti-Gaspi sous pack, un crédit est décompté (cf. CGV)." (CGV acceptées à la création de compte.) *(Précision AG = débit crédit ajoutée 2026-06-07 — F2.)*

---

## Ajouter une collecte à un événement existant (NOUVEAU 2026-05-21)

Couvre le cas : ajouter l'autre type de collecte plus tard (ZD programmé aujourd'hui, AG la semaine suivante). **Retiré — Révisé 2026-05-25 (Sujet 1, option A)** : le gros volume nécessitant plusieurs camions est désormais géré **en interne par le TMS** (1 collecte ZD traiteur → N tournées prestataire, décidées par l'Admin Savr au dispatch) et ne crée plus de collectes ZD supplémentaires côté traiteur.

**Workflow** : depuis la fiche événement (page détail), bouton "Ajouter une collecte" → rouvre le formulaire avec le **niveau événement figé et pré-rempli** (client, date événement, pax, type d'événement, lieu, contacts, contrôle d'accès). L'utilisateur :

1. Choisit le type de collecte à ajouter (ZD ou AG).
2. Saisit le sous-bloc spécifique (date+heure de collecte, infos supplémentaires) — étape 3.
3. Confirme → création d'une nouvelle `collectes` rattachée à l'`evenement_id` existant + webhook E1.

**Rattachement explicite** : la nouvelle collecte pointe sur l'`evenement_id` (plus de matching textuel date+lieu+client, supprimé 2026-05-21). Zéro risque de doublon d'événement.

**Contrainte** : pas de doublon de type implicite — si l'événement a déjà une collecte AG, en ajouter une seconde reste possible (cas multi-points AG rare) mais l'UI avertit "Cet événement a déjà une collecte Anti-Gaspi. Confirmer l'ajout d'une seconde ?".

---

## Multi-camions (gros volume) — V1 manuel (décision 4a 2026-05-21) Multi-camions — **Révisé 2026-05-25 (Sujet 1, option A : interne TMS)**

> **Révision 2026-05-25 (Sujet 1, option A)** : la décision 4a (multi-camions = N collectes ZD rattachées à l'événement, agrégation niveau événement, saisie manuelle via "Ajouter une collecte") est **annulée**.
>
> **Modèle retenu** : le traiteur programme **une seule collecte ZD** (assiette pax, facturation traiteur, rapport, registre). Le dimensionnement en N camions est décidé par l'**Admin Savr au dispatch** avec le prestataire logistique et reste **interne au TMS** : `1 collecte ZD → N tournées` prestataire, rattachées au `collecte_id`. Les pesées des N camions sont **agrégées sous la collecte ZD** (webhook S5 agrège déjà par `collecte_tms_id`, cf. [[12 - Reporting et exports]]). La facturation prestataire (type de véhicule + nombre d'équipiers) est portée par les tournées TMS — **assiette distincte** de la facturation traiteur (pax). Plus aucune collecte ZD supplémentaire créée côté Plateforme.
>
> **Cross-CDC** : la cardinalité TMS `collecte → N tournées` (modèle actuel `collecte → 1 tournée`) doit être figée en session `cdc-tms-savr` dédiée. Contrat §08 S5 inchangé.

---

## Cas Agence (extension 2026-05-07, conservée)

Le sélecteur "Traiteur opérant" apparaît à l'étape 1 (bloc choix des types de collecte) :

| Champ | Obligatoire | Composant | Règle |
|-------|-------------|-----------|-------|
| Traiteur opérant | Oui | Combobox autocomplete sur référentiel traiteurs Savr (`organisations` `type='traiteur'` + filtre `est_shadow=false`) + option "Ajouter un traiteur hors référentiel" | L'agence programme pour le compte d'un traiteur identifié. Stocké sur `evenements.traiteur_operationnel_organisation_id`. |

**Sous-cas A — Traiteur référencé** : sélection dans la combobox → `evenements.traiteur_operationnel_organisation_id` pointe vers l'organisation traiteur existante.

**Sous-cas B — Traiteur hors référentiel (workflow shadow)** : si le traiteur cherché n'existe pas, "Ajouter un traiteur hors référentiel" → modal :

| Champ (saisie shadow) | Obligatoire | Règle |
|----------------------|-------------|-------|
| Nom commercial | Oui | Texte libre, 2 caractères min — persisté sur **`organisations.nom`** (pas de colonne `nom_commercial` sur `organisations`) |
| Raison sociale | Oui | Texte libre |
| SIRET | **Fortement recommandé** (non bloquant) | 14 chiffres, validation API INSEE/Sirene si saisi. **Alerte UX rouge si vide** : "Sans SIRET, le bordereau réglementaire ne pourra pas être généré et le traiteur opérationnel ne sera pas conforme aux obligations de traçabilité déchets." |

À validation : création d'une row `organisations` avec `type='traiteur'`, `est_shadow=true`, `cree_par_organisation_id = agence.organisation_id`. Pas de `users`, pas d'`entites_facturation`. **Notification Admin Savr = in-app uniquement** (code `shadow_traiteur_cree`, via `f_upsert_alerte_admin`, dédupliquée) — **aucun email** (décision F3 2026-06-07). Source de vérité adresse/SIRET = `entites_facturation` (non créée à ce stade) — pas de colonne `nom_commercial` ni `ville` sur `organisations`. *(correctif D2 2026-06-17)*

**Conséquences aval** : événement créé sur la fiche shadow ; bordereau ZD snapshote le shadow comme producteur (bloqué en `brouillon` si SIRET manquant) ; attestation de don AG snapshote l'**agence** comme donateur fiscal (programmateur=facturé) ; pack AG décompté = celui de l'agence.

---

## Cas Gestionnaire de lieux (2026-05-07, conservée)

Le sélecteur "Traiteur opérant" apparaît à l'étape 1 :

| Champ | Obligatoire | Composant | Règle |
|-------|-------------|-----------|-------|
| Traiteur opérant | Oui | Combobox autocomplete sur référentiel traiteurs Savr (`organisations` `type='traiteur'` + filtre `est_shadow=false`) | **Pas d'option "Ajouter un traiteur hors référentiel"** (différence avec l'agence). Restreint aux traiteurs référencés. |

**Périmètre lieu** : la combobox lieu §2.a est filtrée selon `organisations_lieux WHERE organisation_id = gestionnaire.organisation_id`. Le gestionnaire ne programme que sur ses propres lieux.

**Conséquences aval** : événement créé avec le traiteur opérationnel référencé ; notification email info-only au traiteur opérationnel ; bordereau ZD snapshote le traiteur opérationnel ; attestation de don AG snapshote le gestionnaire comme donateur fiscal ; pack AG décompté = celui du gestionnaire.

---

## Sélection pack AG (3 types, conservée)

Si la case **Anti-Gaspi** est cochée en étape 1, le formulaire vérifie l'existence d'un pack AG actif sur l'organisation programmatrice (`packs_antgaspi WHERE organisation_id = organisation_programmatrice.id AND statut = 'actif'`). Règle identique pour les 3 types :

- **0 pack actif** : alerte bloquante "Vous n'avez pas de pack Anti-Gaspi actif. Contactez Savr pour en négocier un." → **blocage de la collecte AG uniquement**. La collecte ZD (si cochée) reste programmable (grille tarifaire publique). **Moment du blocage (tranché Val 2026-06-07 — test scenarios F5)** : la vérification a lieu **à la coche de la case Anti-Gaspi en étape 1** — la case n'est pas validable (alerte inline), l'utilisateur la décoche pour poursuivre en ZD seule. Aucune soumission partielle implicite (pas de récap avec AG ignorée silencieusement).
- **1 pack actif** : sélection automatique, indicateur "X crédits restants sur Y".

> **Retiré (revue sobriété 2026-05-29, A1)** — cas impossible par construction : l'unicité du pack actif est garantie au niveau DB par le partial unique index `uniq_pack_actif_par_org` (cf. [[05 - Règles métier#Règle V1 — Pack unique actif refonte 2026-05-08]] + [[04 - Data Model]]). Une organisation a **au plus un** pack `statut='actif'`. Deux cas seulement : 0 (blocage) ou 1 (auto-sélection).

**Déclenchement décompte** : à la transition `collectes.statut → 'realisee'` OU à l'**annulation tardive** (< 12h avant l'heure de collecte ou après mandat prestataire — trigger `trg_pack_debit_annulation_tardive`, ajout 2026-06-07 F2 ; cf. §05 §3 Packs AG « Débit d'un crédit »). L'organisation décomptée est `evenements.organisation_id` (programmateur).

---

## Logique métier annexe

### Sauvegarde brouillon

- Sauvegarde **manuelle** via le bouton "Enregistrer en brouillon" (étape 1, 2 et 3). **Retiré V1 (revue sobriété 2026-05-29, A2)** — l'autosave debounced (gestion de conflit + reprise d'état partiel multi-collectes) est du confort disproportionné pour un formulaire rempli en une passe. Le bouton manuel couvre le besoin. Autosave reportable V1.1 si retour terrain.
- Brouillon récupérable depuis la liste des collectes (filtre "Brouillons"). Un brouillon d'événement multi-collectes est repris dans son état complet (étapes + types cochés).
- Suppression manuelle par l'utilisateur ("Supprimer ce brouillon"). Pas de suppression automatique par ancienneté V1.

### Validations bloquantes (à la confirmation)

- Pax ≥ 1
- **Retiré (revue sobriété 2026-05-29, C1)** — `date_evenement` n'est plus saisie (dérivée de `MIN(date_collecte)`). La contrainte est portée par la validation "date de collecte ≥ aujourd'hui" ci-dessous.
- Au moins un type de collecte coché (ZD et/ou AG)
- Nom du client renseigné
- Type d'événement sélectionné (catégorie parmi les 4 ; **plus de texte libre obligatoire pour "Autre"** — corrigé revue sobriété 2026-05-29, C2, alignement Sujet 4 2026-05-26)
- Lieu sélectionné (référentiel ou manuel complet)
- Contact principal renseigné
- **Pour chaque collecte** : date de collecte ≥ aujourd'hui + heure de collecte renseignée
- Si AG coché : pack AG actif (sinon blocage AG seul)

### Champs non bloquants (marquage "Info incomplète")

Soumission possible sans ces champs ; au moins un manquant → `collectes.informations_completes = false` + badge "Info incomplète" back-office Admin :

- Numéro de téléphone contact traiteur / contact lieu
- Nom du contact sur le lieu
- Instructions d'accès spécifiques au lieu
- Logo du client final
- Référence client
- Informations supplémentaires concernant la collecte

**Justification** : le traiteur n'a pas toujours ces infos à la programmation (souvent plusieurs semaines avant). Bloquer créerait une friction opérationnelle.

### Validations non bloquantes (warnings inline)

- Date de collecte dans les 48h → "Attention, vous programmez à moins de 48h. La disponibilité du prestataire n'est pas garantie."
  - **Pas de délai minimum bloquant V1 (tranché Val 2026-06-10, challenge logistique — ne pas re-proposer)** : une collecte peut être programmée à n'importe quelle échéance, y compris < 1h. Le filet assumé est **l'acceptation explicite** (la collecte reste `programmee`/`attribuee_en_attente_acceptation` tant que le transporteur n'a pas confirmé — jamais d'acceptation par délai, cf. [[../08 - APIs et intégrations]] §3) + le **monitoring Admin des collectes non confirmées** (§06.06) pour relance Ops. La latence outbox (worker 15 min) est couverte par ce même filet.
- **Retiré (refonte 2026-05-29)** : `date_evenement` est auto-dérivé, plus de divergence à signaler. L'info "collecte le lendemain" est implicitement correcte (le programmeur saisit directement la bonne date de collecte).
- Champs non bloquants vides → "Certaines informations ne sont pas encore renseignées. Vous pourrez les compléter plus tard depuis votre espace."

---

## Wireframe textuel (vue desktop) — refonte 2026-05-21, màj 2026-05-29

```
┌─────────────────────────────────────────────────────┐
│  Savr — Programmer une collecte                      │
├─────────────────────────────────────────────────────┤
│  Étape 1/3 — Informations événement                  │
│                                                      │
│  [ Nom du client final : ______________________ ]    │
│  (Agence/Gestionnaire) [ Traiteur opérant : ____ ▼ ] │
│  [ Pax : ___ ]                                       │
│  [ Type d'événement : Cocktail repas complet ▼ ]     │
│      (Cocktail apéritif / Cocktail repas complet /   │
│       Repas assis / Autre — pas de texte libre)      │
│  [ Référence client : _________________ ] (opt.)     │
│  [ Logo client (upload) ] (opt.)                     │
│   (Pas de "Date de l'événement" — dérivée backend)   │
│                                                      │
│  Type(s) de collecte pour cet événement :            │
│   ☐ Zéro-Déchet    ☐ Anti-Gaspi   (au moins un)      │
│                                                      │
│                    [ Enregistrer ]  [ Continuer ]    │
├─────────────────────────────────────────────────────┤
│  Étape 2/3 — Lieu, contacts, contrôle d'accès        │
│   (communs à l'événement)                            │
├─────────────────────────────────────────────────────┤
│  Étape 3/3 — Spécificités par collecte + récap       │
│   ┌ Collecte Zéro-Déchet ────────────────────┐       │
│   │ Date collecte __/__/__ (oblig., sans déf.)│       │
│   │ Heure __h__   Infos supplémentaires ...   │       │
│   └───────────────────────────────────────────┘       │
│   ┌ Collecte Anti-Gaspi ──────────────────────┐       │
│   │ Date collecte __/__/__   Heure __h__      │       │
│   │ Pack AG : 12 crédits restants             │       │
│   └───────────────────────────────────────────┘       │
│   [ Récapitulatif ]   [ Confirmer la programmation ] │
└─────────────────────────────────────────────────────┘
```

Responsive mobile : steps en single-column, sous-blocs collecte stacked, boutons stacked.

---

## Actions post-confirmation

1. Création `evenements` (1) avec `pax`, `type_evenement_id`, contacts, contrôle d'accès, traiteur opérationnel. `date_evenement` est auto-calculé par trigger après l'insertion des collectes.
2. Création de **N `collectes`** (1 par type coché), chacune avec son `date_collecte` + `heure_collecte` + `informations_supplementaires`, rattachées à l'`evenement_id` (rattachement explicite).
3. Copie de `controle_acces_requis` (niveau événement) sur chaque collecte.
4. Upsert des contacts saisis dans `contacts_traiteurs`.
5. Upsert du lieu saisi manuellement dans `lieux` (`actif = false`).
6. Si modifs lieu existantes : stockage dans `collectes.lieu_overrides` + notification Admin (signalement léger, plus de table `lieux_modifications_en_attente` — audit sobriété §04 2026-05-25 B1).
7. **Retiré V1 (propagation Sujet 4 — type vs taille, 2026-05-26)** — « Autre » est une catégorie sélectionnable sans saisie libre, aucune notification ni normalisation.
8. Si `controle_acces_requis = true` ET `lieux.controle_acces_requis_default = false` : update lieu à `true` (cascade upgrade-only).
9. **Pour chaque collecte** : envoi au TMS (webhook E1 `POST /collectes`) avec payload incluant `controle_acces_requis`, `date_collecte` (via `heure_collecte.date`) et `informations_supplementaires`.
10. Email récap au programmeur (un seul email couvrant l'événement et ses collectes — [[05 - Règles métier#9. Notifications V1]]).
11. Si AG : lancement algo attribution → notification Admin pour validation.
12. Si `controle_acces_requis = true` côté TMS : R_M04.CONTROLE_ACCES active.
13. Redirection vers la page détail de l'événement créé (depuis laquelle "Ajouter une collecte" est disponible).

---

## Décisions prises

- **Formulaire unique événement-centré (2026-05-21)** : un point d'entrée, étape 1 = événement + choix des types (☐ZD ☐AG), une soumission crée l'événement + 1-2 collectes. Remplace les 2 boutons + saisie séquentielle + matching textuel.
- **Rattachement explicite collecte→événement (2026-05-21)** : via `collectes.evenement_id`. Fin du matching date+lieu+client (source de doublons d'événements).
- **Date événement vs date collecte distinguées (2026-05-21, révisé 2026-05-29)** : `collectes.date_collecte` (vérité logistique, **saisie étape 3, sans défaut, obligatoire**) est la seule date saisie ; `evenements.date_evenement` est **auto-dérivé en backend** = `MIN(date_collecte)` (trigger `fn_set_date_evenement`), jamais saisi au formulaire. inversé par la refonte 2026-05-29. Heure de collecte propre à chaque collecte.
- **Contrôle d'accès niveau événement (2026-05-21)** : saisi une fois, copié sur chaque collecte (la contrainte vient du site, pas de la collecte). Cascade lieu upgrade-only conservée. Exception vélo cargo AG conservée.
- **Révisé 2026-05-25 (Sujet 1, option A)** : multi-camions interne au TMS — 1 collecte ZD traiteur → N tournées prestataire (Admin au dispatch), agrégation des pesées au niveau de la collecte ZD. Plus de collectes ZD multiples côté traiteur ni d'agrégation niveau événement.
- **Ajout d'une collecte à un événement existant (2026-05-21)** : bouton depuis la fiche événement, niveau événement pré-rempli figé.
- **3 étapes** : événement → lieu/contacts/contrôle d'accès → spécificités par collecte + récap.
- **Nom du client = nom de l'événement**.
- **Heure de collecte unique** (point fixe, pas de fenêtre, pas de 15 min) — par collecte.
- **Caduc (revue sobriété 2026-05-29, C3)** — "Autre" est une catégorie sèche sélectionnable depuis Sujet 4 (2026-05-26) : plus de texte libre ni de notification de normalisation.
- **Lieu hors référentiel autorisé** + validation Admin asynchrone.
- **Lieu existant éditable** (override collecte + patch en attente Admin, option C).
- **Contacts niveau événement** (autocomplete `contacts_traiteurs`).
- **Informations supplémentaires niveau collecte** (chaque collecte ZD/AG les siennes).
- **Volume AG = 10% pax** auto-calculé backend invisible.
- **Pack AG bloquant pour la collecte AG seule** (la ZD reste programmable).
- **Récap distinguant date événement et dates de collecte**.
- **Tarif ZD non affiché au formulaire (Sujet 5, 2026-05-26)** : aucun montant pendant la saisie ni au récap (réduction de friction). Le tarif applicable est calculé en backend et communiqué **après confirmation** (email récap `collecte_programmee` + facture). Option A retenue (Val). Lève la contradiction §3.b vs §3.d et solde la référence obsolète `tarifs_zd_par_gestionnaire` → `tarifs_negocie`. Question ouverte 5 (nom gestionnaire vs anonyme) rendue caduque.
- **Suppression case CGV** : couvertes à la création de compte.
- **Brouillon persistant** : suppression explicite par user.
- **FR uniquement V1**.
- **Agence (2026-05-07)** : "Traiteur opérant" + option shadow (alerte SIRET vide).
- **Gestionnaire de lieux (2026-05-07)** : "Traiteur opérant" sans option shadow, combobox lieu filtrée à son parc.
- **Duplication d'une collecte → V1.1 (2026-05-29)** : le bouton "Dupliquer" (pré-remplissage depuis une collecte passée) est reporté en V1.1. Confort, non bloquant ; le brouillon persistant couvre déjà la friction de saisie. Tranche la question ouverte 1.
- **Normalisation des lieux saisis manuellement = best-effort, pas de SLA formel (2026-05-29)** : un lieu hors référentiel est créé `actif = false` puis normalisé par l'Admin sans délai engagé (la collecte est programmée plusieurs jours à l'avance, la normalisation n'est pas bloquante). Aucun SLA contractuel à respecter en V1. Tranche la question ouverte 2.
- **Matching AG sans `contraintes_aliments` = géographie + capacité créneau uniquement (2026-05-29)** : l'algo d'attribution association ne s'appuie que sur la proximité géographique et la capacité de l'association sur le créneau. `contraintes_aliments` ayant été retiré volontairement (refonte 2026-05-03), aucun critère de type alimentaire n'est réintroduit (associations généralistes). Tranche la question ouverte 4. Cf. [[09 - Flux algo attribution AG (Admin)]].

---

## Questions ouvertes

1. **Tranchée 2026-05-29 (Val) : V1.1** — cf. Décisions prises.
2. **Tranchée 2026-05-29 (Val) : best-effort, pas de SLA formel** — cf. Décisions prises.
3. **Caduque 2026-05-29** : la table `lieux_modifications_en_attente` et son workflow d'approbation ont été supprimés (audit sobriété §04 2026-05-25 B1). Les modifs lieu passent désormais par un override per-collecte (`collectes.lieu_overrides`) + signalement Admin léger, sans machine à états ni SLA. Plus aucun workflow « en attente » à cadencer.
4. **Tranchée 2026-05-29 (Val) : géographie + capacité créneau uniquement** — cf. Décisions prises.
5. **Caduque — tranchée par Sujet 5 (2026-05-26, option A Val)** : le tarif ZD n'est plus affiché au formulaire, donc plus de mention de source ("tarif négocié {nom}") à exposer. L'email récap §06.02 affiche un montant brut sans préciser la source.
6. **Révisé 2026-05-25 (Sujet 1, option A)** : sans objet — multi-camions interne au TMS, une seule collecte ZD par programmation traiteur. L'alerte pesées (§12 §1.5) opère **par collecte** (les N camions sont agrégés sous la collecte ZD côté TMS avant remontée S5). Spec figée [[12 - Reporting et exports#1.5 Alerte pesées anormales (Admin Savr)]].

---

## Historique des décisions V1

| Date       | Décision                                                                                                  | Source                                |
| ---------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 2026-04-20 | V1 initiale du formulaire (Draft Claude)                                                                  | —                                     |
| 2026-04-24 | Suppression case "Recevoir plaque chauffeur" + email T+3h                                                  | Q10 M05                               |
| 2026-04-24 | Toggle "Plaque véhicule requise" niveau lieu (`lieux.plaque_requise_default`)                              | Q8.2 + propagation M03                |
| 2026-04-29 | Suppression "Flux attendus" + "Volume estimé par flux" en amont (peuplés via pesées chauffeur S5 TMS)     | Revue sobriété M05                    |
| 2026-04-29 | Heure de collecte = point fixe V1 (pas de fenêtre)                                                        | Revue sobriété                        |
| 2026-05-01 | Restauration toggle plaque (audit cohérence inter-CDC)                                                     | Audit cohérence run 4                 |
| 2026-05-03 | Refonte étape 1 (ordre + heure unique + type "Autre" libre)                                                | Refonte Val 2026-05-03                |
| 2026-05-03 | Lieu existant éditable + patch en attente Admin (option C)                                                 | Refonte Val 2026-05-03                |
| 2026-05-03 | Suppression `Horaire de l'événement`                                                                       | Refonte Val 2026-05-03                |
| 2026-05-03 | Suppression `Contraintes aliments` AG                                                                      | Refonte Val 2026-05-03                |
| 2026-05-03 | Renommage `plaque_requise` → `controle_acces_requis`                                                       | Refonte Val 2026-05-03                |
| 2026-05-03 | Cascade lieu upgrade-only                                                                                  | Refonte Val 2026-05-03                |
| 2026-05-03 | Récap allégé                                                                                               | Refonte Val 2026-05-03                |
| 2026-05-03 | Suppression case CGV                                                                                       | Refonte Val 2026-05-03                |
| 2026-05-06 | Tous les champs lieu (sauf nom) en autocomplete éditables                                                  | Refonte Val 2026-05-06                |
| 2026-05-06 | Ajout champ `Informations supplémentaires` (niveau collecte, propagé TMS E1)                               | Refonte Val 2026-05-06                |
| 2026-05-06 | Suppression Commentaire libre étape 1 (`evenements.notes_client` retiré)                                   | Refonte Val 2026-05-06                |
| 2026-05-07 | Ouverture programmation aux 3 types (traiteur + agence + gestionnaire), workflow shadow, pack AG 3 types   | Refonte Val 2026-05-07                |
| 2026-05-07 | Suppression saisie volume estimé AG (calcul backend invisible)                                             | Refonte back-office Val 2026-05-07    |
| **2026-05-21** | **Formulaire unique événement-centré** : 1 entrée, étape 1 = événement + ☐ZD ☐AG, 1 soumission crée événement + N collectes | **Refonte Val 2026-05-21 (D1)**       |
| **2026-05-21** | **Rattachement explicite `collectes.evenement_id`** (fin du matching textuel date+lieu+client)        | **Refonte Val 2026-05-21 (D1)**       |
| **2026-05-21** | **Date événement (`evenements.date_evenement`) distinguée de la date collecte (`collectes.date_collecte`, saisie étape 3, défaut = date événement)** | **Refonte Val 2026-05-21 (D2)**       |
| **2026-05-21** | **Contrôle d'accès saisi niveau événement, copié sur chaque collecte**                                | **Refonte Val 2026-05-21 (sous-arbitrage 2)** |
| **2026-05-21** | **Multi-camions = N collectes ZD / événement, agrégation niveau événement, saisie manuelle V1 (4a)** | **Refonte Val 2026-05-21 (D3 + 4a)**  |
| **2026-05-21** | **Ajout d'une collecte à un événement existant** (bouton fiche événement)                             | **Refonte Val 2026-05-21 (sous-arbitrage 1)** |
| **2026-05-25** | **Révision D3/4a — multi-camions interne TMS (option A)** : 1 collecte ZD traiteur → N tournées prestataire (Admin au dispatch), agrégation pesées niveau collecte ZD. Annule N collectes ZD niveau événement. | **Révision Val 2026-05-25 (Sujet 1)** |
| **2026-05-29** | **Retrait de l'override pax par collecte** : `collectes.pax_collecte` supprimé V1. Pax unique au niveau événement (`evenements.pax`). Cas multi-jours à pax variable reporté V2. Annule l'ajout du 2026-05-29 (même jour). | **Val 2026-05-29** |
| **2026-05-26** | **Tarif ZD non affiché au formulaire (Sujet 5, option A)** : alignement §3.b sur §3.d (non affiché, réduction friction). Tarif communiqué post-confirmation (email récap + facture). Question ouverte 5 caduque. Réf obsolète `tarifs_zd_par_gestionnaire` → `tarifs_negocie`. | **Sujet 5 — Val 2026-05-26** |
| **2026-05-29** | **Duplication de collecte → V1.1** (Q1). **Normalisation lieux saisis manuellement = best-effort sans SLA** (Q2). **Matching AG = géo + capacité créneau uniquement** (Q4). Q3 (SLA modifs lieu) caduque — workflow `lieux_modifications_en_attente` supprimé. | **Arbitrages micro-points — Val 2026-05-29** |
| **2026-05-29** | **Revue de sobriété §06.01** : A1 cas "N packs actifs" supprimé (impossible — index unique DB) · A2 autosave 30s retiré (sauvegarde manuelle V1) · B1 date événement au récap conditionnée (mono-collecte) · C1 validation "date événement ≥ aujourd'hui" retirée (champ dérivé) · C2 validation type "Autre" texte libre corrigée · C3 décision "Autre → notif Admin" caduque · C4 décision "date collecte défaut = date événement" réalignée · C5 wireframe màj. | **Revue sobriété — Val 2026-05-29** |
