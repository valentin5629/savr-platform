# 02 - Personas et cas d'usage


---

## Résumé

6 profils utilisateurs distincts. Chaque profil a une logique RLS (Row Level Security) différente dans Supabase. Val représente l'ensemble des profils pour les décisions.

---

## Les 6 profils

| # | Profil | Logique d'accès | Peut programmer | Voit les finances |
|---|--------|----------------|----------------|------------------|
| 1 | Traiteur - Commercial | Tous les événements du traiteur (= Manager, sauf gestion des utilisateurs) | Oui | Toutes les factures du traiteur |
| 2 | Traiteur - Manager | Tous les événements du traiteur | Oui | Toutes les factures du traiteur |
| 3 | Gestionnaire de lieux | Toutes les collectes sur ses lieux (tous traiteurs) | Oui (ses propres lieux) | Factures de ses propres programmations |
| 4 | Agence | Les collectes qu'elle a programmées (multi-traiteurs/multi-lieux) | Oui | Factures à son nom |
| 5 | Admin Savr | Tout | Oui | Tout |
| 6 | Client Organisateur | Événements rattachés à son organisation (lecture seule) | Non | Non |

---

## Profil 1 — Traiteur - Commercial

### Qui c'est
Commercial chez un traiteur (ex: chargé de projet événementiel chez Kaspia, Butard, etc.). Il organise les événements et programme les collectes côté Savr.

### Accès aux données
- **Lecture** : voit TOUTES les collectes/factures de son traiteur, tous commerciaux confondus (identique au Manager, décision 2026-05-29)
- **Écriture** : ne peut modifier/supprimer que les collectes qu'il a lui-même créées (révision 2026-05-29)
- Prédicats RLS techniques : voir [[09 - Authentification et permissions]] (source de vérité)

### Ce qu'il peut faire
- **Voir tout le traiteur** : consulter l'ensemble des collectes, factures, dashboard analytique, benchmarks et rapports agrégés du traiteur (lecture = Manager)
- Programmer de nouvelles collectes (ZD et/ou AG)
- Modifier / supprimer **uniquement les collectes qu'il a créées** (dans les limites de statut habituelles)
- Accéder à ses rapports RSE et aux rapports agrégés du traiteur, les télécharger

### Ce qu'il NE peut pas faire
- **Modifier ou supprimer les collectes créées par un autre commercial** (lecture seule sur celles-ci) — réservé au créateur ou au Manager
- **Gérer les utilisateurs de son organisation** (inviter/désactiver un compte) — réservé au Manager
- Modifier une collecte déjà validée / en cours / réalisée (même limite de statut que le Manager)
- Voir les données d'autres traiteurs
- Modifier la tarification ou le référentiel lieux/contacts (Admin Savr uniquement)
- **Voir le prestataire logistique assigné** : les prestataires opèrent sous la marque Savr, le commercial ne voit que "Savr" comme transporteur dans l'interface et les emails

### Cas d'usage critiques
1. **Programmer une collecte** : saisit les infos événement (lieu, date, heure, pax estimés, type de prestation) → l'app pré-remplit les données connues du lieu (accès, contact, contraintes) + autocomplete des contacts sur le référentiel traiteur → il valide → ordre envoyé à Savr ops
2. **Consulter un rapport RSE** : accède à l'historique → télécharge le PDF de son événement → peut régénérer si besoin
3. **Suivre ses collectes du mois** : vue calendrier ou liste des événements à venir / passés avec statut
4. **Accès coordonnées chauffeur/plaque** : visibles depuis la fiche collecte de son espace client (section logistique) une fois la tournée créée et la plaque saisie côté TMS. Pas de notification automatique T+3h en V1.

### Décisions prises
- **Commercial : lecture = Manager, écriture = ses créations (2026-05-29)** : RLS **lecture** alignée sur `organisation_id` (voit tout le traiteur, dashboards inclus) ; RLS **écriture** maintenue sur `created_by_user_id` (modifie/supprime uniquement ses propres collectes). Seule autre restriction vs Manager : pas de gestion des utilisateurs. Revient sur l'isolement strict V1 en lecture (Q1, voir Questions ouvertes). Propagation : [[09 - Authentification et permissions]] (RLS lecture/écriture distinctes) + [[11 - Dashboards]] (dashboard analytique + benchmarks ouverts au commercial)
- Branding Savr en frontal : aucun prestataire logistique n'est exposé au commercial
- Contacts pré-remplis via référentiel traiteur (voir [[04 - Data Model]])

---

## Profil 2 — Traiteur - Manager

### Qui c'est
Directeur commercial ou responsable RSE/DD chez un traiteur. Ne programme pas nécessairement, mais analyse, valide, et rend compte à ses clients finaux.

### Accès aux données
- **Accès** : voit TOUTES les collectes de son traiteur, tous commerciaux confondus. Prédicats RLS : voir [[09 - Authentification et permissions]]

### Ce qu'il peut faire
- Tout ce que fait le Commercial (programmer, modifier, consulter)
- Voir et télécharger l'ensemble des collectes et factures du traiteur (tous commerciaux)
- Accéder au dashboard analytique du traiteur (volumes, tonnes détournées, évolution, benchmarks)
- Générer des rapports RSE agrégés sur une période (ex: bilan annuel)
- Gérer les utilisateurs de son organisation (inviter un commercial, désactiver un compte)

### Ce qu'il NE peut pas faire
- Voir les données d'autres traiteurs
- Modifier la tarification (Admin Savr uniquement)
- Accéder aux données de coûts internes de Savr

### Cas d'usage critiques
1. **Bilan RSE trimestriel** : filtre par période → génère un rapport consolidé (tonnes par flux, nb événements, comparatif N-1) → télécharge en PDF ou partage le lien
2. **Benchmark** : compare ses performances à la moyenne anonymisée des traiteurs similaires (type d'événement, taille, etc.)
3. **Suivi facturation** : voit toutes les factures Savr → rapproche avec son service comptable
4. **Onboarding nouveau commercial** : invite un email → le commercial crée son compte. Il accède en lecture à tout le traiteur (comme le Manager) mais ne peut modifier que ses propres collectes et n'a pas la gestion des utilisateurs (révision 2026-05-29)
5. **Modification / suppression collectes commerciaux** : peut intervenir sur les collectes créées par ses commerciaux (mêmes règles que sur ses propres collectes, statuts permis)

### Décisions prises
- **Le Manager peut modifier et supprimer** les collectes créées par ses commerciaux (dans les limites du statut : pas de modification si collecte déjà réalisée ou clôturée)
- **Pas de niveau intermédiaire** en V1 : Manager = accès total traiteur. Un éventuel rôle "manager régional" sera traité en V2 si besoin réel

---

## Profil 3 — Gestionnaire de lieux

### Qui c'est
Responsable RSE ou facility manager chez un opérateur de lieux (Viparis, Sodexo Live, etc.). Veut mesurer la performance environnementale de ses sites, quel que soit le traiteur qui y opère.

### Accès aux données
- **Accès** : voit toutes les collectes réalisées sur ses lieux (attribués par Admin Savr), tous traiteurs confondus. Prédicats RLS : voir [[09 - Authentification et permissions]]
- Attribution configurée manuellement par Admin Savr (ex: profil Viparis → accès à 15 lieux Viparis)

### Ce qu'il peut faire
- Consulter l'historique complet des **événements** sur ses lieux (tous traiteurs) — le détail des collectes (pesées par flux, repas, bordereaux, attestations) est accessible dans le détail événement (refonte 2026-05-03 : la page Collectes a été supprimée, fusion dans Événements)
- Voir les volumes agrégés par lieu, par flux, par période via le Dashboard (onglets ZD/AG, blocs jauges kg/pax × benchmark parc)
- Comparer les performances entre ses différents lieux et au parc Savr (barre filtre benchmark dédiée 5 dimensions sur le Bloc 3 ZD)
- Télécharger des rapports RSE par lieu ou agrégés (PDF) + export CSV niveau événement sur la liste Événements
- **Programmer des collectes sur ses propres lieux** *(extension 2026-05-07)* : avec un traiteur du référentiel Savr (pas de fiche shadow autorisée). Workflow §06.01 cas Gestionnaire. Use case : gestionnaire qui pilote la RSE événementielle directement (vs uniquement via le traiteur).
- **Recevoir des factures Savr en direct** *(extension 2026-05-07)* : pour les collectes qu'il a programmées (règle programmateur=facturé V1).
- **Acheter et consommer un pack AG** *(extension 2026-05-07)* : pack négocié avec Savr, décompté sur les collectes AG programmées par le gestionnaire.

### Ce qu'il NE peut pas faire
- Programmer sur des lieux qui ne lui appartiennent pas (périmètre fermé via `organisations_lieux`)
- Programmer avec un traiteur hors référentiel Savr (réservé agences via fiche shadow)
- Voir les données financières des collectes programmées **par un traiteur** sur ses lieux (ni les tarifs Savr, ni les factures inter-traiteurs)
- Voir les données individuelles d'un traiteur de façon identifiée (anonymisation ou agrégation selon le volume → à décider)
- Modifier les collectes programmées par un traiteur sur ses lieux (lecture seule sur celles-ci ; modification possible uniquement sur ses propres programmations)

### Cas d'usage critiques
1. **Reporting mensuel site** : sélectionne un lieu + une période → voit les tonnes collectées par flux → compare avec le mois précédent
2. **Vue multi-sites** : tableau de bord avec ses 15 lieux, classés par performance (taux de recyclage *(ZD uniquement, formule à captation par filière)*, volume, tendance)
3. **Rapport annuel** : génère un PDF consolidé pour son reporting RSE interne ou réglementaire
4. **Invitation collègues** : invite de manière illimitée d'autres utilisateurs de son organisation (ex: équipe RSE Viparis, équipe opérationnelle par site)

### Décisions prises
- **Données identifiées par traiteur** (non anonymisées) — déjà acté (Option B, voir plus haut)
- **Accès aux collectes antérieures** : par défaut le gestionnaire voit l'historique complet de ses lieux. L'Admin Savr peut limiter la profondeur d'accès (ex: 12 mois glissants) sur demande d'un traiteur via paramètre orga
- **Invitations illimitées** : le gestionnaire peut inviter autant d'utilisateurs qu'il souhaite au sein de son organisation (pas de quota V1)
- **Extension transactionnelle V1 (2026-05-07)** : programmation + facturation directe + pack AG sur ses propres lieux. Périmètre fermé (lieux propres + référentiel traiteurs). Pas de nouveau rôle (extension du rôle `gestionnaire_lieux` existant).
- **Pas de fiche shadow gestionnaire (2026-05-07)** : si le gestionnaire veut travailler avec un traiteur hors référentiel, il demande à l'Admin Savr de l'embarquer via le workflow standard.

---

## Profil 4 — Agence

### Qui c'est
Agence événementielle qui organise des événements pour le compte de ses clients, avec plusieurs traiteurs différents selon les événements. Elle programme les collectes Savr pour le compte de ses clients.

### Accès aux données
- **Accès** : voit uniquement les collectes que son organisation a programmées, quel que soit le traiteur ou le lieu. Prédicats RLS : voir [[09 - Authentification et permissions]]

### Ce qu'il peut faire
- Programmer des collectes pour différents traiteurs sur différents lieux
- Choisir le traiteur dans une **liste déroulante** alimentée par le référentiel des traiteurs connus Savr
- **Ajouter manuellement un traiteur** si absent du référentiel (création d'une fiche traiteur "non référencée" à valider par Admin Savr)
- Consulter l'historique de toutes les collectes qu'elle a programmées
- Télécharger les rapports RSE des événements qu'elle a gérés
- Recevoir les factures Savr à son nom (voir Décision Facturation Agence plus haut)

### Ce qu'il NE peut pas faire
- Voir les collectes des traiteurs qu'elle a mandaté en dehors de ses propres programmations
- Voir l'historique global d'un traiteur (ex: ne voit pas les autres événements Kaspia programmés par d'autres organisations)
- Voir les données financières du traiteur (tarifs négociés, factures d'autres agences, etc.)

### Cas d'usage critiques
1. **Programmer une collecte multi-traiteurs** : pour un événement complexe avec 3 traiteurs → crée 3 collectes distinctes liées au même événement
2. **Reporting RSE client** : génère un rapport regroupant toutes les collectes d'un même client organisateur sur l'année
3. **Ajout traiteur hors référentiel** : renseigne manuellement les infos d'un traiteur inconnu → la collecte est créée → Admin Savr reçoit une notification pour valider/normaliser la fiche traiteur

### Décisions prises
- **Facturation à son nom** (Option B actée) : Savr facture l'agence. L'agence refacture son client selon ses propres conditions
- **Périmètre data strict** : l'agence voit uniquement ses propres collectes. Si un traiteur accède aussi à la collecte (via sa propre fiche commercial), la facture reste adressée à l'agence
- **Liste déroulante traiteurs + ajout manuel** : combo search dans le référentiel Savr avec fallback saisie libre si inconnu (workflow shadow §06.01 cas Agence)
- **Conflit de modification agence/traiteur** : l'agence est propriétaire de la collecte (créatrice). Le traiteur rattaché peut consulter en lecture seule depuis son espace, mais ne peut pas modifier ni supprimer. Si besoin d'intervention, passage par un admin ou édition directe par l'agence
- **Notification info-only au traiteur opérationnel (2026-05-07)** : le traiteur reçoit un email récap quand une collecte est programmée chez lui par l'agence, pas de validation requise. Droit de retrait conservé via workflow annulation existant. Cf. §05 §9.
- **Branding agence prioritaire sur PDF rapport RSE (2026-05-07)** : logo agence en couverture, pas celui du traiteur. L'agence partage le rapport avec son client final.
- **Extension Pack AG (2026-05-07)** : l'agence peut acheter un pack AG, décompté sur ses propres collectes programmées (pas sur les packs des traiteurs opérationnels).

---

## Profil 5 — Admin Savr

### Qui c'est
Val (et potentiellement Louis à terme). Accès complet à toutes les fonctions de la plateforme.

### Accès aux données
- **Règle RLS** : aucun filtre → voit tout

### Ce qu'il peut faire
- Tout ce que font les autres profils
- Valider / modifier / annuler toute collecte
- Valider les recommandations de l'algorithme Anti-Gaspi (ou activer l'auto-accept)
- Gérer le référentiel : lieux, prestataires, associations, transporteurs
- Configurer les accès : attribuer des lieux à un gestionnaire, des traiteurs à une agence
- Piloter les revenus et coûts (dashboard finance)
- Gérer la tarification et les packs clients
- Superviser les intégrations API (Pennylane, Everest/A Toutes!, TMS Savr)
- Gérer les utilisateurs de toutes les organisations

### Cas d'usage critiques (spécifiques Admin)
1. **Validation algo Anti-Gaspi** : reçoit une notification → voit la recommandation (assoc + transporteur + score de confiance) → valide ou modifie → email automatique envoyé
2. **Onboarding nouveau client traiteur** : crée l'organisation → invite le Manager → configure la tarification
3. **Pilotage financier** : dashboard revenus (factures Savr émises, packs consommés, impayés) vs. coûts (logistique Strike, Veolia, Marathon, A Toutes!)
4. **Configuration d'un profil gestionnaire de lieux** : crée le compte Viparis → attribue manuellement les 15 lieux → définit les droits
5. **Impersonation** : se "met dans la peau" d'un utilisateur (commercial, manager, gestionnaire, agence, client organisateur) pour voir exactement ce que lui voit. Utile pour le support, la QA et la résolution d'incidents. Action loguée dans `audit_log` avec `impersonated_by` + `impersonated_user_id` + horodatage
6. **Dashboard global style gestionnaire** : vue transverse multi-clients style "gestionnaire de lieux" sur tout le parc Savr (tonnage par lieu, par traiteur, par flux, CO₂e, taux de recyclage *(ZD uniquement)*), filtrable par période et entité

### Décisions prises
- **Impersonation** : fonctionnalité V1 réservée aux `admin_savr`, log obligatoire
- **Dashboard global gestionnaire** : vue additionnelle du dashboard Admin, structure similaire au dashboard `gestionnaire_lieux` mais sur tout le parc Savr

---

## Profil 6 — Client Organisateur

**Nom du profil** : **Client Organisateur** — slug technique `client_organisateur`. Décision 2026-04-28.

### Qui c'est
Le client organisateur qui mandate un traiteur et/ou une agence et paie la prestation événementielle. En V1, il vient sur Savr pour **visualiser l'historique des collectes de ses événements** sans pouvoir agir dessus.

### Accès aux données
- **Accès** : voit tous les événements rattachés à son organisation (via `evenements.client_organisateur_organisation_id`), potentiellement répartis sur plusieurs lieux et plusieurs traiteurs. Prédicats RLS : voir [[09 - Authentification et permissions]]
- Rattachement d'un événement à un client organisateur : effectué par le programmeur (commercial traiteur, manager traiteur ou agence) lors de la création de la collecte (champ optionnel → obligatoire pour que le client organisateur ait accès à la donnée)

### Ce qu'il peut faire
- Consulter la liste et l'historique des événements rattachés à son organisation
- Visualiser les rapports RSE de ses événements (CO₂e évité, tonnes détournées, taux de recyclage *(ZD uniquement, formule à captation par filière)*)
- Télécharger les rapports PDF
- Consulter les KPIs agrégés sur l'ensemble de son parc événementiel (multi-lieux / multi-traiteurs)

### Ce qu'il NE peut pas faire
- Programmer ou modifier une collecte
- Voir les tarifs ni les factures (relation contractuelle Savr ↔ traiteur/agence, pas Savr ↔ client organisateur en V1)
- Voir les contacts logistiques (prestataire, chauffeur, plaque)
- Voir les données d'autres clients finaux

### Cas d'usage critiques
1. **Visualisation historique** : un directeur achats / RSE d'un grand groupe (ex: LVMH, L'Oréal, Kering) consulte l'ensemble des collectes réalisées dans le cadre de ses événements, quel que soit le traiteur ou l'agence mandatés
2. **Reporting multi-prestataires** : consolide les volumes détournés sur une année, tous prestataires confondus
3. **Partage en interne** : télécharge des rapports PDF à inclure dans son reporting RSE corporate

### Décisions prises
- **Lecture seule** en V1, pas de programmation ni de modification
- **Multi-lieux / multi-traiteurs** : un même client organisateur peut être rattaché à plusieurs événements organisés par des traiteurs ou agences différents sur des lieux différents
- **Rattachement au moment de la programmation** : le champ `evenements.client_organisateur_organisation_id` est renseigné au moment de la création de la collecte (liste déroulante référentiel clients finaux + ajout manuel)
- **Pas de facturation V1** : aucun lien financier direct client organisateur ↔ Savr en V1 (à réévaluer en V2 si modèle B2B2C ou abonnement direct)

---

## Matrice des permissions synthétique

> Vue d'orientation — **non normative**. Source de vérité des permissions et prédicats RLS : [[09 - Authentification et permissions]].

| Action | Commercial | Manager | Gestionnaire | Agence | Client Organisateur | Admin |
|--------|-----------|---------|--------------|--------|--------------|-------|
| Programmer collecte | ✅ | ✅ (tout le traiteur) | ✅ (ses propres lieux) | ✅ (ses mandats) | ❌ | ✅ |
| Modifier collecte future | ✅ (ses créations only) | ✅ (tout le traiteur) | ✅ (ses propres programmations) | ✅ (ses mandats) | ❌ | ✅ |
| Voir historique collectes | ✅ (tout le traiteur) | ✅ (tout le traiteur) | ✅ (ses lieux) | ✅ (ses mandats) | ✅ (ses événements rattachés) | ✅ |
| Rapports RSE | ✅ (tout le traiteur) | ✅ (tout le traiteur) | ✅ (ses lieux) | ✅ (ses mandats) | ✅ (ses événements rattachés) | ✅ |
| Facturation | ✅ (lecture tout le traiteur) | ✅ (tout le traiteur) | ✅ (ses propres programmations) | ✅ (à son nom) | ❌ | ✅ |
| Dashboard analytique | ✅ | ✅ | ✅ | Partiel | ✅ (lecture seule) | ✅ |
| Benchmarks | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Gérer utilisateurs org | ❌ | ✅ (son org) | ✅ (illimité son org) | ✅ (son org) | ✅ (son org) | ✅ (tout) |
| Validation algo Anti-Gaspi | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Pilotage financier Savr | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Configuration référentiel | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Impersonation | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Décisions prises

- **6 profils distincts** : Commercial traiteur, Manager traiteur, Gestionnaire de lieux, Agence, Client Organisateur, Admin Savr. Chacun a une logique RLS différente
- **Traiteur-Commercial (révisé 2026-05-29)** : **lecture** identique au Manager (RLS `organisation_id`, voit tout le traiteur + dashboards/benchmarks) ; **écriture** limitée à ses propres créations (RLS `created_by_user_id`) ; pas de gestion des utilisateurs. Pas de prestataire logistique exposé (branding Savr)
- **Traiteur-Manager** : voit tout le traiteur, peut programmer, modifier et supprimer les collectes (y compris celles de ses commerciaux)
- **Gestionnaire de lieux** : données identifiées par traiteur (Option B), invitations illimitées dans son org, historique complet accessible (limitation possible par Admin sur demande)
- **Agence** : périmètre strict à ses propres programmations, facturation à son nom, liste déroulante traiteurs + ajout manuel
- **Client Organisateur** : lecture seule, rattachement aux événements via champ `client_organisateur_organisation_id` saisi à la programmation
- **Admin Savr** : profil unique, accès complet + impersonation + dashboard global style gestionnaire
- **Attribution gestionnaire de lieux** : configurée manuellement par Admin Savr

### Décision — Facturation Agence : facturée directement par Savr (Option B)

**Décision** : Savr facture l'agence directement. L'agence refacture son client traiteur selon ses propres conditions.

**Implication data model critique** : `client_facturation_id` peut pointer vers n'importe quel type d'organisation (traiteur OU agence). La table `organisations` est générique avec un champ `type`. La facturation pointe toujours vers une `organisation`, jamais exclusivement vers un `traiteur`. → [[04 - Data Model]]

### Décision — Gestionnaire de lieux : traiteurs identifiés (non anonymisés) (Option B)

**Décision** : le gestionnaire voit les données identifiées par traiteur. Ex: Viparis voit "Kaspia : 2T biodéchets, Palais des Congrès, mars 2026".

**Implication business** : Viparis peut comparer les traiteurs entre eux. À gérer contractuellement avec les traiteurs (clause CGV Savr sur partage de données avec gestionnaires de lieux).

**Implication data model** : pas de couche d'anonymisation en V1. Les vues Gestionnaire de lieux affichent `organisation.nom` sans masquage.

## Questions ouvertes

_Aucune — module stabilisé pour V1. (2026-04-28)_

## Liens

- [[00 - Index]]
- [[01 - Vision et objectifs]]
- [[09 - Authentification et permissions]] (RLS détaillé par profil)
- [[04 - Data Model]] (champs `created_by_user_id`, `organisation_id`, `lieu_id`, `programmed_by_org_id`)
- [[11 - Dashboards]] (vues par profil)
