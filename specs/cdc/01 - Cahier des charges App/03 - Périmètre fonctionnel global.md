# 03 - Périmètre fonctionnel global


---

## Résumé

Liste macro des modules de la **Plateforme Savr** uniquement (le TMS Savr a son propre CDC). Chaque module est priorisé : MVP (indispensable au lancement), V2 (après stabilisation), V3 (vision long terme). Ce fichier sert de table des matières fonctionnelle — chaque module est détaillé dans [[06 - Fonctionnalités détaillées]].

---

## Modules de la Plateforme Savr

### Module 1 — Gestion des événements et collectes `MVP`

Le cœur opérationnel de la plateforme. Couvre la programmation, le suivi et la clôture de chaque collecte.

- Formulaire de programmation collecte (zéro-déchet et/ou anti-gaspi)
- Pré-remplissage automatique des champs lieu (adresse, accès, contacts, contraintes) à partir du référentiel
- Statuts de collecte : programmée → validée → en cours → réalisée → clôturée
- Gestion des modifications et annulations (avant/après validation)
- Vue calendrier et vue liste des événements (par profil utilisateur)
- Historique complet et consultable
- Gestion des imprévus : retard, annulation last minute, collecte manquée
- Filtres avancés : par lieu, traiteur, période, flux, statut, prestataire

**Interfaces concernées** : tous les profils
**Dépendances** : [[08 - APIs et intégrations]] (TMS Savr pour envoi ordres), référentiel lieux

---

### Module 2 — Référentiel `MVP`

Base de données propriétaire Savr des entités permanentes. Condition de la qualité des données en aval.

- **Lieux** : nom, adresse, accès (badge, interphone, code, contact), contraintes (horaires, flux autorisés, volumes max, parking véhicule Savr), photos, historique des collectes
- **Traiteurs** : nom, contacts, tarification applicable, packs actifs, commerciaux associés
- **Prestataires logistiques** : Strike (déchets), Marathon (alimentaire nuit), A Toutes! (alimentaire journée IDF)
- **Associations Anti-Gaspi** : nom, localisation, capacité max (nb bénéficiaires), horaires d'ouverture, types d'aliments acceptés, zone géographique couverte, contact, date de dernière vérification
- **Transporteurs Anti-Gaspi** : nom, zones couvertes (IDF / province), véhicules disponibles (vélo cargo, camionnette réfrigérée, etc.), capacité, contacts, tarification, date de dernière vérification
- **Flux de déchets** : 5 flux V1 (post-refonte 2026-05-02) — biodéchets, emballages, carton, verre, déchet résiduel — avec unités de mesure et exutoires associés. Enum fermée V1 (cf. [[04 - Data Model#Table : `flux_dechets`]])
- **Agences** : nom, contacts, traiteurs/lieux associés

**Interface concernée** : Admin Savr uniquement (lecture seule pour les autres profils)
**Dépendances** : fondation de tous les autres modules

---

### Module 3 — Algorithme d'attribution Anti-Gaspi `MVP`

Recommandation automatique association + transporteur pour chaque collecte Anti-Gaspi, avec validation humaine.

- Calcul de score par association (distance lieu événement, capacité vs. volume estimé, horaires d'ouverture, historique de fiabilité)
- Calcul de score par transporteur (zone couverte, disponibilité, type de véhicule adapté au volume)
- Affichage de la recommandation à l'ops Savr (top 1 par défaut, top 3 en détail)
- Validation humaine obligatoire (avec possibilité de passer outre la recommandation)
- Mode auto-accept configurable par combinaison (assoc × type d'événement) — activable/désactivable par Admin
- Déclenchement d'email automatique à l'association et au transporteur sélectionnés
- Email inclut phrase type : "Si vos informations changent, envoyez-nous un mail"
- Historique des recommandations (acceptées / modifiées / refusées) pour amélioration continue de l'algo

**Interface concernée** : Admin Savr (validation) + notifications email externes
**Dépendances** : Référentiel associations et transporteurs, module emailing

---

### Module 4 — Rapports RSE `MVP`

Génération automatique des rapports de collecte envoyés aux clients.

- Génération PDF post-collecte (<24h) à partir des pesées réalisées (données issues du TMS Savr)
- Régénération à la demande (si données corrigées)
- Contenu : volumes collectés par flux, tonnes détournées, équivalences RSE (ex: X arbres sauvegardés), prestataires intervenus, photos si disponibles
- Format adapté selon le profil (traiteur vs. lieu vs. gestionnaire de lieux)
- Archivage et accès historique pour tous les profils autorisés
- Template personnalisable par type d'événement (à définir dans [[12 - Reporting et exports]])

**Interface concernée** : tous les profils (selon permissions)
**Dépendances** : données pesées depuis TMS Savr, module stockage PDF

---

### Module 5 — Facturation et packs `MVP`

Gestion complète de la facturation Savr et du suivi des packs Anti-Gaspi.

- **Zéro-Déchet** : facturation à la collecte selon tarification par tranches pax (saisie lors de la programmation)
- **Anti-Gaspi** : facturation via packs pré-payés (Pack 10, Pack 30, Pack 60, Unitaire) — décrémentation automatique du solde à chaque collecte réalisée
- Suivi solde pack par client (solde en temps réel, alerte seuil bas, historique consommation)
- Intégration Pennylane : création automatique de la facture à la clôture de la collecte
- Mode "1 collecte = 1 facture" (pour les clients qui le demandent)
- Mode "facturation groupée mensuelle" (pour les autres)
- Historique des factures consultable par les traiteurs (et agences si elles sont facturées directement)
- Gestion des avoirs (en cas d'annulation ou d'erreur)

**Interface concernée** : Admin Savr (configuration), Traiteur-Manager, Agence, Traiteur-Commercial (ses factures)
**Dépendances** : [[08 - APIs et intégrations]] (Pennylane), [[05 - Règles métier]] (tarification)

---

### Module 6 — Pilotage financier Savr (interne) `MVP`

Dashboard de pilotage des revenus et coûts, visible uniquement par Admin Savr.

- Revenus : factures émises (par client, par mois, par type de prestation), packs vendus vs. consommés (PCA), impayés
- **Sources tarifs prestataires** :
  - **Strike, Marathon** : tarification récupérée côté **TMS Savr** (table `courses_logistiques`) — source de vérité pour les ZD
  - **A Toutes!** : tarification remontée via le Savr TMS (qui gère l'intégration avec Everest) — import manuel dans pilotage V1, intégration auto V2 si l'API Everest est exposée au moment du build
  - **Autres prestataires ponctuels** : gestion côté du prestataire, import manuel dans pilotage V1
- Coûts exutoires Veolia : saisie manuelle V1 (V2 auto-import Gmail)
- Marge brute par collecte, par client, par période
- Trésorerie prévisionnelle (packs vendus non encore consommés = engagement client)
- Export comptable (pour Pennylane v2 ou tableur)

**Interface concernée** : Admin Savr uniquement
**Dépendances** : TMS Savr (coûts logistiques), Pennylane (revenus facturés)

---

### Module 7 — Dashboards et analytics clients `MVP`

Vues analytiques par profil (détaillées dans [[11 - Dashboards]], règles en [[05 - Règles métier#11. Dashboards Gestionnaires de lieux (Module dédié)]]).

- **Split systématique AG / ZD** sur tous les dashboards de collecte (onglets)
- **Traiteur-Manager** : KPIs par onglet (AG : repas détournés, packs / ZD : tonnes, taux de recyclage *(formule à captation par filière, indicateur unique — "Taux de recyclage" sur AG retiré 2026-05-06 car métrique ZD-only ; "Taux de valorisation" supprimé 2026-05-06)*), benchmarks anonymisés vs. traiteurs similaires (seuil 3 minimum), graph événements par type
- **Traiteur-Commercial** : ses collectes (AG/ZD) + accès lecture factures de ses propres événements
- **Agence** : impact événements organisés (AG/ZD), **bouton "Programmer une collecte"**, **filtres traiteurs ouverts** (5 dimensions benchmark Bloc 3 ZD vs 4 côté traiteur), **bloc "Mon pack AG"** si applicable, **branding agence prioritaire** sur PDF rapport RSE *(2026-05-07)*
- **Gestionnaire de lieux** : vue multi-lieux (AG/ZD), carte interactive, comparaison inter-lieux, tarifs préférentiels négociés en lecture, **bouton "Programmer une collecte"** *(extension 2026-05-07 — sur ses propres lieux, traiteur référencé only)*, **bloc "Mon pack AG"** si applicable
- **Client Organisateur** (nouveau) : synthèse RSE YTD, export PDF Rapport d'impact Savr
- **Admin Savr** : vue consolidée tous clients + statut TMS acceptance + tournées + picto plaque

 **Réouvert 2026-05-07** : programmation ouverte aux 3 types (traiteur + agence + gestionnaire de lieux). Le gestionnaire programme sur ses propres lieux avec un traiteur du référentiel. Pas de nouveau rôle créé (extension du rôle `gestionnaire_lieux` existant). La table `tarifs_negocie` reste en place pour les remises négociées.

**Interface concernée** : tous les profils espace client
**Dépendances** : données pesées TMS, [[04 - Data Model]] (vues SQL analytiques, `tournees`, `tarifs_negocie`)

---

### Module 8 — Notifications et emailing `MVP`

Système de notifications transactionnelles. V1 = email uniquement. Règles exactes en [[05 - Règles métier#9. Notifications V1]].

- **Clients (programmeur de la collecte)** : récap programmation, récap modification, confirmation annulation, rapport disponible, email de bienvenue *(rappel completion profil entreprise retiré V1 — gate in-app, sobriété §06.02 A2 2026-06-03)*
- **Associations / Transporteurs (hors scope V1 notifications auto depuis la plateforme)** : gérés manuellement par Admin Savr en V1
- **Admin Savr** : alerte pack AG bas/épuisé, alerte incident collecte (pesée contestée, prestataire manqué) *(alerte « nouvelle orga à valider » retirée V1 — vérification a posteriori via liste back-office, sobriété §06.02 A3 2026-06-03)*
- **Templates** : stockés en base, éditables sans redéploiement (variables interpolées)

**Hors scope V1** : notifications in-app, SMS, digest, préférences utilisateur, envoi auto des factures.

**Interface concernée** : tous (émission), Admin Savr (configuration templates)
**Dépendances** : service emailing tiers **Resend** (cf. [[08 - APIs et intégrations]])

---

### Module 9 — Intégration TMS Savr (API interne) `MVP`

Interface de communication entre la Plateforme Savr et le TMS Savr propriétaire.

- Envoi des collectes programmées au TMS (avec toutes les infos lieu, créneau, prestataire)
- Réception du statut TMS (`statut_tms`, enum 8 valeurs miroir TMS — propagation audit cohérence inter-CDC 2026-04-25) par collecte
- Réception des regroupements en **tournées** (1 camion = N collectes)
- Réception des pesées réalisées depuis le TMS (source de vérité pour les rapports et la facturation)
- Réception des statuts en temps réel (collecte démarrée, terminée, incident)
- Réception des informations chauffeurs (nom, téléphone, plaque véhicule) **(propagation Q10 M05 2026-04-24)** pour traçabilité interne (registre transport, audit M08 rapprochement factures, monitoring Admin délai acceptation→saisie plaque). Email client T+3h retiré V1.
- **Plus de fallback MTS-1** : licence terminée. En cas d'indisponibilité TMS Savr, Admin Savr envoie l'ordre de mission manuellement au prestataire (email/PDF)

**Interface concernée** : Admin Savr (supervision), automatique pour le reste
**Dépendances** : [[08 - APIs et intégrations]], CDC TMS Savr

#### Cumul cross-app Plateforme ↔ TMS (propagation §11 TMS 2026-04-27, simplifié revue sobriété §08 Bloc A 2026-05-01 A1)

Voir aussi [[02 - Cahier des charges TMS/11 - Dashboards TMS]] §3.4.

Un user Ops Savr peut avoir 2 profils (Plateforme + TMS) avec même email Google Workspace SSO. La navigation entre les 2 apps est gérée par boutons sidebar permanents + SSO transparent.

**Côté Plateforme** :
- Bloc « Switcher d'app » en bas de sidebar : « Plateforme » (highlight courant) + « → TMS » (**toujours affiché**).
- Au clic « → TMS » : redirect cross-domain `https://tms.gosavr.io/` (qui redirige selon le rôle TMS de l'user, ou affiche page d'accès refusé propre si pas de profil).
- **Supprimé revue sobriété §08 A1 2026-05-01** (confort UX pur, ≤4 users cumul concernés).

**Côté TMS** : symétrique (cf. CDC TMS §11 D3).

**Risque assumé V1** : un user sans profil sur l'app cible voit un bouton qui mène à une page d'accès refusé propre. Acceptable — pas de fuite de données, message UX clair (« Vous n'avez pas accès au TMS Savr. Contactez Val ou Louis. »).

 **Supprimé revue sobriété §08 A1 2026-05-01** — pas d'endpoint dédié, donc pas de CORS spécifique.

---

### Module 10 — Intégration A Toutes! (API Everest) `MVP`

Envoi automatique des ordres de collecte Anti-Gaspi journée IDF vers A Toutes!.

- Déclenchement après validation ops Savr de l'attribution
- Données transmises : adresse événement, créneau, volume estimé, contact traiteur
- Réception du statut de confirmation côté A Toutes!
- En cas d'échec API : notification Admin Savr pour traitement manuel

**Interface concernée** : Admin Savr (supervision)
**Dépendances** : API Everest (geteverest.io), Module 3 (algorithme attribution)

---

### Module 11 — Onboarding et gestion des organisations `MVP`

Gestion du cycle de vie des clients et de leurs utilisateurs (règles détaillées en [[05 - Règles métier#8. Onboarding — Création de compte self-service]]).

- **Création de compte self-service** : inscription libre (email, mot de passe, téléphone, profil, raison sociale, acceptation CGU), email de vérification
- **Rattachement auto à une organisation existante** via le domaine email (matching sur `organisations.domaine_email`) → rôle `traiteur_commercial` par défaut
- **Sinon création d'une nouvelle organisation** → utilisateur en `traiteur_manager` (accès admin sur son orga)
- **Completion progressive** : infos entreprise (SIRET, TVA, adresse facturation, CGV) exigées avant la première programmation de collecte (pas à l'inscription)
- **Validation Admin a posteriori** : aucune facture envoyée Pennylane tant qu'Admin Savr n'a pas validé la fiche orga (vérif SIRET/raison sociale). Les collectes peuvent avoir lieu avant validation.
- **Gestion des lieux** : création et rattachement des lieux par Admin Savr uniquement. Gestionnaire de lieux peut demander l'ajout d'un lieu via formulaire.
- **Invitation des utilisateurs supplémentaires** : Traiteur-Manager peut inviter ses commerciaux depuis son back-office.
- **Désactivation** : soft-delete des comptes par Admin Savr uniquement. Contributions historiques conservées (nom/prénom figés via snapshots).

**Interface concernée** : self-service (inscription), Admin Savr (validation + désactivation), Traiteur-Manager (invitation commerciaux)

---

### Module 12 — Benchmarks sectoriels `V1 (data model) — V2 (interface client)`

Comparaison anonymisée des performances environnementales.

- **V1** : data model anticipe la dimension benchmarking (champs segmentation : type d'événement, tranche de pax, saison, géographie)
- **V2** : interface client exposant les benchmarks (ex: "votre taux de recyclage est 12 % au-dessous de la moyenne cocktail 200-500 pax IDF" — calculé via formule à captation par filière)

**Dépendances** : [[04 - Data Model]] (champs de segmentation), volumes historiques Savr suffisants (seuil à définir)

---

### Module 13 — Reporting export REP/Citeo `V2`

Export des données de collecte au format Citeo pour la déclaration REP Emballages.

- Agrégation des volumes collectés par flux et par événement sur la période réglementaire
- Export Excel au format imposé par Citeo (ou format libre en attendant que Citeo impose un standard API)
- Validation avant export (cohérence des pesées, flux éligibles)

**Dépendances** : données pesées TMS, référentiel flux

---

### Module 14 — App mobile native (traiteurs/ops) `V2`

Version mobile de la Plateforme Savr pour les traiteurs et les ops Savr sur le terrain.

**Dépendances** : stabilisation V1, retours utilisateurs

---

### Module 15 — Multi-langues `V2`

Interface en anglais pour les profils Gestionnaire de lieux (ex: management Sodexo Live anglophone).

**Dépendances** : stabilisation V1, anticiper dans le data model dès V1 (champs traduisibles)

---

### Module 16 — Signature électronique `V2`

Signature des devis ou bons de commande depuis la plateforme.

---

### Module 20 — Traçabilité réglementaire `MVP`

Registre chronologique interne Savr des déchets collectés pour chaque organisation cliente, avec bordereaux, justificatifs et méthodologie. Accessible depuis l'espace client de chaque profil autorisé — RLS filtre sur les événements auxquels l'utilisateur est associé.

**Conformité ciblée** : article R. 541-43 du Code de l'environnement (tenue d'un registre chronologique des déchets). Registre interne Savr uniquement — pas d'intégration Trackdéchets en MVP. En cas d'audit, renvoi vers l'exutoire Veolia pour les BSD officiels.

**Contenu accessible côté espace client** :
- **Registre chronologique** : liste de toutes les collectes réalisées associées à l'organisation de l'utilisateur — date, lieu, événement, flux collectés, poids par flux, exutoire, transporteur, filière de valorisation
- **Filtres** : période, lieu, flux, type (ZD / AG), statut
- **Export** : Excel et PDF sur la période sélectionnée
- **Justificatifs téléchargeables** :
  - Bordereaux Savr (format PDF, émis automatiquement à la clôture de chaque collecte ZD, mentionnant exutoire Veolia, transporteur, poids par flux, code déchet européen)
  - Attestations de don aux associations (format PDF, émises pour les collectes AG éligibles — associations habilitées 2041-GE — mentionnant poids/volume donné, valeur estimée pour défiscalisation 60%)
- **Exutoires** : fiche détaillée par flux (filière de valorisation : recyclage, compostage, méthanisation, valorisation énergétique, enfouissement, don alimentaire + coordonnées exutoire)
- **Méthodologie** : document PDF Savr statique en MVP (comment on calcule les équivalences, sources ADEME Base Carbone, méthode de pondération). Version dynamique (calculs détaillés par événement) en V2, couplé au Module 19

**Alimentation** : automatique à chaque collecte passée au statut `cloturee`. Aucune intervention utilisateur, le registre se construit seul.

**Traçabilité des exports** : chaque export Excel/PDF généré est loggué (qui, quand, quelle période) pour auditabilité.

**Interfaces concernées** : tous les profils espace client (Traiteur-Manager, Traiteur-Commercial, Agence, Gestionnaire de lieux, Lieu) — chacun voit uniquement les événements qui lui sont associés via RLS. Admin Savr a une vue globale + pouvoir de régénérer/corriger les bordereaux.

**Dépendances** : [[04 - Data Model]] (tables justificatifs + bordereaux + attestations), Module 4 (rapports RSE), module génération PDF.

**Évolution V2** :
- Intégration API Trackdéchets (BSD dématérialisés officiels)
- Méthodologie dynamique par événement (couplé Module 19 Impact enrichi)
- Upload de certificats de valorisation annuels Veolia (si Veolia les fournit)

---

### Module 19 — Import brief + Mesure d'impact enrichie `V2 — data model V1`

Extension du reporting au-delà du bilan déchets : mesure de l'impact environnemental complet d'un événement (alimentation, emballage, décor, mobilier, transport convives, énergie du lieu).

**Principe fonctionnel** :
- Le traiteur importe son brief (PDF, Excel, Word, format libre) dans la Plateforme Savr — le document qu'il produit déjà pour son client organisateur (BC, fiche de prod, etc.)
- Parsing automatique (IA) du document : extraction structurée des éléments (nombre de pax, menus servis, emballages utilisés, verres consignés ou jetables, etc.)
- Chaque item extrait est mappé vers le **référentiel d'impact propriétaire Savr** (facteurs d'émission CO2, recyclabilité, source ADEME ou partenaire, date de validité)
- Calcul automatique de l'impact par item et agrégation au niveau événement
- Restitution dans un rapport d'impact enrichi (plus complet que le rapport RSE déchets actuel)

**Extension V2.1+** : élargissement du périmètre au-delà de l'alimentation/emballage — décor, mobilier, transport convives (avion/train/voiture), consommation d'énergie du lieu. Nécessite formulaires ou briefs additionnels, et enrichissement du référentiel.

**Livrable business** :
- Différenciateur fort vs concurrence pure collecte
- Réponse à l'obligation CSRD des clients finaux (LVMH, Kering, etc.)
- Justification d'une prime de prix sur la collecte ZD
- Data product enrichi (benchmarks sectoriels d'impact, pas seulement déchets)

**Prérequis V2** :
- Construction du référentiel d'impact propriétaire Savr (chantier structurel de 3-6 mois) — partenariat (Greenly, Sami, Carbone 4) ou recrutement (chargé projet environnemental)
- Choix du stack IA pour parsing de documents hétérogènes (OCR + NER + mapping)
- Co-construction avec 5-10 traiteurs pilotes pour cadrer les formats de briefs acceptés

**Anticipation data model — NON créée V1** *(révisé audit sobriété §04 2026-05-25, A1)* :
- Les 6 tables Module 19 et les 3 champs anticipés (`evenements.statut_brief`, `evenements.template_brief_id`, `rapports_rse.type_rapport`) **ne sont pas créés en V1**. Ajout en V2 par migration (triviale sous Supabase). Spec conservée en référence dans [[04 - Data Model]] Niveau 6.
- Pas d'interface exposée en V1.

**Interface concernée V2** : Traiteur-Commercial (upload brief), Admin Savr (supervision parsing + validation mapping), tous profils (consultation rapport enrichi)
**Dépendances** : référentiel d'impact (à construire), service IA parsing, Supabase Storage (stockage briefs), [[04 - Data Model]]

---

### Module 17 — Marketplace associations (portail self-service) `V3`

Portail où les associations se créent un compte, renseignent leurs informations et gèrent leurs préférences de collecte.

---

### Module 18 — Fallback Everest / Intégration alternative A Toutes! `V3`

Plan de sortie de la dépendance Everest si A Toutes! change de TMS.

---

## Vue synthétique des priorités

| Priorité | Modules |
|----------|---------|
| **MVP** | 1 Événements, 2 Référentiel, 3 Algo Anti-Gaspi, 4 Rapports RSE, 5 Facturation/Packs, 6 Pilotage financier, 7 Dashboards, 8 Emailing, 9 Intégration TMS, 10 Intégration A Toutes!, 11 Onboarding, 20 Traçabilité réglementaire |
| **V2** | 12 Benchmarks clients, 13 Citeo, 14 App mobile, 15 Multi-langues, 16 Signature élec., 19 Import brief + Impact enrichi |
| **V3** | 17 Marketplace assocs, 18 Fallback Everest |

---

## Décisions prises

- **Périmètre MVP = 11 modules** confirmé — remplacement complet de Bubble
- **Benchmarks** : data model V1, interface client exposée V2 (seuil ~30 collectes/segment requis)
- **App mobile Plateforme** : V2 (TMS Savr a son app mobile en V1)
- **Reporting Citeo** : V2 par défaut
- **Stockage PDF** : Supabase Storage confirmé pour la V1
- **Pilotage financier V1 limité** : revenus collectes + coûts logistiques directs (Strike, Marathon, A Toutes!) uniquement. Coûts Veolia exclus du V1 (factures mensuelles avec relevés de passage → saisie manuelle trop lourde). Connexion Gmail pour auto-import coûts Veolia → V2.
- **Commentaires internes** : champ commentaire libre ajouté sur les collectes ET sur les lieux (pour notes opérationnelles ops Savr). MVP.
- **Référentiel lieux enrichi** : la base de données lieux doit contenir toutes les spécificités opérationnelles (accès, contraintes, contacts, horaires, historique incidents). Ces données doivent être accessibles au TMS Savr via l'API. Ce n'est pas au traiteur de les saisir — pré-remplissage automatique dans le formulaire de programmation. Données gérées exclusivement par Admin Savr. **MVP.**
- **Import brief + Mesure d'impact enrichie** : V2. Structure data **non créée en V1** (audit sobriété §04 2026-05-25, A1 — ajout en V2 par migration, spec conservée en référence). Gating V2 = construction du référentiel d'impact propriétaire. Orientation retenue : **recrutement interne** (chargé projet environnemental, 45-60k€/an chargé).
- **Module 20 Traçabilité réglementaire — MVP** : registre interne Savr (pas d'intégration Trackdéchets en V1, renvoi vers Veolia en cas d'audit). Bordereaux Savr émis automatiquement avec exutoires Veolia mentionnés. **Attestations de don émises pour 100% des collectes AG** (avec ou sans mention fiscale 2041-GE selon habilitation de l'association). Bordereaux et attestations en batch **J+1 à 6h** pour regrouper les corrections de pesée. Pas de rapport de pesée brut. Méthodologie statique en MVP → dynamique en V2 (couplé Module 19). Accessible à tous les profils espace client sur leurs propres événements (filtrage RLS).
- **Resend** retenu comme provider email (décision dans 08 APIs)
- **Onboarding 100% automatisé V1** : validation SIRET INSEE + VIES, pas de gating Admin au go-live (cf. 05 Règles métier)
- **Nouveau profil `client_organisateur`** : dashboard lecture seule, rattachement via `evenements.client_organisateur_organisation_id` (cf. 02 Personas et 04 Data Model)
- **Tarifs préférentiels par gestionnaire** (table `tarifs_negocie`, ex `tarifs_zd_par_gestionnaire`) — remplace le rôle `gestionnaire_lieux_commandeur` supprimé
- **Cumul cross-app Plateforme ↔ TMS via switcher sidebar** (propagation §11 TMS 2026-04-27, simplifié revue sobriété §08 Bloc A 2026-05-01 A1) : bloc « Switcher d'app » en bas de sidebar Plateforme avec bouton « → TMS » **toujours affiché**. SSO Google Workspace transparent. Symétrique côté TMS. supprimée — confort UX pur (≤4 users cumul). Risque V1 assumé : page d'accès refusé propre côté cible si user sans profil.

## Questions ouvertes

_Aucune — module stabilisé pour V1. (2026-04-28)_

 **Clôturé** : Everest expose bien les tarifs réels. Grille tarifaire A Toutes! (prestataire Vélo Frais) documentée dans §05 Règles métier. (2026-04-28)

## Liens

- [[00 - Index]]
- [[01 - Vision et objectifs]]
- [[02 - Personas et cas d'usage]]
- [[04 - Data Model]] (structure de données sous-jacente à tous les modules)
- [[06 - Fonctionnalités détaillées]] (détail de chaque module)
- [[08 - APIs et intégrations]]
