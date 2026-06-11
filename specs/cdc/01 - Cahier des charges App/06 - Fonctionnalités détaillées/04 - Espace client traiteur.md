# 04 - Espace client traiteur

**Lié à** : [[02 - Personas et cas d'usage]] (profils `traiteur_manager`, `traiteur_commercial`) · [[09 - Authentification et permissions]] · [[11 - Dashboards]] · [[01 - Formulaire de programmation de collecte]] · [[05 - Espace client gestionnaire de lieux]] (structure dashboard héritée)

---

## Principe

L'espace client traiteur est l'interface principale des utilisateurs côté traiteur. Il couvre deux profils :

- **`traiteur_manager`** : vision complète de l'organisation (toutes les collectes, toutes les factures, gestion de l'équipe)
- **`traiteur_commercial`** _(révision 2026-05-29)_ : **lecture identique au Manager** (toutes les collectes, toutes les factures, dashboards et benchmarks de l'orga). Il ne diffère du Manager que sur deux points : (a) en **écriture**, il ne peut créer/modifier/supprimer que **les collectes qu'il a lui-même créées** (`created_by = auth.uid()`) ; (b) il **n'a pas la gestion des utilisateurs** ni l'édition des paramètres de l'organisation (logo, infos, facturation), réservées au Manager.

Le périmètre des données visibles (lecture) et des actions (écriture) est filtré par RLS Supabase (voir [[09 - Authentification et permissions]]).

---

## 1. Navigation principale

Barre latérale (desktop) / menu burger (mobile) — **4 entrées V1** (refonte 2026-05-05 : suppression entrée "Factures" fondue dans Mon organisation > Facturation manager only, suppression entrée "Rapports RSE" remplacée par bouton "Exporter une synthèse PDF" depuis dashboard) :

1. **Dashboard** (page d'accueil)
2. **Collectes** (liste + programmation)
3. **Mon organisation** — _(révision 2026-05-29)_ visible Manager **et** Commercial. **Commercial = lecture seule** sur Facturation + Infos/Logo ; sous-section **Utilisateurs masquée** (gestion des utilisateurs = Manager uniquement). Toute édition des paramètres org reste Manager only.
4. **Mon profil**

### Différences `traiteur_manager` vs `traiteur_commercial`

| Section          | Manager                                                                                                                                                                      | Commercial                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard        | Données de toute l'organisation + bloc Mon pack AG (onglet AG) + bloc Top 5 commerciaux                                                                                      | **Identique au Manager** : données de toute l'orga + Mon pack AG (lecture + demande renouvellement) + **Top 5 commerciaux visible** (révision 2026-05-29)                                    |
| Collectes        | Toutes les collectes de l'orga                                                                                                                                               | **Lecture : toutes les collectes de l'orga**. Programmation / modification / suppression : **uniquement ses propres collectes** (`created_by = auth.uid()`) (rév. 2026-05-29)                |
| Factures         | Vue liste + filtres dans Mon organisation > Facturation (toutes factures de l'orga)                                                                                          | **Vue liste lecture seule** dans Mon organisation > Facturation (toutes factures de l'orga) — révision 2026-05-29, l'ancienne restriction « fiche collecte uniquement / option C » est levée |
| Rapports RSE     | Synthèses générées à la demande via bouton "Exporter une synthèse PDF" du dashboard ; rapports par collecte téléchargeables depuis liste collectes (picto) ou fiche collecte | Idem manager, **périmètre orga complet** (révision 2026-05-29)                                                                                                                               |
| Mon organisation | Accès complet (users, logo, infos, facturation)                                                                                                                              | **Lecture seule** (Facturation + Infos + Logo) ; **sous-section Utilisateurs masquée** ; aucune édition (révision 2026-05-29)                                                                |
| Mon profil       | Édition de son profil                                                                                                                                                        | Édition de son profil                                                                                                                                                                        |

_(Révision 2026-05-29)_ Un commercial **voit en lecture** toutes les collectes et factures de l'organisation (comme le Manager) ; il ne peut **modifier/supprimer** que celles qu'il a lui-même créées.

---

## 2. Dashboard de pilotage (page d'accueil)

### Principe (refonte 2026-05-04)

Le dashboard reprend **intégralement la structure du §05 Espace gestionnaire de lieux** (2 onglets ZD/AG, barre de filtres globaux, blocs hérités), filtrée sur le **périmètre du traiteur connecté**. _(Révision 2026-05-29)_ : en **lecture**, manager et commercial voient le **même périmètre** (toute l'orga) ; ils ne diffèrent qu'en écriture (commercial = ses propres collectes). Pas de duplication de composants côté dev — cible : composants partagés réutilisables.

Mutualisation logique : 1 dashboard, 2 contextes (gestionnaire / traiteur), filtres et RLS adaptés au rôle.

### Bandeau actions rapides (au-dessus des onglets, toujours visible)

**Refonte 2026-05-21 (formulaire unique événement-centré)** : bouton unique **[ Programmer un événement ]** (action transversale aux deux onglets). Ouvre le formulaire unique §06.01 où l'utilisateur choisit le ou les types de collecte (☐ Zéro-Déchet ☐ Anti-Gaspi) en étape 1. Pour préserver l'économie de clic du contexte d'onglet, l'ouverture depuis l'onglet ZD pré-coche Zéro-Déchet, depuis l'onglet AG pré-coche Anti-Gaspi (l'utilisateur peut cocher l'autre type pour programmer les deux en une passe).

**Retiré V1 (refonte formulaire unique 2026-05-21)** — l'entrée se fait désormais par un bouton unique ouvrant le formulaire événement-centré.

Voir [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]].

> **Refonte 2026-05-10** : ex-bouton secondaire "Exporter une synthèse PDF" du bandeau **retiré**. L'export se fait désormais via les **Bloc 8 ZD / Bloc 8 AG** par onglet (pré-rempli filtres globaux + type de collecte selon onglet actif). Pattern aligné §06.05 et §06.11. Pour une synthèse globale ZD+AG, l'utilisateur décoche le filtre "Type de collecte" dans l'étape 2 de la modal de génération (voir [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux#4. Section Rapports (refonte 2026-05-05 — à la demande uniquement)]]). **Pas d'archivage** (refonte 2026-05-05 — table `rapports_synthese` supprimée, voir §Impact data model).

### Onglets

Le dashboard est scindé en **2 onglets** :

- **Zéro-déchet** (sélectionné par défaut)
- **Anti-gaspi**

Chaque onglet affiche son propre jeu de blocs adaptés au métier. La barre de filtres globale est commune aux deux onglets.

### Barre de filtres globale (au-dessus des onglets)

5 filtres persistants en query string (deep-linkable) — s'appliquent à **tous les blocs** du dashboard :

| Filtre              | Type                           | Valeurs                                                                                                                  |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Période             | Date range picker + raccourcis | 7j / 30j / Trimestre en cours / 12 derniers mois (défaut) / Année civile / Personnalisé                                  |
| Lieux               | Multi-select                   | Lieux où le traiteur est intervenu sur les 24 derniers mois — défaut "Tous"                                              |
| Client organisateur | Multi-select                   | Clients organisateurs renseignés sur ses collectes — défaut "Tous"                                                       |
| Type d'événement    | Multi-select                   | `types_evenements.libelle` — référentiel extensible Admin                                                                |
| Taille d'événement  | Multi-select                   | Bracket calculé sur `evenements.pax` : **XS** [0-249], **S** [250-499], **M** [500-749], **L** [750-999], **XL** [1000+] |

Bouton "Réinitialiser" ramène aux valeurs par défaut. Compteur "X collectes correspondent" sous la barre.

> **Note** : pas de filtre "Traiteurs" côté traiteur (par construction = lui seul). Filtre "Commercial" disponible dans la liste Collectes pour le manager **et le commercial** _(révision 2026-05-29 — le commercial voyant désormais toute l'orga, il peut filtrer par commercial)_.

### Bloc 1 — KPIs (5 cartes ZD / 4 cartes AG)

Cartes chiffres clés en haut de page (recalcul live selon les filtres actifs) :

Mapping par onglet :

- **ZD (5 cartes)** : Nombre de collectes · Tonnage collecté (kg) · **Taux de recyclage** (%) _(renommé 2026-05-06 — ex "Taux de tri global". Moyenne pondérée par tonnage des `collectes.taux_recyclage`, formule à captation par filière cf. [[05 - Règles métier#R_taux_recyclage]])_ · kg/pax moyen · **Marge générée (€)** _(ajout 2026-05-07 — formule cf. [[05 - Règles métier#R_marge_zd_traiteur]])_
- **AG (4 cartes)** : Nombre de collectes · Repas donnés · Pax cumulés · Repas/pax moyen

Chaque carte clickable → renvoie vers la liste **Collectes** sur l'onglet correspondant (ZD/AG), filtres globaux transmis en query string.

#### KPI **Marge générée (€)** — détail (ajout 2026-05-07)

- **Formule** : `(organisations.tarif_refacture_pax_zd) × Σ evenements.pax − Σ factures_collectes.montant_ht`
  - **Numérateur revenu** : `tarif_refacture_pax_zd` (paramètre par traiteur, défaut 1.50 €, modifiable Admin Savr only — cf. [[04 - Data Model]] §`organisations`) × pax cumulés des collectes ZD du périmètre filtré (les pax de chaque événement comptent une fois, pas de double comptage si plusieurs collectes par événement — `DISTINCT evenements.id`)
  - **Numérateur coût** : somme des montants HT des lignes `factures_collectes` rattachées aux collectes ZD du périmètre filtré, **uniquement sur factures de statut `emise` ou `payee`** (les brouillons et avoirs ne comptent pas — cohérent §06.04 vue facturation)
- **Format affichage** : `1 234,56 €` (€ avec 2 décimales). Couleur neutre. Pas de seuil rouge/vert V1.
- **Cas null/zéro** :
  - Si Σ pax = 0 (aucune collecte ZD sur la période) → affiche `—`
  - **Badge info "X collectes en attente de facturation"** _(révisé 2026-06-07 — test scenarios §06.04 F3, arbitrage Val)_ : affiché dès que **X ≥ 1**, où X = nombre de collectes ZD `cloturee` du périmètre filtré **sans facture `emise` ou `payee` rattachée** — y compris en facturation partielle (ex : 3 facturées, 2 non → badge "2 collectes en attente de facturation"). Si Σ factures HT = 0 mais pax > 0 → marge = revenu pur + badge (cas couvert par la règle générale)
  - Si marge < 0 (coût > revenu) → affichée en rouge avec valeur absolue, exemple `−45,20 €`
- **Tooltip survol carte** : "Marge = {{tarif}} €/pax × {{pax}} pax − {{coût}} € de prestations Savr facturées (statuts émise + payée). Tarif refacturé éditable par Savr."
- **Périmètre RLS** : la carte affiche la marge sur le périmètre des collectes que le user voit en lecture — **manager = toute l'orga, commercial = toute l'orga** (révision 2026-05-29). RLS héritée des collectes (pas de RLS dédiée).
- **Onglet AG** : pas de KPI marge AG V1 (modèle économique pack, marge AG ≠ marge ZD — V2 selon retours).

Chaque carte est **clickable → renvoie vers la liste Collectes** filtrée (filtres globaux du dashboard transmis en query string, onglet actif ZD/AG transmis).

> **Note suppression** : le KPI "CA collecte" historique (manager only) est **retiré** (refonte 2026-05-04). Le suivi du CA reste dans la section Facturation. La nouvelle carte Marge ZD couvre le besoin de pilotage économique côté traiteur.

---

### Onglet **Zéro-déchet**

#### Bloc 2 ZD — Évolution mensuelle (graphique barres empilées)

Identique à §05 Bloc 2 ZD : barres empilées par mois (granularité automatique : jour si <30j, semaine si <12 mois, mois sinon) :

- **Axe X** : période
- **Axe Y** : tonnage en kg (bascule kg/T automatique au-delà de 10 000 kg)
- **Empilement** : 5 segments par barre = les 5 flux ZD (`biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`)
- **Courbe superposée** (axe Y secondaire %) : taux de recyclage moyen pondéré par tonnage (formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]])

Légende cliquable. Tooltip au survol : valeurs kg + % par flux.

#### Bloc 3 ZD — Jauges kg/pax par flux × benchmark parc

Bloc hérité §05 avec **adaptation traiteur** :

- **Jauge gestionnaire** → **jauge traiteur** : ratio `kg du flux / pax cumulés` sur le périmètre des **filtres globaux** (les collectes du traiteur).
- **Point rouge benchmark** : moyenne `kg flux / pax` calculée sur **l'ensemble du parc Savr** selon les **filtres benchmark dédiés**.

##### Barre de filtre benchmark dédiée (au-dessus du bloc, distincte de la barre globale)

Encart compact "Filtres benchmark" affichant **4 critères** (et non 5 comme côté gestionnaire) :

| Filtre benchmark             | Type                           | Valeurs                                                                      |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Période benchmark            | Date range picker + raccourcis | 12 mois glissants (défaut) / 24 mois glissants / Année civile / Personnalisé |
| Lieux benchmark              | Multi-select                   | Tous les lieux du parc Savr — défaut "Tous"                                  |
| Type d'événement benchmark   | Multi-select                   | `types_evenements.libelle` — défaut "Tous"                                   |
| Taille d'événement benchmark | Multi-select                   | XS / S / M / L / XL — défaut "Tous"                                          |

> **Différence vs §05** : le filtre **"Traiteurs benchmark" est ABSENT** côté traiteur. Décision Val 2026-05-04 : un traiteur ne peut pas filtrer le benchmark sur d'autres traiteurs (concurrentiel). La fonction `f_benchmark_kg_pax_zd` côté traiteur ignore le paramètre `traiteur_ids[]` (filtre rejeté côté serveur, pas seulement masqué front).

**Initialisation** : à l'ouverture du dashboard, les filtres benchmark héritent par défaut des filtres globaux (Type d'événement + Taille d'événement uniquement). Bouton "Réinitialiser" pour revenir à l'héritage par défaut.

**Avertissement UX** : si le traiteur applique le filtre `Lieux benchmark` sur ses propres lieux d'intervention, tooltip "Vous comparez vos données à un benchmark restreint à vos lieux — la valeur de référence en perd". Pas de blocage.

##### Jauges (1 par flux ZD, 5 jauges au total)

- **Jauge traiteur** : ratio `kg du flux / pax cumulés` sur les **filtres globaux**
- **Borne max axe** : valeur max observée du parc Savr × 1,2 (échelle figée par flux)
- **Point rouge benchmark** : moyenne parc Savr selon **filtres benchmark dédiés** (4 dimensions)
- **K-anonymat ≥5 collectes** appliqué côté serveur. Si <5 → point rouge masqué + tooltip "Données insuffisantes pour benchmark".

**Légende couleur** (ratio jauge traiteur / point benchmark, calculés chacun sur leur propre périmètre) :

- Vert : ratio ≤ benchmark (performance ≥ moyenne du segment)
- Orange : entre 100% et 130% du benchmark
- Rouge : > 130% du benchmark
- Gris : benchmark masqué (k-anonymat) → la jauge n'a pas de couleur de performance, seule la valeur kg/pax est affichée

#### Bloc 4 ZD — Répartition des tonnages (donut)

Donut affichant la part relative des 5 flux ZD sur la période filtrée. Tooltip au survol : kg + %. Total au centre = tonnage total.

#### Bloc 5 ZD — Prochaines collectes ZD programmées

Liste des collectes ZD à venir sur les 30 prochains jours, filtrée selon les filtres globaux. Grain = collecte (1 ligne = 1 collecte) :

- Date + heure
- Événement
- Lieu
- Statut (badge)

> **Sobriété B3 2026-05-04** : badge "Compléter infos" rouge **retiré** de la vue liste. Le bandeau orange est conservé sur la fiche collecte (signalement plus pédagogique avec la liste des champs manquants). Évite double-rendu et incohérence couleur.

Clic sur une ligne → fiche collecte.

#### Bloc 6 ZD — Top 5 lieux ZD

Tableau ordonné par tonnage, période filtrée :

- Lieu · Nombre de collectes ZD · Tonnage · Taux de recyclage _(moyenne pondérée par tonnage)_

#### Bloc 7 ZD — Top 5 commerciaux ZD

Visible pour `traiteur_manager` **et** `traiteur_commercial` _(ouvert 2026-05-29 — lecture alignée Manager, périmètre orga)_.

Tableau ordonné par nombre de collectes ZD, période filtrée :

- Commercial · Nombre de collectes ZD · Tonnage · Taux de recyclage _(moyenne pondérée par tonnage)_

> **Note vs §05** : remplacement du bloc "Top 5 traiteurs" du §05 (sans objet côté traiteur) par "Top 5 commerciaux".

#### Bloc 8 ZD — Exporter une synthèse PDF (ZD)

Bouton "Exporter une synthèse PDF" pré-rempli :

- **Période** : période active des filtres globaux
- **Lieux / Client organisateur / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `ZD` (figé selon onglet actif)

Clic → ouvre la modal de génération synthèse (Edge Function asynchrone 5-30 sec selon volume) puis téléchargement direct du PDF (URL pré-signée Supabase Storage temporaire, expire 1h). Si l'utilisateur veut modifier les filtres avant génération, retour aux étapes 1-2 possible. **Pas d'archivage** (refonte 2026-05-05 — table `rapports_synthese` supprimée).

Pattern aligné §06.05 §1 Bloc 8 ZD et §06.11 §1 Bloc 8 ZD.

---

### Onglet **Anti-gaspi**

#### Bloc 2 AG — Évolution mensuelle (graphique courbe)

Identique à §05 Bloc 2 AG :

- **Axe X** : période
- **Axe Y gauche** : nombre de repas donnés
- **Axe Y droit** (courbe superposée) : ratio repas/pax

Pas de jauge benchmark AG (un seul flux `don_alimentaire` — pertinence visuelle nulle).

#### Bloc 3 AG — Top associations bénéficiaires

Tableau ordonné par nombre de repas reçus (période filtrée) :

- Association · Ville · Nombre de collectes · Repas reçus

Source : `attributions_antgaspi` jointe à `associations`, restreinte par RLS aux collectes du traiteur.

> **Refonte 2026-05-05** : colonne `Distance moyenne (km)` supprimée (donnée non pilotante côté traiteur).

#### Bloc 4 AG — **Mon pack AG** (bloc dédié pleine largeur, sous les KPIs)

Bloc fondu depuis l'ancienne section §6 (refonte 2026-05-04). Position : pleine largeur, sous les KPIs onglet AG.

**Règle métier V1** : un traiteur a **au plus un pack actif à un instant T**. Pas de FIFO multi-packs (refonte 2026-05-05). Le pack suivant n'est activé qu'après épuisement (ou annulation Admin) du pack en cours.

Visible uniquement aux organisations avec un pack actif.

**Affichage (refonte 2026-05-05 — pack unique)** :

- Type pack + date d'achat
- Crédits initiaux (référence)
- Crédits restants (compteur principal)
- Progression visuelle (barre ou anneau, % consommé)

> **Pas d'historique des packs précédents (épuisés / annulés)** affiché en V1. Si un traiteur a besoin de l'historique → support ou Admin Savr le communique. V1.1 selon retours.

**Actions** (manager + commercial, RLS lecture sur le solde, action ouverte aux deux) :

- Bouton "Demander un renouvellement" : actif dès que **solde ≤ 10 % des crédits initiaux** _(révisé 2026-06-07 — test scenarios §06.04 F2, arbitrage Val : seuil relatif aligné sur l'alerte email admin `admin_pack_ag_etat` au franchissement ≤ 10 %, ex-seuil absolu < 10 crédits)_, toujours actif si solde = 0
- Soumission formulaire (pack souhaité + message optionnel)
- Email à Admin Savr (template `admin_demande_renouvellement_pack`, identification du demandeur)

**Alertes visuelles intégrées** _(seuil révisé 2026-06-07 F2 — relatif ≤ 10 %, une seule logique UI + email)_ :

- Badge orange si **solde ≤ 10 % des crédits initiaux** (ex : Pack 20 → badge dès 2 crédits restants ; Pack 60 → dès 6)
- Badge rouge "Pack épuisé" si solde = 0 → la programmation AG est bloquée jusqu'au renouvellement (la programmation ZD reste possible)

#### Bloc 5 AG — Prochaines collectes AG programmées

Liste des collectes AG à venir sur les 30 prochains jours, filtrée selon les filtres globaux. Grain = collecte (1 ligne = 1 collecte) :

- Date + heure
- Événement
- Lieu
- Statut (badge)

Clic sur une ligne → fiche collecte.

#### Bloc 6 AG — Top 5 lieux AG

Tableau ordonné par repas donnés, période filtrée :

- Lieu · Nombre de collectes AG · Repas donnés · Repas/pax

#### Bloc 7 AG — Top 5 commerciaux AG

Visible pour `traiteur_manager` **et** `traiteur_commercial` _(ouvert 2026-05-29 — lecture alignée Manager, périmètre orga)_.

Tableau ordonné par nombre de collectes AG, période filtrée :

- Commercial · Nombre de collectes AG · Repas donnés · Repas/pax

#### Bloc 8 AG — Exporter une synthèse PDF (AG)

Bouton "Exporter une synthèse PDF" pré-rempli :

- **Période** : période active des filtres globaux
- **Lieux / Client organisateur / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `AG` (figé selon onglet actif)

Clic → ouvre la modal de génération synthèse (Edge Function asynchrone) puis téléchargement direct du PDF.

Pattern aligné §06.05 §1 Bloc 8 AG et §06.11 §1 Bloc 8 AG.

> **Refonte 2026-05-05 (rappel historique)** : ex-Bloc 8 "Dernier rapport de synthèse" supprimé du dashboard ET de la fiche collecte. Plus aucune section "Synthèses agrégées archivées" — les synthèses sont générées à la demande, téléchargées et **non archivées** (table `rapports_synthese` supprimée).

### Itération V2

Contenu évolutif selon les retours utilisateurs. Structure V1 volontairement resserrée pour valider les usages prioritaires.

---

## 3. Collectes

### Structure : 2 onglets ZD / AG (refonte 2026-05-07)

La page Collectes est scindée en **2 onglets** au sommet :

- **Zéro-déchet** (sélectionné par défaut)
- **Anti-gaspi**

Suppression de la vue "Toutes les collectes" historique (ex-filtre Type `ZD / AG / Tout` retiré). L'onglet actif filtre l'ensemble du tableau et conditionne le bouton de programmation (cf. §Bouton "Programmer une collecte" ci-dessous).

Cohérent avec la structure du dashboard §2 (mêmes 2 onglets ZD/AG). L'onglet sélectionné est persisté en query string (deep-linkable).

### Bouton "Programmer une collecte" (contextuel par onglet — refonte 2026-05-07)

Au-dessus du tableau, à droite, **un bouton unique [ Programmer un événement ]** (refonte 2026-05-21). Clic → ouvre le formulaire unique §06.01 avec le **type pré-coché selon l'onglet actif** (onglet ZD → Zéro-Déchet pré-coché ; onglet AG → Anti-Gaspi pré-coché), l'utilisateur pouvant cocher l'autre type. Gain de 1 clic préservé via le contexte d'onglet.

> **Cas pack AG épuisé** : si l'utilisateur arrive depuis l'onglet AG (Anti-Gaspi pré-coché) ET le pack actif a un solde = 0, la **case Anti-Gaspi est cochée mais la soumission AG est bloquée** (alerte "Pack épuisé — demander un renouvellement depuis le dashboard onglet AG"). La collecte ZD reste programmable si l'utilisateur coche aussi Zéro-Déchet. Cohérent avec règle Bloc 4 AG dashboard et §06.01 Sélection pack AG.

### Vue liste

Tableau filtrable (refonte 2026-05-05 — colonnes Événement supprimée, Lieu enrichi adresse, Pax ajoutée après Client / refonte 2026-05-07 — filtrage Type retiré, géré par l'onglet) :

| Colonne             | Contenu                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date + heure        | `collectes.date_collecte` + `collectes.heure_collecte`                                                                                                                  |
| Type                | Badge ZD / AG                                                                                                                                                           |
| Lieu                | **Nom du lieu** (ligne 1) + **adresse complète** (ligne 2, fonte secondaire) — refonte 2026-05-05 (ex Nom + ville)                                                      |
| Client Organisateur | Si renseigné                                                                                                                                                            |
| Pax                 | `evenements.pax` — refonte 2026-05-05 (nouvelle colonne)                                                                                                                |
| Statut              | Badge coloré — inclut le statut `realisee_sans_collecte` avec badge dédié "Aucun repas collecté" (AG uniquement)                                                        |
| Rapport             | Indicateur (Disponible / À venir / Non consulté) **+ picto téléchargement actif si Disponible** (clic = download direct du PDF rapport RSE — ajouté refonte 2026-05-04) |
| Poids ZD / Repas AG | Valeur si collecte passée. Affiche "—" si `statut = realisee_sans_collecte`                                                                                             |

> **Refonte 2026-05-05** : colonne `Événement` supprimée (nom événement reste accessible depuis la fiche collecte, dénomination événement aussi reprise dans le titre fiche). Surface tableau réduite, focus sur le lieu (info pilotante côté traiteur).

**Cas "Aucun repas à collecter" (AG)** :

**AG uniquement** — ce cas n'existe pas en ZD (il y a toujours des déchets à collecter). Quand le chauffeur déclare qu'il n'y a rien à collecter via l'app mobile TMS (webhook `collecte-terminee` avec `statut_final = realisee_sans_collecte`, voir [[02 - Cahier des charges TMS/03 - Périmètre fonctionnel TMS#M05]]), la ligne de collecte affiche :

- Badge "Aucun repas collecté" dans la colonne Statut
- Tooltip au survol : motif chauffeur (saisi sur l'app mobile TMS)
- Dans la fiche détail : section dédiée "Aucun repas collecté" avec motif + horodatage (la photo du lieu prise par le chauffeur comme preuve de présence reste stockée côté TMS et est accessible par Ops Savr ; **plus affichée à l'utilisateur traiteur** depuis la refonte 2026-05-04)
- Pas d'attestation de don 2041-GE générée (pas de don à certifier)
- **Nouveau rapport PDF "Événement sans excédent alimentaire"** (refonte 2026-05-04) : rapport texte seul, sans photos. Téléchargeable depuis la colonne Rapport (picto actif). Spec : voir [[12 - Reporting et exports]] §Rapports PDF.
- **Facturation client au tarif normal V1** (le déplacement et la mobilisation chauffeur restent facturés). Facturation partielle possible en V2 selon retour terrain.

Ces informations sont visibles par le traiteur (contexte sur sa propre collecte) ET par l'Admin Savr (back-office).

**Filtres disponibles** :

- — **retiré 2026-05-07**, géré par les onglets ZD/AG en haut de page
- Statut (multi — inclut `realisee_sans_collecte` AG-only)
- Période
- Lieu
- Client Organisateur
- "Info incomplète" oui/non
- **Programmée par** (multi : "Mon organisation" / "Agence : {{nom}}" / "Gestionnaire : {{nom}}") — ajout 2026-05-07. Permet au traiteur de filtrer les collectes programmées par des tiers (cas où il opère pour le compte d'une agence ou d'un gestionnaire de lieux).

**Indicateur ligne tableau (ajout 2026-05-07)** : si `evenements.organisation_id ≠ traiteur_operationnel_organisation_id`, picto orange à côté du nom du lieu (icône "user-tag"). Tooltip "Programmée par {{nom organisation programmatrice}}". Pas de colonne dédiée pour ne pas alourdir le tableau (déjà 8 colonnes).

**Tri par défaut** : date décroissante (les plus récentes en premier).

Pour le `traiteur_commercial` _(révision 2026-05-29)_ : la liste affiche **toutes les collectes de l'organisation** (lecture alignée Manager, RLS lecture `organisation_id` + collectes où le traiteur est opérationnel). Seules les actions d'écriture (modifier/supprimer/programmer) sont restreintes à ses propres collectes (`created_by = auth.uid()`) ; les collectes d'un autre commercial s'affichent en lecture seule (actions grisées).

### Fiche collecte (vue détail)

Refonte 2026-05-04 + sobriété 2026-05-04 + **refonte 2026-05-05** : nouveau titre composite, ajout adresse + contacts dans entête, suppression Type de pesée (champ orphelin), ajout Bloc 3 ZD jauges sur collectes ZD terminées, suppression bloc Dernier rapport synthèse, bouton facture explicite.

**Titre de la fiche (refonte 2026-05-05)**

Composition : `<Date collecte> - <Nom du lieu> - <Nom du client organisateur> - <pax> pax`

- Si `evenements.client_organisateur` non renseigné (champ optionnel §06.01) → fallback `<Date> - <Nom du lieu> - <pax> pax`
- Si `evenements.pax` non renseigné (cas `informations_completes = false`) → afficher "— pax" en placeholder
- Ancien titre = numéro de collecte (`collectes.tms_reference` ou `id` court) → retiré du titre, reste affiché en sous-titre discret pour traçabilité support

**Bloc d'entête (sous le titre — refonte 2026-05-05 + extension 2026-05-07)**

Infos pilotantes affichées en bloc compact :

- Adresse complète du lieu (`lieux.adresse` + complément si fourni)
- Contact principal collecte (`evenements.contact_principal_nom` + téléphone + email)
- Contact secours collecte (`evenements.contact_secours_nom` + téléphone + email, affiché uniquement si renseigné)
- Type d'événement + taille (XS/S/M/L/XL bracket calculé sur pax)
- Heure de collecte
- Statut (badge)
- **Programmée par** (badge orange — affiché uniquement si `evenements.organisation_id ≠ traiteur_operationnel_organisation_id`, ajout 2026-05-07) : "Programmée par {{nom organisation programmatrice}} ({{type : agence | gestionnaire de lieux}})". Cliquable → modal info "Cette collecte a été programmée par {{nom}}, {{type}}. Vous êtes le traiteur opérationnel sur place. Pour toute question : {{email contact organisation programmatrice}}." Pas d'action depuis cette modal — le traiteur peut annuler/éditer la collecte via les workflows existants (droit de retrait conservé).

> **Cohérence cross-CDC** : ces champs sont les contacts portés par l'événement parent (cf. décision 2026-04-28 audit cohérence — contacts relogés sur `evenements.contact_principal_*` + `contact_secours_*`, plus sur `lieux`). Pas de duplication côté `collectes`.

**Actions possibles (traiteur)**

| Action                                                                                                                   | Statut autorisé                                                                                                                                                                                                                           | Qui                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Éditer les informations de la collecte** (couvre complétion ET modification — fusion sobriété B1)                      | Voir §Édition d'une collecte à venir ci-dessous (source unique : [[05 - Règles métier]])                                                                                                                                                  | Programmeur (créateur) ou manager                                                                                                                                                                                                        |
| Annuler la collecte (**directe** — sans validation Admin) _(révisé 2026-06-07, test scenarios §06.04 F1 : §05 fait foi)_ | `statut IN (brouillon, programmee)` — annulation immédiate `→ annulee` ; si `statut_tms ≠ non_envoye`, E3 `DELETE /collectes/:id` déclenché vers TMS (prestataire informé côté TMS)                                                       | Programmeur (créateur) ou manager                                                                                                                                                                                                        |
| Demander une annulation (validation Admin)                                                                               | `statut = validee` _(révisé 2026-06-07 F1 — l'ancien gate `statut IN (programmee, validee)` uniforme est scindé : `programmee` = annulation directe ci-dessus ; Sujet 2 2026-05-26 : condition `statut_tms ≠ en_cours/cloturee` retirée)_ | Programmeur (créateur) ou manager                                                                                                                                                                                                        |
| Télécharger le rapport RSE                                                                                               | Si rapport disponible (>= H+24 post-collecte)                                                                                                                                                                                             | Tous · **picto actif**                                                                                                                                                                                                                   |
| **Télécharger la facture** (bouton explicite — refonte 2026-05-05)                                                       | Si facture émise (statut `emise` ou ultérieur)                                                                                                                                                                                            | Manager / commercial _(révision 2026-05-29 : commercial accède à toutes les factures de l'orga, via fiche collecte **et** via la vue liste Mon organisation > Facturation en lecture seule — l'ancienne restriction option C est levée)_ |

**Actions retirées de la fiche traiteur V1 (refonte 2026-05-04)**

- : **intégrés au rapport RSE PDF** comme pages supplémentaires (spec §12). La notion de bordereau ZD reste affichée et accessible côté Registre réglementaire (§06.03), Espace gestionnaire de lieux (§05) et back-office Admin (§06.06).
- : les photos sont **uniquement dans le rapport RSE PDF**. Pour les collectes `realisee_sans_collecte`, la photo lieu reste côté TMS (accès Ops uniquement, pas dans le rapport PDF "Événement sans excédent alimentaire").
- : **retiré V1 (sobriété A2 2026-05-04)**. `audit_log` reste alimenté côté DB et accessible Admin Savr (back-office §06.06). Si un traiteur a besoin de l'historique → support traite manuellement. V1.1 selon retours.

**Actions NON disponibles côté traiteur V1**

- Modifier les pesées (post-collecte)
- Modifier le statut directement
- Importer des photos (uniquement Admin Savr)
- Régénérer un rapport (uniquement Admin Savr)

**Bloc 2bis ZD — Taux de recyclage de la collecte _(ajout 2026-05-06)_**

Affiché uniquement sur collectes **ZD terminées** (`statut = cloturee`). Carte chiffre clé en haut du Bloc 3 jauges :

- **Valeur** : `collectes.taux_recyclage` (figé à la clôture, formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]])
- **Format** : `78.4 %` (1 décimale). Cas `taux_recyclage IS NULL` (total pesées = 0 ou collecte non clôturée) → `—`
- **Tooltip** : "Taux de recyclage net (méthode UE 2019/1004) — calculé avec les taux de captation effectifs par filière (verre, carton, biodéchets, emballages). L'OMR (déchet résiduel) entre uniquement au dénominateur. Voir Méthodologie."
- **Pas de seuil couleur V1** (l'utilisateur compare à la moyenne parc via le Bloc 3 jauges ci-dessous)

Cette valeur est **également imprimée sur le PDF Rapport RSE** §1.2 page 1 (Synthèse RSE) — lecture directe du même `collectes.taux_recyclage`, garantissant la cohérence UI/PDF.

**Bloc 3 ZD — Jauges kg/pax × benchmark parc (refonte 2026-05-05)**

Affiché uniquement sur collectes **ZD terminées** (`statut IN (cloturee, realisee)`). Permet au traiteur de visualiser les performances de cette collecte unique vs benchmark parc Savr.

Structure (1 jauge par flux ZD = 5 jauges) :

- **Valeur traiteur** : ratio `kg du flux sur cette collecte / pax de cet événement` (grain `single collecte`)
- **Borne max axe** : valeur max parc Savr × 1,2 (échelle figée par flux, identique §05/§02 dashboard)
- **Point rouge benchmark** : moyenne parc Savr selon **filtres benchmark dédiés** (4 dimensions, voir §2 Bloc 3 ZD pour la liste)
- **K-anonymat ≥5 collectes parc** appliqué côté serveur. Si <5 → point rouge masqué + tooltip "Données insuffisantes pour benchmark"
- **Légende couleur** identique §2 Bloc 3 ZD (vert ≤ benchmark, orange 100-130%, rouge >130%, gris masqué)

**Filtres benchmark modifiables (encart compact au-dessus du bloc)**

Mêmes 4 critères qu'au dashboard (Période / Lieux / Type événement / Taille événement). Pas de filtre `traiteur_ids[]` (idem dashboard, motif concurrentiel).

**Initialisation** : à l'ouverture de la fiche collecte, les filtres benchmark sont pré-remplis avec les caractéristiques de la collecte courante :

- Période benchmark = 12 mois glissants (défaut)
- Lieux benchmark = "Tous"
- Type événement benchmark = type de cette collecte (`evenements.type_evenement_id`)
- Taille événement benchmark = bracket calculé sur le pax de cette collecte

Bouton "Réinitialiser" pour revenir aux valeurs par défaut.

**Lien avec rapport RSE** : ce graphique avec les filtres sélectionnés est **intégré au PDF rapport RSE** que le traiteur télécharge / envoie au client. **Snapshot persisté (`rapports_rse.filtres_benchmark` jsonb — rétabli 2026-06-03, annulation revue §12 B2 sur arbitrage Val)** : les filtres benchmark choisis à la génération sont figés sur le rapport ; le re-téléchargement du même PDF redonne exactement les mêmes valeurs de référence (PDF reproductible). **Légende sous le graphe (ajout 2026-06-03)** : le PDF affiche, en dessous du graphe benchmark, une légende précisant les filtres effectivement appliqués au point de comparaison parc (période / lieux / type d'événement / taille) — le lecteur sait sur quel segment le benchmark a été calculé, y compris quand le traiteur a personnalisé les filtres. Le filtre `traiteur_ids[]` reste rejeté côté serveur (motif concurrentiel). Le taux de recyclage affiché reste figé (`collectes.taux_recyclage`). Cf. [[12 - Reporting et exports]] §1.2.

**Source de données** : fonction `f_benchmark_kg_pax_zd` étendue (refonte 2026-05-05) — signature accepte un grain `single_collecte` (paramètre `p_collecte_id` uuid) en plus du grain agrégé existant. Cf. [[04 - Data Model]].

### Édition d'une collecte à venir (refonte 2026-05-04 + sobriété 2026-05-04)

> **Source unique** des règles métier : [[05 - Règles métier#Modification d'une collecte à venir (refonte 2026-05-04)]]. Cette section décrit l'UX côté traiteur — les statuts autorisés, le cut-off et les permissions sont figés en §05.

**Fusion sobriété B1** : un seul flow d'édition couvre les deux cas historiques "Compléter informations manquantes" et "Modifier les informations". Le bandeau orange "Informations incomplètes" reste comme indicateur visuel sur les fiches `informations_completes = false`, mais le bouton est unique : **[ Éditer la collecte ]**.

**Champs éditables**

Tous les champs métier de la collecte et de l'événement parent :

- Date, heure de collecte
- Pax, type d'événement, taille
- Contacts principal / secours (événement)
- Notes
- Flag `controle_acces_requis`
- **Informations supplémentaires concernant la collecte** (text 1000 car., refonte 2026-05-06 §06.01 §2.a)

> **Refonte 2026-05-05** : champ "Type de pesée" supprimé. Champ orphelin (jamais défini en data model, jamais utilisé côté TMS, suppression sans cascade).

> **Refonte 2026-05-06** : ajout du champ `informations_supplementaires` (texte libre niveau collecte) suite à la refonte du formulaire programmation §06.01 §2.a. Modification post-programmation autorisée — push silencieux côté TMS via E2 (pas de réacceptation prestataire).

**Champs verrouillés UI (sobriété A4 2026-05-04)**

- `traiteur` (organisation) : immuable par construction (un traiteur ne peut pas réattribuer la collecte à un autre traiteur)
- `type_collecte` (ZD/AG) : verrouillé. Pour changer de type, le traiteur doit **annuler la collecte et en programmer une nouvelle**. Évite la cascade DELETE+POST côté TMS et le recalcul tarif.
- `lieu_id` : verrouillé. Pour changer de lieu, idem : annulation + reprogrammation.
- Message UX sur les champs verrouillés (tooltip au survol) : "Pour changer le lieu ou le type de collecte, annulez cette collecte et programmez-en une nouvelle."

**Cut-off et alertes Ops** : cf. [[05 - Règles métier#Modification d'une collecte à venir]]. Pas de blocage UI ; modulation par sévérité de l'email Ops (≥12h normal vs <12h priorité haute).

**Cascade TMS** : cf. [[05 - Règles métier#Modification d'une collecte à venir]] + [[08 - APIs et intégrations#Modification collecte (refonte 2026-05-04)]] + [[../../02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS#E2 — `PATCH /collectes/:id`]] et [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] W10.

**Effets de bord côté prestataire** (résumé) :

- Champ non-impactant (notes, contact secours, `informations_supplementaires`, etc.) : push silencieux
- Date / heure sur collecte `statut_tms = acceptee` : **réacceptation prestataire requise** (statut TMS → `attribuee_en_attente_acceptation` + flag `flags_jsonb.re_confirmation_requise`)
- `controle_acces_requis` : push silencieux, le bloc "Contrôle d'accès" se met à jour côté fiche

**Permissions** (cf. §05 source unique) — _modification_ d'une collecte :

- Programmeur / créateur (`created_by = auth.uid()`) : oui
- Manager (`role = traiteur_manager` même orga) : oui
- Autre commercial de la même orga : **non** (lecture seule — il voit la collecte mais ne peut pas la modifier ; révision 2026-05-29)

**Audit** : `audit_log` global rempli (champs `user_id`, `collecte_id`, `champ_modifie`, `ancienne_valeur`, `nouvelle_valeur`, `timestamp`, `cascade_tms`, `priorite_urgence`). Pas d'onglet front traiteur (sobriété A2 2026-05-04). Audit accessible Admin Savr uniquement via back-office §06.06.

**Notification client organisateur** : aucune (Ops Savr fait le filtre et relaie au cas par cas).

**Confirmation utilisateur** (sobriété B2 2026-05-04 — modal unique au lieu de 3)

Une seule modal de confirmation, contenu adapté dynamiquement aux flags applicables. Avant sauvegarde, si **au moins un** des contextes ci-dessous est vrai, la modal s'affiche en empilant les avertissements pertinents (sinon save direct sans modal) :

- `priorite_urgence` (modification < 12h avant créneau) → ligne "Cette modification a lieu moins de 12h avant la collecte. Notre équipe Ops sera alertée en urgence pour relayer au prestataire si besoin."
- `reacceptation_requise` (modif date/heure sur collecte `acceptee`) → ligne "Cette modification de créneau invalidera l'acceptation du prestataire qui devra re-confirmer."

Bouton unique "Confirmer la modification" (et "Annuler" pour fermer la modal).

### Bloc "Contrôle d'accès" (propagation M03 2026-04-24 — RESTAURÉ 2026-05-01 — RENOMMÉ + ÉTENDU 2026-05-03)

> **NOTE 2026-05-03 (refonte formulaire §06.01)** : bloc **renommé** "Véhicule qui viendra" → "Contrôle d'accès" + **étendu** à l'affichage de plaque + nom chauffeur (sémantique du flag unique `controle_acces_requis`). Voir [[04 - Data Model]] addendum 2026-05-03.

> **NOTE 2026-05-01** : bloc **restauré V1** suite à l'audit cohérence inter-CDC (annulation revue sobriété M05 2026-04-29 — la chaîne plaque manager `lieux.controle_acces_requis_default` + `collectes.controle_acces_requis` + webhook S7 `plaque-saisie` + `tournees.plaque_immatriculation` + `tournees.chauffeur_nom` est réactivée). Note 2026-04-29 antérieure (retrait V1) annulée.

**Contexte** : suite à l'introduction du toggle `lieux.controle_acces_requis_default` (refonte 2026-05-03 §06.01 Formulaire programmation de collecte), la fiche collecte affiche **la plaque ET le nom du chauffeur** communiqués par le prestataire. Remplacement fonctionnel de l'ancien email T+3h (retiré Q10 M05 propagation 2026-04-24).

**Affichage conditionnel** :

Le bloc s'affiche dans la fiche collecte uniquement si `collectes.controle_acces_requis=true` ET `collectes.statut IN ('programmee','validee','en_cours')` _(Sujet 2 2026-05-26 : ancien set `validee/attribuee/acceptee/en_cours` mélangeait `statut` métier et `statut_tms` — `attribuee`/`acceptee` sont des valeurs de `statut_tms`. Exprimé en `statut` métier : `programmee` couvre le dispatch — la plaque pré-saisie par le manager prestataire peut arriver dès cette phase —, `validee` l'acceptation, `en_cours` l'exécution)_. Invisible pour les collectes réalisées (clôturées — la plaque + nom chauffeur deviennent historiques via le bordereau).

**États du bloc** :

> **Sobriété B2 2026-06-03** : l'ex-3e état "Modification en cours" est **fusionné dans "Communiqué"**. Il ne déclenchait aucun comportement applicatif distinct (juste un badge de couleur différente, aucune action côté traiteur). Le bloc affiche désormais **toujours la dernière valeur** plaque/nom reçue (qu'elle vienne de la pré-saisie manager ou d'une actualisation chauffeur jour J), avec sa date d'actualisation. 2 états au lieu de 3.

| État           | Trigger                                                                                                                           | Affichage                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **En attente** | `plaque_preassignee_manager` NULL **OU** `chauffeur_nom` NULL côté TMS                                                            | Placeholder "Le prestataire n'a pas encore communiqué la plaque + le nom du chauffeur." + icône horloge _(mention "SLA d'acceptation : <date/heure limite>" **retirée 2026-06-07** — test scenarios §06.04 F4, arbitrage Val : aucune source App pour cette date, donnée TMS absente des payloads S2/S3/S7 ; zéro extension contrat V1)_ |
| **Communiqué** | `plaque_preassignee_manager` ET `chauffeur_nom` renseignés (push via webhook S3 `tournee-upsert` + S7 `plaque-saisie` depuis TMS) | "Véhicule prévu : <plaque> (<type véhicule>) — Chauffeur : <nom>" + badge vert "Communiqué par <prestataire> le <date d'actualisation>". La valeur affichée est **toujours la plus récente** reçue (une actualisation chauffeur jour J via S7 remplace la pré-saisie ; la date reflète la dernière mise à jour).                         |

**Cas multi-camions (refonte 2026-05-25)** : une collecte volumineuse peut être servie par N tournées (relation N↔N via `collecte_tournees`). Le bloc affiche alors **une ligne par tournée** : `<plaque> (<type véhicule>) — Chauffeur : <nom>`, avec l'état (En attente / Communiqué / Modification en cours) calculé **par tournée**. En-tête "N véhicules prévus" si la collecte a plus d'une tournée. Cas standard (1 tournée) = une seule ligne, affichage inchangé.

**Cas vélo cargo A Toutes! (AG)** : si la collecte est attribuée à A Toutes! avec véhicule = vélo cargo, le bloc affiche un message dédié : "Vélo cargo — pas de plaque communiquée. Chauffeur : <nom>" (le nom chauffeur reste affiché si disponible, la plaque est masquée avec mention explicite).

**Permissions** :

- `traiteur_manager` : voit toujours si collecte de son organisation
- `traiteur_commercial` : voit toute collecte de son organisation _(révision 2026-05-29 — RLS lecture `organisation_id`, plus de restriction `cree_par_user_id` en lecture)_
- `gestionnaire_lieu` : voit également sur son dashboard lieu (cf. [[05 - Espace client gestionnaire de lieux]])

**Pas d'email automatique V1** (Q8.2 option b validée) — notification push en V2. L'utilisateur doit consulter la fiche collecte pour voir l'info. Si un contrôle d'accès nécessite plaque + nom chauffeur, le traiteur ou l'Admin Savr la relaye manuellement.

**Sources de données** :

- `collectes.controle_acces_requis` (booléen, propagé au TMS via payload E1) — refonte 2026-05-03 ex `plaque_requise`
- Webhook S3 `tournee-upsert` côté Plateforme stocke `tournees.plaque_preassignee_manager` + `tournees.chauffeur_nom`
- Webhook S7 `plaque-saisie` enrichi 2026-05-03 : payload contient `plaque` + `chauffeur_nom`
- Liaison via `collecte_tournees` → `tournees` pour jointure (N↔N — refonte multi-camions 2026-05-25, ex `collectes.tournee_id` singulier retiré ; une collecte peut joindre N tournées donc N plaques/chauffeurs)

**Cohérence cross-CDC** : [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] E4 Assignation tournée + [[../../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] R_M04.CONTROLE_ACCES (ex R_M04.PLAQUE).

### Programmation d'une collecte

Voir [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]]. Le formulaire est accessible :

- Via les boutons du dashboard (accueil — bandeau actions rapides §2)
- Via le bouton **unique** `[ Programmer un événement ]` en haut de la liste Collectes (refonte 2026-05-21 — formulaire unique événement-centré). Le **type est pré-coché selon l'onglet actif** (onglet ZD → Zéro-Déchet pré-coché ; onglet AG → Anti-Gaspi pré-coché), l'utilisateur pouvant cocher l'autre type en étape 1 du formulaire §06.01.

**Rappel** : la programmation est possible même avec des champs non bloquants vides (voir sous-page 01 §Champs non bloquants). La collecte est créée avec `informations_completes = false` et peut être complétée ultérieurement depuis la fiche collecte.

### Bandeau "Informations incomplètes" (sobriété B1 2026-05-04 — fusionné dans §Édition)

Sur la fiche d'une collecte `informations_completes = false`, un bandeau orange "Informations incomplètes — merci de compléter avant la collecte" reste affiché en haut de page. Le bouton est le même que pour la modification (cf. §Édition d'une collecte à venir) : **[ Éditer la collecte ]**. Pas de flow distinct pour la complétion. À la sauvegarde, si tous les champs non bloquants sont renseignés → `informations_completes = true`, le bandeau disparaît.

### Partage de collecte avec un ou plusieurs collègues — Reporté V1.1 _(audit sobriété §04 2026-05-25, A4)_

> ⚠ **Reporté V1.1 (A4 2026-05-25)** : la table `collecte_partages` et l'UI de partage commercial↔commercial sont retirées du périmètre V1. Motif : le manager voit déjà 100 % des collectes de l'organisation ; le cas commercial↔commercial est marginal et ne justifie pas une table de jointure + une clause RLS `OR` sur chaque lecture de collecte. La spec ci-dessous est conservée pour réactivation V1.1.

Un commercial qui programme une collecte pour un autre collègue (cas fréquent : commercial A programme pour commercial B absent) peut partager l'accès à cette collecte.

**Depuis le formulaire de programmation** (section optionnelle étape 3) :

- Champ "Partager cette collecte avec un collègue"
- Saisie d'une ou plusieurs adresses emails de collègues de la même organisation
- Validation à la saisie : l'email doit correspondre à un user actif de la même organisation. Sinon message d'erreur : "Cet email ne correspond à aucun membre de votre équipe. Invitez d'abord le collaborateur depuis Mon organisation."

**Depuis la fiche collecte (après programmation)** :

- Section "Partage" en bas de page
- Liste des collègues déjà partagés (email + date de partage)
- Bouton "Ajouter un collègue" ou "Retirer un collègue"
- Seul le programmeur de la collecte et le manager peuvent modifier la liste des partages

**Comportement côté collègue partagé** :

- La collecte apparaît dans sa liste des collectes avec un badge "Partagée par [prénom nom]"
- Accès en lecture sur la fiche collecte
- Possibilité de compléter les informations manquantes
- Pas de possibilité de demander l'annulation (réservée au programmeur et au manager)
- Accès aux rapports RSE de cette collecte

**Impact data model** : table `collecte_partages` **reportée V1.1** (audit sobriété §04 2026-05-25, A4 — voir §Impact data model ci-dessous).

### Annulation / Demande d'annulation _(scindé 2026-06-07 — test scenarios §06.04 F1, arbitrage Val : §05 fait foi)_

**Deux chemins selon le statut** (cf. [[05 - Règles métier#Annulation]], source unique) :

**A. Annulation directe — `statut IN (brouillon, programmee)`** (sans validation Admin) :

1. Clic "Annuler la collecte" → modal de confirmation (motif texte libre, optionnel V1)
2. Statut collecte passe **immédiatement** à `annulee`
3. Si `statut_tms ≠ non_envoye` (collecte déjà poussée TMS) : **E3 `DELETE /collectes/:id` déclenché systématiquement** vers le TMS → le prestataire est informé côté TMS sans délai _(exigence Val 2026-06-07 F5 : toute annulation/suppression — traiteur, Ops ou Admin — doit être propagée au TMS)_
4. Notification email info à l'Admin Savr (pas de validation requise)
5. Règles de facturation/débit pack identiques (cf. ci-dessous — le seuil 12h s'applique quel que soit le chemin)

**B. Demande d'annulation — `statut = validee`** (validation Admin requise) :

1. Clic "Demander l'annulation" → modal de confirmation
2. Saisie d'un motif (texte libre, optionnel V1)
3. Clic "Confirmer la demande"
4. Statut collecte passe à `annulation_demandee`
5. Notification email à l'Admin Savr (template `admin_demande_annulation` existant)
6. Si prestataire déjà mandaté : notification automatique au prestataire
7. L'Admin valide ou refuse → statut final ; si validée → `annulee` + E3 vers TMS

**Règle de facturation V1** (voir [[05 - Règles métier]]) :

- Annulation ≥ 12h avant créneau : pas de facturation
- Annulation < 12h avant créneau (ou après mandat prestataire) : facturation plein tarif. Pour AG : **débit d'un crédit pack** via trigger `trg_pack_debit_annulation_tardive` _(révisé 2026-06-07 — test scenarios §06.01 F2, arbitrage Val : §4bis fait foi)_. Sans pack actif → alerte Admin + arbitrage manuel, pas de facture automatique (F3). Cf. [[05 - Règles métier#Débit d'un crédit]].

**Recrédit pack AG (refonte 2026-05-08)** : si la collecte annulée est de type AG :

- Annulation **avant `realisee`** (cas standard) : aucun débit pack n'a été fait, donc rien à recréditer. Le pack reste intact.
- Annulation **après `realisee`** (cas exceptionnel, traité Admin) : recrédit automatique du pack via trigger DB. Aucune action manuelle requise du traiteur ou de l'Admin.

Ces règles sont rappelées dans la modal avant confirmation, avec une mention explicite pour AG : _"Votre crédit Anti-Gaspi sera préservé : il n'a pas encore été débité (annulation avant réalisation de la collecte)."_

---

## 4. Factures (déplacé dans Mon organisation > Facturation — refonte 2026-05-05)

> **Refonte 2026-05-05** : entrée nav supprimée. Vue liste + filtres + fiche facture déplacés en sous-section "Facturation" de Mon organisation (voir §3 Mon organisation ci-dessous, désormais §3 après renumérotation).
>
> **Pour `traiteur_commercial`** _(révision 2026-05-29)_ : **vue liste accessible en lecture seule** (toutes les factures de l'orga, comme le Manager). L'ancienne restriction option C (accès via fiche collecte uniquement, périmètre ses propres collectes) est **levée**. Le commercial ne peut toujours pas agir sur les factures (lecture/téléchargement seulement) ni accéder à la sous-section Utilisateurs.

---

## 5. Rapports RSE (supprimé — refonte 2026-05-05)

> **Refonte 2026-05-05** : entrée nav supprimée + table `rapports_synthese` supprimée + batchs auto (mensuel/trimestriel/annuel) supprimés.
>
> **Accès rapports RSE par collecte** : reste via picto liste collectes (download direct) + bouton sur fiche collecte. Inchangé.
>
> **Accès synthèses agrégées** : uniquement à la demande via bouton "Exporter une synthèse PDF" du dashboard (modal avec filtres dashboard pré-remplis + ajustables). Pas d'archivage. Pas d'envoi par email V1. Pas de pack ZIP groupé.
>
> **Contenu du PDF synthèse** (inchangé, déplacé dans [[12 - Reporting et exports]]) :
>
> - Page de garde : période couverte, organisation, filtres appliqués, logo
> - Bloc KPIs : nombre de collectes, tonnage total, taux de recyclage _(ZD uniquement, formule à captation par filière, cf. [[05 - Règles métier#R_taux_recyclage]])_, repas donnés, CO2 évité
> - Graphique évolution mensuelle (tonnage par flux)
> - Top 10 lieux / clients finaux
> - Tableau détaillé des collectes (date, lieu, type, poids/repas)
> - Données de conformité réglementaire
> - Collectes prises en compte uniquement statut `cloturee` (embargo H+24 post-collecte)

---

## 6. Mon organisation

_(Révision 2026-05-29)_ Accessible au `traiteur_manager` (accès complet, édition) **et** au `traiteur_commercial` (**lecture seule**, sous-section **Équipe/Utilisateurs masquée**). Détail des droits par sous-section ci-dessous.

| Sous-section                                      | Manager                                              | Commercial (rév. 2026-05-29)                                                                               |
| ------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Informations légales / Entités facturation / Logo | Lecture + édition                                    | **Lecture seule**                                                                                          |
| Équipe (utilisateurs)                             | Accès complet (inviter, rôles, suspendre, transfert) | **Masquée** (gestion des utilisateurs = Manager uniquement)                                                |
| Facturation (paramètres + liste + fiche)          | Lecture + édition paramètres                         | **Lecture seule** (toutes factures orga, téléchargement PDF ; pas d'édition des paramètres de facturation) |
| Préférences                                       | Lecture + édition                                    | **Lecture seule**                                                                                          |

### Sous-sections

**Informations légales**

- Raison sociale, SIREN, adresse — **modifiables par le manager** (toute modification est loguée dans `audit_log`)
- Entités de facturation (multi-SIRET) — ajout/modification/suppression par le manager
- Domaines email autorisés (pour l'onboarding auto des collaborateurs)
- Logo de l'organisation (upload, affiché dans les rapports)

**Équipe (users rattachés)**

- Liste des utilisateurs avec : nom, email, rôle, dernière connexion
- Actions manager :
  - **Inviter un collaborateur** : email + rôle (`traiteur_commercial`)
  - Modifier le rôle d'un collaborateur
  - Suspendre un compte (soft delete)
  - Transférer les collectes d'un commercial vers un autre (en cas de départ)

**Facturation** (refonte 2026-05-05 — fusion ex-onglet Factures + ex-sous-section Facturation Mon organisation)

Sous-section unifiée. _(Révision 2026-05-29)_ : édition des **paramètres de facturation** = Manager only ; **vue liste + fiche facture** accessibles au commercial en **lecture seule** (toutes les factures de l'orga).

**Paramètres de facturation** (haut de page) :

- Coordonnées bancaires (affichées sur les factures émises)
- Contact principal facturation (email qui reçoit les factures et relances)
- Conditions de paiement négociées (V2)

**Vue liste des factures** (corps de page — ex §4 Factures vue liste) :

Tableau lecture seule :

| Numéro         | Date émission | Échéance    | Montant TTC | Statut | PDF         |
| -------------- | ------------- | ----------- | ----------- | ------ | ----------- |
| FZD-2026-00124 | 12 avr 2026   | 12 mai 2026 | 1 032,00 €  | Émise  | Télécharger |

**Filtres** : statut, type (ZD/AG/Pack/Avoir), période.

Toutes les factures de l'organisation sont visibles (factures par collecte, factures groupées, achats de pack, avoirs).

**Fiche facture (vue détail)** :

- Lignes détaillées (collectes facturées)
- Montant HT, TVA, TTC
- Conditions de paiement
- Téléchargement PDF (source : `pdf_url_pennylane` si dispo, sinon `pdf_url_savr`)
- Lien vers les collectes associées

**Pas de paiement en ligne en V1.** Le règlement se fait hors plateforme (virement bancaire classique). Les coordonnées bancaires de Savr sont indiquées sur la facture.

**Indicateurs** :

- Badge "En retard" rouge si échéance dépassée
- Lien vers "Me contacter" pour toute question facturation (ouvre un mailto hello@gosavr.io)

> **Accès commercial** _(révision 2026-05-29 — l'option C 2026-05-05 est levée)_ : le commercial accède à la **vue liste complète des factures de l'orga en lecture seule** (Mon organisation > Facturation), en plus du bouton "Télécharger la facture" sur la fiche collecte. RLS lecture alignée sur `organisation_id`. Il ne peut pas éditer les paramètres de facturation.

**Préférences**

- Notifications email (activer/désactiver par type d'événement) — V1.1
- Langue de l'interface (FR uniquement V1)

### Invitation de collaborateur (flux)

1. Clic "Inviter un collaborateur" → modal
2. Champs : email, prénom, nom, rôle (sélecteur `traiteur_commercial`)
3. Envoi d'un email d'invitation au collaborateur (template `invitation_collaborateur` — à ajouter à [[02 - Templates emails V1]])
4. Le collaborateur clique sur le lien → création de compte en auto-service
5. Rattachement automatique à l'organisation de l'invitant
6. Statut initial : `actif`

---

## 7. Mon profil

Section commune à tous les users :

- Informations personnelles : prénom, nom, email, téléphone
- Changement de mot de passe
- Préférences (si applicable)
- Lien "Demander la suppression de mon compte" (soft delete 48h + hard delete / anonymisation — voir [[09 - Authentification et permissions]])

---

## 8. Responsive mobile

Tous les écrans de l'espace traiteur doivent être responsives sur mobile, y compris :

- Dashboard
- Liste et fiche collecte
- Formulaire de programmation
- Factures et rapports

**Priorisation V1** :

- Programmation de collecte sur mobile : usage fréquent (les commerciaux programment souvent depuis le terrain)
- Téléchargement de PDF : accessible depuis mobile
- Édition "Mon organisation" : admis en mobile mais pas prioritaire (usage desktop principal)

Voir [[10 - Design System]] pour les règles responsive détaillées.

---

## 9. Règles RLS (Row Level Security) Supabase

Rappel synthétique (voir [[09 - Authentification et permissions]] pour le détail) :

### `traiteur_manager`

- Lecture/écriture sur toutes les entités où `organisation_id = current_user.organisation_id`
- Écriture sur `collectes`, `evenements`, `organisations` (sa propre orga uniquement)
- Lecture factures : toutes celles de l'orga
- Actions utilisateurs : CRUD sur les users de son orga

### `traiteur_commercial` _(révision 2026-05-29 — lecture alignée Manager, écriture limitée à ses créations)_

- **Lecture** sur toutes les entités où `organisation_id = current_user.organisation_id` (collectes, événements, factures, dashboards, benchmarks) — **périmètre identique au Manager**. Couvre aussi les collectes où son traiteur est opérationnel (`traiteur_operationnel_organisation_id = current_user.organisation_id`).
- **Écriture** sur `collectes` / `evenements` WHERE `created_by = current_user.id` uniquement (création + modification/suppression libre des champs métier de ses propres collectes futures, voir §2 Édition). Aucune écriture sur les collectes d'un autre commercial.
- **Factures** : lecture sur toutes les factures de l'orga (vue liste Mon organisation > Facturation en lecture seule **+** bouton "Télécharger la facture" sur fiche collecte). Aucune action d'écriture.
- Lecture pack AG de l'orga (solde) **+ action "Demander un renouvellement"** (refonte 2026-05-04 : action ouverte au commercial dans le bloc Mon pack AG du dashboard onglet AG)
- **`organisations`** : lecture seule (Mon organisation accessible en consultation : infos, logo, facturation). **Aucune écriture** (édition des paramètres org = Manager only). Sous-section **Utilisateurs/Équipe masquée** (gestion des utilisateurs = Manager only).
- Lecture autorisée sur `f_benchmark_kg_pax_zd` (paramètre `traiteur_ids[]` rejeté côté serveur — cf. §2 Bloc 3 ZD benchmark, applicable au dashboard ET au bloc fiche collecte refonte 2026-05-05)

### Permissions modification collecte (refonte 2026-05-04, révision 2026-05-29)

- Programmeur / créateur (`created_by = auth.uid()`) : modification autorisée sur tous champs métier collecte/événement
- Manager (`role = traiteur_manager` même orga) : modification autorisée sur toute collecte de l'orga
- Autre commercial de la même orga : **lecture seule** (voit la collecte mais ne peut pas la modifier/supprimer — révision 2026-05-29)
- Collègue partagé (table `collecte_partages`) : sans objet V1 (partage reporté V1.1, A4) — mécanisme V1.1 destiné à étendre l'**écriture** à un collègue désigné
- Toute modification logguée dans `audit_log` global avec champs `cascade_tms` (bool) et `priorite_urgence` (bool si <12h)

---

## Impact data model

### Nouveau champ `organisations.tarif_refacture_pax_zd` (numeric — ajout 2026-05-07)

Tarif que le traiteur refacture à son client final par couvert, pour le service "tri à la source" sur les collectes ZD. Sert exclusivement au calcul du KPI **Marge générée** sur le dashboard traiteur ZD.

| Champ                    | Type           | Contrainte                           | Description                                                                                                   |
| ------------------------ | -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `tarif_refacture_pax_zd` | numeric(10, 2) | NOT NULL, DEFAULT 1.50, CHECK (>= 0) | Tarif refacturé en € par couvert. Modifiable Admin Savr only via §06.06 Back-office. Audit_log sur changement |

**Migration SQL** :

```sql
ALTER TABLE organisations
  ADD COLUMN tarif_refacture_pax_zd numeric(10, 2) NOT NULL DEFAULT 1.50
  CHECK (tarif_refacture_pax_zd >= 0);
```

Déploiement : valeur par défaut 1.50 € appliquée à toutes les organisations existantes au moment de la migration. Admin Savr peut éditer la valeur ensuite par traiteur (cf. [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]]).

**RLS** :

- Lecture : `traiteur_manager` + `traiteur_commercial` peuvent **lire** la valeur de leur propre orga (nécessaire pour calculer le KPI Marge côté front).
- Écriture : Admin Savr uniquement (cf. [[09 - Authentification et permissions]]).

### Nouvelle table `collecte_partages` → Reportée V1.1 _(audit sobriété §04 2026-05-25, A4)_

> ⚠ **Reportée V1.1 (A4 2026-05-25)** : table non créée en V1.

**RLS collectes V1 (sans partage) — révision 2026-05-29** :

_Policy LECTURE (SELECT)_ — un user voit une collecte si :

- `collectes.organisation_id = user.organisation_id AND user.role IN ('traiteur_manager','traiteur_commercial')` (manager **et** commercial : toutes les collectes de l'orga), OU
- `collectes.traiteur_operationnel_organisation_id = user.organisation_id` (collectes où son traiteur est opérationnel, programmées par un tiers).

_Policy ÉCRITURE (INSERT/UPDATE)_ — un user peut écrire une collecte si :

- `collectes.created_by = auth.uid()` (créateur : ses propres collectes), OU
- `collectes.organisation_id = user.organisation_id AND user.role = 'traiteur_manager'` (manager : toutes les collectes de l'orga).

_Policy DELETE — restreinte 2026-06-07 (test scenarios §06.04 F5, arbitrage Val)_ : le DELETE physique est limité à **`collectes.statut = 'brouillon'`** (jamais poussée TMS), avec le même prédicat acteur que l'écriture (créateur ou manager). Toute collecte `programmee+` se supprime **uniquement via l'annulation** (statut `annulee`), qui déclenche systématiquement E3 `DELETE /collectes/:id` vers le TMS si `statut_tms ≠ non_envoye` — le prestataire est informé sans délai (chemins traiteur, Ops et Admin confondus). pgTAP : deny DELETE sur `programmee+` tous rôles traiteur.

La clause `OR EXISTS (collecte_partages …)` est retirée de la policy V1 (réactivation V1.1 sur la policy écriture).

### Table `rapports_synthese` (supprimée — refonte 2026-05-05)

> **Refonte 2026-05-05** : table supprimée. Les synthèses agrégées ne sont plus archivées. Génération uniquement à la demande via bouton "Exporter une synthèse PDF" du dashboard, téléchargement direct, pas de stockage côté DB. Cohérent avec suppression nav Rapports RSE + suppression batchs auto.
>
> **Impact §04 Data Model** : retirer la définition de cette table (jamais arrivée en migration prod, V1 de toute façon).

### Champ `rapports_rse.filtres_benchmark` (jsonb, nullable) — rétabli 2026-06-03

> **Rétabli 2026-06-03 (session sobriété §06.04, arbitrage Val — annulation revue §12 B2)** : colonne `rapports_rse.filtres_benchmark` **conservée/rétablie**. Le bloc benchmark du rapport RSE (§1.2) est **figé par snapshot** : les filtres benchmark choisis par le traiteur au moment de la génération sont persistés, le re-téléchargement du même PDF redonne exactement les mêmes valeurs (PDF reproductible). Une **légende affichée sous le graphe benchmark du PDF** précise les filtres appliqués (période / lieux / type d'événement / taille). Motif Val : permettre un benchmark personnalisé reproductible sur le rapport client, sans ambiguïté sur le segment de comparaison.
>
> _(Historique : la revue §12 du même jour, B2, avait supprimé cette colonne au profit d'un recalcul à la volée — décision **annulée** par Val. Le calcul à la volée est abandonné.)_
>
> La règle « pas de `traiteur_ids[]` » (filtre rejeté côté serveur, motif concurrentiel) reste portée par le bloc benchmark §2 Bloc 3 ZD. Définition canonique de la colonne : [[04 - Data Model]] table `rapports_rse`.

---

## Décisions prises

> **Révision structurante 2026-05-29 — droits `traiteur_commercial`** : le commercial a désormais une **lecture identique au Manager** (toutes les collectes, factures, dashboards, benchmarks, Bloc 7 de l'organisation). Il ne diffère du Manager que sur (a) l'**écriture**, limitée à ses propres collectes (`created_by = auth.uid()`), et (b) l'absence de **gestion des utilisateurs** + d'édition des paramètres de l'organisation. Plusieurs décisions ci-dessous sont marquées RÉVISÉ en conséquence. Propagé : [[02 - Personas et cas d'usage]], [[11 - Dashboards]], [[09 - Authentification et permissions]].

| Décision                                                                                                                                                                                                | Alternative écartée                                                                                                 | Raison                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard = page d'accueil                                                                                                                                                                              | Liste collectes directe                                                                                             | Vue d'ensemble d'abord, actions ensuite. Cohérent avec le flux commercial                                                                                                                                                                                                                                   |
| Boutons "Programmer collecte" proéminents sur dashboard                                                                                                                                                 | Menu accessible                                                                                                     | La programmation est l'action principale → visibilité maximale                                                                                                                                                                                                                                              |
| **RÉVISÉ 2026-05-29** : lecture = toute l'orga (comme Manager) ; seule l'écriture reste limitée à ses propres collectes                                                                                 | Vision équipe partagée                                                                                              | Décision initiale (confidentialité commerciale) annulée sur demande Val : le commercial doit avoir la même vision que le Manager, hors gestion des utilisateurs                                                                                                                                             |
| Pas de paiement CB en V1                                                                                                                                                                                | Paiement intégré                                                                                                    | Complexité juridique (CGV, PSD2, Stripe) hors scope V1                                                                                                                                                                                                                                                      |
| Invitation collaborateur = manager uniquement                                                                                                                                                           | Auto-service avec domaine email                                                                                     | Contrôle manager sur qui rejoint l'équipe                                                                                                                                                                                                                                                                   |
| Rapports RSE section dédiée + accès via fiche collecte                                                                                                                                                  | Accès uniquement via fiche collecte                                                                                 | Usage fréquent = accès direct justifié                                                                                                                                                                                                                                                                      |
| Pack groupé de rapports (ZIP)                                                                                                                                                                           | Rapports un par un uniquement                                                                                       | Cas d'usage réel (restitution annuelle client organisateur)                                                                                                                                                                                                                                                 |
| Dashboard RSE 12 mois glissants                                                                                                                                                                         | Mois en cours uniquement                                                                                            | Perception d'impact long terme, fidélisation                                                                                                                                                                                                                                                                |
| **Refonte dashboard 2026-05-04 — héritage structure §05 (2 onglets ZD/AG, 5 filtres globaux, blocs hérités)**                                                                                           | Conserver dashboard traiteur historique séparé                                                                      | Mutualisation logique (1 dashboard, 2 contextes) — réduction surface UI + composants partagés                                                                                                                                                                                                               |
| **Filtre global "Client organisateur"** (remplace "Traiteurs" du §05)                                                                                                                                   | Filtre "Commercial"                                                                                                 | Cohérent avec filtres existants liste collectes — pas de logique conditionnelle manager/commercial                                                                                                                                                                                                          |
| **Bloc 7 "Top 5 commerciaux"** _(ouvert au commercial 2026-05-29)_                                                                                                                                      | "Top 5 traiteurs" §05                                                                                               | Sans objet côté traiteur (un seul traiteur) — top commerciaux apporte valeur métier ; visible Manager **et** Commercial depuis l'alignement lecture 2026-05-29                                                                                                                                              |
| **Suppression KPI "CA collecte" du dashboard**                                                                                                                                                          | Conserver en 5e KPI manager                                                                                         | CA reste dans section Factures, dashboard recentré sur indicateurs RSE                                                                                                                                                                                                                                      |
| **Bloc 3 ZD benchmark ouvert aux traiteurs** sans filtre `traiteur_ids[]`                                                                                                                               | Réservé gestionnaires                                                                                               | Apporte de la valeur à tous les utilisateurs ; filtre traiteurs interdit pour préserver le compétitif                                                                                                                                                                                                       |
| **Mon pack AG fondu dans onglet AG** (bloc dédié pleine largeur sous KPIs)                                                                                                                              | Section navigation séparée                                                                                          | Suppression entrée nav (8→7), regroupement contexte AG, suppression page dédiée                                                                                                                                                                                                                             |
| **Bouton "Exporter une synthèse PDF"** au-dessus des onglets, ouvre formulaire §5 pré-rempli filtres dashboard                                                                                          | Génération one-click directe                                                                                        | Réutilise existant, l'utilisateur peut ajuster avant génération                                                                                                                                                                                                                                             |
| **Picto rapport téléchargeable** dans liste collectes (à côté indicateur "Disponible")                                                                                                                  | Indicateur passif uniquement                                                                                        | UX directe — gain de temps pour traiteurs qui consultent leurs rapports régulièrement                                                                                                                                                                                                                       |
| **Suppression UI "Bordereau ZD / Attestation AG" et "Voir les photos"** depuis fiche collecte traiteur                                                                                                  | Conserver en actions séparées                                                                                       | Bordereau intégré au PDF rapport RSE (page supplémentaire) ; photos restent dans le rapport RSE PDF ; cas `realisee_sans_collecte` → nouveau PDF "Événement sans excédent alimentaire" sans photos                                                                                                          |
| **Modification libre des informations collectes futures** + alerte Ops systématique                                                                                                                     | Liste de champs verrouillés                                                                                         | Confiance utilisateur, Ops arbitre côté terrain — pas de friction UI inutile                                                                                                                                                                                                                                |
| **Pas de cut-off bloquant modification** ; modulation par sévérité alerte Ops (urgence si <12h)                                                                                                         | Cut-off temporel bloquant                                                                                           | Réalité opérationnelle : les modifs tardives existent, autant les tracer + alerter qu'interdire                                                                                                                                                                                                             |
| **Cascade webhook `collecte-update` vers TMS** sur statuts `validee`/`attribuee`/`acceptee` + réacceptation prestataire si modif date/heure post-acceptation                                            | Modification locale uniquement                                                                                      | Cohérence inter-CDC — le TMS doit voir la donnée à jour pour exécuter la tournée correctement                                                                                                                                                                                                               |
| **Audit modifications via `audit_log` global**                                                                                                                                                          | Table dédiée `collectes_modifications`                                                                              | Sobriété data model — `audit_log` couvre déjà ce besoin                                                                                                                                                                                                                                                     |
| **Pas de notification client organisateur sur modification**                                                                                                                                            | Email auto au contact principal                                                                                     | Ops Savr fait le filtre + relais cas par cas, évite bruit email                                                                                                                                                                                                                                             |
| **Sobriété A1 2026-05-04** — Bloc 8 dashboard "Dernier rapport synthèse" supprimé, conservé sur fiche collecte                                                                                          | Bloc 8 dashboard                                                                                                    | Redondance avec section Rapports RSE accessible via nav. Conservation sur fiche = accès contextuel pertinent                                                                                                                                                                                                |
| **Sobriété A2 2026-05-04** — Onglet "Historique des modifications" lecture seule retiré de la fiche traiteur                                                                                            | Onglet front avec audit_log paginé                                                                                  | Volume usage <1%. Audit reste accessible Admin Savr via back-office                                                                                                                                                                                                                                         |
| **Sobriété A3 2026-05-04** — Template email modification : 1 seul objet + en-tête, urgence dans le contenu uniquement                                                                                   | Variantes objet `[URGENT]` + `X-Priority: 1`                                                                        | Filtrage Ops via règle Gmail si besoin, évite logique de variantes côté envoyeur                                                                                                                                                                                                                            |
| **Sobriété A4 2026-05-04** — `type_collecte` et `lieu_id` verrouillés UI (pas modifiables)                                                                                                              | Modification autorisée avec workflow annulation+recréation                                                          | Cas <1%, alternative manuelle (annuler + reprogrammer) acceptable. Évite cascade DELETE+POST côté TMS, modal dédiée, recalcul tarif                                                                                                                                                                         |
| **Sobriété B1 2026-05-04** — Fusion "Compléter infos manquantes" + "Modifier les informations" en 1 seul flow `[Éditer la collecte]`                                                                    | 2 actions distinctes                                                                                                | Mêmes champs, mêmes permissions, même logique. 1 composant front au lieu de 2                                                                                                                                                                                                                               |
| **Sobriété B2 2026-05-04** — Modal de confirmation unique avec avertissements empilés dynamiquement                                                                                                     | 3 modals distinctes (urgence / type-lieu / réacceptation)                                                           | 1 composant testable au lieu de 3. La modal A4 disparaît avec verrouillage UI                                                                                                                                                                                                                               |
| **Sobriété B3 2026-05-04** — Badge "Compléter infos" rouge retiré de la vue liste, bandeau orange fiche conservé                                                                                        | Double signalement liste + fiche                                                                                    | Évite double-rendu et incohérence couleur (rouge vs orange)                                                                                                                                                                                                                                                 |
| **Sobriété B4 2026-05-04** — Mon pack AG affiche uniquement les packs actifs, pas l'historique                                                                                                          | Accordéon historique repliable                                                                                      | Surface UI réduite. Historique disponible via support ou Admin Savr V1.1 selon retour                                                                                                                                                                                                                       |
| **Sobriété B5 2026-05-04** — Champ `side_effects` retiré du payload `PATCH /collectes/:id`                                                                                                              | Payload Plateforme calcule + envoie `reacceptation_requise`                                                         | Le TMS source de vérité sur le workflow prestataire, pas le frontoffice. Contrat API plus net                                                                                                                                                                                                               |
| **Sobriété C1+C2 2026-05-04** — Source unique des règles modification = §05 Règles métier (statuts autorisés + cut-off)                                                                                 | 3 endroits redondants (§06.04 + §05 + §08)                                                                          | Évite drift maintenance                                                                                                                                                                                                                                                                                     |
| **Refonte nav 2026-05-05** — 6→4 entrées : suppression "Factures" (déplacé dans Mon organisation manager only) + suppression "Rapports RSE" (remplacé par bouton "Exporter une synthèse PDF" dashboard) | Conserver 6 entrées                                                                                                 | Réduction surface UI, regroupement par contexte (facturation = admin orga, synthèses = depuis le dashboard où on a déjà les filtres)                                                                                                                                                                        |
| **RÉVISÉ 2026-05-29** : commercial accède à la vue liste complète (toutes factures orga) en lecture seule + fiche collecte                                                                              | A. Coupure totale ; B. Mon orga partiel                                                                             | Option C levée : lecture commercial alignée Manager. Le commercial ne peut toujours pas éditer les paramètres de facturation                                                                                                                                                                                |
| **Suppression batchs auto synthèses + table `rapports_synthese`** (option A)                                                                                                                            | B. Conservation batchs sans UI ; C. Batchs envoyés par email                                                        | Sobriété V1 max. Si traiteur veut une synthèse régulière → 1 clic depuis le dashboard avec filtres pré-remplis                                                                                                                                                                                              |
| **Bloc 3 ZD jauges sur fiche collecte ZD terminée** + filtres benchmark modifiables intégrés au PDF rapport RSE                                                                                         | Pas de jauge sur fiche, lecture KPI seulement                                                                       | Apporte le benchmark au grain collecte unique, support visuel pour le rapport RSE envoyé au client                                                                                                                                                                                                          |
| **Refonte Dashboard 2026-05-10 — blocs communs rattachés aux onglets ZD/AG**                                                                                                                            | Conserver section "Bloc commun (sous les onglets)"                                                                  | Cohérence stricte avec §06.05 et §06.11 : un onglet actif filtre tout le contenu visible. Numérotation suffixée `Bloc 5/6/7 ZD` et `Bloc 5/6/7 AG`. Bloc 7 (Top 5 commerciaux) **visible Manager et Commercial** dans les 2 onglets _(révision 2026-05-29)_.                                                |
| **Refonte Dashboard 2026-05-10 — bouton bandeau "Exporter synthèse PDF" retiré, remplacé par Bloc 8 ZD/Bloc 8 AG**                                                                                      | Conserver le bouton bandeau (en plus ou en remplacement des blocs)                                                  | Évite double mécanisme. Pattern strictement aligné §06.05/§06.11. Synthèse globale ZD+AG accessible en décochant le filtre "Type de collecte" dans la modal §4 Section Rapports (étape 2).                                                                                                                  |
| **Persistance filtres benchmark `rapports_rse.filtres_benchmark` jsonb + légende des filtres sous le graphe PDF (rétabli 2026-06-03, arbitrage Val)**                                                   | A. Calcul à la volée (revue §12 B2, parc courant, colonne supprimée) — **annulée** ; B. Pas de benchmark sur le PDF | Val veut un benchmark **personnalisable et reproductible** sur le rapport client : les filtres choisis sont figés (snapshot jsonb), le PDF est reproductible, et une légende sous le graphe précise le segment de comparaison. La revue §12 B2 du même jour (à la volée) est annulée.                       |
| **Titre fiche collecte composite** "Date - Lieu - Client - Pax"                                                                                                                                         | Numéro de collecte                                                                                                  | Numéro orienté support, titre composite orienté utilisateur métier (reconnaît sa collecte au premier coup d'œil)                                                                                                                                                                                            |
| **Suppression Type de pesée** champ orphelin                                                                                                                                                            | Conservation pour V2                                                                                                | Champ jamais défini en data model, jamais utilisé côté TMS, mention en 3 endroits seulement → nettoyage                                                                                                                                                                                                     |
| **Adresse + contacts en entête fiche collecte**                                                                                                                                                         | Bloc séparé en bas                                                                                                  | Infos pilotantes sur le champ : tel chauffeur, adresse pour Ops, contact secours pour le jour J                                                                                                                                                                                                             |
| **Liste collectes : suppression colonne Événement, Lieu = nom + adresse, ajout Pax**                                                                                                                    | Conservation 8 colonnes existantes                                                                                  | Lieu = info pilotante (où aller), pax = dimension événement, nom événement remonté dans titre fiche                                                                                                                                                                                                         |
| **Bloc 3 AG : suppression Distance moyenne**                                                                                                                                                            | Conservation                                                                                                        | Donnée non actionnable côté traiteur (pas de levier sur la distance asso<>lieu)                                                                                                                                                                                                                             |
| **Bloc 4 AG : 1 seul pack actif à la fois (pas de FIFO)**                                                                                                                                               | Multi-packs FIFO                                                                                                    | Règle métier : pack suivant activé après épuisement du précédent. Simplifie l'affichage et la logique de débit                                                                                                                                                                                              |
| **Notification info-only collecte programmée par tiers (2026-05-07)**                                                                                                                                   | Validation explicite par le traiteur                                                                                | Ouverture programmation aux agences/gestionnaires : le traiteur opérationnel reçoit un email récap (cf. §05 §9), pas de validation requise. Droit de retrait conservé via workflow annulation existant                                                                                                      |
| **Badge "Programmée par X" sur fiche collecte + picto liste (2026-05-07)**                                                                                                                              | Pas d'indicateur visuel                                                                                             | Le traiteur opérationnel doit identifier en un coup d'œil les collectes programmées par tiers (responsabilité opérationnelle reste sienne, visibilité sur le donneur d'ordre)                                                                                                                               |
| **Filtre liste "Programmée par" (2026-05-07)**                                                                                                                                                          | Filtres existants suffisants                                                                                        | Cas d'usage : un traiteur multi-agences peut isoler les collectes WPM vs Quintessence vs ses propres directs                                                                                                                                                                                                |
| **RLS commercial étendue aux collectes programmées par tiers (2026-05-07)**                                                                                                                             | Restreindre à `created_by = self`                                                                                   | Le commercial doit voir toutes les collectes pour lesquelles son traiteur opère, peu importe qui les a programmées (responsabilité opérationnelle)                                                                                                                                                          |
| **KPI Marge ZD ajouté Bloc 1 dashboard (2026-05-07)** — formule `tarif_refacture_pax_zd × pax − Σ factures HT ZD émises/payées`                                                                         | Pas de KPI marge / KPI CA brut                                                                                      | Pilotage économique côté traiteur (impact direct sur la perception de valeur Savr). Distinct du CA = lecture facture seule. Numérateur revenu paramétré par traiteur, défaut 1.50 €                                                                                                                         |
| **Tarif refacturé par couvert paramétré par traiteur** (`organisations.tarif_refacture_pax_zd` numeric, défaut 1.50 €, Admin Savr only)                                                                 | Constante hardcodée pour tous traiteurs                                                                             | Chaque traiteur facture son client final à son propre tarif. Constante = KPI faux dès le 2e traiteur avec un autre tarif. Édition réservée Admin Savr (cohérent paramètres financiers §06.06)                                                                                                               |
| **Périmètre coût marge ZD = factures statut `emise` + `payee`**                                                                                                                                         | Inclure brouillons / facturer_dans_factures                                                                         | Cohérent avec lecture financière Mon organisation > Facturation. Brouillon = encore éditable par Savr, ne devrait pas dégrader la marge prématurément                                                                                                                                                       |
| **Liste Collectes : suppression vue "Toutes les collectes" → 2 onglets ZD/AG (2026-05-07)**                                                                                                             | Conserver filtre Type 3 valeurs                                                                                     | Cohérence dashboard §2 (déjà 2 onglets ZD/AG) → 1 seul pattern UI traiteur. Réduit charge cognitive et 1 zone à maintenir                                                                                                                                                                                   |
| **Bouton "Programmer une collecte" contextuel par onglet (2026-05-07)**                                                                                                                                 | Bouton générique avec popup de choix type                                                                           | Économise 1 clic, exploite le contexte de l'onglet, cohérent avec le bandeau dashboard (déjà 2 boutons ZD + AG)                                                                                                                                                                                             |
| **Bouton unique "Programmer un événement" + type pré-coché selon l'onglet (refonte 2026-05-21)**                                                                                                        | Conservation des 2 boutons distincts ZD/AG                                                                          | Formulaire unique événement-centré (D1) : un seul point d'entrée, choix ☐ZD ☐AG en étape 1. Le pré-cochage selon l'onglet conserve l'économie de clic du contexte.                                                                                                                                          |
| **Invitation collaborateur : n'importe quelle adresse email autorisée (2026-05-29)**                                                                                                                    | Restreindre aux emails du domaine de l'organisation                                                                 | Le manager gate déjà l'invitation manuellement (saisie explicite email + rôle). La restriction domaine bloque des cas légitimes (commercial freelance en email perso) et ajoute une logique de validation pour un gain de sécurité marginal.                                                                |
| **Transfert de collectes entre commerciaux : réassignation simple + `audit_log` (2026-05-29)**                                                                                                          | Table d'historique dédiée `collectes_transferts`                                                                    | Cas départ d'un commercial : le manager réassigne les collectes (mise à jour `cree_par_user_id`), l'opération est tracée dans `audit_log` global. Pas de table d'historique dédiée — `audit_log` couvre déjà la trace (cohérent avec la décision « Audit modifications via `audit_log` global » ci-dessus). |
| **Export groupé de rapports de recyclage en ZIP : plafond 50 fichiers / export (2026-05-29)**                                                                                                           | 100 fichiers / illimité (stream)                                                                                    | Évite les timeouts de génération côté serveur. Au-delà de 50, l'utilisateur découpe son export par période. Borne ajustable en V1.1 selon retours. _(Distinct de la synthèse PDF unique du dashboard — qui reste un fichier unique, pas un ZIP.)_                                                           |
| **Sobriété B2 2026-06-03 — Bloc Contrôle d'accès : fusion état "Modification en cours" dans "Communiqué"** (3→2 états, toujours la dernière valeur plaque/nom + date d'actualisation)                   | Conserver 3 états distincts                                                                                         | Le 3e état ne déclenchait aucun comportement applicatif distinct (badge de couleur, aucune action traiteur). Affichage de la valeur la plus récente suffit. Moins d'états = moins de logique d'affichage à tester.                                                                                          |

---

## Questions ouvertes

- **Tranchée 2026-05-29 (Val) : n'importe quelle adresse email** — cf. Décisions prises.
- **Tranchée 2026-05-29 (Val) : réassignation simple + `audit_log`** — cf. Décisions prises.
- **Tranchée 2026-05-29 (Val) : plafond 50 fichiers / export** — cf. Décisions prises.
- **Rapport de synthèse auto** : inclure ou non les collectes programmées mais non encore `cloturee` à la date du batch ? (décision V1 : non — uniquement les `cloturee`)

---

## Liens

- [[06 - Fonctionnalités détaillées/01 - Formulaire de programmation de collecte]]
- [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]] — structure dashboard héritée (2 onglets ZD/AG, 5 filtres globaux, blocs)
- [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]]
- [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]] (règles packs AG, pack unique actif)
- [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)]]
- [[02 - Personas et cas d'usage]]
- [[04 - Data Model]] — fonction `f_benchmark_kg_pax_zd` étendue grain `single_collecte` (refonte 2026-05-05) + colonne `rapports_rse.filtres_benchmark` (jsonb) **rétablie 2026-06-03 (annulation revue §12 B2, arbitrage Val — snapshot filtres benchmark persisté + légende sous le graphe PDF)** + suppression table `rapports_synthese` + `audit_log` global pour modifications collectes + **`organisations.tarif_refacture_pax_zd` (numeric, défaut 1.50 € — refonte 2026-05-07)**
- [[05 - Règles métier]] — règles modification collecte (cut-off, cascade TMS, réacceptation prestataire) + **R_marge_zd_traiteur (formule KPI marge dashboard — refonte 2026-05-07)**
- [[08 - APIs et intégrations]] — webhook E2 `collecte-update` vers TMS + suppression `type_pesee` du payload PATCH (refonte 2026-05-05)
- [[09 - Authentification et permissions]] — RLS factures commercial via fiche collecte uniquement (refonte 2026-05-05 option C) + lecture `tarif_refacture_pax_zd` traiteur orga, écriture Admin Savr only (refonte 2026-05-07)
- [[11 - Dashboards]] — nav traiteur 6→4 entrées (refonte 2026-05-05) + KPIs traiteur ZD 4→5 (ajout Marge — refonte 2026-05-07)
- [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] — édition `tarif_refacture_pax_zd` par Admin Savr (refonte 2026-05-07)
- [[12 - Reporting et exports]] — bordereau ZD intégré au rapport RSE PDF + template "Événement sans excédent alimentaire" + bloc benchmark dans rapport RSE par collecte (refonte 2026-05-05) + suppression batchs auto synthèses (refonte 2026-05-05)
- [[02 - Templates emails V1]] — templates `invitation_collaborateur` + `admin_modification_collecte_traiteur` (à ajouter)
