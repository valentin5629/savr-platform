# 11 - Dashboards

**Statut** : Validé
**Dernière mise à jour** : 2026-06-07 (**Session test-scenarios lot ⑫ — F5 tranchée Val** : histogramme Revenus Bloc 2 = statuts factures `emise|payee`, avoirs en négatif. Scénarios : `tests/11-12-dashboards-reporting-scenarios.md`.) / Antérieure : 2026-06-03 (**Revue de sobriété §11 Dashboards — 4 items, zéro dette** : **A1** suppression des 4 vues matérialisées `mv_kpi_*` + cron 15 min (fantômes, absentes §04) → vues SQL non matérialisées `v_kpi_*` à la volée ; **B1** préférences filtres/période → `localStorage` (plus de table serveur) ; **B2** retrait onglet « Vue consolidée » du dashboard `client_organisateur` → bandeau de tête + nettoyage références stale (décisions L208 + agence) ; **C1** dédup « Export PDF dashboards Puppeteer » → source unique §12. Toutes modifs locales §11.) — *ex 2026-05-06 : Taux de recyclage indicateur unique ZD-only, cf. [[04 - Data Model]] addendum 2026-05-06 + [[05 - Règles métier#R_taux_recyclage]]*

---

## Principe

Chaque rôle a un dashboard dédié avec KPIs contextualisés. V1 privilégie la clarté et la rapidité de lecture plutôt que l'exhaustivité. Tous les dashboards partagent un composant filtres commun (période + entité) et un principe d'interactivité (clic pour zoom vers le détail).

**Règle structurante V1** : TOUS les dashboards qui agrègent de l'activité collecte proposent un **split AG / ZD** côte à côte (sections ou onglets). Les deux métiers ont des indicateurs différents, les mélanger dégrade la lisibilité.

---

## 1. Dashboards `admin_savr` + `ops_savr` *(refonte 2026-05-07)*

Le back-office Admin propose **2 dashboards distincts** en navigation : Dashboard Admin (pilotage opérationnel Savr) + Dashboard Client (vue restituée du dashboard gestionnaire pour 1 ou plusieurs orgs). Les deux sont accessibles à `admin_savr` + `ops_savr`. Voir spec UI complète [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §1 + §2.

### 1.1 Dashboard Admin (page d'accueil)

Vue de pilotage opérationnel Savr — exclusivement orientée actions à mener.

**Bloc 1 — KPIs du jour / actions en attente** (5 cartes-actions, chacune cliquable redirige vers §3 Collectes filtré)

| Carte | Source |
|-------|--------|
| Collectes non transmises au TMS (split ZD / AG) *(renommée Sujet 2 2026-05-26, ex « à valider » — monitoring d'échec E1, pas de gate Admin)* | `collectes` `statut=programmee` ET `tms_reference IS NULL` |
| Collectes en attente de validation prestataire | `statut_tms = 'attribuee_en_attente_acceptation'` *(corrigé 2026-05-29 : ex `statut_dispatch`, champ TMS — miroir Plateforme = `collectes.statut_tms`)* |
| Collectes modifiées sans renvoi TMS | `dirty_tms = true` |
| Collectes ZD prévues 48h | `type=zd` ET `date_collecte BETWEEN now() AND now()+48h` ET `statut ∈ (programmee, validee)` |
| Collectes AG prévues 48h | idem `type=ag` |

> **Bloc « Données opérationnelles » supprimé 2026-05-07** — les agrégats métier (tonnage, flux, taux recyclage, graphs événements) sont accessibles via le **Dashboard Client §1.2** avec sélecteur "Toutes les organisations".

**Bloc 2 — Section Revenus**

- **Histogramme 12 mois glissants** : barres empilées par mois (segment ZD + segment AG), toggle "nombre" / "montant facturé HT". Source nb : `collectes.date_collecte` ; source montant : `factures.date_emission`. **Statuts (tranché 2026-06-07, F5 lot ⑫)** : montant = factures `statut IN ('emise','payee')` (brouillons exclus, cohérent R_revenus_imputation_organisation), **avoirs comptés en négatif** sur leur mois d'émission.
- **Tableau "Revenus par organisation"** : sélecteur de période (`date_collecte` from/to, défaut mois en cours). Colonnes : nom, type, nb ZD, montant ZD HT, nb AG, montant AG HT. Imputation = organisation programmatrice (`evenements.organisation_id`), cf. [[05 - Règles métier#R_revenus_imputation_organisation]]. Tri défaut `montant_total_desc`. Pagination 50/page. Export CSV.

**Bloc 3 — Section Coûts** — 🔒 **DESCOPÉ V1.1 (décision Val 2026-06-10, challenge Frontière TMS-Ready)** : ce bloc lit `v_courses_logistiques`, vue sur `tms.tournees ⋈ tms.collecte_tournees` — schéma `tms.*` non créé en V1, coûts non exposés par l'API MTS-1 (extract CSV = V2). **Aucun élément de ce bloc n'est développé en V1** (pas de stub, pas de chiffres à zéro). Le pilotage coûts/marge V1 reste hors plateforme (DAF / savr-data-query). Le bloc revient avec le TMS natif (ou une saisie coûts V1.1). Spec conservée telle quelle ci-dessous :

- Coûts logistiques totaux (`v_courses_logistiques` — somme des tournées ; pour une collecte multi-camions, somme des parts de coût de ses N tournées, cf. [[04 - Data Model#Vue : `v_courses_logistiques`]])
- Split par prestataire (Strike, Marathon, A Toutes!, province)
- Coûts moyens par collecte par type (ZD / AG)
- Marge brute (CA − coûts logistiques) par collecte et agrégée
- Alerte visuelle sur les collectes à marge négative

> Le KPI traiteur « Marge générée € » (§06.04) n'est **pas** concerné : sa formule `tarif_refacture_pax_zd × pax − Σ factures HT ZD` n'utilise que des données Plateforme — il reste V1.

**Accès détail** : clic sur n'importe quelle carte ou ligne → liste collectes filtrée correspondante. Pas de page intermédiaire.

### 1.2 Dashboard Client (vue restituée)

Reprise **exacte** du dashboard Gestionnaire de lieux (§5 ci-dessous) avec **sélecteur d'organisations multi-sélection en haut de page** :

- Option **"Toutes les organisations"** (défaut) → vue 100 % opérationnelle Savr (aucun filtre orga, agrégat total).
- Sélection d'une ou plusieurs organisations (autocomplete `organisations.nom`, tous types confondus) → vue restreinte au périmètre.

Persistance localStorage côté navigateur. Utilisé par Savr pour voir « ce que voient les clients » et piloter les opérations sous l'angle client.

Spec détaillée : voir [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr#2. Dashboard Client]].

---

## 2. Dashboard `traiteur_manager` & `traiteur_commercial` *(refonte 2026-05-10 — alignement strict §06.05/§06.11)*

**Source de vérité** : la spec détaillée du dashboard traiteur (onglets ZD/AG, 5 filtres globaux, blocs 1 à 8 par onglet) vit dans [[06 - Fonctionnalités détaillées/04 - Espace client traiteur#2. Dashboard de pilotage (page d'accueil)]]. Cette section est un résumé pour l'index dashboards.

### Synthèse (commun aux deux profils, RLS adapté)

- **Onglets** : Zéro-déchet (par défaut) / Anti-gaspi. Filtres globaux communs.
- **Filtres globaux (5)** : période, lieux (où le traiteur est intervenu), client organisateur, type d'événement, taille d'événement. *(Pas de filtre "Traiteurs" — par construction = lui seul. Pas de filtre "Commercial" dans la barre globale — il reste dans la liste Collectes pour le manager.)*
- **Filtres benchmark dédiés (4)** sur Bloc 3 ZD uniquement : période, lieux, type, taille. **Filtre "Traiteurs benchmark" interdit côté traiteur** (préservation compétitive — variante traiteur de la fonction `f_benchmark_kg_pax_zd`, paramètre `traiteur_ids[]` rejeté côté serveur).
- **Bandeau actions rapides** au-dessus des onglets : `[Programmer collecte ZD]`, `[Programmer collecte AG]` *(refonte 2026-05-10 — bouton "Exporter une synthèse PDF" du bandeau retiré, fonction reportée sur Bloc 8 ZD/Bloc 8 AG par onglet)*.
- **Architecture blocs *(refonte 2026-05-10)*** : tous les blocs synthétiques (5/6/7/8) sont rattachés à l'onglet actif et filtrés ZD ou AG. Plus de section "Bloc commun (sous les onglets)".
- **Blocs ZD** : KPI **(5 cartes — Nb collectes / Tonnage / Taux de recyclage / kg/pax / Marge générée €)** · Bloc 2 ZD évolution mensuelle (barres empilées 5 flux) · Bloc 3 ZD jauges kg/pax × benchmark parc (5 jauges, k-anonymat ≥5) · Bloc 4 ZD donut répartition tonnages · Bloc 5 ZD prochaines collectes ZD · Bloc 6 ZD top 5 lieux ZD · Bloc 7 ZD top 5 commerciaux ZD · Bloc 8 ZD bouton export synthèse PDF (type=ZD).
- **Blocs AG** : KPI (4 cartes — Nb collectes / Repas donnés / Pax cumulés / Repas/pax) · Bloc 2 AG évolution mensuelle (courbe) · Bloc 3 AG top associations bénéficiaires · Bloc 4 AG **Mon pack AG** (pleine largeur, pack actif unique, demande renouvellement + badges orange/rouge) · Bloc 5 AG prochaines collectes AG · Bloc 6 AG top 5 lieux AG · Bloc 7 AG top 5 commerciaux AG · Bloc 8 AG bouton export synthèse PDF (type=AG).
- **Bloc 7 Top 5 commerciaux** : visible pour `traiteur_manager` **et** `traiteur_commercial` (ouvert 2026-05-29 — lecture alignée Manager) — présent dans les deux onglets ZD et AG.
- : **supprimé refonte 2026-05-05** ; **refonte 2026-05-10** : nouveau Bloc 8 ZD/AG = bouton export synthèse PDF (filtres globaux + type figé selon onglet).
- **KPI "CA collecte" supprimé** (refonte 2026-05-04, le suivi CA reste dans Mon organisation > Facturation manager only — refonte 2026-05-05 ex-onglet Factures fusionné). **KPI "Marge générée ZD" ajouté** (refonte 2026-05-07).
- **Cartes KPI clickables** → liste Collectes filtrée (filtres dashboard transmis en query string + **onglet ZD/AG transmis** — refonte 2026-05-07).
- **Cible composants partagés avec §05** (mutualisation dev — 1 dashboard, 3 contextes gestionnaire / traiteur / agence).

### Distinction RLS manager vs commercial

| Élément | `traiteur_manager` | `traiteur_commercial` |
|---|---|---|
| Périmètre data (lecture) | Toute l'orga | **Toute l'orga** (révision 2026-05-29 — lecture alignée Manager, RLS `organisation_id`) |
| Dashboard analytique + benchmarks | Visible | **Visible** (ouvert 2026-05-29) |
| Bloc 7 Top 5 commerciaux | Visible | **Visible** (ouvert 2026-05-29 — cohérence lecture Manager) |
| Bloc Mon pack AG (onglet AG) | Lecture + action "Demander renouvellement" | Lecture + action "Demander renouvellement" (action ouverte aux deux profils) |
| Modification d'une collecte | Toute collecte de l'orga | **Ses propres collectes uniquement** (RLS écriture `cree_par_user_id`, révision 2026-05-29) |

> **Seule distinction restante (2026-05-29)** : le commercial a la **même lecture** que le Manager (périmètre orga, dashboard analytique, benchmarks, Bloc 7). Il ne diffère que sur (a) l'**écriture** limitée à ses propres collectes et (b) l'absence de **gestion des utilisateurs**.

### Exports
- CSV des collectes de la période filtrée (depuis liste Collectes, pas depuis dashboard)
- Synthèse PDF via Bloc 8 ZD / Bloc 8 AG (modal pré-remplie filtres globaux + type figé selon onglet). Téléchargement direct, pas d'archivage (table `rapports_synthese` supprimée 2026-05-05).

---

## 4. Dashboard `agence` *(parité absolue §06.04 — revue sobriété 2026-06-03)*

**Source de vérité** : le dashboard agence est, en V1, le **dashboard `traiteur` (§2 / §06.04) à l'identique**, branché sur le périmètre de l'agence. Aucune spec propre — cf. [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] (source de vérité) et [[06 - Fonctionnalités détaillées/11 - Espace client agence]] (différences forcées).

### Synthèse
- **Réplique stricte §06.04** : onglets ZD/AG, barre de filtres globale, blocs 2 à 8 par onglet, benchmark Bloc 3 ZD (**4 dimensions** §06.04 : période, lieux, type, taille — k-anonymat ≥5), bouton export Bloc 8, pack AG fondu dans l'onglet AG. **Bloc 7 Top 5 commerciaux retiré côté agence V1** *(décision F1 test-scenarios lot ⑨ 2026-06-07, tranché Val — RLS `users` agence = self only, cf. §06.11 différence forcée #8)*. Pas de redescription ici.
- **Différences forcées (les seules)** :
  - **Périmètre** : RLS sur `evenements.organisation_id = agence` (donneur d'ordre).
  - **Pas de KPI « Marge générée »** : 4 cartes ZD (Nb collectes / Tonnage / Taux de recyclage / kg/pax), sans la 5e carte Marge du §06.04 (décision 2026-05-07 maintenue).
  - **Branding agence** sur les PDF synthèse (logo programmateur agence — règle portée par [[12 - Reporting et exports]] §1.4/§1.6).
  - **Pas de Registre réglementaire** : l'agence n'est pas productrice du déchet.
  - **Traiteur opérationnel** affiché uniquement sur la **fiche collecte** (cf. §06.11). Pas de filtre ni de bloc dédié au traiteur opérationnel dans le dashboard en V1.
- **Bouton "Programmer un événement"** : formulaire unique §06.01 cas Agence (combobox traiteur opérationnel : référentiel + option shadow ; combobox lieu ouverte).

> **Retrait sobriété 2026-06-03 (parité absolue, arbitrage Val)** : le filtre global « Traiteurs opérationnels », le Bloc 7 « Top 5 traiteurs opérationnels » et la 5e dimension benchmark « traiteurs » sont **retirés en V1** (réévalués ultérieurement). L'agence utilise le dashboard traiteur sans divergence analytique.

### Itération V2
- Rôle `agence_commercial` (split manager/commercial)
- Comparaison inter-agences anonymisée (k-anonymat ≥ 3 agences)
- Vue géographique (carte des lieux)

---

## 5. Dashboard `gestionnaire_lieux`

**Source de vérité** : la spec détaillée du dashboard gestionnaire de lieux (onglets ZD/AG, blocs 1 à 8 par onglet, barre de filtres globale 5 dimensions, **barre de filtres benchmark dédiée 5 dimensions** sur le Bloc 3 ZD, k-anonymat ≥ 5 collectes) vit dans [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux#1. Dashboard (page d'accueil)]]. Cette section n'est qu'un résumé pour l'index dashboards.

### Synthèse
- **Onglets** : Zéro-déchet (par défaut) / Anti-gaspi. Filtres globaux communs.
- **Filtres globaux (5)** : période, lieux, traiteurs, type d'événement, taille d'événement.
- **Filtres benchmark dédiés (5)** sur le Bloc 3 ZD uniquement, indépendants des filtres globaux : période, lieux, traiteurs, type, taille (cf. refonte 2026-05-03 — option D Val).
- **Architecture blocs *(refonte 2026-05-10)*** : tous les blocs synthétiques (5/6/7/8) sont rattachés à l'onglet actif et filtrés ZD ou AG. Plus de section "Bloc commun".
- **Blocs ZD** : KPI (4 cartes au-dessus des onglets) · Bloc 2 ZD évolution mensuelle (barres empilées 5 flux) · Bloc 3 ZD jauges kg/pax × benchmark parc (5 jauges, k-anonymat ≥5) · Bloc 4 ZD donut répartition tonnages · Bloc 5 ZD prochaines collectes ZD · Bloc 6 ZD top 5 lieux ZD · Bloc 7 ZD top 5 traiteurs ZD · Bloc 8 ZD bouton export synthèse PDF (type=ZD).
- **Blocs AG** : KPI · Bloc 2 AG évolution mensuelle (courbe) · Bloc 3 AG top associations bénéficiaires · Bloc 5 AG prochaines collectes AG · Bloc 6 AG top 5 lieux AG · Bloc 7 AG top 5 traiteurs AG · Bloc 8 AG bouton export synthèse PDF (type=AG). Pas de Bloc 4 AG (pas de donut, AG = un seul flux).
- **Bloc 8 *(refonte 2026-05-10)*** : remplacé par bouton "Exporter une synthèse PDF" pré-rempli (filtres globaux + type de collecte selon onglet). Ex-bloc "Dernier rapport de synthèse" supprimé (orphelin refonte 2026-05-05 : rapports auto + table `rapports_synthese` supprimés).
- **Cartes KPI clickables** → liste **Événements** filtrée (la page Collectes a été supprimée en V1, refonte 2026-05-03).
- **Pas de tarifs ZD négociés** côté gestionnaire en V1 (volet Admin uniquement).
- **Bouton "Programmer un événement" *(refonte 2026-05-21 — formulaire unique, ex 2 sous-boutons ZD/AG)*** : ouvre le formulaire unique §06.01 (choix ☐ZD ☐AG en étape 1) cas Gestionnaire (combobox lieu filtrée à `organisations_lieux`, combobox traiteur opérationnel restreinte au référentiel sans option shadow). Si Anti-Gaspi coché sans pack actif, soumission AG bloquée (ZD reste programmable). Cf. [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux#Navigation]].
- **Bloc Mon pack AG** *(ajout 2026-05-07)* : affiché si l'orga a au moins 1 pack actif (cf. nav §06.05 onglet "Mon pack AG"). Décompte sur les collectes AG programmées par le gestionnaire (`evenements.organisation_id = current_org`).
- **Exports** : Bouton Export CSV sur la liste Événements (grain événement, format C1) ; PDFs via section Rapports.

---

## 6. Lieux autonomes mono-site (ex-`lieu_independant`, fusionné — sobriété 2026-06-03 D1)

Un lieu autonome mono-site est un `gestionnaire_lieux` ne gérant qu'**un seul lieu** (une seule ligne `organisations_lieux`). Il utilise donc le **dashboard `gestionnaire_lieux` (§5)** : avec un lieu unique, la vue multi-lieux et la carte n'apparaissent simplement pas (filtre lieux mono-valeur). Split AG / ZD (onglets) conservé. Pas de rôle ni de dashboard distinct.

---

## 7. Dashboard `client_organisateur` (nouveau rôle)

### Vue d'accueil : mon impact RSE

Lecture seule, ultra-simple, orienté reporting ESG.

Onglet **AG** / Onglet **ZD**. *(Onglet « Vue consolidée » retiré — revue sobriété 2026-06-03 B2 : la synthèse RSE annuelle remonte en bandeau de tête commun aux 2 onglets, le PDF d'impact reste servi via [[12 - Reporting et exports]].)*

**Bandeau de tête (commun aux 2 onglets)** : synthèse impact RSE annuel (YTD, à communiquer dans rapport DPEF / bilan carbone) + accès aux rapports RSE/PDF existants → `/organisateur/documents` *(V1 : liste des rapports RSE/bordereaux/attestations générés, avec logo client si fourni. Un PDF agrégé dédié « Rapport d'impact Savr » = V4 — décision M3.4 2026-06-17.)*

### Onglet AG
- Cadrans (filtre période, §8 — par défaut 30 j) : événements AG, repas détournés, **CO₂e évité** *(taux de recyclage retiré — métrique ZD-only, cf. addendum 2026-05-06)*. **CO₂e évité AG modélisé 2026-06-04 bis** : lu depuis `collectes.co2_evite_kg` figé (= `volume_repas_realise × 2,5 kgCO₂e/repas`, facteur FAO `parametres_facteurs_co2_ag`), cf. [[05 - Règles métier#R_co2_ag]]. Évité seul V1 (induit/net/transport = V2). *(La synthèse YTD figée vit dans le bandeau de tête — décision M3.4 2026-06-17.)*
- Liste événements (date, nom, lieu, traiteur, pax, repas)
- Accès aux rapports RSE / attestations PDF

### Onglet ZD
- Cadrans (filtre période, §8 — par défaut 30 j) : événements ZD, kg détournés, taux de recyclage *(formule à captation par filière, indicateur unique — "taux de valorisation" supprimé 2026-05-06)*, **CO₂ évité en headline** (refonte 2026-06-04, Sujet 3) — induit + net + énergie primaire en détail repliable (règle ABC, lus depuis `collectes.co2_*` figés, cf. [[05 - Règles métier#R_co2_calcul]]). *(La synthèse YTD figée vit dans le bandeau de tête — décision M3.4 2026-06-17.)*
- Liste événements
- Accès aux rapports RSE / bordereaux PDF

**Pas de données financières, pas de benchmark** (un client organisateur n'a pas d'intérêt à se comparer).

---

## 8. Règles communes UI/UX

- **Chargement** : les cadrans se chargent en <1s (vues SQL indexées, calcul à la volée — cf. §9)
- **Période par défaut** : 30 derniers jours, personnalisable par user (persistée en `localStorage` navigateur, pas de table serveur — cf. décision sobriété 2026-06-03 B1)
- **Split AG / ZD** : onglets obligatoires sur tous les dashboards qui agrègent de la collecte
- **Devise / unités** : € HT, kg, tonnes, kg CO₂e (seuil auto : passage à t à partir de 1 000 kg)
- **Pas de données → état vide explicite** : "Aucune collecte sur la période sélectionnée. Ajustez les filtres ou programmez votre première collecte."
- **Responsive** : mobile consultation uniquement (pas d'édition depuis mobile en V1)
- **Accessibilité** : contrastes WCAG AA, navigation clavier sur tableaux
- **Facteurs CO₂ (ADEME)** : stockés en DB (`parametres_facteurs_co2` + `parametres_mix_emballages` + `parametres_co2_divers`, cf. [[04 - Data Model]] addendum 2026-06-04), modifiables par Admin Savr (audit trail). Les dashboards lisent les grandeurs **figées** sur `collectes.co2_*` (jamais recalculées côté affichage) — cf. [[05 - Règles métier#R_co2_calcul]].

---

## 9. Vues SQL de performance

> **Revue sobriété 2026-06-03 (A1)** : les 4 vues **matérialisées** `mv_kpi_*` + cron de rafraîchissement 15 min sont supprimées V1 (objets fantômes — jamais déclarés dans [[04 - Data Model]], qui ne matérialise que `mv_benchmark_kg_pax_zd_base`, refresh quotidien justifié par sa cardinalité). À ~20 événements/mois, une vue SQL non matérialisée calculée à la volée répond en <100 ms et sert des données temps réel. Matérialisation réévaluée V1.1 si le volume le justifie (cf. [[05 - Règles métier]] — « V1 = requête live OK »).

Pour servir les dashboards, créer des **vues SQL non matérialisées** (calcul à la volée, index sur `date_collecte` / `organisation_id` / `lieu_id`) :

- `v_kpi_traiteur` : agrégats par `organisation_id` et mois, split AG / ZD
- `v_kpi_lieu` : agrégats par `lieu_id` et mois, split AG / ZD
- `v_kpi_admin` : agrégats globaux par jour, split AG / ZD
- `v_kpi_client_organisateur` : agrégats par `client_organisateur_organisation_id` et mois

Les dashboards lisent ces vues, pas les tables sources. Seul le benchmark Bloc 3 ZD reste matérialisé (`mv_benchmark_kg_pax_zd_base`, refresh quotidien, cf. [[04 - Data Model]]).

---

## Décisions prises

- **6 dashboards distincts** (un par rôle V1, y compris `client_organisateur` ; `lieu_independant` fusionné dans `gestionnaire_lieux` — sobriété 2026-06-03 D1, cf. §6)
- **Split AG / ZD systématique** via onglets sur tous les dashboards de collecte
- **Admin** : statut TMS acceptance visible par collecte + détail tournées (N tournées listées pour une collecte multi-camions, refonte 2026-05-25) + picto "plaque TMS" (vert si **toutes** les tournées de la collecte ont leur `tournees.plaque_immatriculation` renseignée, gris si au moins une manque) — **propagation Q10 M05 2026-04-24** : picto "plaque demandée" client retiré V1, remplacé par picto monitoring Admin interne
- **Accès détail direct** au clic (pas de page intermédiaire)
- **Manager** : ajout taux de recyclage partout (ZD uniquement, formule à captation cf. [[05 - Règles métier#R_taux_recyclage]]) + graph événements par type
- **Commercial (révision 2026-05-29)** : lecture intégralement alignée sur le Manager — dashboard analytique complet + benchmarks + Bloc 7 Top 5 commerciaux ouverts, accès lecture à toutes les collectes et factures du traiteur (RLS `organisation_id`). Écriture limitée à ses propres créations (`cree_par_user_id`)
- **Agence** : **parité absolue avec le dashboard traiteur §06.04 (sobriété 2026-06-03)** — réplique stricte, scope `evenements.organisation_id`, sans KPI Marge, sans filtre/bloc traiteur opérationnel (retirés V1)
- **Gestionnaire** : ajout tarifs préférentiels en lecture ; retrait action "programmer"
- **Benchmark anonymisé activé à partir de 3 acteurs minimum** dans la catégorie
- **Facteurs CO₂ (ADEME) modifiables** par Admin Savr (tables `parametres_facteurs_co2` + `parametres_mix_emballages` + `parametres_co2_divers`, cf. [[04 - Data Model]] addendum 2026-06-04 + [[05 - Règles métier#R_co2_calcul]]). Dashboards lisent les grandeurs figées `collectes.co2_*` (snapshot, jamais recalculées à l'affichage). *(Ancienne réf `parametres_kpi` corrigée 2026-06-04 — table fantôme jamais déclarée.)*
- **Taux de recyclage indicateur unique ZD-only (2026-05-06)** : suppression "Taux de valorisation". Formule à captation par filière (cf. [[05 - Règles métier#R_taux_recyclage]] + [[04 - Data Model]] addendum 2026-05-06). 4 taux modifiables `admin_savr` only via §06.06 §9 Paramètres > Taux de recyclage par filière. Snapshot `collectes.caps_appliques jsonb` figé à la clôture pour reproductibilité PDF.
- **Filtres paramétrables par user** (persistance `localStorage` navigateur, pas de table serveur — sobriété 2026-06-03 B1)
- **Export PDF** : source unique [[12 - Reporting et exports]] (techno Puppeteer + contenu PDF), déclenché depuis le Bloc 8 de chaque dashboard. *(Ligne « Export PDF dashboards Puppeteer » dédupliquée — sobriété 2026-06-03 C1)*
- **Cadrans chargés < 1s** via vues SQL indexées calculées à la volée (cf. §9 — sobriété 2026-06-03 A1, ex vues matérialisées 15 min)
- **Pas d'édition dashboard par l'utilisateur V1** (structure figée)
- **Pas de segmentation supplémentaire des cohortes benchmark en V1 (2026-05-29)** : la comparabilité est déjà assurée par les dimensions de filtre du Bloc 3 ZD (période, lieux, traiteurs, type, taille). Aucune segmentation additionnelle par volume pax/an ni par zone géographique n'est introduite en V1. Motif : à ~20 événements/mois, une segmentation supplémentaire fragmente les cohortes et casse le k-anonymat ≥5 (jauges « non comparable »). Segmentation volume/géo réévaluée en V2 quand la densité de données le permet. Tranche la question ouverte 1.

## Questions ouvertes

1. **Tranchée 2026-05-29 (Val) : pas de segmentation supplémentaire en V1** — cf. Décisions prises.

## Liens

- [[04 - Data Model]] (tables et vues, `tarifs_negocie`, `tournees`)
- [[05 - Règles métier]] (section 11 gestionnaire, section pondération algo et seuils)
- [[12 - Reporting et exports]]
