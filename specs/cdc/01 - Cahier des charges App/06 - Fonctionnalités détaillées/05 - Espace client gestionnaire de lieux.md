# 05 - Espace client gestionnaire de lieux

**Statut** : Validé V1 (session test-scenarios 2026-06-07 — 6 floues tranchées Val : F1 toggle notif collecte supprimé · F2 statut consolidé défini · F3 brouillons tiers exclus · F4 fenêtre `f_collecte_editable` sur UPDATE gestionnaire · F5 policies users org-wide · F6 factures SELECT self — cf. `tests/06.05-espace-gestionnaire-lieux-scenarios.md`)
**Dernière mise à jour** : 2026-07-06 (patchs divergences M3.2 — nav 9 sections avec entrées Collectes + Registre distinctes L67/72-73/83 ; champ « type » retiré de la fiche lieu L372, colonne inexistante V1 + cible — cf. `_Divergences/_traités/2026-07/M3.2_*.md`)
**Lié à** : [[02 - Personas et cas d'usage]] · [[04 - Data Model]] tables `organisations`, `organisations_lieux`, `lieux`, `types_evenements`, `flux_dechets`, `coefficients_perte_labo` · [[05 - Règles métier#R_dechets_labo_estimes]] · [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]] · [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] · [[11 - Dashboards]] · [[12 - Reporting et exports]] §1.6

---

## Contexte

Les gestionnaires de lieux sont des opérateurs d'espaces événementiels qui louent leurs lieux pour des événements où Savr intervient via un traiteur. Cibles V1 : **Viparis**, **GL Events**, **Sodexo Live**.

**Refonte 2026-05-07 — extension transactionnelle** : historiquement, les gestionnaires étaient en consultation seule (programmation = traiteur). À partir du 2026-05-07, le gestionnaire peut aussi **programmer une collecte directement** sur l'un de ses lieux (avec un traiteur du référentiel comme opérateur), être **facturé en direct** par Savr pour cette collecte, et **acheter/consommer un pack AG**. Use case : un gestionnaire qui contractualise une prestation événementielle où la RSE est portée par lui-même (pas par le traiteur).

Cas d'usage hérités (consultation 360) :
- Justifier l'offre "zéro-déchet / anti-gaspi" auprès de leurs propres clients
- Consolider un reporting RSE à l'échelle de leur parc de lieux
- Tracer la performance environnementale des traiteurs référencés
- Répondre aux appels d'offres publics et privés avec des chiffres consolidés

Cas d'usage ajoutés (transactionnels) :
- Programmer une collecte directement quand le gestionnaire pilote la RSE
- Recevoir une facture Savr en direct pour ces collectes
- Bénéficier d'un pack AG négocié

**Positionnement V1 (post-2026-05-07)** : consultation 360 **+ transactionnel sur ses propres lieux**. Périmètre programmation fermé via `organisations_lieux`, restreint aux traiteurs référencés Savr (pas de fiche shadow autorisée côté gestionnaire — cf. §06.01).

---

## Rôles et accès

### Rôle unique V1 : `gestionnaire_lieux`

Pas de distinction manager/commercial en V1. Un utilisateur gestionnaire de lieux voit tout le périmètre de son organisation.

**Justification** : les équipes RSE/événementiel des opérateurs de lieux sont de petite taille (quelques personnes), et la donnée visible n'est pas sensible commerciale (pas de tarif, pas de marge). Pas besoin de segmentation.

### Multi-users par organisation

Plusieurs utilisateurs peuvent appartenir à une même organisation gestionnaire_lieux. Ils voient tous la même chose. Invitation par email (voir §Paramètres).

### Scope des données

Un user `gestionnaire_lieux` de l'organisation X voit :
- Tous les lieux rattachés à l'organisation X (via `organisations_lieux`)
- Tous les événements qui se sont tenus sur ces lieux
- Toutes les collectes associées à ces événements
- Toutes les données de reporting (bordereaux, rapports de recyclage, attestations don, rapports de synthèse agrégés)
- Les traiteurs qui sont intervenus sur ces lieux (lecture seule, pas d'identité fiscale détaillée)
- Les clients finaux si renseignés par le traiteur

Un user `gestionnaire_lieux` **ne voit pas** :
- Les tarifs de collecte pratiqués avec les traiteurs
- Les montants facturés aux traiteurs (ni en HT, ni en TTC) — *ses propres factures Savr (collectes qu'il a programmées) restent visibles via Mon organisation > Facturation (décision F6 2026-06-07, cf. [[09 - Authentification et permissions]])*
- Les événements **brouillons** (date_evenement NULL) créés par un traiteur sur ses lieux — un brouillon n'est pas un événement confirmé, exclusion anti-fuite d'intention commerciale *(décision F3 2026-06-07 — prédicat SELECT `date_evenement IS NOT NULL OR organisation_id = self`)*
- Les coûts logistiques
- Les marges
- Les données des autres organisations gestionnaire_lieux
- Les données commerciales/personnelles des traiteurs au-delà du nom/logo — dont, sur les événements programmés par un tiers : contacts sur place (nom, téléphone), référence d'affaire, entité de facturation *(arbitrages Val C1-C3 2026-10-01 ; fermé en base par liste blanche de colonnes, cf. [[09 - Authentification et permissions]])*

**RLS** : filtre sur `users.organisation_id` + jointure `organisations_lieux`. Les requêtes coté collectes passent par une vue dédiée qui expose uniquement les colonnes non-financières.

---

## Navigation (refonte 2026-05-07)

Barre latérale gauche, **8 sections** *(Val 2026-10-07 : entrée **Événements** retirée, en doublon de Collectes. Val 2026-07-06, divergence M3.2 R19b-P2 : réintégration **Collectes** + **Registre réglementaire** — override de la décision 2026-05-03 ; neutralise la partie « 9→7 » du ticket BL-P2-13. Historique : 7 sections après refonte sobriété 2026-05-30 — entrée "Rapports" retirée ; vs 8 entre 2026-05-07 et 2026-05-30, vs 6 avant 2026-05-07)* :

1. **Dashboard** — page d'accueil (vue 360 — inchangé)
2. **Collectes** *(réintégrée Val 2026-07-06)* — liste des collectes sur les lieux de l'organisation (`/gestionnaire/collectes`, vue `v_collectes_gestionnaire_lieux`) → détail collecte
3. **Traiteurs** — partenaires intervenants
4. **Lieux** — liste des lieux de l'organisation
5. **Registre réglementaire** *(réintégré Val 2026-07-06)* — registre déchets ZD hérité (R13, `/registre`, prédicat gestionnaire `v_registre_dechets`)
6. **Mon pack AG** *(nouveau 2026-05-07)* — vue pack actif + crédits restants + historique consommation. Affiché uniquement si l'organisation a au moins 1 pack (`packs_antgaspi WHERE organisation_id = current_org`). Sinon l'entrée nav est masquée, sur toutes les pages où le gestionnaire voit son menu : son espace, le registre réglementaire et le formulaire de programmation. Comportement identique au Bloc 4 AG du §06.04 (pack actif unique, pas de liste des packs précédents). **Historique consommation** *(précisé 2026-10-07)* : liste des collectes Anti-Gaspi rattachées à un pack de l'organisation — collectes réalisées ou clôturées, et collectes annulées dont l'annulation tardive a débité un crédit (§05), ces dernières signalées « Annulée tardivement », sans nombre de repas ni association. Tous les packs de l'organisation sont couverts, y compris épuisés. Une collecte d'un traiteur tiers tenue sur un lieu du gestionnaire, débitée sur le pack du traiteur, n'y figure jamais. 50 collectes les plus récentes.
7. **Mon organisation** *(nouveau 2026-05-07)* — sous-sections : Profil organisation / Utilisateurs (invitations, rôles) / **Facturation** (entités juridiques, factures, mandats SEPA, intégration Pennylane). Réutilisation du composant §06.04 §6 "Mon organisation" (manager only — ici tous les users gestionnaire ont accès, pas de distinction manager/commercial en V1).
8. **Paramètres** — préférences personnelles utilisateur (notifications email, langue) — réduit vs avant (organisation + utilisateurs déplacés dans Mon organisation)

> **Ordre des sections** *(décision Val 2026-10-07, revue d'écran E2E)* : l'ordre ci-dessus est celui du menu. La place de « Mon pack AG », juste avant « Mon organisation », n'a pas été dictée par Val (interprétation Claude Code, confirmée par Val 2026-10-09). Sur mobile, la barre du bas affiche les 4 premières entrées : Dashboard, Collectes, Traiteurs, Lieux.

> La génération de synthèse PDF agrégée n'a plus d'entrée nav dédiée : elle se déclenche via le bouton "Exporter une synthèse PDF" du dashboard (ZD et AG), qui ouvre la modal de génération (cf. §4). Décision sobriété 2026-05-30.

**Bouton primaire dashboard "Programmer un événement"** *(refonte 2026-05-21 — formulaire unique événement-centré, ex 2 sous-boutons ZD/AG)* : ouvre le formulaire unique §06.01 (choix ☐ZD ☐AG en étape 1) avec les contraintes Cas Gestionnaire (combobox lieu filtrée à `organisations_lieux`, combobox traiteur opérationnel restreinte au référentiel sans option shadow). Si la case Anti-Gaspi est cochée sans pack actif, la soumission AG est bloquée (alerte "Contactez Savr pour négocier un pack AG") — la collecte ZD reste programmable.

**Section Collectes réintégrée (Val 2026-07-06 — divergence M3.2, override de la décision 2026-05-03)** : le gestionnaire dispose d'une entrée nav Collectes dédiée (`/gestionnaire/collectes`). **Colonnes de la liste** *(décision Val 2026-10-01, revue écran E2E)* : celles de la liste Collectes traiteur (§06.04 §3) plus le traiteur et les déchets labo estimés — **Date · Lieu (nom + adresse) · Client · Traiteur · Pax · Résultats · Déchets labo est. · Type · Statut**. **Client** = client organisateur, si renseigné par le traiteur (« — » sinon) ; **Traiteur** = nom du traiteur opérationnel ; **Déchets labo est.** *(décision Val 2026-10-07)* = estimation des déchets produits au labo du traiteur pour l'événement de la collecte, `pax × coefficient` du traiteur opérationnel (cf. [[05 - Règles métier#R_dechets_labo_estimes]]) — affichée sur les lignes de collecte ZD seulement (arbitrage Val 2026-10-07 : la notion ne tient pas pour une collecte AG, qui affiche `—`) ; même valeur et même format que la colonne de la liste Événements, `—` si coefficient non communiqué ; c'est une valeur de l'événement, répétée sur chacune de ses collectes ZD ; colonne propre au gestionnaire, non triable ; **Résultats** = ceux de la liste traiteur sur une collecte réalisée (ZD : poids · taux de recyclage · CO₂ évité ; AG : repas donnés · CO₂ évité), avec le téléchargement du rapport ; les repas d'une collecte programmée par un traiteur tiers sont lus dans l'attribution par la vue `v_attributions_gestionnaire` (même règle que la fiche ; l'ancien repli sur l'attestation de don, D13, est retiré depuis le 2026-10-04) ; **Type** est gardé parce que la liste mêle ZD et AG. Pas de colonne « Événement », **aucun picto d'action** (la fiche porte « Modifier » pour ses propres programmations, D7). La liste reste plate et paginée (décisions 2026-07-14 et 2026-09-22 inchangées). Le détail d'une collecte (pesées par flux, repas, bordereau, rapport recyclage, attestation don) vit dans la fiche collecte. **Export CSV** *(décision Val 2026-10-07)* : bouton « Exporter CSV » dans l'en-tête de la liste, 1 ligne = 1 collecte, colonnes et filtres décrits au [[12 - Reporting et exports]] §2.

> **Fiche collecte (décision Val 2026-09-29)** : la fiche collecte reprend le pop-up client §06.04 « Fiche collecte (vue détail) » (en-tête, frise client, onglets Informations / Logistique / Bilan & documents) ; seules changent les actions autorisées au rôle. **Exception** *(arbitrage Val C2 2026-10-01)* : bloc « Contacts sur place » **absent** sur la collecte programmée par un tiers (traiteur ou agence) — le gestionnaire ne voit pas les données personnelles des traiteurs (cf. « ne voit pas » ci-dessus) ; le bloc reste affiché sur ses propres programmations (`evenements.organisation_id = self`). _(2026-10-04 — vue `v_attributions_gestionnaire` implémentée)_ Collecte AG programmée par une autre organisation : « Repas donnés », « Repas par pax » et le bloc « Association bénéficiaire » (nom, ville, présentation) sont lus dans l'attribution par la vue `v_attributions_gestionnaire` (« — » et pas de bloc tant qu'aucune attribution n'existe) ; radar ZD masqué (garde `f_benchmark_single_collecte`). L'ancien repli sur l'attestation de don (D13) et le masquage du bloc Association sont retirés.


> **Barre de filtres de la liste Collectes** *(R-UI-4b 2026-10-02 ; choix multiple 2026-10-06)* : type de collecte ZD / AG levable (« Toutes »), puis Période · Lieu · Traiteur · Type d'événement · Taille d'événement. Lieu, Traiteur, Type et Taille d'événement sont à choix multiple, case « Tous » en tête (Design System §5.5). Options : celles de la barre globale du dashboard (lieux de l'organisation ; traiteurs intervenus sur les 24 derniers mois). Persistante en query string : `lieu` et `traiteur` en liste séparée par des virgules, le lien d'un drill-down de Top liste étant une liste d'un élément. Pas d'onglets Programmées / Historique ni de filtre Statut.

> **Pagination** : liste paginée côté serveur, **50 collectes par page** (aligné §06.06 Back-office Admin). Au-delà d'une page, l'écran affiche le **nombre total de collectes du périmètre filtré** et le composant Pagination du Design System (§10 §6). Le total affiché est celui de la base, pas celui de la page : c'est lui qui rend la troncature visible, la liste étant volontairement large (« tous statuts, type ZD/AG non figé », cf. drill-down des Top listes). Un changement de filtre (dont un drill-down) **réinitialise la pagination à la page 1**. Tri départagé (`date_collecte` puis `id`) : `date_collecte` n'est pas unique, sans départage deux pages successives peuvent réordonner les ex æquo et faire disparaître une ligne. *(décision Val 2026-09-22 — la section réintégrée le 2026-07-06 ne spécifiait pas la taille de la liste ; la route coupait à 100 lignes sans le signaler.)*

> **Page demandée au-delà de la dernière** (lien partagé, ou liste qui a rétréci pendant la consultation) : la route répond **200 avec une page vide ET le total exact**, jamais une erreur — l'écran afficherait sinon « Le chargement des collectes a échoué » sur un parc sain. L'écran, lui, **ramène l'utilisateur sur la dernière page valide** plutôt que de montrer l'état vide : le bloc de pagination ne s'affiche que lorsque la liste est non vide, donc l'état vide serait un cul-de-sac, avec le message d'un parc réellement vide. *(confirmé Val 2026-09-22.)*

(paragraphe supprimé — décision Val 2026-10-07 : la liste Événements est retirée et le badge n’est pas repris sur la liste Collectes.)

---

## 1. Dashboard (page d'accueil)

### Principe

Le gestionnaire de lieux arrive sur le dashboard après connexion. Vue 360 consolidée sur l'ensemble de son parc de lieux. **Refonte 2026-05-21** : bouton primaire "Programmer un événement" en bandeau actions rapides (cf. §Navigation — formulaire unique événement-centré §06.01, ex bouton "Programmer une collecte" 2026-05-07), aligné sur le pattern §06.04. Le reste du dashboard reste orienté consultation/synthèse.

Le dashboard est scindé en **2 onglets** en haut de page :
- **Zéro-déchet** (sélectionné par défaut)
- **Anti-gaspi**

Chaque onglet affiche son propre jeu de blocs adaptés au métier (les flux ZD se mesurent en kg, l'AG en repas/dons). La barre de filtres globale est commune aux deux onglets.

### Barre de filtres globale (au-dessus des onglets)

5 filtres persistants en query string (deep-linkable) — les filtres s'appliquent à **tous les blocs** du dashboard :

| Filtre             | Type                           | Valeurs                                                                                                                      |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Période            | Date range picker + raccourcis | 7j / 30j / Trimestre en cours / 12 derniers mois (défaut) / Année civile / Personnalisé — **filtre sur `collectes.date_collecte`** (NOT NULL, cohérent avec les vues KPI M3.5) |
| Lieux              | Multi-select                   | Liste des lieux rattachés à l'organisation (`organisations_lieux`) — défaut "Tous"                                           |
| Traiteurs          | Multi-select                   | Traiteurs intervenus sur au moins une collecte sur les lieux de l'organisation sur les 24 derniers mois                      |
| Type d'événement   | Multi-select                   | `types_evenements.libelle` (4 catégories de format de service : Cocktail apéritif, Cocktail repas complet, Repas assis, Autre) — référentiel extensible Admin par ajout direct de ligne |
| Taille d'événement | Multi-select                   | Bracket calculé sur `evenements.pax` : **XS** [0-249], **S** [250-499], **M** [500-749], **L** [750-999], **XL** [1000+]     |
|                    |                                |                                                                                                                              |

Bouton "Réinitialiser" ramène aux valeurs par défaut. Compteur "X collectes correspondent" sous la barre.

### Bloc 1 — KPIs (4 cartes)

4 cartes chiffres clés en haut de page (recalcul live selon les filtres actifs) :

| KPI | Détail | Onglet ZD | Onglet AG |
|---|---|---|---|
| Nombre de collectes | Total filtré | ZD uniquement | AG uniquement |
| Tonnage collecté | kg total | Somme `collecte_flux.poids_reel_kg` | — |
| Taux de recyclage *(renommé 2026-05-06 — ex "Taux de tri global", formule changée)* | % moyen pondéré par tonnage | Moyenne pondérée des `collectes.taux_recyclage` (formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]]). Cas `taux_recyclage IS NULL` (total pesées = 0) → exclu de la pondération. | — |
| Repas donnés | Nombre de repas collectés | — | Somme repas AG |
| Pax cumulés | Couverts cumulés sur les événements filtrés | ✓ | ✓ |
| kg/pax moyen | Tonnage / pax cumulés | ✓ | — |
| Repas/pax moyen | Repas donnés / pax cumulés | — | ✓ |

Mapping 4 cartes affichées par onglet :
- **ZD** : Nombre de collectes · Tonnage collecté · Taux de recyclage · kg/pax moyen
- **AG** : Nombre de collectes · Repas donnés · Pax cumulés · Repas/pax moyen

Chaque carte porte une **sparkline** (tendance mensuelle) et une **variation N-1** (sauf « kg/pax » et « Repas/pax moyen », arbitrage Val 2026-10-08) *(déclinaison Cockpit, GO-VISUAL Val 2026-07-10)*. **Les cartes KPI ne sont PAS cliquables** *(décision Val GO-VISUAL 2026-07-10)*. Pas de héros CO₂ côté gestionnaire (endpoint agrégé, sans `co2_*`).

---

### Onglet **Zéro-déchet**

#### Bloc 2 ZD — Évolution mensuelle (graphique barres empilées)

Graphique barres empilées par mois (période filtrée, granularité automatique : jour si <30j, semaine si <12 mois, mois sinon) :
- **Axe X** : période
- **Axe Y** : tonnage en kg (bascule kg/T automatique au-delà de 10 000 kg)
- **Empilement** : 5 segments par barre = les 5 flux ZD (`biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`)
- **Courbe superposée** (axe Y secondaire %) : taux de recyclage moyen pondéré par tonnage (formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]])

Légende cliquable pour masquer/afficher chaque flux. Tooltip au survol : valeurs kg + % par flux.

#### Bloc 3 ZD — Radar kg/pax par flux × benchmark parc

**Représentation (décision Val 2026-09-28 — remplace les 5 jauges bullet)** : radar 5 axes « lignes seules » (1 axe par flux ZD), échelle **indice parc = 100 par flux** (le parc forme un pentagone régulier `primary-300`, « Vous » = ligne navy `primary-700` sans remplissage, grille polygonale sans rayons). Liste à côté du radar : par flux, kg/pax réel + repère parc + badge d'écart coloré + légende des statuts. Flux sans donnée : axe « n/d » grisé, pas de point, badge « Données manquantes ». Survol d'un axe ou d'une ligne : infobulle Vous / Parc / Écart. Données, filtres, k-anonymat et seuils de couleur inchangés ; dans la suite, « jauge » se lit « axe du radar » et « point rouge » se lit « repère parc ».

##### Barre de filtre benchmark dédiée (au-dessus du bloc, distincte de la barre globale)

Encart compact "Filtres benchmark" affichant **4 critères** (lieux, traiteurs, type, taille — période fixe 24 mois), mais qui ne s'appliquent **qu'au point rouge benchmark**, pas aux jauges du gestionnaire :

| Filtre benchmark | Type | Valeurs |
|---|---|---|
| Lieux benchmark | Multi-select | Lieux rattachés à l'organisation du gestionnaire (`organisations_lieux`) — défaut « Tout le parc Savr » |
| Traiteurs benchmark | Multi-select | Traiteurs intervenus sur au moins une collecte sur ses lieux depuis 24 mois (même liste que le filtre global Traiteurs) — défaut « Tout le parc Savr » |
| Type d'événement benchmark | Multi-select | `types_evenements.libelle` — défaut "Tous" |
| Taille d'événement benchmark | Multi-select | XS / S / M / L / XL — défaut "Tous" |

> **Période du repère parc fixe = 24 mois glissants, non modifiable** (décision Val 2026-09-28) — imposée côté serveur sur toutes les vues benchmark (dashboards, fiche collecte, Dashboard Client Admin, rapport PDF) ; `periode_debut`/`periode_fin` reçus sont ignorés.

**Initialisation** : à l'ouverture du dashboard, les filtres benchmark héritent par défaut des filtres globaux (Type d'événement + Taille d'événement uniquement). Le gestionnaire peut ensuite les modifier indépendamment (bouton "Réinitialiser" pour revenir à l'héritage par défaut).

> **Périmètre des listes Lieux / Traiteurs (décision Val 2026-10-06).** Le gestionnaire ne peut nommer que ses lieux rattachés et les traiteurs intervenus sur ses lieux. Sans rien cocher, le repère reste calculé sur **tout le parc Savr** : la case de tête de ces deux listes s'appelle « Tout le parc Savr » (et non « Tous »), cochée par défaut, décochée dès qu'une ligne est cochée ; la recocher vide la sélection. Cocher toutes les lignes reste une sélection explicite (« n sélectionnés »), jamais ramenée à « Tout le parc Savr ». Type d'événement et Taille gardent « Tous ». La règle est tenue en base : `f_benchmark_lieux_parc` et `f_benchmark_traiteurs_parc` refusent le rôle `gestionnaire_lieux`, et `f_benchmark_kg_pax_zd` refuse (SQLSTATE 42501, relayé en 403) un lieu non rattaché ou un traiteur que sa vue `v_traiteurs_gestionnaire` ne lui rend pas — type traiteur, opérationnel sur un événement daté tenu sur l'un de ses lieux, sans fenêtre de 24 mois (cf. §04). La liste affichée (24 mois) est un sous-ensemble de cette borne. Les rôles traiteur et agence gardent, dans ce filtre, tous les lieux du parc (« lieux rattachés » n'est pas défini pour eux — hors lot).

**Avertissement UX** : dès que le gestionnaire coche un lieu ou un traiteur (tous sont dans son périmètre), un tooltip affiche "Vous comparez vos données à vos propres données — le benchmark perd son rôle de référence parc". Pas de blocage, juste un avertissement.

##### Radar (1 axe par flux ZD, 5 axes au total)

- **Jauge gestionnaire** : ratio `kg du flux / pax cumulés` sur la période et le périmètre **des filtres globaux** (pas des filtres benchmark)
- **Échelle** : indice parc = 100 par flux (remplace la borne max parc × 1,2 des jauges — 2026-09-28)
- **Point rouge** : **benchmark parc Savr** = moyenne `kg flux / pax` calculée sur l'ensemble du parc Savr selon les **filtres benchmark dédiés** (les 5 critères ci-dessus)

**Règle k-anonymat (durcie 2026-09-22)** : si l'échantillon benchmark filtré contient strictement moins de **5 collectes**, **ou moins de 3 acteurs distincts** (organisations programmatrices et traiteurs opérationnels, minimum des deux compteurs), le point rouge est **masqué** et un tooltip affiche "Données insuffisantes pour benchmark (échantillon non comparable — affinez ou élargissez les filtres benchmark)". Le libellé ne cite plus « < 5 collectes » : il ne doit pas révéler laquelle des deux conditions a masqué le segment. La jauge gestionnaire reste affichée.

**Source benchmark** : agrégat exposé via la fonction PostgreSQL `f_benchmark_kg_pax_zd` (cf. [[04 - Data Model]] §Fonction SQL `f_benchmark_kg_pax_zd`). Paramètres acceptés : `flux_id`, `type_evenement_ids[]`, `taille_evenement_codes[]`, `periode_debut`, `periode_fin`, `lieu_ids[]`, `traiteur_ids[]`. Aucun chiffre brut d'autre gestionnaire n'est exposé — uniquement la moyenne. K-anonymat appliqué côté serveur : ≥ 5 collectes **et ≥ 3 acteurs distincts**.

**Légende couleur** (basée sur le ratio jauge gestionnaire / point benchmark, **chacun calculé sur son propre périmètre de filtres**) :
- Vert : ratio gestionnaire ≤ benchmark (performance ≥ moyenne du segment de référence sélectionné)
- Orange : ratio gestionnaire entre 100% et 130% du benchmark
- Rouge : ratio gestionnaire > 130% du benchmark
- Gris : benchmark masqué (k-anonymat) → la jauge n'a pas de couleur de performance, seule la valeur kg/pax est affichée

**Pas de colonnes additionnelles** (suppression vs. maquette source : pas de "nb collectes par mois", pas de "taux remplissage moyen", pas de "déclassement").

#### Bloc 4 ZD — Répartition des tonnages (donut)

Donut affichant la part relative des 5 flux ZD sur la période filtrée. Tooltip au survol : kg + %. Total au centre = tonnage total.

#### Bloc 5 ZD — retiré

> **Retiré le 2026-10-01 (décision Val)** : la liste « Prochaines collectes » ne figure plus sur le dashboard. Les collectes à venir se lisent dans l'onglet Collectes. Les blocs 6, 7 et 8 gardent leur numéro.

#### Bloc 6 ZD — Top 5 lieux ZD

Tableau ordonné par tonnage, période filtrée :
- Lieu · Nombre de collectes ZD · Tonnage · Taux de recyclage *(moyenne pondérée par tonnage)*
- **Chaque ligne cliquable → liste Collectes filtrée sur le lieu** *(drill-down, décision Val 2026-07-14)*. Liste plate (pas d'onglet Historique), tous statuts, type ZD/AG non figé ; filtres du dashboard propagés (période + Type/Taille d'événement). Chip « Filtre actif » ; libellé via `sessionStorage`. Le chip nomme une seule cible : il disparaît dès que la barre filtre sur un deuxième lieu ou un deuxième traiteur, et revient si elle ne filtre de nouveau que sur la cible. Plusieurs lieux ou plusieurs traiteurs dans l'adresse à l'arrivée sont des filtres ordinaires, sans chip ; le lieu prime sur le traiteur. Un traiteur absent des options de la barre (hors des 24 derniers mois) garde sa case, cochée et nommée.

#### Bloc 7 ZD — Top 5 traiteurs ZD

Tableau ordonné par nombre de collectes ZD, période filtrée :
- Traiteur · Nombre de collectes ZD · Tonnage · Taux de recyclage *(moyenne pondérée par tonnage)*
- **Chaque ligne cliquable → liste Collectes filtrée sur le traiteur** *(drill-down, décision Val 2026-07-14)*.

#### Bloc 8 ZD — Exporter une synthèse PDF (ZD)

Bouton "Exporter une synthèse PDF" pré-rempli :
- **Période** : période active des filtres globaux
- **Lieux / Traiteurs / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `ZD` (figé selon onglet actif)

Clic → ouvre la modal de génération §4 Génération de synthèse PDF en étape 3 directement (téléchargement après génération Next.js API Route + Railway/Puppeteer ≤2 min). Si l'utilisateur veut modifier les filtres avant génération, retour aux étapes 1-2 possible.

Pattern aligné §06.04 espace traiteur (bouton dashboard équivalent).

---

### Onglet **Anti-gaspi**

#### Bloc 2 AG — Évolution mensuelle (graphique courbe)

Graphique en courbe (granularité automatique identique à ZD) :
- **Axe X** : période
- **Axe Y gauche** : nombre de repas donnés
- **Axe Y droit** (courbe superposée) : ratio repas/pax

Pas de jauge en onglet AG (Décision Val 2026-05-02 — option B retenue : KPI + courbe suffisent, pas de benchmark visuel par flux puisque AG = un seul flux `don_alimentaire`).

#### Bloc 3 AG — Top associations bénéficiaires

Tableau ordonné par nombre de repas reçus (période filtrée) :
- Association · Ville · Nombre de collectes · Repas reçus

Source : `attributions_antgaspi` jointe à `associations`.

> **Correction 2026-07-07** : colonne `Distance moyenne (km)` supprimée (alignement §06.04 traiteur — donnée non restituée au client, reste un critère interne de l'algo d'attribution AG).

> **Note numérotation** : pas de Bloc 4 AG (pas de donut côté AG, AG = un seul flux `don_alimentaire`). On saute directement à Bloc 6 AG pour préserver l'alignement des numéros entre onglets sur les blocs partagés (6/7/8) — le Bloc 5 est retiré depuis le 2026-10-01.

#### Bloc 5 AG — retiré

> **Retiré le 2026-10-01 (décision Val)** : même décision que le Bloc 5 ZD.

#### Bloc 6 AG — Top 5 lieux AG

Tableau ordonné par repas donnés, période filtrée :
- Lieu · Nombre de collectes AG · Repas donnés · Repas/pax
- **Chaque ligne cliquable → liste Collectes filtrée sur le lieu** *(drill-down AG, décision Val 2026-07-14)*.

#### Bloc 7 AG — Top 5 traiteurs AG

Tableau ordonné par nombre de collectes AG, période filtrée :
- Traiteur · Nombre de collectes AG · Repas donnés · Repas/pax
- **Chaque ligne cliquable → liste Collectes filtrée sur le traiteur** *(drill-down AG, décision Val 2026-07-14)*.

#### Bloc 8 AG — Exporter une synthèse PDF (AG)

Bouton "Exporter une synthèse PDF" pré-rempli :
- **Période** : période active des filtres globaux
- **Lieux / Traiteurs / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `AG` (figé selon onglet actif)

Clic → ouvre la modal de génération §4 Génération de synthèse PDF en étape 3 directement.

---

## 2. Section Événements

(remplacée par le bloc ci-dessus)

### Barre de filtres (5 critères, identiques à la barre globale du Dashboard)

Persistante en query string (deep-linkable). Cohérente avec le Dashboard pour permettre la navigation depuis les cartes KPI clickables (les filtres sont transmis via query string).

| Filtre | Type | Valeurs |
|---|---|---|
| Période | Date range picker + raccourcis | 7j / 30j / Trimestre en cours / 12 derniers mois (défaut) / Année civile / Personnalisé |
| Lieux | Multi-select | Lieux rattachés à l'organisation (`organisations_lieux`) |
| Traiteurs | Multi-select | Traiteurs intervenus sur au moins un événement sur les lieux de l'organisation (24 derniers mois) |
| Type d'événement | Multi-select | `types_evenements.libelle` |
| Taille d'événement | Multi-select | XS / S / M / L / XL (bracket calculé sur `evenements.pax`) |

Filtres complémentaires propres à la liste Événements :

| Filtre | Type | Valeurs |
|---|---|---|
| Type de collecte | Multi-select (case « Toutes » = aucun filtre) | "ZD seul" / "AG seul" / "ZD et AG" — partition : chaque événement est dans une seule case selon les types de ses collectes ; « avec au moins une ZD » = ZD seul + ZD et AG ; idem AG. Un événement sans collecte ZD ni AG n'apparaît qu'avec « Toutes » (arbitrage Val F1 2026-10-01). API : `types_collecte[]` ; l'ancien `type_collecte=avec_zd\|avec_ag\|zd_et_ag` reste lu pour les liens existants. |
| Statut consolidé | Multi-select | En cours / Terminé / Annulé |

Bouton "Réinitialiser" ramène aux valeurs par défaut. Compteur "X événements correspondent" sous la barre.

### Vue liste

Agrégation par événement (un événement peut avoir 1 à N collectes ZD/AG). Tri par défaut antéchronologique sur la date de début de l'événement.

| Colonne | Détail |
|---|---|
| Date | Date début événement (DD/MM/YYYY) |
| Événement | Nom |
| Lieu | |
| Traiteur | Organisation traiteur |
| Pax | Nombre de couverts |
| Nb collectes | ZD + AG (ex: "2 ZD + 1 AG") |
| Tonnage total | kg ZD agrégé sur l'événement |
| Déchets labo estimés *(ajout 2026-05-22)* | Estimation kg du déchet produit au labo du traiteur = `pax × coefficient` du traiteur opérationnel pour l'année − 1 (cf. [[05 - Règles métier#R_dechets_labo_estimes]]). `—` si coefficient non communiqué, ou si l'événement n'a aucune collecte ZD *(arbitrage Val 2026-10-07)*. Distinct du tonnage collecté. |
| Repas donnés | Si AG sur l'événement |
(ligne emportée par le remplacement de la section §2 ; règle reprise au §12 §2, bloc ci-dessus)

### Détail événement

Clic sur une ligne → vue consolidée en lecture seule (consultation pure, aucune action de modification ou d'annulation) :

**Bloc en-tête événement** :
- Nom, date de début, lieu, pax, type d'événement, taille bracket
- Traiteur (nom + logo, pas d'email / téléphone / SIRET)
- Client Organisateur si renseigné par le traiteur
- **Déchets labo estimés (kg)** *(ajout 2026-05-22)* — estimation du déchet produit en amont au laboratoire du traiteur = `pax × coefficient` du traiteur opérationnel pour l'année − 1 (cf. [[05 - Règles métier#R_dechets_labo_estimes]]). Affiché avec tooltip explicatif ("estimation amont, distincte des déchets collectés sur l'événement ci-dessous"). `—` si le traiteur n'a pas communiqué de coefficient pour l'année applicable, ou si l'événement n'a aucune collecte ZD *(arbitrage Val 2026-10-07)*. Le coefficient brut n'est jamais affiché, seule l'estimation kg.

**Bloc collectes rattachées** : 1 sous-bloc par collecte (ZD et/ou AG), affichant :
- Type (ZD / AG), date + heure début, **statut affiché côté client** — mapping canonique : voir [[04 - Espace client traiteur#Mapping d'affichage du statut collecte côté client (canonique — décision Val 2026-06-30, divergence UX-STATUTS)]]. Points clés : `programmee` → **Créée** (jamais « Programmée »), `validee` → Validée, `en_cours`/`realisee` → En cours, `cloturee` → **Réalisée**, `realisee_sans_collecte` → Sans excédents, `annulee`/`annulation_demandee` → Annulée. *(Supersède le mapping F2 2026-06-07 `programmee`/`validee` → Programmée · `realisee`/`cloturee` → Réalisée — décision Val 2026-06-30. UX-only, enum `collectes.statut` inchangé. Le « Statut consolidé » événement ci-dessus reste distinct.)*
- **Pour ZD** : détail des pesées par flux (kg par flux pour les 5 flux ZD : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`), **taux de recyclage** de la collecte *(lecture directe `collectes.taux_recyclage`, formule à captation par filière)*
- **Pour AG** : repas donnés, association(s) bénéficiaire(s) avec ville et **distance**, attribution(s). *(Arbitrage Val 2026-09-21 — la distance EST restituée au gestionnaire sur le détail événement, par exception à la correction 2026-07-07 §2 qui reste valable pour la **liste** Associations.)* **Spécification du calcul** : distance orthodromique (haversine, **même formule que l'algo d'attribution AG**) entre les coordonnées GPS de l'association et celles du **lieu de l'événement** ; arrondie à l'entier le plus proche, affichée en km (« 12 km »). **Aucune colonne stockée** — calcul à la volée à chaque lecture (fonction partagée `lib/attribution-ag/associations-par-distance.ts`). Coordonnées manquantes côté association **ou** côté lieu → affichage « — » (jamais 0, jamais d'estimation).

**Bloc documents** : tous les justificatifs disponibles à l'échelle de l'événement et des collectes :
- Bordereau ZD (par collecte ZD)
- Rapport de recyclage (1 par événement, agrégé)
- Attestation(s) de don AG (par attribution)

**Note** : pas de bouton d'action **sur le détail événement**. Le gestionnaire ne peut pas dupliquer ni annuler. *(Précision D7, arbitrage Val 2026-09-30)* : sur la **fiche collecte**, le gestionnaire garde « Modifier » sur **ses propres programmations** (synthèse M1.2 §06.04, `f_collecte_editable`) — grisé sur les collectes de traiteurs tiers ; jamais d'annulation.

### Export CSV

Bouton "Exporter" en haut de la liste. Respecte les filtres actifs. Format CSV UTF-8 séparateur `;`.

**Grain export V1 = niveau événement** (1 ligne = 1 événement, données agrégées). Décision Val 2026-05-03 (option C1).

Colonnes exportées (voir [[12 - Reporting et exports]] §1.6 pour la spec détaillée) :
- Date événement, nom événement, lieu, traiteur, type d'événement, taille bracket, pax
- Nb collectes ZD, nb collectes AG, tonnage ZD total, taux de recyclage *(moyenne pondérée par tonnage des collectes ZD de l'événement, ex `taux_tri_pct` renommé 2026-05-06)*, repas AG donnés
- Statut consolidé, période de collecte (date première collecte → dernière collecte)

Pas d'export grain collecte côté gestionnaire en V1. Si un client demande le détail collecte par collecte, il passe par les rapports de synthèse PDF (§4 Génération de synthèse PDF) ou par une demande au support.

---

## 3. Section Lieux

### Vue liste

Tous les lieux de l'organisation. Rattachement géré par Admin Savr (ajout = bouton « Demander l'ajout d'un lieu », cf. « Ajout / retrait lieu » ci-dessous ; retrait = demande via support).

| Colonne | Détail |
|---|---|
| Nom | Nom du lieu |
| Adresse | |
| Capacité | Capacité d'accueil (si renseignée — `lieux.capacite_maximum`, exposée via `v_lieux_clients`) |
| Nb collectes 12 mois | Indicateur d'activité |
| Tonnage 12 mois | |

### Détail lieu

Fiche lieu **en pop-up sur la liste Lieux** *(décision Val 2026-10-06 — même cadre que les fiches collecte ; l'adresse porte la fiche ouverte, `?lieu=<id>`)*, en **lecture seule**, trois onglets :
- **Informations** — informations générales (**Adresse accès livraison** *(label refondé 2026-05-08)*, capacité, photos si disponibles *(« type » retiré 2026-07-06 — divergence M3.2 : colonne `lieux.type` inexistante dans le schéma V1 ET le DDL cible V2 ; si une catégorie de lieu est souhaitée un jour, c'est une évolution Data Model + DDL, pas un patch texte)*, stationnement / accès office / type véhicule max — tous enum facile/difficile/très difficile pour stationnement+accès office, enum véhicule unifié `velo_cargo/camionnette/fourgon/vul/poids_lourd` pour type véhicule max — cf. [[04 - Data Model]] table `lieux`)
  Région, stationnement, accès office et flux s'affichent par leur libellé.
- **Traiteurs** — liste des traiteurs opérant sur le lieu, calculée à la lecture depuis ses collectes (traiteur opérationnel de l'événement, tous statuts, sans limite de date — même règle de comptage que la fiche lieu Admin, cf. [[04 - Data Model]] note sous la table `lieux` ; périmètre = ce que le gestionnaire lit sous sa RLS : un événement d'un tiers sans date ne lui est pas servi, son traiteur peut donc manquer là où la fiche Admin le montre), avec nombre de collectes (tous statuts) et tonnage ZD (collectes clôturées). Onglet toujours présent ; état vide si aucune collecte.
- **Activité** — l'histogramme « Évolution mensuelle Zéro Déchet » du dashboard ([[11 - Dashboards]] Bloc 2 ZD : tonnages par flux, taux de recyclage superposé), filtré sur le lieu, sur les 12 derniers mois ; état vide sinon. Pas d'historique des collectes sur la fiche *(décision Val 2026-10-07)* : elles se consultent par la liste Collectes filtrée sur le lieu.

> **Demande de modification d'information** *(décision Val 2026-10-06)* : le gestionnaire ne modifie pas les informations d'un lieu (référentiel tenu par l'Admin Savr, [[04 - Data Model]]). Le pied de la fiche porte un bouton « Demande de modification d'information » : il décrit ce qui doit être corrigé (10 à 1 000 caractères) et la demande ouvre une alerte in-app pour l'Admin (code `lieu_modification_demandee`, « À traiter », lien vers la fiche lieu Admin ; ni email ni Slack). Bouton proposé sur les seuls lieux du parc de l'organisation (`organisations_lieux`). Une demande ouverte par lieu (index unique en base) : tant que l'Admin n'a pas résolu l'alerte, le bouton est neutralisé (« Une demande de modification est en cours de traitement par l'équipe Savr »). Le message de l'alerte nomme le lieu et l'organisation qui demande, sans donnée personnelle ; l'auteur est tracé dans `audit_log` (qui, quand).

**Masqué côté gestionnaire de lieux V1** : tarifs ZD négociés, tarifs AG, tout élément financier. Les tarifs restent exclusivement dans le back-office Admin. **Champs admin/ops only également masqués** *(refonte 2026-05-08)* : `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` (cf. [[05 - Règles métier#R_lieux_admin_only_fields]]).

### Ajout / retrait lieu

Pas d'interface de rattachement en V1. Sur la liste Lieux, le bouton « Demander l'ajout d'un lieu » ouvre un formulaire simple — nom du lieu (2 à 150 caractères) et adresse (5 à 300) obligatoires, précision facultative (1 000 caractères au plus). La demande ouvre une **alerte in-app dans la file de l'Admin Savr** *(décision Val 2026-10-07 — même canal que la « Demande de modification d'information » de la fiche lieu ; ni email ni Slack)* : code `lieu_ajout_demande`, « À traiter », rattachée à l'organisation qui demande (lien vers sa fiche Admin). Le message de l'alerte nomme l'organisation et reprend le lieu souhaité, sans donnée personnelle ; l'auteur est tracé dans `audit_log` (non affiché dans l'interface Admin en V1 : les contacts de l'organisation se trouvent sur sa fiche). Une demande d'ajout ouverte à la fois par organisation (index unique en base) : tant que l'Admin n'a pas résolu l'alerte, le bouton est neutralisé (« Une demande d'ajout est en cours de traitement par l'équipe Savr »). La demande ne crée ni lieu ni rattachement : traitement manuel côté Admin (voir [[06 - Back-office Admin Savr]] §7, fiche lieu, champ « Gestionnaire »), qui résout ensuite l'alerte.

---

## 4. Génération de synthèse PDF (refonte 2026-05-05 — à la demande uniquement ; refonte sobriété 2026-05-30 — plus d'entrée nav)

> **Refonte 2026-05-05** : suppression de la vue liste + suppression des batchs auto + suppression de la table `rapports_synthese`. La génération de synthèse devient une simple **modal à la demande**, accessible via bouton "Exporter une synthèse PDF" depuis le dashboard (cohérent avec espace traiteur §06.04).
> **Refonte sobriété 2026-05-30** : l'entrée nav "Rapports" (qui ne faisait que rouvrir la modal en doublon du bouton dashboard) est retirée. La modal reste accessible exclusivement via le bouton dashboard.

### Modal de génération synthèse

Accessible depuis le bouton "Exporter une synthèse PDF" du dashboard, dans les deux onglets ZD et AG (filtres pré-remplis depuis le dashboard — cf. Bloc 8 ZD et Bloc 8 AG).

**Étape 1 — Période** :
- Raccourcis : 7j / 30j / Trimestre en cours / 12 derniers mois (défaut) / Année civile
- Ou : Période personnalisée (date début → date fin)

**Étape 2 — Filtres (tous optionnels)** :
- Lieux (multi-select parmi les lieux de l'organisation)
- Traiteurs (multi-select parmi les traiteurs intervenus sur au moins une collecte sur ses lieux sur les 24 derniers mois) — visible côté gestionnaire (pas de restriction concurrentielle ici)
- Types de collecte (ZD / AG)

**Étape 3 — Générer** :
- Clic "Générer" → génération PDF (Next.js API Route + Railway/Puppeteer, cible ≤ 2 min)
- Modal affiche état "En cours" + spinner
- Une fois généré : téléchargement direct du PDF (URL pré-signée Cloudflare R2 temporaire, expire 1h)
- **Pas d'archivage** côté DB (refonte 2026-05-05)

### Rapports automatiques (supprimés refonte 2026-05-05)

> Suppression complète des batchs mensuel / trimestriel / annuel côté gestionnaire (cohérent avec côté traiteur). Réactivation possible V1.1 sur retour terrain.

### Contenu du PDF

Voir [[12 - Reporting et exports]] §1.6 pour la spec détaillée. Particularité côté gestionnaire de lieux :
- Page de garde : logo Savr + logo de l'organisation gestionnaire de lieux
- Section "Ventilation géographique" systématiquement affichée (plusieurs lieux attendus)
- Section "Ventilation par traiteur" affichée (le filtre `traiteur_ids[]` reste autorisé côté gestionnaire — distinct de la restriction côté traiteur)

---

## 5. Section Traiteurs

### Vue liste

Tous les traiteurs ayant réalisé au moins une collecte sur les lieux de l'organisation.

| Colonne | Détail |
|---|---|
| Traiteur | Nom + logo |
| Nb collectes 12 mois | |
| Tonnage 12 mois | |
| Taux de recyclage moyen | Moyenne pondérée par tonnage des `collectes.taux_recyclage` ZD du traiteur sur les lieux du gestionnaire, formule à captation par filière (cf. [[05 - Règles métier#R_taux_recyclage]]) |
| Repas donnés 12 mois | |
| Lieux d'intervention | Liste des lieux où ce traiteur est intervenu |

### Détail traiteur

Fiche traiteur (vue non commerciale), **en pop-up sur la liste Traiteurs** *(refonte 2026-10-07 — même cadre que la fiche lieu ; l'adresse porte la fiche ouverte, `?traiteur=<id>`, et l'ancienne adresse `/gestionnaire/traiteurs/<id>` y redirige)*. Lecture seule, aucune action.

- En-tête : logo, nom (pas de ville — aucune colonne dédiée dans `organisations` ; pas d'adresse / email / téléphone / SIRET / notes internes)
- Onglet **Lieux d'intervention** : lieux de l'organisation où le traiteur est intervenu, avec le nombre de collectes par lieu sur les 24 derniers mois. Collectes **clôturées** seules — mêmes lieux que la colonne « Lieux d'intervention » de la liste *(arbitrage Val 2026-10-07 ; l'onglet « Traiteurs » de la fiche lieu, lui, compte tous les statuts)*. Tri par nombre de collectes puis par nom.
- Onglet **Activité** : sélecteur Zéro Déchet / Anti-Gaspi, puis pour le type choisi les 4 cartes KPI et le graphique d'évolution mensuelle du Dashboard (Blocs 1 et 2), filtrés sur ce traiteur, sur les 12 derniers mois — mêmes chiffres que le Dashboard filtré sur ce traiteur (collectes clôturées sur les lieux de l'organisation uniquement). Sans collecte du type sur la période : un message, ni cartes à zéro ni graphique.
- Pas d'historique des collectes sur la fiche *(retiré 2026-10-07, arbitrage Val — la liste Collectes filtrée sur le traiteur le donne)*
- Pas d'accès aux tarifs, pas d'accès aux marges

**Pourquoi limité** : le gestionnaire de lieux et le traiteur ont souvent une relation commerciale directe (référencement, contrat). Savr ne veut pas exposer les tarifs négociés traiteur↔Savr sur l'espace gestionnaire de lieux (confidentialité commerciale).

---

## 6. Section Paramètres

### Bloc Organisation

Informations de l'organisation :
- Nom, email, téléphone (lecture seule — modification via support)
- Raison sociale, SIRET, adresse (modifiables — décision Val 2026-09-28, audités)
- Logo (upload / remplacement)
- Informations personnelles (prénom, nom, téléphone) via `/api/me/profil`
- Notes internes (non visibles par le gestionnaire, champ Admin uniquement)

### Bloc Utilisateurs

Liste des utilisateurs de l'organisation (rôle `gestionnaire_lieux`). Colonnes : nom, email, dernière connexion, statut (actif/inactif), actions (désactiver).

**Invitation d'un nouveau collègue** — mode unique : **provisioning direct** (*décision Val 2026-07-01, M3.1 — self-service écarté, « doublon inutile »*) :
- Bouton "Inviter un collègue"
- Champs **prénom + nom + email** ; le compte est provisionné immédiatement (rôle `gestionnaire_lieux` + organisation de l'invitant imposés, `organisation_id` posé côté serveur). L'invité reçoit un email `invitation_utilisateur` (voir [[02 - Templates emails V1]] template 17) avec lien d'activation (validité 7 jours) pour définir son mot de passe.
- Le collaborateur invité devient `gestionnaire_lieux` de la même organisation, rattachement garanti à la création (y compris email perso)

**Désactivation** : bouton "Désactiver" sur chaque ligne utilisateur. `users.actif = false`. L'utilisateur ne peut plus se connecter mais son historique (qui a généré quoi) est conservé.

> **Câblage RLS (décision F5 2026-06-07, BLOQUANT soldé)** : la matrice `users` §09 classait gestionnaire_lieux dans « autres » (UPDATE self only, zéro INSERT) — invitation et désactivation étaient mortes au niveau RLS. Tranché : gestionnaire_lieux aligné sur traiteur_manager (INSERT + UPDATE `organisation_id = self`), cohérent avec l'absence de distinction manager V1. Garde UI : pas d'auto-désactivation (bouton absent sur sa propre ligne).

### Bloc Préférences de notification

**Supprimé V1 (décision F1 2026-06-07)** : aucun des 19 templates actifs §06.02 ne l'implémentait (le template 20 `collecte_programmee_tiers` cible le traiteur opérationnel, pas le gestionnaire) — promesse fonctionnelle morte, même pattern que la sobriété 2026-05-30 ci-dessous. Réintroduction V1.1 avec template dédié si demande terrain. Le bloc Préférences ne porte plus que la langue (aucun toggle email V1).

> *(Refonte sobriété 2026-05-30 — toggle "rapport automatique" retiré)* : la préférence "Recevoir un email à la mise à disposition d'un nouveau rapport automatique" est supprimée — les rapports automatiques (batchs mensuel/trimestriel/annuel) ont été supprimés à la refonte 2026-05-05. Le toggle ne pilotait plus aucun envoi (promesse fonctionnelle morte).

---

## Ce qui n'existe PAS côté gestionnaire de lieux (V1) — refonte 2026-05-07

À documenter explicitement pour lever toute ambiguïté côté Claude Code et côté Val en itération :

| Fonctionnalité | Raison V1 |
|---|---|
| | **Réouvert 2026-05-07** : programmation autorisée sur ses propres lieux, avec traiteur opérationnel du référentiel Savr (pas de fiche shadow autorisée). Périmètre fermé via `organisations_lieux`. |
| | **Réouvert 2026-05-07** : facturation directe Savr ↔ gestionnaire pour les collectes programmées par le gestionnaire (règle programmateur=facturé V1). Les collectes programmées par les traiteurs intervenants restent facturées au traiteur (pas de visibilité sur ces montants côté gestionnaire). Section "Mon organisation > Facturation" ajoutée. |
| | **Réouvert 2026-05-07** : pack AG ouvert aux gestionnaires de lieux. Section "Mon pack AG" ajoutée. Décompte sur le pack du gestionnaire pour ses propres programmations. |
| Création de fiche traiteur "shadow" (hors référentiel) | Réservé aux agences. Le gestionnaire qui voudrait travailler avec un traiteur non référencé doit demander à l'Admin Savr de l'embarquer (workflow standard). |
| Demande d'intervention directe à une association | Pas de rôle attribué dans le flux AG côté gestionnaire (algo attribution AG inchangé) |
| Modification des données opérationnelles d'une collecte programmée par un traiteur | Le gestionnaire n'a aucun droit sur les collectes qu'il n'a pas programmées (consultation lecture seule). Sur ses propres collectes : workflow d'édition identique au traiteur (cf. §06.04). |
| Notification en temps réel sur les anomalies | V2 (envisageable pour les grands comptes type Viparis) |

---

## Impact data model

### Nouvelle table `coefficients_perte_labo` *(ajout 2026-05-22)*

Une table ajoutée pour porter le coefficient de perte labo par traiteur × année (cf. [[04 - Data Model#⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, gestionnaire-only)]]). Le gestionnaire ne lit **pas** cette table : l'estimation `pax × coefficient` est calculée côté serveur (fonction SECURITY DEFINER) et exposée en kg dans le détail événement, la colonne de la liste Événements et la colonne de la liste Collectes *(ajout Val 2026-10-07)*. Saisie réservée à l'Admin Savr (§06.06).

### Tables existantes réutilisées

Le reste des données nécessaires est déjà modélisé :
- `organisations` (type `gestionnaire_lieux`)
- `users` (role `gestionnaire_lieux`)
- `organisations_lieux` (rattachement N-N)
- `lieux`, `evenements`, `collectes`, `collecte_flux`, `v_attributions_gestionnaire` (vue en liste blanche — la table `attributions_antgaspi` reste fermée au rôle, C-1 §09), `courses_logistiques` (consultation uniquement, pas les champs financiers)
- : table supprimée refonte 2026-05-05 (synthèses générées à la demande, non archivées)
- `rapports_rse` (lecture selon `organisation_id` traiteur ≠ gestionnaire — à arbitrer, voir Questions ouvertes)
- `types_evenements` (filtre dashboard "type d'événement" — référentiel extensible Admin)
- `flux_dechets` (5 valeurs canoniques V1 : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel` — voir [[04 - Data Model]])

### Règles RLS

Un `user` avec `role = 'gestionnaire_lieux'` accède :
- `collectes` WHERE `evenements.lieu_id` IN (`SELECT lieu_id FROM organisations_lieux WHERE organisation_id = user.organisation_id`)
- `evenements` SELECT : prédicat complété *(décision F3 2026-06-07)* par `(date_evenement IS NOT NULL OR organisation_id = self)` — les brouillons tiers sont exclus. UPDATE : prédicat complété *(décision F4 2026-06-07)* par `f_collecte_editable(evenements.id)` — fenêtre d'édition identique au workflow traiteur (§05 source unique).
- `factures` SELECT `organisation_id = self` *(décision F6 2026-06-07)* — ses propres factures Savr uniquement (collectes programmées par lui) ; les factures des traiteurs restent invisibles même si la collecte s'est tenue sur ses lieux. Miroir `shared.fichiers` (scope strict = RLS table factures).
- `users` INSERT + UPDATE `organisation_id = self` *(décision F5 2026-06-07)* — invitation + désactivation de collègues (aligné traiteur_manager).
- : table supprimée refonte 2026-05-05. Génération synthèse : RLS appliquée via JWT du demandeur sur les collectes sources lues par la Route API.
- `rapports_rse` WHERE `collectes.lieu_id` IN (ses lieux) — validé : le gestionnaire de lieux voit tous les rapports de recyclage des collectes sur ses lieux
- `lieux` WHERE `id` IN (ses lieux)
- `traiteurs` (vue restreinte) WHERE `organisation_id` IN (traiteurs intervenus sur ses lieux)
- `coefficients_perte_labo` *(ajout 2026-05-22)* : **aucun accès direct** pour le rôle `gestionnaire_lieux`. L'estimation `pax × coefficient` est calculée côté serveur via une fonction SECURITY DEFINER ; seule la valeur kg est retournée au gestionnaire (le coefficient brut du traiteur n'est jamais exposé). Lecture/écriture directe réservée à `admin_savr` (cf. [[09 - Authentification et permissions]]).
- `f_benchmark_kg_pax_zd` : EXECUTE autorisé pour le rôle `gestionnaire_lieux` (fonction `SECURITY DEFINER`). Filtres acceptés en paramètres : `flux_id`, `type_evenement_id`, `taille_evenement`, `periode_debut`, `periode_fin`, `lieu_ids[]`, `traiteur_ids[]` (les 5 dimensions de la barre filtre benchmark dédiée du Bloc 3 ZD). Aucun filtre obligatoire — tous facultatifs. `lieu_ids[]` et `traiteur_ids[]` ne peuvent nommer que les lieux rattachés et les traiteurs intervenus sur ses lieux ; hors périmètre, la fonction lève SQLSTATE 42501 *(garde de périmètre du 2026-10-06, cf. §04)*. **K-anonymat strict (durci 2026-09-22)** : la fonction applique côté serveur `nb_collectes_segment >= 5` **et ≥ 3 acteurs distincts** (minimum entre organisations programmatrices et traiteurs opérationnels) ; un segment qui ne franchit pas les deux seuils n'apparaît pas dans la réponse SQL. Les colonnes brutes individuelles ne sont jamais exposées — uniquement les agrégats.

### Vue SQL dédiée

Pour limiter la surface d'exposition, une vue PostgreSQL dédiée expose les collectes côté gestionnaire de lieux avec uniquement les colonnes autorisées (sans `factures.montant_ht`, `courses_logistiques.cout_ht`, etc.).

Nom : `v_collectes_gestionnaire_lieux`.

### Fonction benchmark `f_benchmark_kg_pax_zd`

> *(Refonte sobriété 2026-05-30 — unification vue/fonction)* : l'objet benchmark était référencé tantôt comme vue `v_benchmark_kg_pax_zd`, tantôt comme fonction `f_benchmark_kg_pax_zd`. Une vue figée ne peut pas prendre les paramètres dynamiques (`lieu_ids[]`, `traiteur_ids[]`...) requis par la barre filtre benchmark à 5 dimensions. **Un seul objet canonique : la fonction `SECURITY DEFINER` `f_benchmark_kg_pax_zd`** (cf. [[04 - Data Model]] §Fonction SQL `f_benchmark_kg_pax_zd`). Toute référence à la vue `v_benchmark_kg_pax_zd` est supprimée.

Fonction agrégée dédiée au Bloc 3 ZD (jauges) avec **filtres benchmark dédiés** (5 dimensions, indépendants des filtres globaux du dashboard). Adossée à la table base matérialisée `mv_benchmark_kg_pax_zd_base` rafraîchie quotidiennement (cf. [[04 - Data Model]]).

**Colonnes retournées (RETURNS TABLE)** :
- `flux_id` (FK `flux_dechets`)
- `type_evenement_id` (FK `types_evenements`)
- `taille_evenement` (enum bracket : `XS`, `S`, `M`, `L`, `XL`)
- `kg_par_pax_moyen` (decimal)
- `nb_collectes_segment` (integer — compteur k-anonymat)
- `nb_organisations_distinctes` (integer — **garde** : un segment n'est publié qu'à ≥ 3 organisations distinctes, cf. « Filtre RLS »)

**Paramètres de filtrage dynamique** (passés depuis le front via la barre filtre benchmark dédiée) :
- `flux_id` : filtré (1 jauge par flux)
- `type_evenement_id` : multi-select facultatif
- `taille_evenement` : multi-select facultatif
- `periode_debut` / `periode_fin` : facultatif (défaut UI = 12 mois glissants)
- `lieu_ids[]` : multi-select facultatif, borné aux lieux rattachés du gestionnaire ; vide = tout le parc Savr
- `traiteur_ids[]` : multi-select facultatif, borné aux traiteurs de `v_traiteurs_gestionnaire` ; vide = tout le parc Savr

**Calcul** : pour chaque tuple `(flux, type_evenement, taille)` correspondant aux paramètres, moyenne pondérée `SUM(collecte_flux.poids_reel_kg) / SUM(evenements.pax)` sur le sous-ensemble du parc Savr filtré.

**Filtre RLS** : deux seuils cumulatifs dans le `HAVING` final de la fonction — `nb_collectes_segment >= 5` **ET** ≥ 3 acteurs distincts (minimum entre organisations programmatrices et traiteurs opérationnels ; durci 2026-09-22, migration `20260922210000`). Un segment qui ne franchit pas les deux n'apparaît pas dans la réponse SQL. ⚠ Le seuil de collectes **seul** ne garantissait pas la non-identifiabilité : 5 collectes d'un acteur unique le franchissaient et la moyenne publiée décrivait alors cet acteur. Plus le gestionnaire restreint les filtres benchmark, plus le risque de masquage augmente — c'est le compromis assumé de l'option D (cf. Décisions prises).

**Risque "comparaison à soi-même"** : dès que le gestionnaire coche un lieu ou un traiteur (le filtre est borné à son périmètre, décision Val 2026-10-06), la moyenne benchmark devient mécaniquement identique (ou très proche) du ratio gestionnaire → ratio = 1.0 → couleur orange permanente. Avertissement UX affiché côté front (tooltip dans la barre filtre benchmark).

### Bracket `taille_evenement`

Champ calculé (non stocké) sur `evenements` à partir de `pax` :
- `XS` : `pax < 250`
- `S` : `pax >= 250 AND pax < 500`
- `M` : `pax >= 500 AND pax < 750`
- `L` : `pax >= 750 AND pax < 1000`
- `XL` : `pax >= 1000`

Implémentation : fonction PostgreSQL `taille_evenement_bracket(pax integer) RETURNS text` ou colonne générée (GENERATED ALWAYS AS). Pas de stockage redondant.

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|----------|---------------------|--------|
| Rôle unique V1 (pas de split manager/commercial) | Split comme côté traiteur | Équipes petites, données non-sensibles commerciales, pas besoin |
| **Réouvert 2026-05-07** | Programmation maintenue interdite | Use case réel : gestionnaires qui pilotent eux-mêmes la RSE événementielle. Restriction périmètre (lieux propres + traiteurs référencés) pour cadrer. |
| Pas de visibilité sur les montants facturés | Exposition sous forme agrégée | Confidentialité commerciale traiteur ↔ Savr |
| Section Traiteurs limitée à nom/logo/stats | Fiche traiteur complète | Pas de données commerciales sensibles exposées |
| Rapports automatiques sans email | Email systématique | Volume trop élevé, faible valeur ajoutée (consultation à la demande suffit) |
| Préférences de notification défaut OFF | Défaut ON | Éviter la saturation email sur des parcs de 50+ lieux |
| Demande d'ajout de lieu par alerte in-app Admin *(décision Val 2026-10-07, ex « par email Admin »)* | Interface self-service | Rattachement nécessite validation commerciale Savr (contrat, négociation tarifs ZD) |
| Rapport de synthèse personnalisé avec filtres | Rapport figé par période | Flexibilité indispensable pour répondre aux RFP clients du gestionnaire |
| **Programmation ouverte gestionnaire (2026-05-07)** | Programmation interdite (positionnement initial V1) | Use case réel : gestionnaires pilotant la RSE événementielle directement. Périmètre restreint (lieux propres + référentiel traiteurs only) pour cadrer. |
| **Facturation directe gestionnaire (2026-05-07)** | Pas de relation financière directe | Cohérence avec règle programmateur=facturé V1. Section Mon organisation > Facturation ajoutée (réutilisation composant §06.04 §6) |
| **Pack AG ouvert gestionnaire (2026-05-07)** | Pack au niveau traiteur uniquement | Use case réel : gestionnaire qui négocie un volume AG sur son parc. Décompte sur pack du programmateur (cf. §06.09). |
| **Pas de fiche shadow gestionnaire (2026-05-07)** | Autoriser comme pour les agences | Risque pollution shadow (gestionnaires moins bien outillés Admin pour normaliser). Restriction métier explicite. |
| Suppression page Collectes — fusion dans Événements (2026-05-03) | Conserver les 2 pages | Le gestionnaire raisonne par événement, pas par collecte. Le détail collecte vit dans le détail événement, suffisant pour la consultation. Réduction surface UI **Levée** : page Collectes réintégrée le 2026-07-06, page Événements retirée le 2026-10-07 (décision Val). |
| Barre filtre benchmark dédiée 5 dimensions (2026-05-03) | Benchmark figé sur le parc total ou héritage des filtres globaux | Permet au gestionnaire de comparer son périmètre à un benchmark de référence personnalisable (option D Val). Risque "comparaison à soi-même" assumé via avertissement UX |
| Export grain événement (option C1) | Export grain collecte ou double export | 1 ligne = 1 événement, suffisant pour V1. Détail collecte par collecte reste accessible via PDF de synthèse §Rapports **Levée le 2026-10-07** : export au grain collecte, depuis la liste Collectes. |
| **Blocs Dashboard rattachés aux onglets ZD/AG (2026-05-10)** | Garder une section "Bloc commun" sous les onglets | Cohérence UX : un onglet actif filtre tout le contenu visible (KPIs comme blocs synthétiques). Plus simple à comprendre, supprime l'ambiguïté "ce bloc affiche-t-il ZD, AG ou les deux ?". |
| **Bloc 8 transformé en bouton export synthèse PDF (2026-05-10)** | Conserver "Dernier rapport de synthèse disponible" / Le supprimer | Reco b retenue. Le bloc original est orphelin de la refonte 2026-05-05 (rapports auto supprimés, table `rapports_synthese` supprimée → toujours vide en V1). Remplacement par un bouton aligné §06.04, pré-rempli avec filtres globaux + type de collecte selon onglet actif. Donne une vraie valeur métier au bloc. |
| **Déchets labo estimés par événement (2026-05-22)** | Mesure réelle / saisie traiteur / coefficient global | Le déchet labo n'est jamais collecté ni pesé par Savr → estimation seule possible. Coefficient annuel par traiteur (calculé sur N, appliqué sur N+1), saisi par l'Admin (le traiteur communique, ne saisit pas). Calcul à la volée `pax × coefficient`, non stocké. Affichage gestionnaire-only (détail événement + colonne des listes Événements et Collectes — cette dernière ajoutée par Val le 2026-10-07), hors rapport PDF. Pas de fallback si coefficient absent (`—`). Coefficient global par traiteur sans distinction type d'événement = limite V1 assumée (V2 si besoin de granularité gala vs cocktail). |

---

## Arbitrages validés (décisions Val)

- **Rapport de recyclage par collecte** : **oui**, le gestionnaire de lieux a accès à tous les rapports (bordereau ZD, rapport de recyclage, attestation de don) des collectes qui se sont tenues sur ses lieux. Accès en lecture seule via le détail collecte et via la section Rapports. Pas d'envoi email automatique.
- **Tarifs ZD négociés par lieu** : **non** affichés en V1 ni en V1.1. Les tarifs restent côté Admin Savr uniquement. Le gestionnaire de lieux voit la prestation RSE mais pas le prix facturé au traiteur.
- **Alertes anomalies opérationnelles** : **non** en V1. À cadrer en V2 (typiquement pour les comptes à fort volume type Viparis qui pourraient vouloir être alertés sur les pesées hors normes).
- **Refonte Dashboard 2026-05-02 (Val)** :
  - Scission ZD/AG via 2 onglets (option A retenue contre pages séparées et empilement vertical) — filtres communs.
  - 5 filtres globaux : période, lieux, traiteurs, type d'événement, taille d'événement.
  - Suppression définitive 7 flux historiques (`dib`, `dangereux`, `huiles`, `papier`, `deee`, `gravats`, `terre`). Renommage `dib` → `dechet_residuel`. Réduction enum `flux_dechets` à **5 valeurs canoniques** : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`. Justification Val : "on n'est pas concerné" — Savr ne collecte aucun de ces flux supprimés.
  - Bloc 2 ZD : graphique barres empilées en kg (vs. CO2 abandonné), 5 segments par flux.
  - Bloc 3 ZD : jauges kg/pax × benchmark parc filtré par type+taille événement, k-anonymat ≥ 5 collectes **et ≥ 3 acteurs distincts** (point rouge masqué sinon).
  - Bloc AG : pas de jauge (un seul flux AG, pas de pertinence visuelle), KPI + courbe uniquement.
  - Suppression colonnes maquette source : "nb collectes par mois", "taux remplissage moyen", "déclassement".
- **Refonte 2026-05-03 (Val)** — 2 changements structurels :
  - **Bloc 3 ZD : barre de filtre benchmark dédiée 5 dimensions** (période, lieux, traiteurs, type, taille), distincte de la barre globale du dashboard. Filtre uniquement le point rouge benchmark, pas les jauges du gestionnaire. Initialisation par défaut héritée des filtres globaux (type + taille uniquement). Option D retenue (filtres complets) malgré risque "comparaison à soi-même" si le gestionnaire restreint le benchmark à ses propres lieux/traiteurs — avertissement UX au lieu d'un blocage.
  - **Suppression page Collectes côté gestionnaire** : la section Collectes est entièrement supprimée. Le gestionnaire ne voit plus que la section Événements (1 ligne = 1 événement). Le détail collecte par collecte (pesées par flux, repas, bordereau, rapport recyclage, attestation don) est intégré dans le détail événement. Bouton Export CSV déménagé sur Événements avec **grain événement** (option C1, 1 ligne export = 1 événement). Bloc 5 dashboard "Prochaines collectes programmées" conservé tel quel (grain collecte pour info opérationnelle), clic → détail événement parent. Vue `v_collectes_gestionnaire_lieux` conservée pour les agrégats dashboard et le détail événement.

## Questions ouvertes

- **Vue multi-organisations** : un user Viparis qui gère aussi Le Parc Floral (deux entités juridiques) doit-il avoir un sélecteur d'organisation dans la top bar ? Probablement **non en V1** (un compte = une organisation), **V2** pour les groupes.

---

## Liens

- [[02 - Personas et cas d'usage]]
- [[04 - Data Model]] — tables `organisations`, `organisations_lieux`, `lieux` (table `rapports_synthese` supprimée refonte 2026-05-05)
- [[11 - Dashboards]]
- [[12 - Reporting et exports]] §1.6
- [[04 - Espace client traiteur]]
- [[06 - Back-office Admin Savr]] — §7, fiche lieu, champ « Gestionnaire » (rattachement d'un lieu) ; file des alertes (demande d'ajout d'un lieu)
- [[02 - Templates emails V1]] — template 17 `invitation_utilisateur`
