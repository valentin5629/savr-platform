# 06 - Back-office Admin Savr

**Dernière mise à jour précédente** : 2026-05-30 (**Revue de sobriété §06.06 (skill `cdc-review-sobriete`) — 8 simplifications appliquées zéro dette** : **A1** champ association `nombre_convives_par_jour` supprimé (§5 — jamais utilisé ; matching par taille = `capacite_max_beneficiaires`) · **A2** axe histogramme revenus = montant HT unique (toggle nb/montant retiré, §1 Bloc 2.1) · **B2** alerte marge négative retirée (§1 Bloc 3 — pas de marge négative attendue V1, décision Val) · **A3/D1** statut pack `expire` retiré V1 (`actif`/`epuise`/`annule` — aucun mécanisme d'expiration V1 ; §8 + §04 enum) · **B1** modal création pack wizard 4 étapes → formulaire modal unique (§8) · **C1** logique SQL recrédit inline du Bloc 6 §3 retirée → source unique [[05 - Règles métier]] · **C2** description du flag `dirty_tms` centralisée (définition canonique = §3 Bloc 0, KPI §1 + chip §3 y renvoient) · **C3** récap « Actions manuelles critiques V1 » transformé en index non-normatif (pointeurs vers sections sources). 3 fichiers App édités (§06.06 + §04 Data Model + mockup admin) zéro dette. Cross-CDC : 0 divergence (toutes modifs internes Plateforme : UI dashboard, enum pack non partagée, récap).)
**Dernière mise à jour précédente** : 2026-05-22 (§8 Clients > fiche organisation traiteur : ajout onglet Coefficient de perte labo — saisie admin par année, table `coefficients_perte_labo`. Cf. [[05 - Règles métier#R_dechets_labo_estimes]].)
**Dernière mise à jour précédente** : 2026-05-08 (fusion ex-fichier 07 dans §8 Clients > onglet Packs AG + §9 Paramètres > Tarifs Anti-Gaspi (publics). Pack unique actif (suppression FIFO multi-packs). Cf. memory `project_fusion_07_packs_ag_2026_05_08`.)
**Dernière mise à jour précédente** : 2026-05-08 (refonte §6 Transporteurs + §7 Lieux + §8 Clients : §6 lever filtre IDF, SIREN à la place de Numéro, ajout Téléphone contact, multi-véhicules unifiés `velo_cargo/camionnette/fourgon/vul/poids_lourd`, suppression `process_creation_collecte`/`detail`, type_tms simplifié `mts1/a_toutes/autre` ; §7 label "Adresse accès livraison", enums `acces_office` + `stationnement` = `facile/difficile/tres_difficile`, `type_vehicule_max` aligné sur enum véhicules unifié, ajout 4 champs (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo` admin/ops only), retrait UI normalisation types événements libres → V1.1 ; §8 vue liste split nb collectes ZD/AG, fiche orga ajout Logo. Cf. memory `project_refonte_back_office_admin_2026_05_08`.)
**Dernière mise à jour précédente** : 2026-05-07 (refonte §1-§5 : ouverture profil `ops_savr`, ajout Dashboard Client §2, refonte Dashboard Admin §1 — KPIs ré-écrits + suppression bloc Données opérationnelles + section Revenus refondue avec histogramme 12 mois et tableau revenus par organisation, refonte §3 Collectes — ajout colonnes Pax + Contrôle d'accès, vue détail mutualisée avec §06.04 + bloc Attribution Prestataire, vue dédiée AG en attente attribution, suppression section Anti-Gaspi §3 fusionnée dans Collectes + Clients + Paramètres, refonte §5 Associations — suppression nom interne Savr + description obligatoire + ajout id MTS-1 V1 + simulateur attribution → V2. Cf. memory `project_refonte_back_office_admin_2026_05_07`.)
**Lié à** : [[02 - Personas et cas d'usage]] (profils `admin_savr` et `ops_savr`) · [[09 - Authentification et permissions]] · [[11 - Dashboards]] · [[08 - APIs et intégrations]] §9

---

## Principe

Le back-office Admin Savr est le pivot opérationnel quotidien de l'équipe Savr. Il permet le pilotage global (dashboards) et les actions manuelles sur tous les objets de la plateforme (collectes, packs, factures, référentiels, utilisateurs).

**Accès** :
- `admin_savr` : accès complet (toutes lectures, toutes écritures, toutes actions sensibles)
- `ops_savr` : accès opérationnel (toutes lectures sauf cas spécifiés ci-dessous, écritures opérationnelles, **PAS** d'accès aux sections critiques admin-only)

**Sections / actions admin-only (réservées `admin_savr`)** :
- §9 Paramètres complet en écriture (tarifs, algo, intégrations, taux recyclage, users Savr, facteurs ADEME, templates emails, référentiels, configuration générale)
- §8 Clients : édition `tarif_refacture_pax_zd`, saisie/édition du coefficient de perte labo (`coefficients_perte_labo`), hard delete utilisateur *(fusion d'organisations retirée V1 — F6 2026-06-07, script SQL hors UI)*
- §5 Associations : SIREN + Habilitation 2041-GE (édition réservée admin)
- Impersonation utilisateur

`ops_savr` peut **lire** toutes ces sections (mode read-only avec bandeau « Lecture seule — édition réservée admin »). Toutes les actions sensibles sont tracées dans `audit_log` avec l'auteur (`admin_savr` ou `ops_savr`).

**Matrice de référence (source unique) : [[09 - Authentification et permissions]] §Matrice étendue `ops_savr`.** Les mentions `ops_savr` (Oui/Non) dispersées dans les écrans ci-dessous sont des rappels de contexte UI ; en cas d'écart avec la matrice §09, **§09 fait foi** (sobriété 2026-06-03 C1). Toute évolution de droit `ops_savr` se décide d'abord dans §09.

---

## Navigation principale

Barre latérale (desktop) / menu burger (mobile) :

1. **Dashboard Admin** (page d'accueil)
2. **Dashboard Client** (vue restituée du dashboard gestionnaire pour 1 ou plusieurs organisations)
3. **Collectes**
4. **Facturation**
5. **Associations**
6. **Transporteurs**
7. **Lieux**
8. **Clients** (organisations + users + packs AG)
9. **Paramètres**

> Section "Anti-Gaspi" supprimée 2026-05-07 — son contenu est redistribué : la file AG en attente attribution est une vue dédiée dans §3 Collectes, la gestion des packs est dans §8 Clients > Fiche organisation, l'auto-accept et les paramètres algo sont dans §9 Paramètres.

---

## 1. Dashboard Admin (page d'accueil)

Vue de pilotage global Savr (toutes données, pas de filtre RLS Admin).

### Bloc 1 — KPIs du jour / actions en attente (haut de page)

5 cartes-actions :

| Carte | Définition | Source |
|-------|------------|--------|
| **Collectes non transmises au TMS** (split ZD / AG en deux chiffres sur la carte) *(renommée Sujet 2 2026-05-26 — ex « Collectes à valider »)* | Collectes en statut `programmee` dont l'**envoi E1 `POST /collectes` n'a pas encore réussi** (`tms_reference IS NULL` ET `statut_tms = 'non_envoye'` — *corrigé 2026-05-29 : ex `statut_dispatch IS NULL`, champ TMS ; côté Plateforme le miroir `statut_tms` a pour défaut `non_envoye`*). **Pas de validation Admin à la création** : l'envoi au TMS est automatique à la soumission (cf. §05 §4) ; cette carte est un **monitoring d'échec d'envoi** (E1 en erreur/retry), normalement à 0 **côté ZD**. **Volet AG (tranché Val 2026-06-07 F4 — ne pas re-proposer)** : le chiffre AG compte **toutes** les AG `non_envoye`, y compris la file d'attribution nominale — assumé, ce n'est pas un indicateur d'échec côté AG (recouvre volontairement le chip « AG en attente attribution »). | `collectes` |
| **Collectes en attente de validation prestataire** | Collectes envoyées au TMS mais non encore acceptées par le prestataire (`statut_tms = 'attribuee_en_attente_acceptation'` — *corrigé 2026-05-29 : ex `statut_dispatch`*) | `collectes` (via webhook S2 TMS — *réf « S7 » retirée 2026-06-07 F5 : S7 = plaque-saisie, sans rapport*) |
| **Collectes modifiées sans renvoi TMS** | Collectes avec `collectes.dirty_tms = true` (définition canonique du flag : §3 Bloc 0 Attribution Prestataire) | `collectes` |
| **Collectes ZD prévues dans les 48h** | `type = 'zd'` ET `date_collecte BETWEEN now() AND now() + interval '48 hours'` ET `statut ∈ ('programmee', 'validee')` | `collectes` |
| **Collectes AG prévues dans les 48h** | `type = 'ag'` ET `date_collecte BETWEEN now() AND now() + interval '48 hours'` ET `statut ∈ ('programmee', 'validee')` | `collectes` |

Chaque carte est cliquable et redirige vers §3 Collectes avec le filtre prédéfini correspondant.

> **Bloc « Données opérationnelles » supprimé** (refonte 2026-05-07) — le tonnage, les répartitions par flux, le taux de recyclage et les graphs événements sont désormais accessibles via le **Dashboard Client §2** (avec sélecteur "Toutes les organisations" pour la vue Savr globale).

### Bloc 2 — Section Revenus

#### 2.1 Histogramme 12 derniers mois glissants

- Axe X : 12 mois glissants (mois calendaires)
- Axe Y : montant facturé HT *(toggle nb collectes / montant retiré — revue sobriété 2026-05-30 A2 : axe unique montant, le compte est dans le tableau « Revenus par organisation » ci-dessous)*
- 1 barre empilée par mois : segment ZD + segment AG
- Tooltip mensuel : nb ZD, nb AG, montant ZD, montant AG, total
- Source nb collectes : `collectes.date_collecte` ; source montant : `factures.date_emission` (cohérent avec définition "facturé"). Voir [[05 - Règles métier#R_revenus_imputation_organisation]].

#### 2.2 Tableau "Revenus par organisation"

Tableau filtrable. **Sélecteur de période** en haut (date_collecte from/to, défaut = mois en cours).

| Colonne | Source |
|---------|--------|
| Nom de l'organisation | `organisations.nom` (organisation **programmatrice** = `evenements.organisation_id`) |
| Type d'organisation | `organisations.type` (badge : traiteur / agence / gestionnaire_lieux / client_organisateur) |
| Nb collectes ZD | Count `collectes` type=zd, `date_collecte ∈ période`, `evenement.organisation_id = org` |
| Montant facturé ZD | Sum `factures_collectes.montant_ht` lié aux factures émises sur ces collectes ZD (statut facture ∈ `emise`, `payee`) |
| Nb collectes AG | Count `collectes` type=ag, idem |
| Montant facturé AG | Idem côté AG |

**Imputation V1** : ligne par organisation programmatrice (`evenements.organisation_id`), aucune ventilation traiteur opérationnel V1 (cf. memory règle programmateur=facturé).

**Filtre dates** : par `date_collecte` (et non par `date_emission`) — l'utilisateur cherche à savoir « combien j'ai facturé pour les collectes effectivement réalisées dans cette période ».

**Tri** : par défaut `montant total décroissant`, colonnes triables.

**Pagination** : 50 lignes / page (volume V1 estimé ~150 organisations actives).

**Export CSV** : bouton export avec colonnes du tableau + total agrégé.

### Bloc 3 — Section Coûts (conservée)

- Coûts logistiques totaux (source : `courses_logistiques`)
- Split par prestataire (Strike, Marathon, A Toutes!, province)
- Coûts moyens par collecte par type (ZD / AG)
- Marge brute (CA − coûts logistiques) par collecte et agrégée *(alerte visuelle marge négative retirée — revue sobriété 2026-05-30 B2 : pas de marge négative attendue en V1)*

---

## 2. Dashboard Client

Vue restituée du **Dashboard Gestionnaire de lieux** (cf. [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]] §05) — pour permettre à l'équipe Savr de voir « ce que voient les clients » et de piloter les opérations sous l'angle client.

### Sélecteur d'organisations (en haut de page)

Multi-sélection :

- **« Toutes les organisations »** (option par défaut) : agrège la totalité des collectes Savr (vue 100 % opérationnelle Savr)
- **Sélection d'une ou plusieurs organisations** (autocomplete `organisations.nom`, tous types confondus : traiteur, agence, gestionnaire_lieux) : affiche le dashboard restreint au périmètre sélectionné

Persistance du filtre : `localStorage` côté navigateur (l'Admin retrouve sa sélection à la prochaine ouverture).

### Composition du dashboard

Reprise **exacte** du dashboard Gestionnaire (§06.05) avec la spécificité suivante :
- Onglets ZD / AG inchangés
- Filtres globaux (lieux, dates, traiteurs, type+taille événement) inchangés — filtre dates = **`date_collecte`** (parité dashboard gestionnaire)
- Bloc 1 KPIs, Bloc 2 répartitions, Bloc 3 jauges benchmark, Bloc 4 historique inchangés
- L'agrégation porte sur le périmètre sélectionné (au lieu de `gestionnaire_id` filtré par RLS comme côté gestionnaire)

**Contrainte benchmark** : la jauge benchmark §06.05 Bloc 3 ZD nécessite un parc minimum (k≥5). Quand le filtre est `Toutes les organisations`, le benchmark est calculé sur l'ensemble du parc Savr filtré par les barres benchmark dédiées (cf. [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]] §benchmark).

### Permissions

- Lecture : `admin_savr` + `ops_savr`
- Écriture : aucune (vue lecture seule, agrégats)

---

## 3. Collectes

### Vue liste (défaut)

Liste déroulante avec scroll vertical. Une ligne = une collecte.

Colonnes par ligne :

| Colonne | Contenu |
|---------|---------|
| Date + heure | `collectes.date_collecte` + `collectes.heure_collecte` (format : "Jeu 23 Avr · 08h30") |
| Type | Badge ZD ou AG |
| Traiteur | `organisations.nom` (= `traiteur_operationnel_organisation_id → nom`) |
| **Pax** *(ajout 2026-05-07)* | `evenements.pax` (entier, format `120`) |
| Lieu | `lieux.nom` |
| Adresse lieu | `lieux.adresse` |
| Client Organisateur | `evenements.client_organisateur_organisation_id → nom` (si renseigné) |
| **Contrôle d'accès** *(ajout 2026-05-07)* | Badge oui/non depuis `collectes.controle_acces_requis`. Tooltip : "Plaque + nom chauffeur communiqués avant exécution". |
| Statut programmation | Badge coloré (enum `collectes.statut` 9 valeurs, aligné audit sobriété §04 2026-05-25 D1) : `brouillon` / `programmee` / `validee` / `en_cours` / `realisee` / `realisee_sans_collecte` (AG only) / `cloturee` / `annulation_demandee` / `annulee`. (`incident` et `manquee` retirés : no-show prestataire = `annulee` + `incident_imputable_a='prestataire'`.) **Libellés d'affichage** *(précisé 2026-07-04, divergence BOA-UI collectes)* : `brouillon` = « Créée » ; une collecte **AG `programmee` sans attribution validée** s'affiche **« À attribuer »** (variant *warning*, cohérent avec le chip « AG en attente attribution » §3 et l'action « Attribuer → »), et non « Créée ». |
| Indicateurs | Voir §ci-dessous |

### Indicateurs par ligne

**Toutes collectes (passées)**
- Icône "Rapport" :
  - Absent : pas encore généré (avant batch J+1 6h)
  - Disponible : PDF prêt
  - Consulté : horodatage de la première ouverture par le user programmeur (`rapports_rse.consulte_par_user_at`)
- Picto ⟳ "Rapport régénéré" si version actuelle ≠ initiale (tooltip : "Mis à jour le [date]")

**Collectes ZD (passées)**
- Poids total collecté (kg) : somme des pesées par flux
- **Taux de recyclage** : `collectes.taux_recyclage` (figé à la clôture, formule à captation par filière). Format `78.4 %`, `—` si NULL.
- Badge "Anomalie pesée" rouge si au moins un flux hors seuils min/max *(V2 — détection seuils par flux en g/pax, exception actée ; non calculé en V1, aucun flag `collecte_flux.anomalie` ni table de seuils alimentée)*

**Collectes AG (passées)**
- Nombre de repas collectés (`attributions_antgaspi.volume_repas_realise`)

**Collectes à venir et en cours**
- Badge "Info incomplète" orange si certains champs non bloquants sont manquants
- Pour AG : statut attribution (en attente / validée / auto-accept) *(« aucune reco » replié sur « en attente » — décision Val 2026-07-02, divergence M0.6 ; une collecte sans reco est de fait en attente d'attribution. Distinction visible sur la fiche/flux algo §06.09, non persistée pré-validation en V1)*

### Filtres

- Type : ZD / AG / Tout
- Traiteur (`organisation_id` via liste déroulante — menu `<select>` peuplé de tous les traiteurs, tri alphabétique, option « Tous les traiteurs »)
- Lieu (`lieu_id` via liste déroulante — menu `<select>` peuplé de tous les lieux, tri alphabétique, option « Tous les lieux »)
- Statut (multi-sélection)
- Plage de dates (`date_collecte` entre X et Y)
- "Info incomplète" oui/non
- "Anomalie pesée" oui/non (ZD uniquement) *(V2 — détection seuils par flux, exception actée ; filtre inactif en V1)*
- "Rapport non consulté" oui/non
- **Filtres prédéfinis cliquables (chips en haut de liste)** *(ajout 2026-05-07)* :
  - "Non transmises au TMS" *(renommé Sujet 2 2026-05-26, ex « À valider »)* → `statut=programmee` ET `tms_reference IS NULL`
  - "En attente prestataire" → `statut_tms = 'attribuee_en_attente_acceptation'` *(corrigé 2026-05-29 : ex `statut_dispatch`, champ TMS — côté Plateforme le miroir est `collectes.statut_tms`)*
  - "Modifiées sans renvoi TMS" → `dirty_tms = true` (cf. §3 Bloc 0 pour la définition du flag)
  - "AG en attente attribution" → `type=ag` ET aucune attribution validée (`NOT EXISTS (attributions_antgaspi a WHERE a.collecte_id = collectes.id AND a.valide_at IS NOT NULL)`) *(corrigé 2026-05-29 : ex réf `attributions_antgaspi.statut` — colonne inexistante. Équivalent post-alignement ZD/AG : `type=ag AND statut_tms = 'non_envoye'`, l'AG restant `non_envoye` tant que l'attribution n'est pas validée)*
  - "ZD 48h" / "AG 48h"

### Vue dédiée "AG en attente attribution" *(ajout 2026-05-07)*

Vue spécifique accessible via chip ou URL `/admin/collectes?filter=ag_attente_attribution`.

Affiche en plus de la liste classique :
- Top 3 algo recommandé pour chaque collecte (depuis `[[06 - Fonctionnalités détaillées/09 - Flux algo attribution AG (Admin)]]`)
- Bouton « Valider attribution » par ligne (déclenche workflow §09 Flux algo)
- Tri par défaut : `date_collecte ASC` (priorité aux collectes les plus proches)

### Vue détail d'une collecte (clic sur une ligne)

Page complète. Reprise des **4 blocs de l'espace traiteur §06.04** + **3 blocs Admin-only** en superset (cf. [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] §Vue détail d'une collecte).

#### Bloc 0 — Attribution Prestataire (Admin-only, **en haut de page**)

État courant + actions de dispatch :

**État affiché** :
- Prestataire actuel (Strike, Marathon, A Toutes!, transporteur province nominal — depuis `collectes.prestataire_logistique_id`)
- Statut TMS (miroir Plateforme `statut_tms` : `a_attribuer` | `attribuee_en_attente_acceptation` | `acceptee` | `en_attente_execution` | `rejetee_par_prestataire` | `annulee_par_traiteur`) *(corrigé 2026-05-29 : ex `statut_dispatch` — champ TMS ; valeurs `non_attribuee`/`refusee` hors enum miroir → `a_attribuer`/`rejetee_par_prestataire`)*
- Horodatage de la dernière transition `statut_tms` (`collectes.statut_tms_at` — cf. [[04 - Data Model]], sémantique = transition, pas émission)
- **Flag « Modifiée sans renvoi TMS » (`collectes.dirty_tms`) — définition canonique** *(source unique — revue sobriété 2026-05-30 C2 ; « émission S7 » renommée « émission dispatch » 2026-06-07 F5)* : passe à `true` quand une collecte **déjà envoyée au TMS** subit une modification métier (date, heure, lieu, pax, flux, contrôle d'accès, contacts, info supplémentaire) **après** la dernière émission dispatch et **avant** un renvoi explicite. Remis à `false` à la prochaine émission dispatch (bouton « Renvoyer au TMS », endpoint [[08 - APIs et intégrations]] §10.1). Toutes les autres mentions du flag dans ce document (KPI §1, chip §3) renvoient à cette définition.
- Tournée(s) TMS rattachée(s) (`collecte_tournees` → `tournees.id` + lien vers TMS si applicable) — **liste** des N tournées pour une collecte multi-camions (refonte 2026-05-25, ex-lien `collectes.tournee_id` singulier retiré)

**Actions disponibles** (variables selon type collecte) :

| Type | Actions Admin/Ops |
|------|-------------------|
| **ZD** | Bouton **« Renvoyer au TMS »** (réémission dispatch idempotente, reset `dirty_tms` — endpoint §08 §10.1). **Pas d'attribution manuelle ZD V1** (la règle dispatch ZD est simple : prestataire fixe par lieu/zone). Override Admin uniquement via §8 Clients > tarifs négociés ou §7 Lieux. |
| **AG** | Liste déroulante « Prestataire » (Strike / Marathon / A Toutes! / transporteur province) + champ « Motif override » obligatoire si choix ≠ top 1 algo. Bouton **« Envoyer au TMS »** (ou **« Renvoyer au TMS »** si `tms_reference IS NOT NULL`). Émet le dispatch avec `prestataire_id` choisi + `motif_override` audité. |

**Spec V1 fork (cdc-v1-scoping ultérieur)** : avec MTS-1 + Everest comme TMS V1, le bouton sera dérivé en **2 boutons distincts selon prestataire** :
- « Envoyer à MTS-1 » — pour collectes Strike et Marathon (pousse vers MTS-1 via API V1)
- « Envoyer à A Toutes! » — pour collectes A Toutes! (workflow distinct A Toutes!)

**Routing du `consumer`/adapter (précision 2026-07-02, divergence M0.6)** : la dérivation de l'adapter au dispatch Bloc 0 doit suivre `transporteurs.type_tms` (`mts1 → adapter_mts1`, `a_toutes → adapter_everest`, `autre`/`par_mail`/`par_telephone` → `provider_manual`), exactement comme `fn_valider_attribution_ag`. La RPC `fn_dispatcher_collecte` ne doit PAS émettre l'outbox avec un `consumer = 'adapter_mts1'` fixe, sinon un dispatch A Toutes!/manuel serait routé vers l'adapter MTS-1.

Le contrat S7 unifié reste en V2 (TMS Savr natif). À matérialiser dans le fork V1 quand la skill `cdc-v1-scoping` sera lancée. Voir [[08 - APIs et intégrations]] §9 Bloc Attribution Prestataire (V1 + V2).

#### Blocs 1 à 4 — Mutualisés avec §06.04 Espace traiteur

Reprise stricte de la vue détail de l'espace traiteur (post-refonte 2026-05-04 et 2026-05-05) :

- **Bloc 1 — Programmation/Événement** : nom, **date de l'événement (`evenements.date_evenement`)** et **date+heure de collecte (`collectes.date_collecte` + `heure_collecte`)** distinguées (refonte 2026-05-21), pax, type événement, client organisateur, contacts. Modifiable par Admin/Ops avec audit_log.
- **Bloc 2 — Pesées + Photos** : poids saisi par flux, photos (TMS + imports manuels), badge « Anomalie pesée » ZD si applicable. Modifiable par Admin (motif obligatoire).
- **Bloc 3 — Documents** : Rapport RSE (télécharger / consulter statut / régénérer), Bordereau ZD, Attestation de don (AG), galerie photos + bouton « Importer des photos » côté Admin.
- **Bloc 4 — Pack AG** (si type AG) : pack rattaché, crédits restants, statut. Si la collecte est `annulee` après avoir été `realisee` : badge "Crédit recrédité automatiquement le {{date}}" (cf. [[05 - Règles métier#Annulation d'une collecte AG recrédit automatique]]).

#### Bloc 5 — Attribution AG (résumé + lien, Admin-only, si type=AG)

Résumé de l'attribution AG sur la fiche collecte (vs vue traiteur qui ne montre que le pack). Le **workflow interactif complet** (sélection top-3, validation, statuts emails, re-jouer l'algo) vit sur l'écran dédié [[09 - Flux algo attribution AG (Admin)]] (`/admin/attributions-ag/[collecteId]`, R11) — le Bloc 5 en est un **résumé lecture + point d'entrée**, pas une duplication *(clarifié 2026-07-04, divergence M0.6 BOA-07 : évite la duplication UI avec l'écran §06.09 ; architecture actée BOA-06 PR #150)*.

Rendu inline sur la fiche :

- Top 3 associations recommandées par l'algo + scores détaillés (distance km, capacité) — données `calculerAlgoAttributionAg`
- Association retenue + transporteur retenu (embed `attributions_antgaspi`)
- Validation (`mode_validation` + `valide_at`)
- Volume estimé (`collectes.volume_estime_repas`, calculé auto, cf. §3.x Champs bloquants ci-dessous) + volume réalisé (`attributions_antgaspi.volume_repas_realise`)
- **Lien proéminent** « Ouvrir l'attribution complète (top 3, validation, emails, re-jouer l'algo) → » vers `/admin/attributions-ag/[collecteId]`

Délégué à l'écran §06.09 (non dupliqué inline) :

- Statuts emails association (`ag_attribution_association` envoyé / lu, accepté / refusé) et transporteur (`ag_attribution_transporteur`)
- Bouton « Re-jouer l'algo » (si attribution invalidée)

#### Bloc 6 — Facturation détaillée (Admin-only)

- Pack rattaché (AG) ou tarif appliqué (ZD)
- Facture émise / brouillon / pas encore générée
- Lien vers facture
- Bouton **« Annuler le crédit de cette collecte »** (AG, uniquement si `statut = realisee`) — cas d'usage : problème côté Savr, la collecte est physiquement réalisée mais ne doit pas être facturée ni décomptée du pack (incident interne, geste commercial). Action passe `collectes.annulee_cote_savr = true` + recrédit du pack + audit_log avec motif obligatoire ≥ 10 car. **La mécanique du recrédit (décrément `credits_consommes`, bascule de statut, dérattachement pack) est décrite à un seul endroit** : [[05 - Règles métier#Annulation d'une collecte AG recrédit automatique]] *(source unique — revue sobriété 2026-05-30 C1, logique SQL inline retirée pour éviter la divergence de specs)*. **Distinct de l'annulation collecte** (qui passe `statut = annulee` via §4 Statuts) : ici la collecte reste `realisee` mais marquée hors-périmètre commercial Savr.
- Bouton **« Générer un avoir »** (si facture déjà émise et collecte annulée post-réalisation)

#### Bloc 7 — Historique + Audit log (Admin-only)

- Timeline des changements de statut
- Liste des actions Admin/Ops (depuis `audit_log` filtré sur cette collecte) avec auteur (`admin_savr` ou `ops_savr`), action, ancienne valeur, nouvelle valeur, motif

### Actions Admin/Ops sur une collecte

`admin_savr` + `ops_savr` (sauf mention explicite admin-only) :

- Modifier les informations (contacts, horaires, pax, etc.)
- Modifier les pesées par flux manuellement (ZD)
- Importer des photos (sans passer par le TMS)
- Importer le logo du client organisateur
- Forcer un changement de statut (motif obligatoire)
- Annuler le crédit d'une collecte (AG)
- Régénérer le rapport RSE
- Régénérer le bordereau ZD / l'attestation AG
- Envoyer une notification au traiteur (email manuel)
- **Renvoyer au TMS / Envoyer au TMS** (cf. Bloc 0)
- **Override prestataire AG** (admin-only — `ops_savr` peut envoyer la recommandation top 1 mais pas override avec motif)

Toutes les actions sont loguées dans `audit_log`.

### Champs bloquants vs non bloquants à la programmation

**Champs bloquants** (obligatoires à la création du formulaire de programmation §06.01) :
- Date, heure de collecte, lieu, type d'événement, pax
- Traiteur opérationnel (et organisation programmatrice)
- Type de collecte (ZD ou AG)

**Champs non bloquants** (collecte créée en `programmee` avec `informations_completes = false` si manquants — affichage badge « Info incomplète » côté Admin/Ops, relance manuelle V1) :
- Nom + téléphone contacts (principal et secours)
- Instructions d'accès spécifiques (`informations_supplementaires`)
- Logo du client organisateur

**Suppression 2026-05-07 — flux ZD souhaités et volume estimé AG ne sont plus des champs de saisie utilisateur** :

- **Flux ZD** : à la création d'une collecte ZD, les **5 flux V1 par défaut sont le référentiel d'affichage** (`biodechet`, `emballage`, `carton`, `verre`, `dechet_residuel`) ; **aucune ligne `collecte_flux` n'est pré-créée** (les lignes sont _dérivées_ de `pesees_tournees` à l'agrégation terminale — cf. §04 — ou saisies manuellement par l'Admin). Pas de saisie traiteur. Un flux non collecté = pas de ligne (implicitement 0) ; l'UI affiche les 5 flux en « En attente ». Ceci garantit le gate batch R-PDF3 (`0 ligne → skip`, jamais de bordereau vide). Voir [[05 - Règles métier#R_flux_par_defaut_zd]].
- **Volume estimé AG** : **calculé en backend** par formule auto (`volume_estime_repas = round(0.10 × evenements.pax)`, V1). Sert uniquement à l'algo d'attribution association (R_capacite_min_50pct). **Non saisi, non visible côté traiteur.** Le traiteur ne voit que le `volume_repas_realise` post-collecte. Voir [[05 - Règles métier#R_volume_estime_ag_calcule]].

**Affichage back-office** : badge "Info incomplète" sur la liste + bloc dédié sur la fiche collecte listant les champs manquants + bouton "Envoyer un rappel au traiteur" (manuel V1).

**V1.1 envisagée** : relance automatique email à J-2 avant la collecte si `informations_completes = false`.

---

## 4. Facturation

### Vue liste
Tableau de toutes les factures avec filtres *(refonte 2026-05-08 — revue de sobriété)* :
- Statut : `brouillon` / `en_attente_pennylane` / `emise` / `payee` / `annulee` (le caractère "en retard" est calculé en lecture sur `emise + date_echeance < CURRENT_DATE`, pas un statut stocké — voir [[08 - Génération et édition facture (Admin)]] §10)
- Type : ZD / AG / Pack / Avoir
- Organisation
- Période d'émission

Colonnes : numéro, date émission, organisation, montant HT, montant TTC, statut (avec pastille orange si `en_attente_pennylane > 2h`), date échéance (badge "En retard" calculé), date paiement.

### Blocs d'action

**Brouillons en attente de validation** (SLA < 24h)
- Bandeau haut de page listant les brouillons non validés depuis plus de 24h
- Bouton "Valider et envoyer" par ligne (déclenche le flux Pennylane décrit dans [[08 - Génération et édition facture (Admin)]] §2)

**Factures en retard** *(consultation seule — refonte 2026-05-08)*
- Liste des factures `emise` avec `date_echeance` dépassée (filtre calculé)
- Tri par retard le plus important
- **Pas de bouton relance V1 côté Savr** : les relances sont gérées directement dans Pennylane (décision 2026-04-28)

**Avoirs à émettre**
- Liste des collectes annulées post-réalisation sans avoir émis
- Action : créer l'avoir depuis la facture d'origine

**Push Pennylane bloqués** *(refonte 2026-05-08)*
- Filtre direct dans la liste des factures (`statut = en_attente_pennylane`) — pas d'écran dédié
- Bouton "Renvoyer vers Pennylane" sur la fiche facture (retry manuel après échec retry auto 5min/1h/24h)
- Erreur Pennylane détaillée affichée sur la fiche facture (`erreur_synchro` + `erreur_synchro_at`)

### KPIs rapides (haut de page)
- CA émis mois en cours (HT + TTC)
- CA encaissé mois en cours
- Factures en retard (nombre + montant — calculé `emise + date_echeance < now()`)
- DSO moyen (Days Sales Outstanding)

### Actions possibles sur une facture
- Éditer avant envoi (modifier montant libre AG, lignes ZD)
- Valider + envoyer Pennylane
- Renvoyer vers Pennylane (si `statut = en_attente_pennylane`)
- Générer un avoir intégral *(avoir partiel reporté V1.1 — refonte 2026-05-08)*
- Annuler la facture (si pas encore payée)
- Télécharger PDF
- Voir le détail des collectes liées (`factures_collectes`)

Voir [[08 - Génération et édition facture (Admin)]] pour le détail du workflow de génération.

**Permissions** :
- `admin_savr` : ALL
- `ops_savr` : lecture + valider + renvoyer (retry Pennylane) + télécharger ; **PAS** d'éditer ligne (modifier montant), **PAS** d'annuler facture, **PAS** de générer avoir

---

## 5. Associations

### Vue liste
Tableau filtrable :

| Colonne *(refonte 2026-05-07)* | Source |
|--------|--------|
| Nom (pour le client) | `associations.nom` (renommé conceptuellement : c'est le nom utilisé partout) |
| Ville | `associations.ville` |
| Habilitation 2041-GE (oui/non) | `associations.habilitee_attestation_fiscale` |
| Capacité max (repas) | `associations.capacite_max_beneficiaires` |
| Actif (oui/non) | `associations.actif` |

Clic sur une ligne → fiche détaillée.

### Formulaire de création / édition

| Champ | Type | Obligatoire | Notes |
|-------|------|-------------|-------|
| **Nom de l'association** | texte | Oui | Libellé unique, affiché dans rapports + back-office |
| Upload logo | fichier (JPG/PNG max 2 Mo) | Non | Affiché dans rapports AG |
| Adresse | texte + géocodage auto | Oui | Source pour distance algo |
| Nom prénom de contact | texte | Oui | |
| Numéro de contact | texte | Oui | |
| Mail des personnes à prévenir en cas de collecte | texte (liste emails séparés par virgule) | Oui | Destinataires email `ag_attribution_association` |
| Instructions d'accès au lieu (pour le transporteur) | texte long | Non | |
| **Horaires d'ouverture** (simplifié) | tableau 7 lignes | Oui | Voir §Horaires ci-dessous |
| Zone de commentaire à usage interne | texte long | Non | |
| SIREN | texte | Non | Validation INSEE (9 chiffres) — édition admin-only. **Non obligatoire — tranché Val 2026-07-02 (R17b) ; colonne `associations.siren` ajoutée (V1 + DDL cible).** |
| Habilitation 2041-GE | booléen + date expiration | Non | Si `true`, attestation fiscale activée — édition admin-only |
| Capacité max bénéficiaires (repas) | integer | Oui | **Critère de matching par taille d'événement** : exclut l'asso si trop petite (`capacite_max_beneficiaires × 2 > volume_estimé`). C'est ce champ qui garantit qu'un gros événement (ex. 3000 pax) est attribué à une asso avec assez de bénéficiaires. || **Description pour le rapport d'impact (pour le client)** | texte long | **Oui** *(rendu obligatoire 2026-05-07)* | Copié dans rapport AG. Validation : ≥ 30 caractères. |
| **Id du point de collecte dans MTS-1** *(ajout 2026-05-07, V1 only)* | texte | Non | Identifiant point de collecte côté MTS-1 — sert au pré-fill V1 lors de l'envoi vers MTS-1 (cf. §3 Bloc 0 Attribution Prestataire / fork V1). En V2 (TMS Savr natif), ce champ devient déprécié (gardé en lecture pour audit historique). |
| Actif | booléen | Oui | Défaut `true` |

**Champs supprimés / dépréciés** :
- — supprimé 2026-05-07 (unification libellé)
- Type de point — supprimé V1 (déprécié Bubble)
- Description des horaires d'ouverture (texte libre) — déprécié V1, remplacé par tableau structuré
- Nombre de collectes sur 8 jours glissants — déprécié V1
- — **supprimé V1 (revue sobriété 2026-05-30 A1)** : jamais utilisé (ni facturation, ni algo, ni reporting). Le matching par taille d'événement repose sur `capacite_max_beneficiaires`.

### Horaires d'ouverture (format simplifié)

Tableau 7 lignes (lundi à dimanche), par ligne :
- Case à cocher "Ouvert" (défaut : décochée)
- Heure de début (time picker, format HH:mm)
- Heure de fin (time picker, format HH:mm)
- Bouton "+" pour ajouter un second créneau (ex : pause déjeuner)

Stocké dans `associations.horaires_ouverture` au format JSON.

### Simulateur d'attribution → V2

> **Reporté V2** *(décision 2026-05-07)*. La fonctionnalité reste valide mais sort du périmètre V1. À implémenter en V2 quand l'algo aura suffisamment d'usage pour bénéficier d'un outil de simulation. Spec conservée pour mémoire dans [[09 - Flux algo attribution AG (Admin)]] §V2.

### Permissions

- `admin_savr` : ALL (création / édition / désactivation / SIREN / habilitation)
- `ops_savr` : lecture + édition partielle (contacts, horaires, instructions, capacité, description) ; **PAS** d'édition SIREN, **PAS** d'édition habilitation 2041-GE, **PAS** de désactivation `actif=false`

---

## 6. Transporteurs

*(Refonte 2026-05-08 — voir mémoire `project_refonte_back_office_admin_2026_05_08`)*

### Vue liste
Tableau filtrable : nom, ville, véhicule(s), type de TMS, actif.

**Périmètre** : tous les transporteurs (IDF + province), pas de filtre zone par défaut. Strike, Marathon, A Toutes! et transporteurs province affichés dans la même liste.

### Formulaire de création / édition

| Champ                            | Type              | Obligatoire | Notes                                                                                                                                                            |
| -------------------------------- | ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom du transporteur              | texte             | Oui         |                                                                                                                                                                  |
| **SIREN** | texte | Oui | **Renommé 2026-05-08** (ex "Numéro du transporteur"). Validation INSEE 9 chiffres. Édition admin + ops *(F3 2026-06-07)*. |
| Nom du contact                   | texte             | Oui         |                                                                                                                                                                  |
| **Numéro de téléphone**          | texte             | Oui         | **Ajout 2026-05-08**. Joignable jour J. Format E.164 recommandé.                                                                                                  |
| Mail de contact                  | email             | Oui         | Destinataire `ag_attribution_transporteur`                                                                                                                       |
| Adresse                          | texte + géocodage | Oui         | Base calcul distance (`adresse`, `code_postal`, `ville` → `latitude`/`longitude` géocodés)                                                                        |
| **Type(s) de véhicule**          | multi-enum        | Oui         | **Refonte 2026-05-08** — sélection multiple (`text[]`) parmi `velo_cargo`, `camionnette`, `fourgon`, `vul`, `poids_lourd`. Enum aligné sur `lieux.type_vehicule_max`. |
| **Type de TMS**                  | enum              | Oui         | **Refonte 2026-05-08** — `mts1` (Strike + Marathon V1, push API depuis Plateforme via fork V1) / `a_toutes` (workflow A Toutes! distinct) / `autre` (province → email + téléphone manuel) / `par_mail` / `par_telephone` (**ajout R17b 2026-07-02** — transporteurs hors TMS routés `provider_manual`, validation manuelle Admin). Détermine quel bouton apparaît au Bloc 0 Attribution Prestataire §3. Champs fusionnés (ex `process_creation_collecte`, `process_creation_collecte_detail`, `type_tms` regroupés en un seul). |
| **Code transporteur MTS-1**      | texte             | Si `type_tms = mts1` | **Ajout 2026-05-29 (propagation §3bis)** — `carrierShareableCode` côté MTS-1 (récupérable via `GET /v3/carrier`), utilisé pour déléguer l'ordre au bon transporteur. Obligatoire si `type_tms = 'mts1'` (cf. [[05 - Règles métier#R_code_mts1_requis]]). Masqué si `type_tms ≠ mts1`. Déprécié V2. |
| **Type(s) de collecte**          | multi-enum        | Oui         | **Ajout R17b 2026-07-02** — flux gérés par le transporteur (`text[]` parmi `anti_gaspi` / `zero_dechet`), sélection multiple. |
| **Description du process de collecte** | texte long | Non | **Ré-ajout R17b 2026-07-02** (ex `process_creation_collecte_detail`) — consignes métier de collecte propres au transporteur, champ dédié `description_process_collecte`. |
| Actif                            | booléen           | Oui         | Défaut `true`                                                                                                                                                    |

**Champs supprimés (refonte 2026-05-08)** :
- (enum email/API/téléphone) — fusionné dans `type_tms`
- — **ré-ajouté R17b 2026-07-02** sous le nom `description_process_collecte` (champ dédié, cf. formulaire ci-dessus)

### Rattachement automatique province

Règle V1 : pour une collecte AG hors IDF, l'algorithme :
1. Identifie les transporteurs actifs dans un rayon de 50 km autour du lieu de collecte
2. Filtre sur compatibilité véhicule (cf. [[05 - Règles métier#R_compatibilite_vehicule_lieu]] : au moins un `transporteurs.types_vehicules` ≤ `lieux.type_vehicule_max` dans la hiérarchie `velo_cargo < camionnette < fourgon < vul < poids_lourd`)
3. Rattache automatiquement à l'association la plus proche (parmi celles compatibles)
4. Affiche le transporteur sélectionné dans le top 3 du bloc transporteurs

L'Admin peut toujours override manuellement avec motif.

### Permissions

- `admin_savr` : ALL (création, édition, désactivation, SIREN)
- `ops_savr` : ALL également *(tranché Val 2026-06-07 F3 — alignement matrice §09 « Lieux / Transporteurs : lecture / écriture / désactivation : ops Oui » ; les ex-restrictions SIREN + `actif=false` sont levées, les 2 tests pgTAP contraires retirés §09)*

---

## 7. Lieux

*(Refonte 2026-05-08 — voir mémoire `project_refonte_back_office_admin_2026_05_08`)*

Voir [[04 - Data Model]] table `lieux`.

### Vue liste
Référentiel complet filtrable (nom, ville, gestionnaire, type, traiteurs opérants, actif).

### Formulaire de création / édition

**Champs visibles dans le formulaire de programmation §06.01** (pour traiteur/agence/gestionnaire/admin) :

| Champ | Type | Obligatoire | Notes |
|-------|------|-------------|-------|
| Nom du lieu | texte | Oui | |
| **Adresse accès livraison** | texte + géocodage | Oui | **Renommé 2026-05-08** (ex "Adresse accès"). Champ DB `adresse_acces` inchangé. Adresse logistique unique (chauffeur + programmation). |
| **Accès office** | enum | Non | **Refonte 2026-05-08** — enum `facile / difficile / tres_difficile`. Migration des valeurs texte libre existantes via UI Admin (file de normalisation Lieux V1.1, en attendant : NULL par défaut + ressaisie manuelle Admin). |
| **Stationnement** | enum | Non | **Refonte 2026-05-08** — enum `facile / difficile / tres_difficile`. **Changement de nature** : ex enum 4 valeurs "type d'emplacement" (`parking_dedie`/`quai_livraison`/`stationnement_rue`/`zone_livraison_courte`) → enum 3 valeurs "difficulté d'accès". Pas de migration des valeurs Bubble actuelles → nouveau référentiel à ressaisir lieu par lieu post-migration (cf. [[13 - Migration depuis Bubble]]). |
| **Type de véhicule max** | enum | Oui | **Refonte 2026-05-08** — enum aligné sur transporteurs : `velo_cargo / camionnette / fourgon / vul / poids_lourd` (hiérarchie du plus petit au plus gros). Le lieu impose un max → tous les véhicules ≤ max sont acceptés. Migration manuelle Admin (ressaisie lieu par lieu post-migration). |
| Traiteurs opérant | liste N-N | Non | Information indicative, alimentée auto via collectes |
| Gestionnaire | FK organisations type `gestionnaire_lieux` | Non | |
| Contrôle d'accès requis (plaque + nom chauffeur) | toggle `controle_acces_requis_default` | Oui | (refonte 2026-05-03 — ex `plaque_requise_default`). Cascade upgrade-only (R_controle_acces_cascade §05). |
| Actif | booléen | Oui | Défaut `true` |

**Champs admin/ops only (NON visibles dans le formulaire de programmation §06.01)** *(ajout 2026-05-08)* :

| Champ | Type | Obligatoire | Notes |
|-------|------|-------------|-------|
| **Commentaire sur le lieu** | texte long | Non | **Ajout 2026-05-08** — Commentaire interne Savr (note opérationnelle, contexte commercial, alerte). Distinct de `acces_details` (consignes terrain partagées TMS) et `commentaires_internes` (note technique migration). RLS column-level admin/ops only. |
| **SIREN** | texte | Non | **Ajout 2026-05-08** — Validation INSEE 9 chiffres. Distinct du SIREN du gestionnaire (peut différer si filiale, lieu indépendant géré par un tiers). Pas de pré-fill auto depuis le gestionnaire. RLS admin/ops only. |
| **Mail gestionnaire du lieu** | email | Non | **Ajout 2026-05-08** — Email du référent gestionnaire (différent du contact terrain `evenements.contact_*`). Usage : relances commerciales / opérationnelles internes Savr. RLS admin/ops only. |
| **Référencé Citeo** | booléen | Non | **Ajout 2026-05-08** — Défaut `false`. Indique si le lieu est référencé Citeo (REP emballages). Usage interne Savr (reporting). RLS admin/ops only. |

**Visibilité des 4 champs admin** : `admin_savr` + `ops_savr` lecture + édition. **Strictement invisibles** côté traiteur, agence, gestionnaire, client organisateur (RLS column-level GRANT — voir [[09 - Authentification et permissions]]).

### Action "Normaliser un lieu"
Quand un user a saisi un lieu manuellement pendant la programmation, la fiche est créée avec `actif = false`. L'Admin normalise (complète, valide, marque `actif = true`).

Voir [[02 - Templates emails V1]] template `admin_demande_ajout_lieu`.

### Signalement modifs lieu (refonte 2026-05-03 — simplifié 2026-05-25)

> ⚠ **Simplifié 2026-05-25 (audit sobriété §04, B1)** : la table `lieux_modifications_en_attente` et son workflow d'approbation (`valider`/`rejeter` + `motif_rejet`) sont supprimés. Remplacés par une **worklist auto-résolutive** + édition directe du lieu dans le back-office lieux existant.

**Contexte** : au formulaire §06.01, l'utilisateur peut modifier les infos d'un lieu existant. Les modifs sont stockées sur la collecte courante (`collectes.lieu_overrides`, utilisé immédiatement et transmis au TMS). Le lieu officiel n'est pas modifié automatiquement (cf. [[05 - Règles métier]] R_lieu_modif_pending).

**UI** :

- **Badge dans la nav principale** : "X modifs lieu signalées" (compteur des collectes récentes dont `lieu_overrides IS NOT NULL` et dont une valeur diffère encore du `lieux` officiel).
- **Worklist** (vue liste) : tableau filtrable
  - Colonnes : Lieu, Date, Signalé par, Collecte associée, Diff (avant `lieux` / après `lieu_overrides`)
  - Ligne expansible : affichage du diff par champ (valeur officielle vs override de la collecte)
- **Action par ligne** : **Appliquer au lieu** → ouvre la fiche lieu (back-office lieux) pré-remplie avec les valeurs override ; l'Admin valide ou ajuste, puis enregistre (UPDATE `plateforme.lieux`). Impacte les futurs programmeurs. S'il ne fait rien, la collecte garde son override et la ligne reste dans la worklist (auto-résolutive : disparaît dès alignement). Pas de statut « rejeté » à stocker.
- **SLA cible V1** : revue quotidienne par Admin (pas de SLA contractuel).

### Normalisation types événements libres → V1.1 **Mécanisme retiré V1 (propagation Sujet 4 — type vs taille, 2026-05-26)**

> **Retiré V1 (Sujet 4, 2026-05-26)** : le mécanisme « Autre + texte libre + normalisation » est **supprimé** (pas seulement reporté). `types_evenements` est figé à 4 catégories de format de service (`cocktail_aperitif`, `cocktail_repas_complet`, `repas_assis`, `autre`) ; `autre` est un fourre-tout sélectionnable **sans saisie**. La colonne `evenements.type_evenement_libre` est supprimée (§04), la règle `R_type_evenement_libre` est retirée (§05), et le champ libre disparaît du formulaire §06.01. Plus aucune file de normalisation, ni en V1 ni en V1.1. Extension du référentiel = **ajout direct d'une ligne** dans `types_evenements` (Admin/Supabase), sans UI dédiée. Les événements `autre` sont comptés comme un bucket benchmark normal.
>
> Contenu historique conservé pour traçabilité :
> 

---

## 8. Clients (organisations + users + packs AG)

*(Section partiellement modifiée 2026-05-07 — ajout sous-section Packs AG fusionnée depuis ex-§3 Anti-Gaspi. Le reste sera revu dans la prochaine itération.)*

### Vue liste organisations
Tableau : nom, type (traiteur / agence / gestionnaire_lieux / client_organisateur), SIREN, nb users, **nb collectes ZD 12 derniers mois**, **nb collectes AG 12 derniers mois**, actif.

> **Refonte 2026-05-08** : split de la colonne unique "nb collectes 12 derniers mois" en 2 colonnes distinctes ZD + AG. Tri possible sur chaque colonne. Pertinent pour identifier rapidement le profil d'usage d'un client (orienté ZD, AG ou mix).

### Fiche organisation

Onglets sur la fiche :

- **Informations légales** : SIREN, entités de facturation, multi-SIRET, **Logo organisation** *(ajout 2026-05-08)* — upload (JPG/PNG max 2 Mo) + preview. Stocké dans `organisations.logo_url` (champ déjà existant utilisé pour rapports RSE — voir [[04 - Data Model]] table `organisations`). Édition admin/ops. Affiché dans rapports ZD/AG quand l'organisation est `client_organisateur` ou en en-tête de fiche traiteur. **Sous-section « Domaines email »** *(fusionnée depuis l'ex-onglet Domaines email — décision Val 2026-07-03)* : domaines whitelistés `organisations_domaines_email`, affichés après les entités de facturation. Aucune modification data-model/API.
- **Users rattachés** : liste avec rôle, statut, dernière connexion
- **Packs AG** *(refonte 2026-05-07)* : voir sous-section dédiée ci-dessous
- **Collectes** : liste filtrée
- **Factures** : liste filtrée
- **Grille tarifaire ZD** *(refonte 2026-05-26, visible si `type='traiteur'`)* : sélecteur de la grille du catalogue affectée à l'organisation (`organisations.grille_tarifaire_zd_id`). Vide = grille par défaut « Standard paliers ». Édition Admin Savr only.
- **Remises négociées** *(refonte 2026-05-26 ; scope de création précisé 2026-07-03)* : lignes `tarifs_negocie` (remises %) éligibles à cette organisation (`scope=organisation`) ou à ses lieux (`scope=gestionnaire`, en lecture). **Depuis la fiche organisation, la création est limitée au scope `organisation`** (org de la fiche, `organisation_id` posé depuis le contexte — non saisi). La création de remises `scope=gestionnaire` (avec `gestionnaire_organisation_id` + `lieu_id` optionnel) relève d'un écran de gestion des remises dédié / la fiche du gestionnaire négociateur (à spécifier séparément). La **fermeture** reste possible pour toute remise affichée (organisation comme gestionnaire).
- **Tarif refacturé client final ZD** *(visible uniquement si `type='traiteur'`)* : champ `organisations.tarif_refacture_pax_zd` (numeric, défaut 1.50 €). Sert au calcul du KPI Marge dashboard traiteur (cf. [[05 - Règles métier#R_marge_zd_traiteur]]).
- **Coefficient de perte labo** *(ajout 2026-05-22 — visible uniquement si `type='traiteur'`)* : sous-bloc de saisie du coefficient annuel communiqué par le traiteur. Table `coefficients_perte_labo` (cf. [[04 - Data Model#⚠ Addendum 2026-05-22 — Coefficient de perte labo (estimation déchets amont, gestionnaire-only)]]). Voir sous-section dédiée ci-dessous.

### Onglet Packs AG (sous-section dédiée — fusionnée 2026-05-07, étoffée 2026-05-08)

Reprise complète des fonctionnalités ex-§3 Anti-Gaspi > Packs **et ex-fichier 07 supprimé 2026-05-08**. Règles métier de référence : [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]]. Grille tarifaire publique : §9 Paramètres > Tarifs Anti-Gaspi (publics) ci-dessous.

#### Vue principale — Pack actif courant

Bloc principal de l'onglet :

- Type pack (badge : Unitaire / Pack 10 / Pack 30 / Pack 60 / Personnalisé)
- Crédits initiaux + crédits restants + barre de progression (% consommé)
- Date d'achat, date d'expiration (V1 toujours null)
- Mode de facturation (`globale_achat` / `par_collecte`)
- Lien vers facture d'achat (si `mode_facturation = globale_achat` et facture émise)
- Commentaires Admin (conditions négociées)

Si aucun pack actif : message "Aucun pack actif" + bouton "Créer un pack".

#### Historique des packs

Tableau antéchronologique sous le pack actif (tous statuts) :

| Pack | Crédits initiaux | Crédits consommés | Statut | Date achat | Date clôture | Actions |
|------|------------------|-------------------|--------|-----------|--------------|---------|
| Pack 30 | 30 | 30 | Épuisé | 12 fév 2026 | 02 mai 2026 | Voir collectes |
| Pack 10 | 10 | 0 | Annulé | 10 sep 2025 | 12 fév 2026 | Voir motif |

Statuts : `actif` / `epuise` / `annule` *(`expire` retiré V1 — revue sobriété 2026-05-30 D1 : aucun mécanisme d'expiration V1, date d'expiration toujours null ; réintroduit en V2 avec le mécanisme d'expiration)*. Filtres locaux : statut, période. Lien sur la ligne → détail pack (collectes débitées + audit_log).

#### Actions Admin

| Action | Rôle | Conditions | Effet |
|--------|------|-----------|-------|
| **Créer un nouveau pack** | `admin_savr` + `ops_savr` | Aucun pack `actif` existant pour l'organisation (sinon bloqué — l'Admin doit annuler l'actuel d'abord, cf. §05 §3 Pack unique actif) | Modal formulaire unique (cf. ci-dessous). À la création : INSERT `packs_antgaspi` avec `statut=actif`, `credits_consommes=0`. Si `mode_facturation=globale_achat` → brouillon de facture généré ([[08 - Génération et édition facture (Admin)]]). |
| **Ajuster crédits** | `admin_savr` + `ops_savr` *(ouvert ops 2026-06-07 F2 — alignement matrice §09 qui fait foi)* | Pack `actif` ou `epuise` | Modal : nouveau `credits_initiaux` + motif obligatoire (≥10 car). UPDATE + audit_log. Cas d'usage : **override exceptionnel** (correction d'erreur, geste commercial sortant du cadre, report manuel crédits restants ancien pack lors d'un renouvellement). Le recrédit standard suite à une annulation de collecte AG post-`realisee` est désormais **automatique** (trigger DB, refonte 2026-05-08 — voir [[05 - Règles métier#Annulation d'une collecte AG recrédit automatique]]) — ne pas utiliser cette action pour ce cas. |
| **Annuler le pack** | `admin_savr` + `ops_savr` *(ouvert ops 2026-06-07 F2 — alignement matrice §09 qui fait foi)* | Pack `actif` | Modal : motif obligatoire (≥10 car). UPDATE `statut=annule` + audit_log. Si `credits_consommes > 0` : warning UI "X collectes ont déjà été imputées sur ce pack. L'annulation ne régénère pas les crédits côté collectes (traçabilité conservée)." |
| **Voir collectes consommatrices** | `admin_savr` + `ops_savr` | Toujours | Redirige vers §3 Collectes filtré sur `pack_antgaspi_id = <id>` |

> **`credits_consommes` non éditable directement** : protection intégrité (incrément exclusivement via débit collecte réalisée). Pour ajuster un solde : passer par "Ajuster crédits" qui modifie `credits_initiaux` (préserve l'historique des collectes débitées).

#### Modal de création de pack — Formulaire unique

*(Revue sobriété 2026-05-30 B1 : wizard 4 étapes remplacé par un formulaire modal unique scrollable. Action rare → pas de parcours guidé. Tous les champs, validations et l'`Idempotency-Key` sont conservés.)*

Un seul écran, sections empilées :

- **Organisation** : autocomplete sur `organisations.nom`, filtré sur `type ∈ ('traiteur', 'agence', 'gestionnaire_lieux')` ET `est_shadow=false`. Validation inline : si l'organisation a déjà un pack `actif` → message bloquant "[Org] a déjà un pack actif (Pack X — N crédits restants). Annulez-le avant d'en créer un nouveau." (bouton « Créer le pack » désactivé tant que non résolu).
- **Type de pack** : sélecteur 5 options (4 standards + Personnalisé) :
  - Unitaire (1 crédit · 590 € HT) ← pré-rempli depuis `tarifs_packs_ag` ligne active
  - Pack 10 (10 crédits · 5 000 € HT) ← idem
  - Pack 30 (30 crédits · 13 800 € HT · Mensualisable 3 mois) ← idem
  - Pack 60 (60 crédits · 23 400 € HT · Mensualisable 6 mois) ← idem
  - **Personnalisé** : 2 champs (`credits_initiaux` integer NOT NULL, `prix_unitaire_ht` decimal NOT NULL) → `montant_total_ht` calculé en lecture seule.
  - Champ « Remise / surcharge » optionnel sur les 4 packs standards pour **surcharger `montant_total_ht`** (cas remise commerciale) — traçabilité dans `commentaires`.
- **Facturation** :
  - `mode_facturation` : `globale_achat` (1 facture immédiate) ou `par_collecte` (facture par collecte avec montant libre).
  - Si pack 30 ou 60 : checkbox "Mensualiser le paiement" (information uniquement, pas de logique automatique V1).
  - `commentaires` (textarea, optionnel) : conditions négociées, contexte commercial, motif report crédits si applicable.
- **Bouton "Créer le pack"** → récap dynamique (crédits, montant total, mode facturation) affiché au-dessus du bouton, puis POST `/api/v1/admin/packs-antgaspi` avec `Idempotency-Key`.

#### Bandeau "À relancer — Packs < 5 crédits restants"

Bandeau en haut de l'onglet **Packs AG** de la fiche organisation : alerte visuelle si le pack actif a moins de 5 crédits restants. Texte : "Pack [type] — N crédits restants. Dernier achat : [date]." Pas d'action automatisée V1 — l'Admin Savr contacte le client par ses canaux habituels (téléphone, email manuel, etc.). Pas de template email dédié V1.

**Vue agrégée cross-organisations** : §1 Dashboard Admin > Bloc 1 KPIs ne contient PAS de carte "Packs à relancer" V1 (le bandeau vit uniquement à la fiche). Volume estimé < 10 organisations concernées en permanence ; relance commerciale gérée par lecture séquentielle des fiches. À rouvrir V1.1 si besoin remonte.

#### Permissions

- Lecture (vue + historique) : `admin_savr` + `ops_savr`
- Création / Annulation / Ajustement crédits : voir tableau actions ci-dessus
- Toutes les actions sont tracées dans `audit_log` avec auteur, action, valeurs avant/après, motif.

### Onglet Coefficient de perte labo (sous-section dédiée — ajout 2026-05-22, traiteurs uniquement)

Saisie du coefficient annuel de perte labo communiqué par le traiteur. Sert à estimer les déchets produits en amont au laboratoire (`pax × coefficient`), affichés côté gestionnaire de lieux (cf. [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]] et [[05 - Règles métier#R_dechets_labo_estimes]]). Onglet visible uniquement si `organisations.type='traiteur'`.

#### Vue principale — coefficients par année

Tableau antéchronologique des coefficients saisis pour ce traiteur (1 ligne par année de référence) :

| Année de référence | Coefficient (kg/couvert) | Appliqué aux événements de | Source / commentaire | Saisi par | Saisi le | Actions |
|--------------------|--------------------------|----------------------------|----------------------|-----------|----------|---------|
| 2025 | 0,1500 | 2026 | Déclaratif traiteur, méthode interne | Val | 22 mai 2026 | Éditer |
| 2024 | 0,1720 | 2025 | — | Val | 10 jan 2025 | Éditer |

Colonne "Appliqué aux événements de" = `année de référence + 1` (calculée, non saisie, pour lever l'ambiguïté côté Admin).

Si aucun coefficient : message "Aucun coefficient communiqué" + bouton "Ajouter un coefficient".

#### Actions Admin

| Action | Rôle | Conditions | Effet |
|--------|------|-----------|-------|
| **Ajouter un coefficient** | `admin_savr` uniquement | Pas de coefficient existant pour l'année de référence choisie (contrainte `UNIQUE (organisation_id, annee_reference)`) | Modal : `annee_reference` (integer, 2020-2100), `coefficient_kg_couvert` (numeric ≥ 0, max 4 décimales), `source_commentaire` (text optionnel). INSERT `coefficients_perte_labo` + audit_log. |
| **Éditer un coefficient** | `admin_savr` uniquement | Ligne existante | Modal : correction de `coefficient_kg_couvert` + `source_commentaire`. UPDATE + audit_log (valeur avant/après). Pas de cascade UI — l'espace gestionnaire recalcule l'estimation à la prochaine ouverture (calcul live). |

> **`ops_savr`** : lecture seule sur cet onglet (cohérent avec les autres paramètres sensibles type `tarif_refacture_pax_zd`). Pas de hard delete d'un coefficient V1 (correction via Éditer).

#### Permissions

- Lecture : `admin_savr` + `ops_savr`.
- Écriture (ajout / édition) : `admin_savr` uniquement.
- Toutes les actions tracées dans `audit_log` (auteur, action, valeurs avant/après).

### Actions Admin / Ops

`admin_savr` + `ops_savr` (sauf mention) :

- Créer / modifier / suspendre un utilisateur
- Inviter un nouvel utilisateur (envoi email d'invitation) — **provisioning direct unique** *(décision Val 2026-07-01, M3.1 — self-service écarté)* : le compte est provisionné immédiatement (prénom + nom + email, rôle + organisation imposés, `organisation_id` posé côté serveur), l'invité reçoit un lien d'activation pour définir son mot de passe. Rattachement à l'organisation garanti à la création.
- Changer le rôle d'un utilisateur
- **Impersonner un utilisateur** (admin-only — bandeau UI + log, voir [[09 - Authentification et permissions]])
- Suppression compte soft delete (48h validation) — admin-only sur hard delete
- **Retiré V1 (tranché Val 2026-06-07 F6)** — la fusion d'organisations est une opération exceptionnelle traitée par **script SQL assisté** (admin/Supabase, hors UI). Bouton + ligne matrice §09 retirés; UI complète avec spec de fusion (users, événements, collectes, factures, packs, remises) = V1.1.
- Modifier le logo de l'organisation
- **Éditer `tarif_refacture_pax_zd`** (admin-only, traiteurs uniquement) : champ numérique €/pax. Validation : `>= 0`, max 2 décimales. Audit_log automatique. Pas de cascade UI — les dashboards traiteur recalculent à la prochaine ouverture (KPI live). Tooltip champ : "Tarif que ce traiteur refacture à son client final par couvert sur ses collectes ZD. Sert au calcul de sa marge affichée dans son dashboard."
- **Saisir / éditer le coefficient de perte labo** *(ajout 2026-05-22 — admin-only, traiteurs uniquement)* : via l'onglet Coefficient de perte labo de la fiche organisation (cf. sous-section dédiée ci-dessus). Saisie par année de référence, `coefficient_kg_couvert ≥ 0` (4 décimales max). Audit_log automatique. Pas de cascade UI — l'espace gestionnaire recalcule l'estimation à la prochaine ouverture.

---

## 9. Paramètres

*(Section non modifiée 2026-05-07 — sera revue dans la prochaine itération. Réception de l'auto-accept et des paramètres algo issus de l'ex-§3 Anti-Gaspi déjà documentée ci-dessous.)*

Section réservée à la configuration globale de la plateforme. **Toutes les sous-sections sont admin-only en écriture** (`ops_savr` lecture seule).

### Utilisateurs (users Savr)
- Liste des `admin_savr` + `ops_savr` + autres rôles internes
- Création / édition / suspension
- Gestion des permissions granulaires V2

### Tarifs ZD (publics)
- Grille des tranches de pax + prix
- Modification → nouvelle version (les tarifs actifs ne sont jamais modifiés rétroactivement)

### Tarifs Anti-Gaspi (publics) *(ajout 2026-05-08 — fusion ex-fichier 07)*

Grille tarifaire publique des packs Anti-Gaspi. Sert de référentiel au formulaire de création de pack (§8 Clients > onglet Packs AG > "Créer un pack"). Stockée dans la table versionnée [[04 - Data Model#Table tarifs_packs_ag|`tarifs_packs_ag`]].

**Vue principale** — tableau 4 lignes (1 par type de pack standard, le type `personnalise` n'a pas de tarif public) :

| Type | Crédits | Prix unitaire HT | Montant total HT | Mensualisable | Nb mensualités | Validité | Action |
|------|---------|-----------------|-----------------|--------------|----------------|---------|--------|
| Unitaire | 1 | 590,00 € | 590,00 € | Non | — | depuis 01/01/2026 | [Modifier] [Historique] |
| Pack 10 | 10 | 500,00 € | 5 000,00 € | Non | — | depuis 01/01/2026 | [Modifier] [Historique] |
| Pack 30 | 30 | 460,00 € | 13 800,00 € | Oui | 3 (4 600 €/mois) | depuis 01/01/2026 | [Modifier] [Historique] |
| Pack 60 | 60 | 390,00 € | 23 400,00 € | Oui | 6 (3 900 €/mois) | depuis 01/01/2026 | [Modifier] [Historique] |

**Modal "Modifier"** — édite la grille pour un type de pack donné :
- Champs : `credits` (integer NOT NULL ≥1), `prix_unitaire_ht` (decimal NOT NULL ≥0), `mensualisable` (bool), `nb_mensualites` (integer si mensualisable), `valide_du` (date de prise d'effet, ≥ aujourd'hui)
- Le `montant_total_ht` est calculé automatiquement (`credits × prix_unitaire_ht`) et affiché en lecture seule
- Bouton "Enregistrer" :
  1. Ferme la ligne actuelle (`valide_jusqu_au = valide_du - 1 jour`)
  2. Crée une nouvelle ligne avec les nouvelles valeurs
  3. Audit_log automatique
- **Pas de modification rétroactive** : les packs déjà créés (`packs_antgaspi`) conservent leur `montant_total_ht` figé à la création. La nouvelle grille s'applique uniquement aux packs créés à partir de `valide_du`.

**Modal "Historique"** :
- Liste antéchronologique des versions de la grille pour ce type
- Colonnes : Crédits · Prix unitaire HT · Montant total HT · Mensualisable · Validité · Modifié par · Date modif
- Lecture seule (immuable — sécurité audit)

**Permissions** :
- Lecture : `admin_savr` + `ops_savr`
- Écriture : `admin_savr` uniquement

**Note sur le type `personnalise`** : pas géré par cette grille. À la création d'un pack `personnalise` (§8 onglet Packs AG), l'Admin saisit librement `credits_initiaux` et `prix_unitaire_ht`. Les conditions négociées sont documentées dans `packs_antgaspi.commentaires`.

### Grilles tarifaires ZD — catalogue (`grilles_tarifaires_zd`) *(ajout 2026-05-26)*
- Tableau : nom + mode (`paliers` / `fixe_variable`) + grille par défaut (badge) + période de validité + nb d'organisations rattachées
- Création : formulaire modal — nom → mode → lignes de tranches. Selon le mode, l'écran adapte la saisie :
  - **paliers** : par tranche `[pax_min, pax_max]`, saisie d'un **montant fixe HT** (le champ « par pax » est masqué, forcé à 0)
  - **fixe_variable** : par tranche, saisie d'un **montant fixe HT** + d'un **montant par pax HT** (ex. 200 € + 1 €/pax) ; une seule tranche `[1, ∞]` par défaut, tranches multiples possibles
- Une seule grille `est_defaut` active à la fois (le catalogue garantit l'unicité). Affectation d'une grille à une organisation depuis la fiche org (onglet « Grille tarifaire ZD »).
- Modification → fermeture de la grille + création d'une nouvelle (entête + lignes). Jamais de modification rétroactive.

### Remises négociées (`tarifs_negocie`) *(refonte 2026-05-26 — ne porte plus que des remises %)*
- Tableau : activité (ZD/AG) + scope (organisation/gestionnaire) + bénéficiaire + lieu (si précis) + **remise %** + période de validité + commentaires
- Filtres : par activité, par scope, par organisation, actifs uniquement. **Dans le contexte de la fiche organisation, seul « Actives uniquement » est implémenté** (activité/scope/organisation sont contextuels — une seule org affichée).
- Création : formulaire modal. **Depuis la fiche organisation, le scope `organisation` est imposé** (org de la fiche, non saisie) → flux réduit à : choix activité → lieu optionnel → **remise % (0–100)** + dates + commentaires. Le choix de scope + la sélection d'un gestionnaire (`gestionnaire_organisation_id`) relèvent de l'écran de gestion des remises dédié (à spécifier). *(précision 2026-07-03)*
- Cumul : plusieurs remises éligibles à une même collecte se cumulent **multiplicativement** sur la base (grille ZD / tarif unitaire AG) — cf. [[05 - Règles métier#Tarifs et remises — résolution du prix]]
- Modification → fermeture de la ligne active + création nouvelle ligne (jamais de modification rétroactive)
- Suppression impossible si la ligne a déjà été utilisée dans une `factures_collectes` (données figées via `tarif_detail`)

### Paramètres algo AG *(ex-§3 Anti-Gaspi)*
- **Retiré (refonte 2026-05-09)** — plus de scoring association : filtres binaires d'éligibilité + tri unique distance Haversine. Aucune pondération paramétrable. Les seuls paramètres algo AG en V1 vivent dans `parametres_algo` (seuils IDF, zones Everest, etc.), pas de poids distance/capacité.
- Voir [[09 - Flux algo attribution AG (Admin)]] §7

### Auto-accept AG *(ex-§3 Anti-Gaspi)*
- Table de configuration des combinaisons (association × type_evenement)
- Voir [[09 - Flux algo attribution AG (Admin)]] §6

### Seuils alertes pesées
- Min/max par flux (5 flux V1 : biodéchets, emballages, carton, verre, déchet résiduel)
- Voir [[12 - Reporting et exports]]

### Taux de recyclage par filière *(ajout 2026-05-06)*

Sous-section dédiée à l'administration des **taux de captation par filière** utilisés pour le calcul du **Taux de recyclage** (cf. [[04 - Data Model]] §`parametres_taux_recyclage` + [[05 - Règles métier#R_taux_recyclage]] + [[08 - APIs et intégrations]] §9).

**Vue principale** — 4 cartes filières (1 par filière valorisable) :

| Filière | Taux de captation | Prestataire | Source | Dernière maj | Action |
|---------|-------------------|-------------|--------|--------------|--------|
| Verre | 96.00 % | Citeo | Citeo 2023 | 12 avr 2026 | [Modifier] [Historique] |
| Carton | 90.00 % | Citeo | Citeo 2023 | 12 avr 2026 | [Modifier] [Historique] |
| Biodéchets | 87.00 % | Veolia / A Toutes! | ADEME ITOM 2017 | 12 avr 2026 | [Modifier] [Historique] |
| Emballages | 77.00 % | Citeo | Citeo 2023 (centres de tri) | 12 avr 2026 | [Modifier] [Historique] |

**Modal "Modifier" (clic sur Modifier)** :
- Champ `taux_captation` (decimal 0-1, ex `0.92` ou affichage `92.00 %` selon UX choisie — input UI saisi en pourcentage avec 2 décimales, persistance decimal 0-1)
- Champ `prestataire` (texte libre)
- Champ `source_donnee` (texte libre)
- Champ `commentaire_modif` (textarea, **obligatoire**, ≥ 5 caractères — motif visible dans l'audit trail)
- Bouton "Enregistrer" → `PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}` avec `Idempotency-Key` (UUID v4 généré côté front)
- Bouton "Annuler" → ferme la modal sans sauvegarder

**Validation côté serveur** :
- `taux_captation` ∈ [0, 1] sinon erreur 422 "Le taux doit être compris entre 0 et 1"
- `commentaire_modif` ≥ 5 caractères sinon erreur 422
- Refus si rôle ≠ `admin_savr` (403)

**Effet de bord** :
- UPDATE `parametres_taux_recyclage` (taux + prestataire + source + `date_maj` + `updated_at`)
- INSERT automatique `parametres_taux_recyclage_history` via trigger DB (snapshot avant/après + `modifie_par` + commentaire)
- **Pas de recalcul rétroactif** des collectes existantes (PDF Rapport RSE déjà générés inchangés). Les nouveaux taux s'appliquent uniquement aux collectes clôturées **après** la modification.

**Modal "Historique" (clic sur Historique)** :
- Liste antéchronologique des modifications de cette filière (lecture `parametres_taux_recyclage_history`)
- Colonnes : Date · Modifié par · Taux avant · Taux après · Prestataire avant/après · Source avant/après · Commentaire
- Pas de pagination V1 (volumétrie minime : ≤10 modifs/an estimées)
- Pas de modification possible (immuable — sécurité audit réglementaire)

**Permissions** :
- Lecture (vue + modal historique) : `admin_savr` + `ops_savr`
- Écriture (modal Modifier) : `admin_savr` uniquement (Val + Louis)

**Pas de suppression V1** : la suppression d'une filière est interdite (intégrité historique des collectes). Pour désactiver une filière, bascule du flag `actif=false` (réservée à un cas exceptionnel — non exposée dans la modal V1, accessible uniquement via SQL direct).

### Facteurs CO₂ (ADEME) *(refonte 2026-06-04, Sujet 3)*

Trois écrans (cf. [[04 - Data Model]] addendum 2026-06-04 + [[08 - APIs et intégrations]] §9ter + [[09 - Authentification et permissions]]) :

1. **Facteurs par flux** (`parametres_facteurs_co2`, 5 flux) : table éditable — `fe_induit_kg_t`, `fe_evite_kg_t`, `energie_primaire_evitee_kwh_t`, source. Modal Modifier avec **commentaire obligatoire** (≥ 5 car.) → audit `parametres_facteurs_co2_history` (modal historique : avant/après, par qui, quand). La ligne **`emballage`** affiche ses FE induit/évité en **lecture seule** (dérivés du mix ci-dessous) ; seule l'énergie primaire y est éditable.
2. **Mix emballages** (`parametres_mix_emballages`, 7 matériaux) : édition de l'ensemble du mix en une fois (part_pct par matériau + FE matériau). **Contrôle live de la somme = 100 %** (blocage si ≠). À l'enregistrement, l'agrégat emballage est recalculé et affiché (`induit +540 / évité −1 188` par défaut). Historique `parametres_mix_emballages_history`.
3. **Paramètres divers** (`parametres_co2_divers`) : forfait collecte (km + FE camion) + équivalences pédagogiques (km voiture, repas bœuf, foyer kWh). Audit `audit_log`.

4. **Facteur CO₂ AG** (`parametres_facteurs_co2_ag`, ajout 2026-06-04 bis) : champ unique **kgCO₂e évité par repas donné** (défaut 2,5 — FAO) + source. Modal Modifier avec commentaire obligatoire → historique `parametres_facteurs_co2_ag_history`. Alimente le CO₂e des attestations de don + dashboard AG (cf. [[05 - Règles métier#R_co2_ag]]).

**Permissions** : lecture `admin_savr` + `ops_savr` ; écriture `admin_savr` uniquement. **Pas de recalcul rétroactif** des collectes déjà clôturées (snapshots figés, PDF/attestations inchangés). **Pas de suppression** (bascule `actif=false`).

### Templates emails
- Liste des 19 templates actifs V1 *(compteur corrigé 2026-06-07 — 3 templates tiers/admin ajoutés session test-scenarios §06.02 F2, cf. [[06 - Fonctionnalités détaillées/02 - Templates emails V1]] qui fait foi)*
- **V1 : consultation seule** (liste + sujet + variables + aperçu du corps). Édition du corps + variables + preview-avec-variables = **V1.1** (cf. [[06 - Fonctionnalités détaillées/02 - Templates emails V1]] qui fait foi). *(corrigé R18 2026-07-04 — le §9 contredisait §06.02 sur la portée V1)*
- Voir [[06 - Fonctionnalités détaillées/02 - Templates emails V1]]

### Référentiels
- Flux de déchets (codes européens)
- Types d'événements (`types_evenements`)
- Prestataires logistiques (Strike, Marathon, A Toutes!, transporteurs)
- Centres de valorisation / exutoires

### Intégrations externes
- Clés API Pennylane (stockage sécurisé vault)
- Config Everest (webhook secret)
- Config TMS Savr (URL, secret HMAC)
- Config Resend (API key, domaines d'envoi)
- Test de connectivité par intégration (bouton "Ping")

### Configuration générale
- Domaines email autorisés pour l'inscription auto-service
- Paramètres de sécurité (durée session JWT, durée refresh token)
- Paramètres RGPD (durée de rétention des données, anonymisation auto)

---

## Actions manuelles critiques V1 (récapitulatif)

> **Index non-normatif — revue sobriété 2026-05-30 C3** : cette liste est un simple rappel de navigation. Le comportement, les conditions et les permissions de chaque action sont définis **uniquement** dans la section source correspondante (ci-dessus). En cas de doute, la section source fait foi.

Ces actions sont indispensables en V1 car elles couvrent les cas d'exception fréquents (auteur loggé : `admin_savr` ou `ops_savr` selon permissions ci-dessus) :

1. **Modifier les informations d'une collecte** → §3
2. **Annuler le crédit d'une collecte AG** → §3 Bloc 6
3. **Modifier les pesées en dur** (ZD et AG) → §3
4. **Importer des photos manuellement** (hors TMS) → §3
5. **Importer un logo client organisateur ou organisation** → §3 / §8
6. **Régénérer un rapport RSE** → §3 Bloc 3 + [[12 - Reporting et exports]]
7. **Forcer un changement de statut de collecte** → §3
8. **Générer un avoir** (admin-only) → §4 + [[08 - Génération et édition facture (Admin)]]
9. *(purgé 2026-06-07 — résidu : pas de relance côté Savr V1, relances gérées dans Pennylane, décision 2026-04-28, cf. §4)*
10. **Normaliser un lieu** saisi manuellement → §7
11. **Impersonner un utilisateur** (admin-only) → §8 + [[09 - Authentification et permissions]]
12. **Renvoyer / Envoyer une collecte au TMS** → §3 Bloc 0
13. **Override prestataire AG** (admin-only) → §3 Bloc 0
14. **Annuler/Ajuster un pack AG** → §8 onglet Packs AG

Toutes ces actions sont loguées dans `audit_log`.

---

## Impact data model

### Champs ajoutés / modifiés (refonte 2026-05-08)

**Table `transporteurs`**

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `siren` | text | NOT NULL, ~ '^[0-9]{9}$' | *(ajout 2026-05-08, ex `numero_transporteur`)* SIREN INSEE 9 chiffres. Édition admin + ops *(F3 2026-06-07)*. |
| `adresse` | text | NOT NULL | *(ajout 2026-05-08)* Adresse postale du transporteur. |
| `code_postal` | text | NOT NULL | *(ajout 2026-05-08)* |
| `ville` | text | NOT NULL | *(ajout 2026-05-08)* |
| `latitude` | float | | *(ajout 2026-05-08)* Géocodage automatique (base calcul distance algo AG). |
| `longitude` | float | | *(ajout 2026-05-08)* |
| `contact_telephone` | text | NOT NULL | *(rendu obligatoire 2026-05-08)* Format E.164. Joignable jour J. |
| `types_vehicules` | text[] | NOT NULL | *(refonte 2026-05-08)* Multi-valeurs parmi `velo_cargo / camionnette / fourgon / vul / poids_lourd`. Hiérarchie alignée sur `lieux.type_vehicule_max`. |
| `type_tms` | enum | NOT NULL | *(ajout 2026-05-08)* `mts1` / `a_toutes` / `autre`. Détermine quel bouton apparaît au Bloc 0 §3 (Envoyer à MTS-1 / Envoyer à A Toutes! / Manuel email+téléphone). |
| `code_transporteur_mts1` | text | NULL | *(ajout 2026-05-29, propagation §3bis)* `carrierShareableCode` MTS-1. Requis si `type_tms = 'mts1'` ([[05 - Règles métier#R_code_mts1_requis]]). Déprécié V2. |

**Table `lieux`**

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `acces_office` | enum | NULL | *(refonte 2026-05-08)* `facile / difficile / tres_difficile`. Ex texte libre — migration via UI Admin V1.1 (en attendant : NULL par défaut + ressaisie manuelle Admin). |
| `stationnement` | enum | NULL | *(refonte 2026-05-08)* `facile / difficile / tres_difficile`. **Changement de nature** : ex enum 4 valeurs "type d'emplacement" → enum 3 valeurs "difficulté d'accès". Pas de migration depuis Bubble — nouveau référentiel à ressaisir. |
| `type_vehicule_max` | enum | NOT NULL | *(refonte 2026-05-08)* `velo_cargo / camionnette / fourgon / vul / poids_lourd`. Aligné sur `transporteurs.types_vehicules`. Migration manuelle Admin (ressaisie lieu par lieu post-migration). |
| `commentaire_lieu` | text | NULL | *(ajout 2026-05-08)* Commentaire interne Savr (note opérationnelle, contexte commercial). RLS column-level admin/ops only. |
| `siren` | text | NULL, ~ '^[0-9]{9}$' | *(ajout 2026-05-08)* SIREN propriétaire du lieu (peut différer du gestionnaire). RLS admin/ops only. |
| `email_gestionnaire` | text | NULL | *(ajout 2026-05-08)* Email référent gestionnaire. RLS admin/ops only. |
| `reference_citeo` | boolean | NOT NULL, défaut `false` | *(ajout 2026-05-08)* Lieu référencé Citeo (REP emballages). RLS admin/ops only. |

**Table `organisations`**

`logo_url` déjà existant en DB (utilisé pour rapports RSE) — exposé en UI fiche organisation §8 *(ajout 2026-05-08)* avec upload + preview.

---

### Champs ajoutés / modifiés (refonte 2026-05-07)

**Table `collectes`**

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `dirty_tms` | boolean | NOT NULL, défaut `false` | *(ajout 2026-05-07 — « émission S7 » → « émission dispatch » 2026-06-07 F5)* `true` si la collecte a subi une modification métier (date, heure, lieu, pax, flux, contrôle d'accès, contacts, info supplémentaire) **après** dernière émission dispatch et **avant** renvoi explicite. Reset à `false` à la prochaine émission dispatch. Sert au KPI dashboard "Collectes modifiées sans renvoi TMS". |
| `motif_override_prestataire` | text | NULL | *(ajout 2026-05-07)* Motif renseigné par Admin si le prestataire choisi pour une AG ≠ top 1 algo. Audit_log automatique. |

**Table `associations`**

| Champ | Type | Contrainte | Description |
|-------|------|-----------|-------------|
| `id_point_collecte_mts1` | text | NULL | *(ajout 2026-05-07, V1 only)* Identifiant point de collecte côté MTS-1, pré-fill V1 lors envoi MTS-1. Déprécié V2 (gardé pour audit). |
| `description_rapport_impact` | text | **NOT NULL, ≥ 30 caractères** | *(rendu obligatoire 2026-05-07)* Description publique de l'association, copiée dans rapport AG. |

**Table `evenements`**

Aucun nouveau champ — `volume_estime_repas` reste sur `collectes` (pas `evenements`), formule auto-calcul `round(0.10 × evenements.pax)` documentée [[05 - Règles métier#R_volume_estime_ag_calcule]].

### Triggers / fonctions

- **Trigger `set_collectes_dirty_tms`** sur UPDATE `collectes` : si `tms_reference IS NOT NULL` et au moins un champ propagé au TMS est modifié → `dirty_tms = true`. Reset par l'endpoint dispatch §08 §10.1 (réémission) ou par bouton "Renvoyer au TMS" depuis Bloc 0 *(« S7 » → « dispatch » 2026-06-07 F5)*.
- **Fonction `f_volume_estime_ag(evenement_id)`** SQL renvoie `round(0.10 × evenements.pax)`. Appelée à l'INSERT collecte AG pour fixer `collectes.volume_estime_repas`.

---

## Décisions prises

| Décision | Alternative écartée | Raison |
|----------|--------------------|--------|
| Page d'accueil = Dashboard Admin de pilotage | Atterrissage liste collectes | L'Admin a besoin de la vue d'ensemble avant d'attaquer les actions |
| Dashboard Client = onglet dédié avec sélecteur multi-org | Vue Admin unique cumulant tout | Permet à Savr de voir « ce que voient les clients » et restituer 100 % opérationnel via "Toutes les organisations" |
| KPIs Dashboard Admin = 5 cartes-actions exclusivement opérationnelles | KPIs métier mélangés (tonnage, etc.) | Vue opérationnelle pure → métier est dans Dashboard Client |
| Bloc Données opérationnelles supprimé du Dashboard Admin | Conservation sous forme abrégée | Doublon avec Dashboard Client (sélecteur "Toutes les organisations") |
| Section Revenus refondue (histogramme 12 mois + tableau orgs) | Conservation Top 10 + courbe | Tableau orgs ouvre le drill-down complet (toutes orgs, pas top 10) |
| Imputation revenus = organisation programmatrice | Imputation traiteur opérationnel | Cohérent avec règle V1 programmateur=facturé (memory) |
| Filtre dates revenus = `date_collecte` | `date_emission` | "Combien j'ai facturé pour les collectes réalisées dans la période" est la question business |
| Collectes en liste unique (ZD + AG) avec filtres | 2 onglets séparés ZD / AG | Cohérent avec usage Admin transversal |
| Vue détail collecte = superset §06.04 + 3 blocs Admin | Strict copy §06.04 | Admin a besoin de l'attribution AG, facturation détaillée et audit |
| Bloc Attribution Prestataire = info-only ZD + manuel override AG (option C) | Tout manuel ou tout auto | ZD = règle dispatch simple, AG = complexité algo + override Admin légitime |
| V1 fork : 2 boutons distincts MTS-1 / A Toutes! | 1 bouton générique | Workflows V1 distincts par TMS source |
| Anti-Gaspi supprimé en section dédiée | Conservation section | Distribution naturelle : AG attente → Collectes filtre, Packs → Clients fiche org, algo+auto-accept → Paramètres |
| Packs AG = onglet de la fiche organisation | Section dédiée navigation | Cohérent avec contexte client (1 organisation = 1 historique de packs) |
| `nom_interne_savr` Associations supprimé | Conservation 2 noms | Source de confusion + jamais utilisé en pratique |
| `description_rapport_impact` rendue obligatoire (≥ 30 car.) | Optionnel | Qualité rapport client AG |
| `id_point_collecte_mts1` ajouté V1 | Suppression | Pré-fill obligatoire pour bouton "Envoyer à MTS-1" V1 |
| Simulateur d'attribution AG → V2 | V1 | Faible ROI V1, complexité spec et UX |
| Flux ZD = 5 par défaut auto, plus saisi traiteur | Saisie au formulaire | 5 flux V1 verrouillés (memory `project_enum_flux_5_valeurs_2026_05_02`) |
| Volume AG = calculé backend (0.10 × pax), invisible traiteur | Saisi par traiteur | Le traiteur ne sait pas estimer, formule simple suffit pour l'algo |
| Ouverture profil `ops_savr` au back-office | Reste admin-only | Délégation opérationnelle nécessaire pour absorber la charge ops |
| `ops_savr` ne peut pas écrire en §9 Paramètres | Permissions identiques admin | Risque d'erreur sur données structurelles (tarifs, algo, intégrations) |
| Permission impersonation, fusion org, hard delete = admin-only | Ouverte ops_savr | Actions sensibles (impact RGPD, intégrité données) |
| Édition `tarif_refacture_pax_zd` = admin-only | Ops_savr | Impacte directement la marge affichée traiteur, doit rester contrôlée |
| **§6 Transporteurs : pas de filtre IDF/Province** *(2026-05-08)* | Filtre par défaut province | Tout en vrac, l'Admin a besoin de la vue d'ensemble (Strike + Marathon + A Toutes! + province dans la même liste) |
| **§6 SIREN à la place de "Numéro du transporteur"** *(2026-05-08)* | Conservation libellé générique | Validation INSEE 9 chiffres, source unique d'identification légale |
| **§6 Type véhicule = multi text[] avec `velo_cargo`** *(2026-05-08)* | Enum simple | Un transporteur peut avoir plusieurs véhicules dans son parc (réalité opérationnelle). Vélo cargo ajouté pour A Toutes!. |
| **§6 type_tms = unique champ `mts1/a_toutes/autre`** *(2026-05-08)* | Conservation 3 champs (process + détail + type_tms) | Un transporteur a UN seul mode de communication (TMS source ou manuel). Détermine le bouton Bloc 0 §3. |
| **§6 Suppression `regions_couvertes` + `villes_couvertes` + `capacite_max_kg`** *(2026-05-08)* | Conservation | Redondant avec géocodage adresse + rayon 50 km algo + types_vehicules |
| **§7 Adresse accès → "Adresse accès livraison"** *(2026-05-08)* | Conservation libellé court | Cohérence sémantique (chauffeur livreur), pas de changement DB |
| **§7 Stationnement = enum facile/difficile/très difficile** *(2026-05-08, changement nature)* | Conservation enum 4 valeurs "type d'emplacement" | Difficulté d'accès = critère discriminant pour algo + chauffeur. Pas de migration Bubble (ressaisie). |
| **§7 Accès office = enum** *(2026-05-08, ex texte libre)* | Texte libre | Normalisation pour reporting + filtrage. Migration via UI Admin V1.1 (texte libre actuel non automatisable). |
| **§7 type_vehicule_max enum aligné transporteurs** *(2026-05-08)* | Enum spécifique lieu (`vl/camion_16m3/...`) | Cohérence cross-table indispensable pour la règle de compatibilité algo. Hiérarchie unique. |
| **§7 4 nouveaux champs admin/ops only (commentaire, SIREN, email gestionnaire, Référencé Citeo)** *(2026-05-08)* | Champs ouverts à tous | Données internes Savr (commercial, SIREN propriétaire, REP) — RLS column-level. |
| **§7 SIREN lieu distinct du SIREN organisation gestionnaire** *(2026-05-08)* | Auto-fill depuis gestionnaire | Le lieu peut être propriété d'une entité juridique différente (filiale, lieu indépendant géré par un tiers). |
| **§8 Vue liste split nb collectes ZD / AG** *(2026-05-08)* | Colonne unique cumul | Permet d'identifier le profil d'usage (orienté ZD, AG ou mix) sans drill-down. |
| **§8 Logo organisation fiche** *(2026-05-08)* | Logo invisible (DB only) | Édition admin/ops directe sans passer par les rapports RSE. |

---

## Questions ouvertes

- **Liste définitive des champs non bloquants à la programmation** : confirmée 2026-05-07 (contacts, instructions, logo + flux/volume retirés du périmètre saisie traiteur).
- **Relance auto J-2 pour infos manquantes** : V1.1.
- **Rattachement transporteur province** : rayon 50 km par défaut — à confirmer post-pilote.
- **Fermée 2026-06-07 (F6, tranché Val)** : bouton retiré V1, fusion = script SQL assisté hors UI. Spec UI complète → V1.1.
- **Relance facture en retard** : template unique V1, séquence (J+7, J+15, J+30) à V2.
- **Permissions granulaires `ops_savr`** : la matrice ci-dessus est V1, V2 envisage permissions par module avec checkbox configurable par admin (cf. [[09 - Authentification et permissions]]).

---

## Liens

- [[09 - Flux algo attribution AG (Admin)]]
- [[05 - Règles métier#3. Packs Anti-Gaspi — Décrémentation et blocage]] (règles métier packs AG)
- [[08 - Génération et édition facture (Admin)]]
- [[06 - Fonctionnalités détaillées/04 - Espace client traiteur]] (vue détail collecte mutualisée)
- [[06 - Fonctionnalités détaillées/05 - Espace client gestionnaire de lieux]] (Dashboard Client)
- [[11 - Dashboards]]
- [[12 - Reporting et exports]]
- [[04 - Data Model]] — tables `collectes`, `organisations`, `associations`, `transporteurs`, `lieux`, `rapports_rse`
- [[05 - Règles métier]]
- [[08 - APIs et intégrations]]
- [[09 - Authentification et permissions]]
