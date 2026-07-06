# 05 - Espace client gestionnaire de lieux

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
- Les données commerciales/personnelles des traiteurs au-delà du nom/logo

**RLS** : filtre sur `users.organisation_id` + jointure `organisations_lieux`. Les requêtes coté collectes passent par une vue dédiée qui expose uniquement les colonnes non-financières.

---

## Navigation (refonte 2026-05-07)

Barre latérale gauche, **9 sections** *(Val 2026-07-06, divergence M3.2 R19b-P2 : réintégration **Collectes** + **Registre réglementaire** — override de la décision 2026-05-03 ; neutralise la partie « 9→7 » du ticket BL-P2-13. Historique : 7 sections après refonte sobriété 2026-05-30 — entrée "Rapports" retirée ; vs 8 entre 2026-05-07 et 2026-05-30, vs 6 avant 2026-05-07)* :

1. **Dashboard** — page d'accueil (vue 360 — inchangé)
2. **Événements** — liste des événements sur les lieux (incluant ceux programmés par le gestionnaire lui-même + ceux programmés par les traiteurs intervenants)
3. **Lieux** — liste des lieux de l'organisation
4. **Collectes** *(réintégrée Val 2026-07-06)* — liste des collectes sur les lieux de l'organisation (`/gestionnaire/collectes`, vue `v_collectes_gestionnaire_lieux`) → détail collecte
5. **Registre réglementaire** *(réintégré Val 2026-07-06)* — registre déchets ZD hérité (R13, `/registre`, prédicat gestionnaire `v_registre_dechets`)
6. **Traiteurs** — partenaires intervenants
7. **Mon pack AG** *(nouveau 2026-05-07)* — vue pack actif + crédits restants + historique consommation. Affiché uniquement si l'organisation a au moins 1 pack (`packs_antgaspi WHERE organisation_id = current_org`). Sinon l'entrée nav est masquée. Comportement identique au Bloc 4 AG du §06.04 (pack actif unique, pas d'historique multi-packs).
8. **Mon organisation** *(nouveau 2026-05-07)* — sous-sections : Profil organisation / Utilisateurs (invitations, rôles) / **Facturation** (entités juridiques, factures, mandats SEPA, intégration Pennylane). Réutilisation du composant §06.04 §6 "Mon organisation" (manager only — ici tous les users gestionnaire ont accès, pas de distinction manager/commercial en V1).
9. **Paramètres** — préférences personnelles utilisateur (notifications email, langue) — réduit vs avant (organisation + utilisateurs déplacés dans Mon organisation)

> La génération de synthèse PDF agrégée n'a plus d'entrée nav dédiée : elle se déclenche via le bouton "Exporter une synthèse PDF" du dashboard (ZD et AG), qui ouvre la modal de génération (cf. §4). Décision sobriété 2026-05-30.

**Bouton primaire dashboard "Programmer un événement"** *(refonte 2026-05-21 — formulaire unique événement-centré, ex 2 sous-boutons ZD/AG)* : ouvre le formulaire unique §06.01 (choix ☐ZD ☐AG en étape 1) avec les contraintes Cas Gestionnaire (combobox lieu filtrée à `organisations_lieux`, combobox traiteur opérationnel restreinte au référentiel sans option shadow). Si la case Anti-Gaspi est cochée sans pack actif, la soumission AG est bloquée (alerte "Contactez Savr pour négocier un pack AG") — la collecte ZD reste programmable.

**Section Collectes réintégrée (Val 2026-07-06 — divergence M3.2, override de la décision 2026-05-03)** : le gestionnaire dispose d'une entrée nav Collectes dédiée (`/gestionnaire/collectes`). Le détail d'une collecte (pesées par flux, repas, bordereau, rapport recyclage, attestation don) reste **également** accessible depuis le détail événement parent.

**Différenciation visuelle événements programmés par le gestionnaire vs par le traiteur** : dans la liste Événements, badge "Programmée par moi" (vert) si `evenements.organisation_id = current_org`, sinon badge "Programmée par {{traiteur}}" (gris). Permet au gestionnaire d'identifier rapidement ses propres programmations.

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

Chaque carte clickable → renvoie vers la liste **Événements** filtrée (filtres globaux du dashboard transmis en query string, plus filtre `Type` ZD/AG selon l'onglet actif).

---

### Onglet **Zéro-déchet**

#### Bloc 2 ZD — Évolution mensuelle (graphique barres empilées)

Graphique barres empilées par mois (période filtrée, granularité automatique : jour si <30j, semaine si <12 mois, mois sinon) :
- **Axe X** : période
- **Axe Y** : tonnage en kg (bascule kg/T automatique au-delà de 10 000 kg)
- **Empilement** : 5 segments par barre = les 5 flux ZD (`biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`)
- **Courbe superposée** (axe Y secondaire %) : taux de recyclage moyen pondéré par tonnage (formule à captation par filière, méthode UE 2019/1004 — cf. [[05 - Règles métier#R_taux_recyclage]])

Légende cliquable pour masquer/afficher chaque flux. Tooltip au survol : valeurs kg + % par flux.

#### Bloc 3 ZD — Jauges kg/pax par flux × benchmark parc

##### Barre de filtre benchmark dédiée (au-dessus du bloc, distincte de la barre globale)

Encart compact "Filtres benchmark" affichant les **5 mêmes critères** que la barre globale, mais qui ne s'appliquent **qu'au point rouge benchmark**, pas aux jauges du gestionnaire :

| Filtre benchmark | Type | Valeurs |
|---|---|---|
| Période benchmark | Date range picker + raccourcis | 12 mois glissants (défaut) / 24 mois glissants / Année civile / Personnalisé |
| Lieux benchmark | Multi-select | Tous les lieux du parc Savr (toutes organisations confondues) — défaut "Tous" |
| Traiteurs benchmark | Multi-select | Tous les traiteurs du parc Savr — défaut "Tous" |
| Type d'événement benchmark | Multi-select | `types_evenements.libelle` — défaut "Tous" |
| Taille d'événement benchmark | Multi-select | XS / S / M / L / XL — défaut "Tous" |

**Initialisation** : à l'ouverture du dashboard, les filtres benchmark héritent par défaut des filtres globaux (Type d'événement + Taille d'événement uniquement). Le gestionnaire peut ensuite les modifier indépendamment (bouton "Réinitialiser" pour revenir à l'héritage par défaut).

**Avertissement UX** : si le gestionnaire applique le filtre `Lieux benchmark` ou `Traiteurs benchmark` sur ses propres lieux/traiteurs, un tooltip affiche "Vous comparez vos données à vos propres données — le benchmark perd son rôle de référence parc". Pas de blocage, juste un avertissement.

##### Jauges (1 par flux ZD, 5 jauges au total)

- **Jauge gestionnaire** : ratio `kg du flux / pax cumulés` sur la période et le périmètre **des filtres globaux** (pas des filtres benchmark)
- **Borne max axe** : valeur max observée du parc Savr × 1,2 (échelle figée par flux pour permettre la comparaison visuelle)
- **Point rouge** : **benchmark parc Savr** = moyenne `kg flux / pax` calculée sur l'ensemble du parc Savr selon les **filtres benchmark dédiés** (les 5 critères ci-dessus)

**Règle k-anonymat** : si l'échantillon benchmark filtré contient strictement moins de **5 collectes**, le point rouge est **masqué** et un tooltip affiche "Données insuffisantes pour benchmark (échantillon < 5 collectes comparables — affinez ou élargissez les filtres benchmark)". La jauge gestionnaire reste affichée.

**Source benchmark** : agrégat exposé via la fonction PostgreSQL `f_benchmark_kg_pax_zd` (cf. [[04 - Data Model]] §Fonction SQL `f_benchmark_kg_pax_zd`). Paramètres acceptés : `flux_id`, `type_evenement_ids[]`, `taille_evenement_codes[]`, `periode_debut`, `periode_fin`, `lieu_ids[]`, `traiteur_ids[]`. Aucun chiffre brut d'autre gestionnaire n'est exposé — uniquement la moyenne. K-anonymat ≥5 appliqué côté serveur.

**Légende couleur** (basée sur le ratio jauge gestionnaire / point benchmark, **chacun calculé sur son propre périmètre de filtres**) :
- Vert : ratio gestionnaire ≤ benchmark (performance ≥ moyenne du segment de référence sélectionné)
- Orange : ratio gestionnaire entre 100% et 130% du benchmark
- Rouge : ratio gestionnaire > 130% du benchmark
- Gris : benchmark masqué (k-anonymat) → la jauge n'a pas de couleur de performance, seule la valeur kg/pax est affichée

**Pas de colonnes additionnelles** (suppression vs. maquette source : pas de "nb collectes par mois", pas de "taux remplissage moyen", pas de "déclassement").

#### Bloc 4 ZD — Répartition des tonnages (donut)

Donut affichant la part relative des 5 flux ZD sur la période filtrée. Tooltip au survol : kg + %. Total au centre = tonnage total.

#### Bloc 5 ZD — Prochaines collectes ZD programmées

Liste des collectes ZD à venir sur les 30 prochains jours, filtrée selon les filtres globaux. Grain **collecte** (1 ligne = 1 collecte) :
- Date + heure début
- Événement
- Lieu
- Traiteur
- Statut

Lecture seule. **Clic → détail de l'événement parent** (la page Collectes n'existant plus en V1, le détail collecte est intégré dans le détail événement — voir §2 Section Événements).

#### Bloc 6 ZD — Top 5 lieux ZD

Tableau ordonné par tonnage, période filtrée :
- Lieu · Nombre de collectes ZD · Tonnage · Taux de recyclage *(moyenne pondérée par tonnage)*

#### Bloc 7 ZD — Top 5 traiteurs ZD

Tableau ordonné par nombre de collectes ZD, période filtrée :
- Traiteur · Nombre de collectes ZD · Tonnage · Taux de recyclage *(moyenne pondérée par tonnage)*

#### Bloc 8 ZD — Exporter une synthèse PDF (ZD)

Bouton "Exporter une synthèse PDF" pré-rempli :
- **Période** : période active des filtres globaux
- **Lieux / Traiteurs / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `ZD` (figé selon onglet actif)

Clic → ouvre la modal de génération §4 Génération de synthèse PDF en étape 3 directement (téléchargement après Edge Function async ≤2 min). Si l'utilisateur veut modifier les filtres avant génération, retour aux étapes 1-2 possible.

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
- Association · Ville · Nombre de collectes · Repas reçus · Distance moyenne (km)

Source : `attributions_antgaspi` jointe à `associations`.

> **Note numérotation** : pas de Bloc 4 AG (pas de donut côté AG, AG = un seul flux `don_alimentaire`). On saute directement à Bloc 5 AG pour préserver l'alignement des numéros entre onglets sur les blocs partagés (5/6/7/8).

#### Bloc 5 AG — Prochaines collectes AG programmées

Liste des collectes AG à venir sur les 30 prochains jours, filtrée selon les filtres globaux. Grain **collecte** (1 ligne = 1 collecte) :
- Date + heure début
- Événement
- Lieu
- Traiteur
- Statut

Lecture seule. **Clic → détail de l'événement parent**.

#### Bloc 6 AG — Top 5 lieux AG

Tableau ordonné par repas donnés, période filtrée :
- Lieu · Nombre de collectes AG · Repas donnés · Repas/pax

#### Bloc 7 AG — Top 5 traiteurs AG

Tableau ordonné par nombre de collectes AG, période filtrée :
- Traiteur · Nombre de collectes AG · Repas donnés · Repas/pax

#### Bloc 8 AG — Exporter une synthèse PDF (AG)

Bouton "Exporter une synthèse PDF" pré-rempli :
- **Période** : période active des filtres globaux
- **Lieux / Traiteurs / Type d'événement / Taille d'événement** : valeurs des filtres globaux
- **Type de collecte** : `AG` (figé selon onglet actif)

Clic → ouvre la modal de génération §4 Génération de synthèse PDF en étape 3 directement.

---

## 2. Section Événements

Vue unique côté gestionnaire pour la consultation opérationnelle (la page Collectes a été supprimée en V1 — décision Val 2026-05-03).

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
| Type de collecte | Single-select | "Avec ZD" / "Avec AG" / "ZD et AG" / "Toutes" (défaut) — un événement avec au moins une collecte ZD entre dans "Avec ZD" ; idem AG |
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
| Déchets labo estimés *(ajout 2026-05-22)* | Estimation kg du déchet produit au labo du traiteur = `pax × coefficient` du traiteur opérationnel pour l'année − 1 (cf. [[05 - Règles métier#R_dechets_labo_estimes]]). `—` si coefficient non communiqué. Distinct du tonnage collecté. |
| Repas donnés | Si AG sur l'événement |
| Statut consolidé | En cours / Terminé / Annulé — dérivation figée *(décision F2 2026-06-07)* : **Annulé** = toutes les collectes de l'événement sont `annulee` · **Terminé** = toutes les collectes sont terminales (`realisee`/`cloturee`/`annulee`) avec au moins 1 `realisee` ou `cloturee` · **En cours** = sinon (≥ 1 collecte non terminale) |

### Détail événement

Clic sur une ligne → vue consolidée en lecture seule (consultation pure, aucune action de modification ou d'annulation) :

**Bloc en-tête événement** :
- Nom, date de début, lieu, pax, type d'événement, taille bracket
- Traiteur (nom + logo, pas d'email / téléphone / SIRET)
- Client Organisateur si renseigné par le traiteur
- **Déchets labo estimés (kg)** *(ajout 2026-05-22)* — estimation du déchet produit en amont au laboratoire du traiteur = `pax × coefficient` du traiteur opérationnel pour l'année − 1 (cf. [[05 - Règles métier#R_dechets_labo_estimes]]). Affiché avec tooltip explicatif ("estimation amont, distincte des déchets collectés sur l'événement ci-dessous"). `—` si le traiteur n'a pas communiqué de coefficient pour l'année applicable. Le coefficient brut n'est jamais affiché, seule l'estimation kg.

**Bloc collectes rattachées** : 1 sous-bloc par collecte (ZD et/ou AG), affichant :
- Type (ZD / AG), date + heure début, **statut affiché côté client** — mapping canonique : voir [[04 - Espace client traiteur#Mapping d'affichage du statut collecte côté client (canonique — décision Val 2026-06-30, divergence UX-STATUTS)]]. Points clés : `programmee` → **Créée** (jamais « Programmée »), `validee` → Validée, `en_cours`/`realisee` → En cours, `cloturee` → **Réalisée**, `realisee_sans_collecte` → Sans excédents, `annulee`/`annulation_demandee` → Annulée. *(Supersède le mapping F2 2026-06-07 `programmee`/`validee` → Programmée · `realisee`/`cloturee` → Réalisée — décision Val 2026-06-30. UX-only, enum `collectes.statut` inchangé. Le « Statut consolidé » événement ci-dessus reste distinct.)*
- **Pour ZD** : détail des pesées par flux (kg par flux pour les 5 flux ZD : `biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`), **taux de recyclage** de la collecte *(lecture directe `collectes.taux_recyclage`, formule à captation par filière)*
- **Pour AG** : repas donnés, association(s) bénéficiaire(s) avec ville et distance, attribution(s)

**Bloc documents** : tous les justificatifs disponibles à l'échelle de l'événement et des collectes :
- Bordereau ZD (par collecte ZD)
- Rapport de recyclage (1 par événement, agrégé)
- Attestation(s) de don AG (par attribution)

**Note** : pas de bouton d'action. Le gestionnaire ne peut pas modifier, dupliquer ou annuler. La gestion des collectes reste exclusive au traiteur.

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

Tous les lieux de l'organisation. Rattachement géré par Admin Savr (ajout/retrait = demande via support).

| Colonne | Détail |
|---|---|
| Nom | Nom du lieu |
| Adresse | |
| Capacité | Capacité d'accueil (si renseignée — `lieux.capacite_maximum`, exposée via `v_lieux_clients`) |
| Nb collectes 12 mois | Indicateur d'activité |
| Tonnage 12 mois | |

### Détail lieu

Fiche lieu avec :
- Informations générales (**Adresse accès livraison** *(label refondé 2026-05-08)*, capacité, photos si disponibles *(« type » retiré 2026-07-06 — divergence M3.2 : colonne `lieux.type` inexistante dans le schéma V1 ET le DDL cible V2 ; si une catégorie de lieu est souhaitée un jour, c'est une évolution Data Model + DDL, pas un patch texte)*, stationnement / accès office / type véhicule max — tous enum facile/difficile/très difficile pour stationnement+accès office, enum véhicule unifié `velo_cargo/camionnette/fourgon/vul/poids_lourd` pour type véhicule max — cf. [[04 - Data Model]] table `lieux`)
- Historique complet des collectes sur ce lieu
- Graphique évolution sur 12 mois
- Top traiteurs intervenant sur ce lieu

**Masqué côté gestionnaire de lieux V1** : tarifs ZD négociés, tarifs AG, tout élément financier. Les tarifs restent exclusivement dans le back-office Admin. **Champs admin/ops only également masqués** *(refonte 2026-05-08)* : `commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` (cf. [[05 - Règles métier#R_lieux_admin_only_fields]]).

### Ajout / retrait lieu

Pas d'interface en V1. Bouton "Demander l'ajout d'un lieu" ouvre un formulaire simple → envoie un email à l'Admin Savr avec le lieu souhaité et les coordonnées du demandeur. Traitement manuel côté Admin (voir [[06 - Back-office Admin Savr]] action "Rattachement lieu").

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
- Clic "Générer" → Edge Function asynchrone (timeout 2 min max)
- Modal affiche état "En cours" + spinner
- Une fois généré : téléchargement direct du PDF (URL pré-signée Supabase Storage temporaire, expire 1h)
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

Fiche traiteur (vue non commerciale) :
- Logo, nom, ville (pas d'email / téléphone / SIRET)
- Statistiques 12 mois sur les lieux de l'organisation uniquement
- Historique des collectes réalisées sur les lieux de l'organisation
- Pas d'accès aux tarifs, pas d'accès aux marges

**Pourquoi limité** : le gestionnaire de lieux et le traiteur ont souvent une relation commerciale directe (référencement, contrat). Savr ne veut pas exposer les tarifs négociés traiteur↔Savr sur l'espace gestionnaire de lieux (confidentialité commerciale).

---

## 6. Section Paramètres

### Bloc Organisation

Informations de l'organisation :
- Nom (lecture seule — modification via support)
- Adresse (modifiable)
- Logo (upload / remplacement)
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

Une table ajoutée pour porter le coefficient de perte labo par traiteur × année (cf. [[04 - Data Model#⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, gestionnaire-only)]]). Le gestionnaire ne lit **pas** cette table : l'estimation `pax × coefficient` est calculée côté serveur (fonction SECURITY DEFINER) et exposée en kg dans le détail événement et la colonne liste. Saisie réservée à l'Admin Savr (§06.06).

### Tables existantes réutilisées

Le reste des données nécessaires est déjà modélisé :
- `organisations` (type `gestionnaire_lieux`)
- `users` (role `gestionnaire_lieux`)
- `organisations_lieux` (rattachement N-N)
- `lieux`, `evenements`, `collectes`, `collecte_flux`, `attributions_antgaspi`, `courses_logistiques` (consultation uniquement, pas les champs financiers)
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
- : table supprimée refonte 2026-05-05. Génération synthèse asynchrone : RLS appliquée via JWT du demandeur sur les collectes sources lues par l'Edge Function.
- `rapports_rse` WHERE `collectes.lieu_id` IN (ses lieux) — validé : le gestionnaire de lieux voit tous les rapports de recyclage des collectes sur ses lieux
- `lieux` WHERE `id` IN (ses lieux)
- `traiteurs` (vue restreinte) WHERE `organisation_id` IN (traiteurs intervenus sur ses lieux)
- `coefficients_perte_labo` *(ajout 2026-05-22)* : **aucun accès direct** pour le rôle `gestionnaire_lieux`. L'estimation `pax × coefficient` est calculée côté serveur via une fonction SECURITY DEFINER ; seule la valeur kg est retournée au gestionnaire (le coefficient brut du traiteur n'est jamais exposé). Lecture/écriture directe réservée à `admin_savr` (cf. [[09 - Authentification et permissions]]).
- `f_benchmark_kg_pax_zd` : EXECUTE autorisé pour le rôle `gestionnaire_lieux` (fonction `SECURITY DEFINER`). Filtres acceptés en paramètres : `flux_id`, `type_evenement_id`, `taille_evenement`, `periode_debut`, `periode_fin`, `lieu_ids[]`, `traiteur_ids[]` (les 5 dimensions de la barre filtre benchmark dédiée du Bloc 3 ZD). Aucun filtre obligatoire — tous facultatifs. **K-anonymat strict** : la fonction applique côté serveur `nb_collectes_segment >= 5` ; un segment avec moins de 5 collectes n'apparaît pas dans la réponse SQL. Les colonnes brutes individuelles ne sont jamais exposées — uniquement les agrégats.

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
- `nb_organisations_distinctes` (integer — audit)

**Paramètres de filtrage dynamique** (passés depuis le front via la barre filtre benchmark dédiée) :
- `flux_id` : filtré (1 jauge par flux)
- `type_evenement_id` : multi-select facultatif
- `taille_evenement` : multi-select facultatif
- `periode_debut` / `periode_fin` : facultatif (défaut UI = 12 mois glissants)
- `lieu_ids[]` : multi-select facultatif (sur l'ensemble du parc Savr)
- `traiteur_ids[]` : multi-select facultatif (sur l'ensemble du parc Savr)

**Calcul** : pour chaque tuple `(flux, type_evenement, taille)` correspondant aux paramètres, moyenne pondérée `SUM(collecte_flux.poids_reel_kg) / SUM(evenements.pax)` sur le sous-ensemble du parc Savr filtré.

**Filtre RLS** : `nb_collectes_segment >= 5` appliqué dans le `WHERE` final de la fonction → un segment avec moins de 5 collectes n'apparaît tout simplement pas dans la réponse SQL, ce qui garantit que la moyenne ne devient jamais identifiante. Plus le gestionnaire restreint les filtres benchmark, plus le risque de masquage augmente — c'est le compromis assumé de l'option D (cf. Décisions prises).

**Risque "comparaison à soi-même"** : si le gestionnaire applique le filtre `lieu_ids[]` ou `traiteur_ids[]` sur ses propres lieux/traiteurs, la moyenne benchmark devient mécaniquement identique (ou très proche) du ratio gestionnaire → ratio = 1.0 → couleur orange permanente. Avertissement UX affiché côté front (tooltip dans la barre filtre benchmark).

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
| Demande d'ajout de lieu par email Admin | Interface self-service | Rattachement nécessite validation commerciale Savr (contrat, négociation tarifs ZD) |
| Rapport de synthèse personnalisé avec filtres | Rapport figé par période | Flexibilité indispensable pour répondre aux RFP clients du gestionnaire |
| **Programmation ouverte gestionnaire (2026-05-07)** | Programmation interdite (positionnement initial V1) | Use case réel : gestionnaires pilotant la RSE événementielle directement. Périmètre restreint (lieux propres + référentiel traiteurs only) pour cadrer. |
| **Facturation directe gestionnaire (2026-05-07)** | Pas de relation financière directe | Cohérence avec règle programmateur=facturé V1. Section Mon organisation > Facturation ajoutée (réutilisation composant §06.04 §6) |
| **Pack AG ouvert gestionnaire (2026-05-07)** | Pack au niveau traiteur uniquement | Use case réel : gestionnaire qui négocie un volume AG sur son parc. Décompte sur pack du programmateur (cf. §06.09). |
| **Pas de fiche shadow gestionnaire (2026-05-07)** | Autoriser comme pour les agences | Risque pollution shadow (gestionnaires moins bien outillés Admin pour normaliser). Restriction métier explicite. |
| Suppression page Collectes — fusion dans Événements (2026-05-03) | Conserver les 2 pages | Le gestionnaire raisonne par événement, pas par collecte. Le détail collecte vit dans le détail événement, suffisant pour la consultation. Réduction surface UI |
| Barre filtre benchmark dédiée 5 dimensions (2026-05-03) | Benchmark figé sur le parc total ou héritage des filtres globaux | Permet au gestionnaire de comparer son périmètre à un benchmark de référence personnalisable (option D Val). Risque "comparaison à soi-même" assumé via avertissement UX |
| Export grain événement (option C1) | Export grain collecte ou double export | 1 ligne = 1 événement, suffisant pour V1. Détail collecte par collecte reste accessible via PDF de synthèse §Rapports |
| **Blocs Dashboard rattachés aux onglets ZD/AG (2026-05-10)** | Garder une section "Bloc commun" sous les onglets | Cohérence UX : un onglet actif filtre tout le contenu visible (KPIs comme blocs synthétiques). Plus simple à comprendre, supprime l'ambiguïté "ce bloc affiche-t-il ZD, AG ou les deux ?". |
| **Bloc 8 transformé en bouton export synthèse PDF (2026-05-10)** | Conserver "Dernier rapport de synthèse disponible" / Le supprimer | Reco b retenue. Le bloc original est orphelin de la refonte 2026-05-05 (rapports auto supprimés, table `rapports_synthese` supprimée → toujours vide en V1). Remplacement par un bouton aligné §06.04, pré-rempli avec filtres globaux + type de collecte selon onglet actif. Donne une vraie valeur métier au bloc. |
| **Déchets labo estimés par événement (2026-05-22)** | Mesure réelle / saisie traiteur / coefficient global | Le déchet labo n'est jamais collecté ni pesé par Savr → estimation seule possible. Coefficient annuel par traiteur (calculé sur N, appliqué sur N+1), saisi par l'Admin (le traiteur communique, ne saisit pas). Calcul à la volée `pax × coefficient`, non stocké. Affichage gestionnaire-only (détail événement + colonne liste), hors rapport PDF. Pas de fallback si coefficient absent (`—`). Coefficient global par traiteur sans distinction type d'événement = limite V1 assumée (V2 si besoin de granularité gala vs cocktail). |

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
  - Bloc 3 ZD : jauges kg/pax × benchmark parc filtré par type+taille événement, k-anonymat ≥5 collectes (point rouge masqué sinon).
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
- [[06 - Back-office Admin Savr]] — action "Rattachement lieu"
- [[02 - Templates emails V1]] — template 17 `invitation_utilisateur`
