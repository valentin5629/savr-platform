# 06.01 - Formulaire de programmation de collecte

**Statut** : Draft V1 (refonte formulaire unique événement-centré 2026-05-21)
**Dernière mise à jour** : 2026-05-29 (revue de sobriété — A1/A2/B1/C1-C5)

---

## Contexte

Formulaire central de la Plateforme Savr. **Refonte 2026-05-21 — formulaire unique événement-centré** : un seul formulaire crée un **événement** puis, dans la même passe, une ou deux collectes (Zéro-Déchet et/ou Anti-Gaspi). Remplace l'ancien pattern à 2 boutons (ZD / AG) avec saisie séquentielle et rattachement automatique par matching textuel.

Utilisé par les 3 types d'organisations programmatrices :

- `traiteur_commercial`, `traiteur_manager` (programmation classique, traiteur=opérationnel)
- `agence` (programmation pour le compte d'un traiteur identifié, périmètre ouvert traiteur+lieu)
- `gestionnaire_lieux` (programmation sur ses propres lieux, pour un traiteur du référentiel Savr)
- `admin_savr` **et `ops_savr`** (programmation de support, tous périmètres) *(ops_savr ajouté 2026-09-14 — alignement CDC ↔ production : les routes `/api/v1/programmation/*` (`requireProgrammateurOuAdmin`), le mode support du formulaire et le bouton « Programmer une collecte » de `/admin/collectes` l'autorisent depuis la PR #223 ; le middleware Next `src/middleware.ts` (`ROLE_PREFIXES` `/programmer`, `/brouillons`) est aligné en conséquence. Voir la matrice étendue §09.)*

**Menu affiché** *(décision Val 2026-10-07)* : celui de l'espace du rôle connecté, avec les mêmes entrées masquées que dans cet espace (ex. « Mon pack AG » du gestionnaire sans pack, §06.05). Le staff (`admin_savr`, `ops_savr`) y garde le menu du back-office.

Les **clients finaux** n'accèdent pas au formulaire (lecture seule).

Bloqué si l'organisation programmatrice n'a pas complété ses infos de facturation — règle bloquante identique pour les 3 types (voir [[05 - Règles métier#8. Onboarding]]).

**Langue V1** : français uniquement. Anglais reporté en V1.1 ou V2 selon besoins Sodexo Live.

---

## Modèle conceptuel : événement → collectes

Le traiteur raisonne en **événement** (un gala, un mariage, un sommet). Un événement physique peut nécessiter :

- une ou plusieurs collectes **Zéro-Déchet** (pesées des déchets triés),
- une ou plusieurs collectes **Anti-Gaspi** (don des excédents alimentaires),
- ou les deux — par exemple une collecte par soirée ou par espace. Le nombre de collectes de chaque type se choisit dès la programmation *(décision Val 2026-10-22)*.

**1 événement (`evenements`) → N collectes (`collectes`).** La table `evenements` est centrale ; les collectes lui sont rattachées explicitement via `collectes.evenement_id` (refonte 2026-05-21 — fin du rattachement par matching date+lieu+client, source de doublons).

**Une seule date : la date de collecte (refonte 2026-05-29)** :

- **Date + heure de collecte** (`collectes.date_collecte` + `collectes.heure_collecte`) : moment où le prestataire intervient. C'est la vérité logistique transmise au TMS et **l'unique date saisie par l'utilisateur**. Chaque collecte porte la sienne.
- `evenements.date_evenement` : champ **backend uniquement**, auto-calculé = `MIN(collectes.date_collecte)` de l'événement (trigger `fn_set_date_evenement`). Jamais saisi ; jamais affiché dans les formulaires, sauf en lecture seule dans le niveau événement figé de « Ajouter une collecte à un événement existant ». Sert de référence pour les rapports PDF client (§12).

**Pax porté par la collecte (décision Val 2026-10-20)** — chaque collecte porte son nombre de convives (`collectes.pax`), saisi avec sa date à l'étape 3 (§ 3.a). Le pax de l'événement (`evenements.pax`) n'est plus saisi : il est calculé depuis ses collectes, pour chaque jour de collecte, le plus grand des deux totaux du jour — somme des pax des collectes ZD non annulées, somme des pax des collectes AG non annulées —, puis la somme des jours (une ZD et une AG du même soir comptent une fois ; deux ZD ou deux AG du même jour s'additionnent ; deux soirées s'additionnent — règle révisée par Val le 2026-10-21). Annule le retrait du 2026-05-29 (pax unique au niveau événement, multi-jours à pax variable reporté V2).

---

## Nouveau pattern V1 (refonte 2026-05-21)

1. **Point d'entrée unique** : bouton **"Programmer une collecte"** sur la page d'accueil **(refonte 2026-05-29 — anciennement "Programmer un événement")** — le concept exposé à l'utilisateur est la collecte, pas l'événement (conteneur purement technique).
2. **Formulaire en deux écrans, puis une page de confirmation** *(refonte Val 2026-10-22)* :
   - **Écran 1 — Informations sur l'événement** (§ Étape 1 et § Étape 2) : nom de l'événement, client final, référence interne, lieu, contrôle d'accès, et **nombre de collectes souhaitées** par type (Zéro-Déchet, Anti-Gaspi ; au moins une au total).
   - **Écran 2 — Informations sur les collectes** (§ Étape 3) : une carte par collecte (« Collecte Zéro-Déchet #1 », « Collecte Zéro-Déchet #2 », puis « Collecte Anti-Gaspi #1 »…) avec date et heure, nombre de convives, type d'événement, contact principal, contact de secours et informations supplémentaires ; bouton « Ajouter une collecte » ; bouton « Confirmer la/les programmations ».
   - **Page de confirmation** (§ Actions post-confirmation, point 13).
3. **Une soumission crée l'événement + ses N collectes** (une par carte de l'écran 2), avec un appel webhook E1 `POST /collectes` par collecte vers le TMS.
4. **Ajout ultérieur** : une collecte peut être ajoutée à un événement existant après coup (cas ZD aujourd'hui, AG la semaine suivante) — voir §"Ajouter une collecte à un événement existant". *(Le cas « camion supplémentaire » reste hors formulaire — multi-camions interne TMS, révisé 2026-05-25 Sujet 1 : une collecte = un passage, et l'équipe Savr fixe le nombre de camions d'un passage.)*

---

## Étape 1 — Informations événement (écran 1)

| #   | Champ                                     | Obligatoire | Composant                                           | Règle |
| --- | ----------------------------------------- | ----------- | --------------------------------------------------- | ----- |
| 1   | **Nom de l'événement**                    | Oui         | Input text libre                                    | Ex: "Gala de printemps", "Séminaire annuel". Nom de l'événement dans l'historique, les listes, les emails et les rapports → `evenements.nom_evenement`. Seul nom exigé à la confirmation. *(Décision Val 2026-10-19 : remplace « Nom du client final (= nom événement) », qui remplissait aussi le client final.)* |
| 2   | *(Nombre de pax : retiré de l'étape 1 — décision Val 2026-10-20)* | — | — | Le nombre de convives se saisit dans chaque carte de collecte (étape 3, § 3.a). Le pax de l'événement en est calculé (cf. note « Pax porté par la collecte » ci-dessus). |
| 3   | *(Type d'événement : déplacé au niveau collecte — décision Val 2026-10-22)* | — | — | Il se choisit dans chaque carte de collecte (étape 3, § 3.a), `collectes.type_evenement_id`. Pendant la transition, `evenements.type_evenement_id` garde celui de la collecte n°1 (C1). |
| -   | Client final                              | Non         | Input text libre                                    | Nom du client organisateur (ex: "Entreprise Dupont") → `evenements.nom_client_organisateur`. Affiché « Client » / « Client final » dans les listes et fiches, filtre « Client », titre du rapport de recyclage (à défaut : nom de l'événement). N'entre pas dans « Info incomplète ». *(Décision Val 2026-10-19.)* |
| 4   | **Référence interne**                     | Non         | Input text libre                                    | Référence interne du programmateur (ex: numéro d'affaire Potel & Chabot). Reportée sur la facture Pennylane (champ "Référence") et sur le PDF Savr. → `evenements.reference_affaire`. *(Libellé « Référence client » renommé « Référence interne » — décision Val 2026-10-22 ; même donnée.)* |
| -   | Logo du client final                      | Non         | Upload image (JPG/PNG, max 2 Mo)                    | Logo affiché dans le rapport de recyclage PDF. Si le client final a un compte Savr avec logo renseigné (`organisations.logo_url`), ce logo prime automatiquement. |

> **Refonte 2026-05-29** : plus de "Date de l'événement" en étape 1. La date est saisie **par collecte en étape 3** (champ `date_collecte`, obligatoire, sans défaut). `evenements.date_evenement` est auto-calculé en backend = `MIN(date_collecte)` des collectes de l'événement.

### Nombre de collectes souhaitées *(refonte Val 2026-10-22 — remplace le choix ☐ Zéro-Déchet ☐ Anti-Gaspi du 2026-05-21)*

| Champ | Obligatoire | Composant | Règle |
| ----- | ----------- | --------- | ----- |
| **Zéro-Déchet** | Oui (au moins une collecte au total) | Nombre entier ≥ 0 | Autant de cartes « Collecte Zéro-Déchet #n » à l'écran 2. |
| **Anti-Gaspi** | Oui (au moins une collecte au total) | Nombre entier ≥ 0 | Autant de cartes « Collecte Anti-Gaspi #n » à l'écran 2. Dès une collecte Anti-Gaspi → lecture du pack AG actif, informative seulement, jamais bloquante (voir §"Sélection pack AG"). |

Une collecte = un passage du prestataire. Un gros volume le même soir ne se programme pas en plusieurs collectes : l'équipe Savr fixe le nombre de camions d'une collecte (Sujet 1, 2026-05-25 ; avertissement au § 3.a).

**Cas Agence / Gestionnaire de lieux** : le sélecteur "Traiteur opérant" apparaît ici (voir §"Cas Agence" et §"Cas Gestionnaire de lieux" ci-dessous).

L'étape 2 (lieu, contrôle d'accès) suit sur le même écran.

---

## Étape 2 — Lieu et contrôle d'accès (niveau événement, écran 1)

Ces informations sont **communes à l'événement** : saisies une fois, héritées par toutes les collectes générées (refonte 2026-05-21). Les **contacts** ne sont plus à ce niveau : ils se saisissent dans chaque carte de collecte (§ 2.b, § 3.a — décision Val 2026-10-22).

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

Stationnement, type de véhicule max et accès office ne sont plus demandés à la saisie manuelle, pour tous les rôles (décision Val 2026-10-16) : l'équipe Savr les renseigne dans la fiche lieu Admin.

Le lieu saisi manuellement est créé avec `actif = false` côté référentiel : utilisable immédiatement pour les collectes en cours, puis validé/normalisé par l'Admin Savr en asynchrone (notification dédiée).

**Cas "lieu existant"** : à la sélection d'un lieu via la combobox, **les champs d'adresse et d'accès du lieu s'affichent pré-remplis et éditables**. Champs concernés (**4** — réduits de 9 à 4 le 2026-10-16, décision Val, pour tous les rôles : stationnement, type de véhicule max, accès office, contraintes horaires et flux acceptés ne sont plus proposés au formulaire ; ils restent au référentiel lieu, renseignés par l'équipe Savr) : adresse accès livraison, code postal, ville, **détails d'accès** (`acces_details` — carnet d'accès terrain : badge, code, interphone, contact gardien, digicode/bip parking) (lecture/édition selon RLS).

> **`acces_details` — surcharge per-collecte assumée.** §04 marque ce champ « RW Admin Savr » : cet ownership porte sur la **valeur de RÉFÉRENCE** dans `lieux`, et n'empêche pas une surcharge per-collecte via `collectes.lieu_overrides` — le programmeur connaît son site mieux que le référentiel. Le `lieux` officiel n'est **jamais** modifié (les autres programmeurs continuent de voir la référence), la surcharge est tracée (`audit_log` + notification Admin) et bornée (1000 car., CHECK `collectes_lieu_overrides_valide_chk`). `acces_details` **ne rejoint pas** `R_lieux_admin_only_fields`, qui reste à 4 champs (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`).
>
> ⚠ Dette à vérifier : `CHAMPS_LIEU_OVERRIDABLES` (allowlist d'ENTRÉE, `lieu-override.ts`) et `CHAMPS_LIEU_SURCHARGEABLES` (allowlist de SORTIE vers le transporteur, `packages/adapters`) doivent rester cohérentes — l'allowlist effective est leur intersection.

**Champs admin/ops only NON visibles côté traiteur/agence/gestionnaire** : `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` (cf. [[05 - Règles métier#R_lieux_admin_only_fields]]).

Le **nom du lieu** reste figé (identifiant lieu). Tout autre champ modifié déclenche :

1. Stockage de la valeur saisie sur **chaque collecte courante** (`collectes.lieu_overrides` → utilisé immédiatement et transmis au TMS via E1).
2. **Notification Admin Savr** (signalement léger — le diff avant/après est lisible via `lieu_overrides` vs `lieux` officiel + tracé `audit_log`). Plus de table `lieux_modifications_en_attente` (supprimée — audit sobriété §04 2026-05-25 B1).
3. Le `lieux` officiel **n'est pas mis à jour** automatiquement (les autres programmeurs voient la valeur de référence) ; l'Admin l'édite ensuite directement dans le back-office lieux s'il juge la correction pérenne.

> **Forme admise de `collectes.lieu_overrides`** *(arbitrage Val 2026-09-15, documenté 2026-09-16 — divergence M1.5a_20260915_lieu-overrides-typage-bornes)*
>
> Les valeurs de `lieu_overrides` sont du **texte** : chaîne (la chaîne vide vaut « non renseigné »), tableau de chaînes pour `flux_autorises`, ou `null` (équivaut à l'absence de surcharge). Toute autre valeur, toute clé hors des 9 champs acceptés par la route (les 4 que le formulaire propose depuis le 2026-10-16, plus stationnement, type de véhicule max, accès office, contraintes horaires et flux acceptés, que la route accepte toujours) et toute valeur au-delà des longueurs admises sont **refusées en `422`**.
>
> Les bornes sont posées **aux deux niveaux — route ET base** (CHECK `collectes_lieu_overrides_valide_chk` + `chk_collectes_lieu_overrides_textuel`, migration `20260915160000`), la validation applicative seule étant contournable. C'est `[[:cntrl:]]` (SQL) qui fait foi sur les caractères de contrôle : l'applicatif peut être plus strict, jamais plus permissif (sinon 500 au lieu de 422).
>
> **Valeur invalide déjà stockée** (écriture hors API) : elle **n'est pas une surcharge** — le lieu officiel est transmis au transporteur à sa place, et le champ redevient propageable par E5, de sorte qu'une édition Admin du lieu **répare** la collecte. Motif : une valeur non textuelle était interpolée telle quelle dans l'adresse poussée au transporteur (`{"adresse_acces": {"a": 1}}` → `"[object Object], 75008 Paris"`) — un camion envoyé nulle part, de nuit.
>
> *Question ouverte MTS-1* : longueur réellement admise sur `place.address.addressSingleLine`. Si < 200, resserrer les bornes d'entrée **et** le CHECK.

(Voir règle [[05 - Règles métier#R_lieu_modif_pending]].)

### 2.b — Contacts sur place *(niveau collecte — refonte Val 2026-10-22)*

Référentiel autocomplete depuis `contacts_traiteurs` (scoped organisation). Niveau **collecte** *(décision Val 2026-10-22, C1–C2)* : chaque carte de collecte (§ 3.a) porte son contact principal et son contact de secours, rangés dans la table `collecte_contacts` (une ligne par collecte, lue et écrite par le serveur seul — cf. [[04 - Data Model]] et [[09 - Authentification et permissions]]). Pendant la transition, l'événement garde les contacts de sa collecte n°1 (copie maintenue par le serveur).

| Champ             | Obligatoire | Composant                                                                              | Règle                               |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| Contact principal | Oui         | Combobox autocomplete (prenom + nom + téléphone) + option "Ajouter un nouveau contact" | Référentiel filtré par organisation. **Bornes (2026-09-16)** — nom : texte libre, **120 car. max**, mono-ligne, **non vide** ; téléphone : texte libre, **40 car. max**, **non vide**, aucun format imposé (E.164 reporté). Ces deux champs alimentent les champs natifs de contact de la commande (`contact` MTS-1 / `pickup.contact` Everest) ; ils sont obligatoires (cf. validations bloquantes) et leurs colonnes sont `NOT NULL` → une saisie faite de blancs (`'   '`) rend **422**, jamais un 500. |
| Contact secours   | Non         | Idem                                                                                   | **Bornes (2026-09-16)** — nom : texte libre, **120 car. max**, mono-ligne ; téléphone : texte libre, **40 car. max**. Ces deux champs sont **concaténés dans le canal de texte libre** transmis au transporteur (`comment` MTS-1 et Everest) et le **nom ouvre l'agrégat** : une saisie démesurée y évince toutes les lignes suivantes (dont l'adresse d'accès) et une valeur multiligne y forge une fausse ligne d'en-tête. Bornes posées route (422) **et** base (CHECK, migration `20260915180000`). |

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

**Cas vélo cargo A Toutes! (AG uniquement)** : si `controle_acces_requis = true` ET une collecte AG vélo cargo est générée (prestataire `integration_externe='everest'` + véhicule vélo cargo) → **message UX inline** sur la carte de la collecte AG (écran 2, étape 3) : "Vélo cargo — pas de plaque possible. La demande sera transmise mais le manager n'aura pas de plaque à saisir." Soumission autorisée. Côté TMS, le trigger `validate_tournee_controle_acces` autorise la validation via exception explicite sur le critère plaque (chauffeur reste obligatoire).

**Action** : bouton « Continuer » (fin de l'écran 1) → écran 2 (étape 3).

---

## Étape 3 — Informations sur les collectes (écran 2)

Une **carte par collecte** : autant de cartes Zéro-Déchet et Anti-Gaspi que de collectes demandées à l'écran 1, numérotées par type (« Collecte Zéro-Déchet #1 », « Collecte Zéro-Déchet #2 », « Collecte Anti-Gaspi #1 »…). Une collecte distincte est créée par carte. *(Refonte Val 2026-10-22, remplace « un sous-bloc par type coché ».)*

- **Reprise de la collecte #1** *(décision Val 2026-10-22, C5)* : la première carte (Zéro-Déchet #1, ou Anti-Gaspi #1 s'il n'y a pas de collecte Zéro-Déchet) sert de modèle. Les autres cartes reprennent, champ par champ, son nombre de convives, son type d'événement, ses contacts et ses informations supplémentaires **tant que l'utilisateur n'a pas modifié ce champ dans la carte** ; un champ modifié dans une carte ne suit plus la #1. La date et l'heure ne sont jamais reprises.
- **« Ajouter une collecte »** : ajoute une carte (Zéro-Déchet ou Anti-Gaspi, au choix), qui suit la collecte #1 de la même façon.
- **Deux collectes du même type à la même date et à la même heure** *(décision Val 2026-10-22, C4)* : avertissement non bloquant « Pour un gros volume, une seule collecte suffit : l'équipe Savr fixe le nombre de camions. » Aucun avertissement si l'heure diffère.

### 3.a — Carte de chaque collecte (ZD et AG)

| Champ | Obligatoire | Composant | Règle |
| ----- | ----------- | --------- | ----- |
| **Date de collecte** | Oui | Date picker | **Sans défaut (refonte 2026-05-29)** — saisie obligatoire, aucune valeur pré-remplie. (supprimé : `date_evenement` est désormais dérivé de cette date, pas l'inverse). ≥ aujourd'hui. Stockée dans `collectes.date_collecte`. |
| **Heure de collecte** | Oui | `TimePicker` — liste de créneaux toutes les 15 min, de 00:00 à 23:45 | Heure unique de présence prestataire (point fixe V1, pas de fenêtre). Stockée dans `collectes.heure_collecte`. Propre à chaque collecte. |
| **Nombre de convives** | Oui | Input number (entier de 1 à 100 000) | Pax de **cette** collecte → `collectes.pax` (décision Val 2026-10-20). Base du calcul backend invisible du volume AG (10 %, cf. 3.c). Chaque carte a son propre champ ; les cartes suivantes reprennent celui de la collecte #1 tant qu'il n'y est pas modifié (décision Val 2026-10-22, C5). Exigé pour confirmer comme pour enregistrer en brouillon. |
| **Type d'événement** | Oui | Select (depuis `types_evenements`) | **Niveau collecte (décision Val 2026-10-22, C1)** → `collectes.type_evenement_id`. 4 catégories de **format de service** : Cocktail apéritif, Cocktail repas complet, Repas assis, Autre (catégorie sèche, sans texte libre — Sujet 4, 2026-05-26). Repris de la collecte #1 tant qu'il n'est pas modifié. Pendant la transition, `evenements.type_evenement_id` garde celui de la collecte n°1. |
| **Contact principal** | Oui | Combobox autocomplete (prénom + nom + téléphone) + option « Ajouter un nouveau contact » | Cf. § 2.b, bornes inchangées (nom : 120 car., mono-ligne, non vide ; téléphone : 40 car., non vide). → `collecte_contacts.contact_principal_nom` / `contact_principal_telephone`. Repris de la collecte #1 tant qu'il n'est pas modifié. Transmis au transporteur de CETTE collecte. |
| **Contact de secours** | Non | Idem | Cf. § 2.b, bornes inchangées. → `collecte_contacts.contact_secours_nom` / `contact_secours_telephone`. Repris de la collecte #1 tant qu'il n'est pas modifié. |
| **Informations supplémentaires concernant la collecte** | Non | Textarea (1000 car. max) | Texte libre, niveau **collecte**. Ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi". Stocké sur `collectes.informations_supplementaires`. Chaque collecte (ZD/AG) porte les siennes. **Plafond 1000 car. désormais appliqué en ÉCRITURE (2026-09-16)** — route (422) + CHECK base (migration `20260915180000`) ; auparavant seul le compteur client tronquait. Sauts de ligne et tabulation admis. ⚠ **Ce champ est le SEUL canal routé vers les deux transporteurs** (`comment` MTS-1 et Everest) : il agrège aussi le nom du contact de secours et les informations d'accès du lieu (cf. [[08 - APIs et intégrations]]). |

**Visibilité aval des informations supplémentaires** :

- **Prestataire (manager + chauffeur)** : via webhook E1 (`POST /collectes`), affiché dans le TMS (M01, M03) et l'app mobile chauffeur (M05).
- **Admin Savr** : back-office.
- **Espace traiteur** : fiche collecte, modifiable post-programmation (cascade `PATCH /collectes/:id` E2 — voir [[04 - Espace client traiteur]]).
- **Pas visible** : Espace gestionnaire de lieu.

### 3.b — Sous-bloc spécifique Zéro-Déchet

Aucun champ ZD additionnel V1 au-delà du sous-bloc commun. Les flux sont peuplés à clôture via les pesées chauffeur (webhook S5 TMS), pas saisis en amont.

**Tarif non affiché dans le formulaire (décision Sujet 5, 2026-05-26)** : aucun montant ZD n'est présenté pendant la saisie ni au récapitulatif, pour réduire la friction au moment de programmer. Le tarif applicable (grille de base affectée à l'organisation `grilles_tarifaires_zd` × remises éligibles `tarifs_negocie`, cf. [[05 - Règles métier#Tarifs et remises — résolution du prix]]) est calculé en backend, puis communiqué **après confirmation** : dans l'email récap `collecte_programmee` ([[06 - Fonctionnalités détaillées/02 - Templates emails V1]]) et sur la facture.

> ⚠ **Go-live : tarif retiré de l'email (décision Val 2026-10-22)** — facturation faite hors plateforme : l'email `collecte_programmee` ne donne plus le tarif ZD (ligne vide) : la plateforme ne communique plus le tarif. Retour avec la facturation sur la plateforme.

> **Retiré V1 (Sujet 5, propagation 2026-05-26)** — contredisait le récap §3.d. Référence `tarifs_zd_par_gestionnaire` également obsolète (table remplacée par `tarifs_negocie` le 2026-04-28).

### 3.c — Sous-bloc spécifique Anti-Gaspi

| Champ | Obligatoire | Composant | Règle |
| ----- | --------- | --------- | ----- |
| Pack AG applicable | Auto | Affichage | Pack actif de l'orga programmatrice, sinon information « facturée à l'unité » (voir §"Sélection pack AG"). |

**État du pack AG** : "Pack AG 50 crédits — il vous reste 12 crédits" ou (si pas de pack actif) « Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité. » — information, jamais bloquante.

> **Note** : le volume estimé de repas n'est pas saisi. Calculé en backend invisible `round(0.10 × collectes.pax)` (pax de la collecte, décision Val 2026-10-20) à l'INSERT collecte AG, stocké dans `collectes.volume_estime_repas`, utilisé uniquement par l'algo d'attribution association (R_capacite_min_50pct). Le traiteur ne le voit jamais. Voir [[05 - Règles métier#R_volume_estime_ag_calcule]].

### 3.d — Confirmation

Pas de récapitulatif à l'écran 2 (décision Val 2026-10-16) : le récapitulatif est affiché après confirmation, sur la page « Votre événement « {nom de l'événement} » est programmé » (cf. § Actions post-confirmation, point 13). Le bouton « Retour » ramène à l'écran 1.

### Section optionnelle — Partager avec un collègue → Reportée V1.1 *(audit sobriété §04 2026-05-25, A4)*

> ⚠ **Reportée V1.1 (A4 2026-05-25)** : le partage de collecte entre collègues (table `collecte_partages`) est retiré du périmètre V1 — le manager voit déjà toutes les collectes de l'organisation, le cas commercial↔commercial est marginal. Section non exposée au formulaire V1.

*(spec conservée pour réactivation V1.1)*

**Boutons** :

- "Enregistrer en brouillon" : statut `brouillon` (toutes collectes).
- « Confirmer la/les programmations » : statut `programmee` → création événement + collectes + envoi TMS + email récap.

> **Mention informative** sous le bouton de confirmation : "Toute collecte annulée à moins de 4h de l'heure de collecte donne lieu à facturation plein tarif — pour une collecte Anti-Gaspi sous pack, un crédit est décompté (cf. CGV)." (CGV acceptées à la création de compte.) *(Précision AG = débit crédit ajoutée 2026-06-07 — F2.)*

---

## Ajouter une collecte à un événement existant (NOUVEAU 2026-05-21)

Couvre le cas : ajouter l'autre type de collecte plus tard (ZD programmé aujourd'hui, AG la semaine suivante). **Retiré — Révisé 2026-05-25 (Sujet 1, option A)** : le gros volume nécessitant plusieurs camions est désormais géré **en interne par le TMS** (1 collecte ZD traiteur → N tournées prestataire, décidées par l'Admin Savr au dispatch) et ne crée plus de collectes ZD supplémentaires côté traiteur.

**Workflow** : depuis la fiche événement (page détail), bouton "Ajouter une collecte", ou depuis la fiche collecte, action « Ajouter une collecte à cet événement » (pied de la fiche collecte des rôles qui programment — traiteur manager et commercial, agence, gestionnaire de lieux — et de la fiche collecte Admin, programmation de support) *(décision Val 2026-10-21)*, ou depuis la page de confirmation (point 13) → rouvre le formulaire avec le **niveau événement figé et pré-rempli** (client, date événement, lieu, contrôle d'accès), affiché en lecture seule et jamais renvoyé par la page : la création relit l'événement. Le **contrôle d'accès** de la nouvelle collecte est celui de l'événement : il n'a pas de colonne sur `evenements` (copié sur chaque collecte, modifiable sur une seule), il est donc **requis dès qu'une collecte de l'événement l'exige** — la contrainte vient du site *(décision Val 2026-10-21)*. Le **nombre de convives**, le **type d'événement** et les **contacts** de la nouvelle collecte se saisissent dans sa carte, pré-remplis avec ceux de la dernière collecte non annulée de l'événement, modifiables (convives : décision Val 2026-10-20 ; type et contacts : décision Val 2026-10-22). L'utilisateur :

1. Choisit le type de collecte à ajouter (ZD ou AG).
2. Remplit la carte de la collecte (§ 3.a : date et heure, convives, type d'événement, contacts, informations supplémentaires). Collecte AG : la carte affiche l'état du pack de l'organisation de l'événement — sans pack actif, l'information « Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité. », jamais bloquante (décision Val 2026-10-16).
3. Confirme → création d'une nouvelle `collectes` rattachée à l'`evenement_id` existant + webhook E1.

**Rattachement explicite** : la nouvelle collecte pointe sur l'`evenement_id` (plus de matching textuel date+lieu+client, supprimé 2026-05-21). Zéro risque de doublon d'événement.

**Événements éligibles** *(décision Val 2026-10-21)* : l'ajout est possible sur **tout événement**, quel que soit l'état de ses autres collectes (en cours, réalisées, clôturées, annulées), tant que la nouvelle collecte est datée d'aujourd'hui ou après (jour en heure de Paris, l'heure de collecte n'entrant pas dans la comparaison ; date passée → refus « Date de collecte dans le passé », rien n'est créé). La fenêtre d'édition `f_collecte_editable` ne s'applique pas à l'ajout : elle reste celle de la modification. L'action n'est proposée que sur un événement de l'organisation de l'utilisateur (périmètre de `col_insert`, [[09 - Authentification et permissions]]) — jamais sur l'événement d'un traiteur tiers tenu sur les lieux d'un gestionnaire, ni au traiteur opérationnel d'une collecte programmée par un tiers, ni au client organisateur. Sur la fiche collecte, elle est proposée quel que soit le statut de la collecte affichée, annulée comprise (seule action alors proposée), sauf un brouillon (événement pas encore confirmé). L'Admin y a accès sur toute collecte hors brouillon (programmation de support). Un événement en brouillon (au moins une collecte en brouillon) est aussi refusé par le serveur, pour tous les rôles, Admin compris : 422 « Événement en brouillon : confirmez-le avant d’y ajouter une collecte. », rien n'est créé *(décision Val 2026-10-21)*.

**Deux collectes du même type au même moment** *(décision Val 2026-10-22, C4 — remplace l'avertissement « Cet événement a déjà une collecte Anti-Gaspi. Confirmer l'ajout d'une seconde ? »)* : rien n'empêche plusieurs collectes du même type sur un événement. Si la nouvelle collecte a le même type, la même date et la même heure qu'une collecte non annulée de l'événement, l'avertissement non bloquant du § 3.a s'affiche. Aucun avertissement si l'heure diffère.

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

Dès qu'une collecte **Anti-Gaspi** est demandée à l'écran 1 *(refonte 2026-10-22)*, le formulaire vérifie l'existence d'un pack AG actif sur l'organisation programmatrice (`packs_antgaspi WHERE organisation_id = organisation_programmatrice.id AND statut = 'actif'`). Règle identique pour les 3 types :

- **0 pack actif** (aucun pack, pack épuisé ou annulé, ou pack actif sans crédit restant) : **jamais bloquant** *(décision Val 2026-10-16, remplace le blocage à la coche F5 du 2026-06-07)*. La collecte Anti-Gaspi reste demandée ; une information s'affiche sous le nombre de collectes Anti-Gaspi (écran 1) et dans chaque carte Anti-Gaspi (écran 2) : « Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité. » — sans montant, le prix dépendant de la remise négociée. La collecte AG est facturée au tarif unitaire (`tarifs_packs_ag` type `unitaire`, moins la remise AG négociée la plus élevée, cf. [[08 - Génération et édition facture (Admin)]] §5). Aucun contrôle serveur ne refuse une collecte AG faute de pack. Programmation de support Admin : le pack lu est celui du traiteur choisi ; tant qu'aucun traiteur n'est choisi, rien n'est affiché.
- **1 pack actif** : sélection automatique, indicateur "X crédits restants sur Y".

> **Retiré (revue sobriété 2026-05-29, A1)** — cas impossible par construction : l'unicité du pack actif est garantie au niveau DB par le partial unique index `uniq_pack_actif_par_org` (cf. [[05 - Règles métier#Règle V1 — Pack unique actif refonte 2026-05-08]] + [[04 - Data Model]]). Une organisation a **au plus un** pack `statut='actif'`. Deux cas seulement : 0 (facturation à l'unité, information non bloquante) ou 1 (auto-sélection).

**Déclenchement décompte** : à la transition `collectes.statut → 'realisee'` OU à l'**annulation tardive** (< 4h avant l'heure de collecte, décision Val 2026-10-15 — trigger `trg_pack_debit_annulation_tardive`, ajout 2026-06-07 F2 ; cf. §05 §3 Packs AG « Débit d'un crédit »). L'organisation décomptée est `evenements.organisation_id` (programmateur).

---

## Logique métier annexe

### Sauvegarde brouillon

- Sauvegarde **manuelle** via le bouton "Enregistrer en brouillon" (écrans 1 et 2). **Retiré V1 (revue sobriété 2026-05-29, A2)** — l'autosave debounced (gestion de conflit + reprise d'état partiel multi-collectes) est du confort disproportionné pour un formulaire rempli en une passe. Le bouton manuel couvre le besoin. Autosave reportable V1.1 si retour terrain.
- Brouillon récupérable depuis la liste des collectes (filtre "Brouillons"). Un brouillon d'événement multi-collectes est repris dans son état complet (écrans 1 et 2 : nombre de collectes par type et cartes saisies).
- **Périmètre de la liste des brouillons (décision Val 2026-07-17)** : rôles clients = les brouillons de leur **organisation** (miroir de la policy `evt_*_select` — un manager voit ceux de ses commerciaux). Staff (`admin_savr`, `ops_savr`) en mode support = **les brouillons qu'il a lui-même créés** (`created_by`), toutes organisations cibles confondues. Le staff n'ayant pas d'organisation cliente (son JWT porte l'org interne `org_savr`), un périmètre org ne le cloisonnerait pas : il masquerait tout. La liste n'est dans aucune navigation — on n'y atterrit que par la redirection qui suit « Enregistrer en brouillon » — donc le périmètre utile est celui qui rend ce qu'on vient d'enregistrer. Le « tous périmètres » ci-dessus porte sur les **organisations pour lesquelles le staff peut programmer**, pas sur une bannette globale des brouillons d'autrui.
- **Confirmation et suppression d'un brouillon** sont ouvertes aux mêmes rôles que sa création, staff inclus (sans quoi un brouillon de support est orphelin dès sa création). L'organisation de rattachement est lue **sur l'événement**, jamais sur le JWT de l'appelant. Le **périmètre d'écriture** suit la matrice §09 : `traiteur_commercial`, `agence` et `gestionnaire_lieux` = **leurs propres créations** (`created_by`), `traiteur_manager` = son organisation. Confirmer et supprimer sont des écritures (émission E1 vers le TMS, débit pack AG, suppression) : un commercial ne confirme ni ne supprime donc jamais le brouillon d'un collègue.
- **Idiomes `requireProgrammateurOuAdmin`** (à respecter sur toute route de programmation) : route de **collection** → l'organisation cible est déclarée en body/query ; route d'**item** (clé par PK) → l'organisation est lue **sur la ligne**. Ne jamais la déduire du JWT de l'appelant en mode support.
- Suppression manuelle par l'utilisateur ("Supprimer ce brouillon"). Pas de suppression automatique par ancienneté V1.

### Validations bloquantes (à la confirmation)

- Nombre de convives : entier de 1 à 100 000 sur chaque collecte (décision Val 2026-10-20 : il se saisit à l'étape 3 ; plafond décidé par Val le 2026-10-21)
- **Retiré (revue sobriété 2026-05-29, C1)** — `date_evenement` n'est plus saisie (dérivée de `MIN(date_collecte)`). La contrainte est portée par la validation "date de collecte ≥ aujourd'hui" ci-dessous.
- Au moins une collecte (Zéro-Déchet et/ou Anti-Gaspi)
- Nom de l'événement renseigné (le client final est facultatif — décision Val 2026-10-19)
- **Pour chaque collecte** : type d'événement sélectionné (catégorie parmi les 4 ; **plus de texte libre obligatoire pour "Autre"** — corrigé revue sobriété 2026-05-29, C2, alignement Sujet 4 2026-05-26 ; niveau collecte depuis le 2026-10-22)
- Lieu sélectionné (référentiel ou manuel complet)
- **Pour chaque collecte** : contact principal renseigné (nom et téléphone ; niveau collecte depuis le 2026-10-22)
- **Pour chaque collecte** : date de collecte ≥ aujourd'hui + heure de collecte renseignée
- Si une collecte AG : aucune condition de pack (sans pack actif, la collecte AG est facturée à l'unité)

### Champs non bloquants (marquage "Info incomplète")

Soumission possible sans ces champs ; au moins un manquant → `collectes.informations_completes = false` + badge "Info incomplète" back-office Admin :

- Numéro de téléphone contact traiteur / contact lieu
- Nom du contact sur le lieu
- Instructions d'accès spécifiques au lieu
- Logo du client final
- Référence interne
- Informations supplémentaires concernant la collecte

**Justification** : le traiteur n'a pas toujours ces infos à la programmation (souvent plusieurs semaines avant). Bloquer créerait une friction opérationnelle.

### Validations non bloquantes (warnings inline)

- Date et heure de collecte à moins de 24h de maintenant, en heure de Paris → « Programmation à moins de 24h — Nous vous demandons de nous appeler pour valider la faisabilité — 07 61 91 29 97 » (numéro cliquable). Tant que l'heure n'est pas choisie, seule une collecte le jour même déclenche l'alerte (validé par Val le 2026-10-20). *(Décision Val 2026-10-16 : remplace l'alerte « à moins de 48h, disponibilité non garantie ».)*
  - **Pas de délai minimum bloquant V1 (tranché Val 2026-06-10, challenge logistique — ne pas re-proposer)** : une collecte peut être programmée à n'importe quelle échéance, y compris < 1h. Le filet assumé est **l'acceptation explicite** (la collecte reste `programmee`/`attribuee_en_attente_acceptation` tant que le transporteur n'a pas confirmé — jamais d'acceptation par délai, cf. [[../08 - APIs et intégrations]] §3) + le **monitoring Admin des collectes non confirmées** (§06.06) pour relance Ops. La latence outbox (envoi immédiat après toute mutation qui écrit un ordre de collecte depuis le 2026-10-12 ; worker 15 min en filet, pour les reprises et pour l'ordre « lieu ») est couverte par ce même filet.
- **Retiré (refonte 2026-05-29)** : `date_evenement` est auto-dérivé, plus de divergence à signaler. L'info "collecte le lendemain" est implicitement correcte (le programmeur saisit directement la bonne date de collecte).
- Champs non bloquants vides → "Certaines informations ne sont pas encore renseignées. Vous pourrez les compléter plus tard depuis votre espace."
- Deux collectes du même type à la même date et à la même heure → « Pour un gros volume, une seule collecte suffit : l'équipe Savr fixe le nombre de camions. » (décision Val 2026-10-22, C4 ; aucun avertissement si l'heure diffère).

---

## Wireframe textuel (vue desktop) — refonte 2026-10-22

```
┌──────────────────────────────────────────────────────────┐
│  Savr — Programmer une collecte                           │
├──────────────────────────────────────────────────────────┤
│  Écran 1 — Informations sur l'événement                   │
│  [ Nom de l'événement : ____________________ ]            │
│  [ Client final : ___________ ] (opt.)                    │
│  [ Référence interne : ______ ] (opt.)                    │
│  (Agence / Gestionnaire / Admin) [ Traiteur : ______ ▼ ]  │
│  [ Lieu de collecte : _____________________ ▼ ]           │
│    adresse, CP, ville, détails d'accès (modifiables)      │
│  ☐ Plaque d'immatriculation et nom du chauffeur requis    │
│  Nombre de collectes souhaitées :                         │
│    Zéro-Déchet [ 2 ]   Anti-Gaspi [ 1 ]                   │
│                       [ Enregistrer ]  [ Continuer ]      │
├──────────────────────────────────────────────────────────┤
│  Écran 2 — Informations sur les collectes                 │
│   ┌ Collecte Zéro-Déchet #1 ─────────────────────────┐    │
│   │ Date __/__/__  Heure __h__  Convives ___         │    │
│   │ Type d'événement ▼  Contact principal ▼          │    │
│   │ Contact de secours ▼  Informations ...           │    │
│   └──────────────────────────────────────────────────┘    │
│   ┌ Collecte Zéro-Déchet #2 ─────────────────────────┐    │
│   │ Date __/__/__  Heure __h__                       │    │
│   │ (convives, type, contacts, informations :        │    │
│   │  repris de la #1 tant qu'ils ne sont pas changés)│    │
│   └──────────────────────────────────────────────────┘    │
│   ┌ Collecte Anti-Gaspi #1 ── (idem) ── Pack AG : 12 ┐    │
│   └──────────────────────────────────────────────────┘    │
│   [ + Ajouter une collecte ]                              │
│   [ Brouillon ]      [ Confirmer la/les programmations ]  │
└──────────────────────────────────────────────────────────┘
```

Responsive mobile : écrans en single-column, cartes collecte stacked, boutons stacked.

---

## Actions post-confirmation

1. Création `evenements` (1) avec le contrôle d'accès, le traiteur opérationnel, et le type d'événement et les contacts **de la collecte n°1** (copie de transition, décision Val 2026-10-22, C1). `date_evenement` et `pax` sont auto-calculés par trigger après l'insertion des collectes (`pax` : pour chaque jour de collecte, le plus grand des deux totaux du jour — somme des pax des collectes ZD non annulées, somme des pax des collectes AG non annulées —, puis la somme des jours (une ZD et une AG du même soir comptent une fois ; deux ZD ou deux AG du même jour s'additionnent ; deux soirées s'additionnent — règle révisée par Val le 2026-10-21) — décision Val 2026-10-20).
2. Création de **N `collectes`** (une par carte de l'écran 2), chacune avec son `date_collecte` + `heure_collecte` + `pax` + `type_evenement_id` + `informations_supplementaires`, et ses contacts dans `collecte_contacts`, rattachées à l'`evenement_id` (rattachement explicite).
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
13. Redirection vers une **page de confirmation dédiée** `/programmer/confirmation?id=…` *(refonte Val 2026-10-22 ; écran de succès dédié plutôt que redirection vers le détail événement : décision Val 2026-07-16, divergence M1.2)* :
    - **En-tête** : « Votre événement « {nom de l'événement} » est programmé ».
    - **Récapitulatif de l'événement** : client final et référence interne (s'ils sont renseignés), lieu, contrôle d'accès requis, nombre de collectes par type (Zéro-Déchet, Anti-Gaspi), compté sur les collectes non annulées de l'événement (aucune donnée stockée en plus).
    - **« Nous réaliserons {nombre} collectes »** : une carte par collecte (« Collecte Zéro-Déchet #1 »…) avec date et heure, nombre de convives, type d'événement, contact principal et contact de secours avec leur téléphone, informations supplémentaires et statut, et deux boutons : **« Modifier »** (ouvre sa fiche en édition dans l'espace du rôle, la fiche collecte Admin pour le staff — décision Val 2026-10-16) et **« Annuler la collecte »** (décision Val 2026-10-22, C6 : règles habituelles d'annulation — [[05 - Règles métier]], annulation tardive à moins de 4 h, ordre d'annulation au transporteur si la demande est partie, demande d'annulation pour un rôle qui n'annule pas directement).
    - **En bas de page** : « Ajouter une collecte » (§ Ajouter une collecte à un événement existant), « Programmer un autre événement », « Accueil », et le rappel de l'email récapitulatif (ci-dessous).
    - **Rappel email récap = issue réelle de l'envoi** *(décision Val 2026-10-08)* : l'écran ne dit « envoyé » que si l'email est réellement parti. L'état est lu dans `emails_envoyes` (dernier envoi `collecte_programmee` de l'événement) et servi aux rôles programmateurs, et au staff en programmation de support, sous la forme d'un état seul — ni adresse du destinataire, ni message d'erreur.
        - Email accepté par Resend : « Un email récapitulatif vient de vous être envoyé. »
        - Email refusé pour l'instant, reprise automatique en cours ([[08 - APIs et intégrations]] §4) : « L'email récapitulatif n'a pas pu partir pour l'instant. Nous le renvoyons automatiquement. »
        - Rien n'est parti et rien ne repartira (4 tentatives épuisées, refus de la messagerie du destinataire, ou aucun envoi tracé), en bandeau d'avertissement : « L'email récapitulatif n'a pas pu vous être envoyé. Votre programmation est bien enregistrée : vous la retrouvez dans vos collectes. Pour toute question, écrivez-nous à contact@gosavr.io. »
        - État inconnu (journal des emails illisible, ou statut non reconnu) : aucune mention de l'email.

---

## Décisions prises

- **Formulaire unique événement-centré (2026-05-21)** : un point d'entrée, étape 1 = événement + choix des types (☐ZD ☐AG), une soumission crée l'événement + 1-2 collectes. Remplace les 2 boutons + saisie séquentielle + matching textuel.
- **Rattachement explicite collecte→événement (2026-05-21)** : via `collectes.evenement_id`. Fin du matching date+lieu+client (source de doublons d'événements).
- **Date événement vs date collecte distinguées (2026-05-21, révisé 2026-05-29)** : `collectes.date_collecte` (vérité logistique, **saisie étape 3, sans défaut, obligatoire**) est la seule date saisie ; `evenements.date_evenement` est **auto-dérivé en backend** = `MIN(date_collecte)` (trigger `fn_set_date_evenement`), jamais saisi au formulaire. inversé par la refonte 2026-05-29. Heure de collecte propre à chaque collecte.
- **Contrôle d'accès niveau événement (2026-05-21)** : saisi une fois, copié sur chaque collecte (la contrainte vient du site, pas de la collecte). Cascade lieu upgrade-only conservée. Exception vélo cargo AG conservée.
- **Révisé 2026-05-25 (Sujet 1, option A)** : multi-camions interne au TMS — 1 collecte ZD traiteur → N tournées prestataire (Admin au dispatch), agrégation des pesées au niveau de la collecte ZD. Plus de collectes ZD multiples côté traiteur ni d'agrégation niveau événement.
- **Ajout d'une collecte à un événement existant (2026-05-21)** : bouton depuis la fiche événement, niveau événement pré-rempli figé (client, date, lieu, contrôle d'accès) ; convives, type d'événement et contacts de la nouvelle collecte pré-remplis depuis la dernière collecte, modifiables (2026-10-22).
- **Deux écrans + page de confirmation (refonte Val 2026-10-22)** : écran 1 événement (identité, lieu, contrôle d'accès, nombre de collectes par type), écran 2 une carte par collecte ; récapitulatif sur la page de confirmation (décision Val 2026-10-16).
- **Nom de l'événement et client final distincts (décision Val 2026-10-19)** : « Nom de l'événement » obligatoire (`evenements.nom_evenement`), « Client final » facultatif (`evenements.nom_client_organisateur`), comme au formulaire de modification. Remplace la règle « Nom du client = nom de l'événement » (une seule case écrite dans les deux colonnes).
- **Heure de collecte unique** (point fixe, pas de fenêtre) — par collecte, choisie dans une liste de créneaux de 15 min (00:00 → 23:45).
- **Caduc (revue sobriété 2026-05-29, C3)** — "Autre" est une catégorie sèche sélectionnable depuis Sujet 4 (2026-05-26) : plus de texte libre ni de notification de normalisation.
- **Lieu hors référentiel autorisé** + validation Admin asynchrone.
- **Lieu existant éditable** (override collecte + patch en attente Admin, option C).
- **Contacts et type d'événement niveau collecte (refonte Val 2026-10-22, C1–C2)** : autocomplete `contacts_traiteurs` ; contacts rangés dans `collecte_contacts` (lue et écrite par le serveur seul), type dans `collectes.type_evenement_id` ; l'événement garde ceux de la collecte n°1 pendant la transition.
- **Plusieurs collectes du même type dès la programmation (refonte Val 2026-10-22)** : nombre de collectes par type à l'écran 1 ; avertissement non bloquant si deux collectes du même type ont la même date et la même heure (C4).
- **Cartes de collecte qui reprennent la #1 (refonte Val 2026-10-22, C5)** : champ par champ, tant que l'utilisateur ne l'a pas modifié dans la carte.
- **Page de confirmation (refonte Val 2026-10-22, C6–C7)** : « Modifier » et « Annuler la collecte » sur chaque collecte ; sélecteur de traiteur, brouillon, champs du lieu, pack AG, rappel annulation, « Programmer un autre événement », « Accueil » et message de l'email conservés.
- **Informations supplémentaires niveau collecte** (chaque collecte ZD/AG les siennes).
- **Volume AG = 10% du pax de la collecte** auto-calculé backend invisible.
- **Pack AG jamais bloquant** : sans pack actif, la collecte AG se programme et est facturée à l'unité (décision Val 2026-10-16).
- **Récapitulatif sur l'écran de confirmation** (décision Val 2026-10-16) : client, lieu, convives, date et heure de chaque collecte, contacts principal et de secours avec téléphone ; plus de récapitulatif à l'étape 3.
- **Tarif ZD non affiché au formulaire (Sujet 5, 2026-05-26)** : aucun montant pendant la saisie ni au récap (réduction de friction). Le tarif applicable est calculé en backend et communiqué **après confirmation** (email récap `collecte_programmee` + facture). Option A retenue (Val). Lève la contradiction §3.b vs §3.d et solde la référence obsolète `tarifs_zd_par_gestionnaire` → `tarifs_negocie`. Question ouverte 5 (nom gestionnaire vs anonyme) rendue caduque.
- **Suppression case CGV** : couvertes à la création de compte.
- **Brouillon persistant** : suppression explicite par user.
- **FR uniquement V1**.
- **Agence (2026-05-07)** : "Traiteur opérant" + option shadow (alerte SIRET vide).
- **Gestionnaire de lieux (2026-05-07)** : "Traiteur opérant" sans option shadow, combobox lieu filtrée à son parc.
- **Duplication d'une collecte → V1 (2026-07-05, remplace l'arbitrage V1.1 du 2026-05-29)** : bouton « Dupliquer » sur la liste Collectes client (§06.04 §3) → `/programmer/nouveau?from=<collecteId>`, formulaire pré-rempli, date laissée vide, rien n'est créé avant validation.
- **Normalisation des lieux saisis manuellement = best-effort, pas de SLA formel (2026-05-29)** : un lieu hors référentiel est créé `actif = false` puis normalisé par l'Admin sans délai engagé (la collecte est programmée plusieurs jours à l'avance, la normalisation n'est pas bloquante). Aucun SLA contractuel à respecter en V1. Tranche la question ouverte 2.
- **Matching AG sans `contraintes_aliments` = géographie + capacité créneau uniquement (2026-05-29)** : l'algo d'attribution association ne s'appuie que sur la proximité géographique et la capacité de l'association sur le créneau. `contraintes_aliments` ayant été retiré volontairement (refonte 2026-05-03), aucun critère de type alimentaire n'est réintroduit (associations généralistes). Tranche la question ouverte 4. Cf. [[09 - Flux algo attribution AG (Admin)]].

---

## Questions ouvertes

1. **Tranchée 2026-05-29 (Val) : V1.1** — cf. Décisions prises. **Révisé 2026-07-05 : livrée en V1** (bouton « Dupliquer », §06.04 §3) — cf. Décisions prises.
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
| **2026-10-20** | **Pax porté par la collecte** : `collectes.pax`, saisi avec la date de chaque collecte (étape 3, plus à l'étape 1) ; `evenements.pax` calculé depuis les collectes (pour chaque jour de collecte, le plus grand des deux totaux du jour — somme des pax des collectes ZD non annulées, somme des pax des collectes AG non annulées —, puis la somme des jours (une ZD et une AG du même soir comptent une fois ; deux ZD ou deux AG du même jour s'additionnent ; deux soirées s'additionnent — règle révisée par Val le 2026-10-21)). « Ajouter une collecte » demande le pax, pré-rempli avec celui de la dernière collecte. Annule le retrait du 2026-05-29. | **Val 2026-10-20** |
| **2026-10-21** | **Pax de l'événement — règle du jour révisée** : par jour, le plus grand des deux totaux (Σ pax des ZD, Σ pax des AG) des collectes non annulées, puis la somme des jours ; remplace le « plus grand pax du jour » du 2026-10-20 (contre-cas assumé : un déjeuner et un dîner pour les mêmes convives comptent deux fois). L'équipe Savr modifie le pax d'une collecte depuis la fiche collecte Admin (lot à livrer avant le lot 2 de facturation). | **Val 2026-10-21** |
| **2026-05-26** | **Tarif ZD non affiché au formulaire (Sujet 5, option A)** : alignement §3.b sur §3.d (non affiché, réduction friction). Tarif communiqué post-confirmation (email récap + facture). Question ouverte 5 caduque. Réf obsolète `tarifs_zd_par_gestionnaire` → `tarifs_negocie`. | **Sujet 5 — Val 2026-05-26** |
| **2026-05-29** | **Duplication de collecte → V1.1** (Q1). **Normalisation lieux saisis manuellement = best-effort sans SLA** (Q2). **Matching AG = géo + capacité créneau uniquement** (Q4). Q3 (SLA modifs lieu) caduque — workflow `lieux_modifications_en_attente` supprimé. | **Arbitrages micro-points — Val 2026-05-29** |
| **2026-05-29** | **Revue de sobriété §06.01** : A1 cas "N packs actifs" supprimé (impossible — index unique DB) · A2 autosave 30s retiré (sauvegarde manuelle V1) · B1 date événement au récap conditionnée (mono-collecte) · C1 validation "date événement ≥ aujourd'hui" retirée (champ dérivé) · C2 validation type "Autre" texte libre corrigée · C3 décision "Autre → notif Admin" caduque · C4 décision "date collecte défaut = date événement" réalignée · C5 wireframe màj. | **Revue sobriété — Val 2026-05-29** |
| **2026-10-22** | **Refonte du formulaire** : deux écrans + page de confirmation ; nombre de collectes par type dès la programmation ; une carte par collecte (date et heure, convives, type d'événement, contacts, informations) qui reprend la #1 champ par champ ; contacts (`collecte_contacts`) et type d'événement (`collectes.type_evenement_id`) au niveau collecte ; « Référence client » renommée « Référence interne » ; avertissement si deux collectes du même type ont la même date et la même heure ; page de confirmation avec « Modifier » et « Annuler la collecte » par collecte. | **Val 2026-10-22 (C1–C8)** |
