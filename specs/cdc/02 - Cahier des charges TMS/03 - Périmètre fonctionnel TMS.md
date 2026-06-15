# 03 - Périmètre fonctionnel TMS

**Statut** : V1 rédigée — 14 modules V1 + 2 modules V2
**Dernière mise à jour** : 2026-04-22

**Cohérence CDC Plateforme** : ce fichier est le pendant TMS de [[01 - Cahier des charges App/03 - Périmètre fonctionnel global]] (Module 9 — Intégration TMS Savr). Chaque module TMS est aligné avec le contrat API défini dans [[01 - Cahier des charges App/08 - APIs et intégrations]].

---

## Vue d'ensemble

Le Savr TMS est organisé en **16 modules fonctionnels** : 14 en V1 (livraison monolithique), 2 reportés en V2.

| # | Module | Scope | Priorité V1 |
|---|--------|-------|-------------|
| M01 | Réception ordres de collecte | Webhook Plateforme → TMS | Fondation |
| M02 | Dispatch Ops Savr | Attribution collectes → prestataires | Fondation |
| M03 | Portail prestataire self-service | Strike, Marathon, A Toutes! uniquement | Fondation |
| M04 | Gestion des tournées (vacations) | Regroupement + calcul coût | Fondation |
| M05 | App mobile chauffeur | Saisie terrain, ZD + AG | Fondation |
| M06 | Référentiel prestataires | 30+ prestataires, chauffeurs, véhicules, tarifs | Fondation |
| M07 | Pilotage financier logistique | Tarifs, coût course, push Plateforme | Cœur métier |
| M08 | Facturation prestataires | Upload PDF, rapprochement auto | Cœur métier |
| M09 | Stock matériel Savr | Rolls, bacs, alertes, inventaire trimestriel | Cœur métier |
| M10 | Gestion exutoires Veolia | Suivi bacs, alerte 85%, déclenchement | Cœur métier |
| M11 | Alerting transverse | `alerte_emit` + catalogue configurable + dashboard Ops + email critical | Cœur métier |
| M12 | Attribution transporteur | Règles auto + validation manuelle | Cœur métier |
| M13 | Administration TMS | Paramétrage, audit log, RGPD | Fondation |
| M14 | Intégration Everest (A Toutes!) | TMS ↔ Everest ↔ Plateforme | Cœur métier |
| M15 | Optimisation tournées (routing) | Algorithme TSP ordre collectes | **V2** |
| M16 | BSD Trackdéchets | Bordereaux dématérialisés réglementaires | **V2** |

---

## M01 — Réception ordres de collecte

### Rôle
Point d'entrée du TMS. Chaque collecte est poussée au TMS via webhook **dès sa soumission** au formulaire côté Plateforme (statut `programmee`). Le TMS met la collecte en file d'attente d'attribution (statut `recue`).

### Fonctionnement V1

- **Déclencheur** : **soumission du formulaire** côté Plateforme — la collecte passe au statut `programmee` et E1 part immédiatement (`statut_tms` `non_envoye`→`a_attribuer`). *(Corrigé cross-CDC Sujet 2 2026-05-26 — ex « collecte passe au statut `validee` » : `validee` = collecte déjà acceptée par le prestataire, donc postérieure à l'envoi ; E1 ne peut pas se déclencher à `validee`. Côté Plateforme, `validee` est dérivé du retour d'acceptation TMS, cf. App §05 §4.)*
- **Endpoint TMS** : `POST /collectes` (idempotent — `collecte_id` comme clé de dédup)
- **Payload entrant** :
  - `collecte_id` (ID Plateforme, clé étrangère en lecture seule dans le TMS)
  - `evenement_id`, `lieu_id`, `traiteur_id` (références Plateforme)
  - `lieu_snapshot` : adresse, coords GPS géocodées automatiquement, contraintes accès, contact principal
  - `créneau` : date + heure_debut + heure_fin
  - (champ `flux[]` retiré revue sobriété 2026-04-29 — suppression `flux_prevus`)
  - `prestataire_id` (si pré-affecté côté Plateforme) ou null
  - `nb_pax` : nombre de convives (utile pour M09 calcul rolls et M12 attribution transporteur)
  - `type_collecte` : enum `zd` | `ag`
- **Modifications** : `PATCH /collectes/:id` — diff complet, TMS applique les changements (si collecte pas encore en cours)
- **Annulations** : statut `annulee` ou `DELETE /collectes/:id` — TMS annule la tournée associée si constituée, notifie le prestataire
- **Fallback polling** : toutes les 60 min pour rattraper les webhooks perdus *(sobriété M01 B_M01_02 — 2026-04-30 : 15 min → 60 min)*
- **Retry policy** : 5 retries (5 min / 30 min / 2h / 6h / 24h), puis alerte Admin TMS + statut `echec_sync` dans `integrations_logs`

### Contrainte GPS
Les coords GPS du lieu sont géocodées **automatiquement** côté Plateforme depuis l'adresse du lieu et incluses dans le payload webhook. Le TMS n'effectue pas de géocodage — il consomme les coords reçues. Si coords absentes (lieu sans adresse précise), alerte Ops Savr pour saisie manuelle.

### Périmètre V1
Tout. C'est une fondation non négociable.

---

## M02 — Dispatch Ops Savr

### Rôle
Interface principale de l'équipe opérations Savr pour attribuer les collectes aux prestataires, suivre l'avancement et gérer les incidents. Utilisé quotidiennement, souvent à 6h du matin.

### Fonctionnement V1

**Vue planning dispatch** :
- Vue jour (défaut) + vue semaine
- Liste des collectes en attente d'attribution, triées par créneau
- Pour chaque collecte : lieu, créneau, type (ZD/AG), nb pax, suggestion transporteur auto (M12), statut
- Filtres : par type (ZD/AG), par prestataire, par statut, par zone géo
- Raccourcis clavier pour les actions fréquentes (attribuer, refuser, réattribuer)

**Workflow d'attribution V1** :
1. Le TMS affiche la suggestion automatique (M12)
2. Ops valide la suggestion ou choisit un autre prestataire (override)
3. Le TMS envoie la collecte au prestataire (webhook vers portail prestataire M03, ou Everest pour A Toutes! M14)
4. Statut `collectes_tms.statut_dispatch` : `a_attribuer` → `attribuee_en_attente_acceptation` (propagation A1 2026-04-25)
5. Le prestataire accepte/refuse (M03) → `statut_dispatch` → `acceptee` (puis `en_attente_execution` post-assignation chauffeur+véhicule) ou `rejetee_par_prestataire`
6. Si refus : retour Ops manuel — Ops réattribue via M02 (auto-relance hybride 4h supprimée revue sobriété 2026-04-29)

**Gestion province (V1 — Ops uniquement)** :
Les prestataires province n'ont pas de portail self-service. Ops Savr dispatch manuellement :
1. TMS suggère le prestataire province le plus proche (M12)
2. Ops contacte le prestataire hors TMS (email/téléphone)
3. Ops saisit manuellement la confirmation dans le TMS (chauffeur, véhicule, `statut_dispatch=en_attente_execution` directement — propagation A1 2026-04-25)
4. Le chauffeur province utilise l'app mobile TMS (M05) pour la saisie terrain

**Bulk actions** :
- Attribuer plusieurs collectes du même créneau au même prestataire en une action
- Réattribuer en masse si un prestataire annule

**Dashboard temps réel** :
- Collectes du jour : statut en temps réel (6 statuts ZD + 8 statuts AG)
- Retards détectés automatiquement (M11)
- Incidents ouverts
- Vue carte du jour (**confirmée V1** — arbitrage Val 2026-06-03 ; M02 E6, pins GPS depuis `collectes_tms.lieu_adresse`, pas de géocodage côté TMS, pas de routing)

### Périmètre V1
Tout. Interface bureau desktop uniquement.

### Propagation M07 2026-04-24 — `nb_personnes_facturation`

Au dispatch M02, Ops Savr saisit `tournees.nb_personnes_facturation` (valeur 1 = chauffeur seul, 2 = chauffeur + équipier). **Cette valeur est la source de vérité pour la facturation** (décision M07 D10 2026-04-24) :

- Pas d'override par Manager prestataire à l'acceptation (M03)
- Pas de correction par le chauffeur en fin de tournée (M05)
- Si l'équipier déclaré est réellement indisponible le jour J → le prestataire facture comme saisi, Ops Savr applique un **ajustement manuel coût** post-clôture (M07 W2/W3) avec motif "équipier non présent jour J"

Cette règle garantit :
- Une fenêtre de négociation Ops/prestataire au moment de l'attribution (maillon décisionnel unique)
- Un coût prévisible pour le pilotage financier M07
- Une trace audit claire en cas de divergence réelle (ajustement = événement tracé)

---

## M03 — Portail prestataire self-service

**Statut** : V1 **rédigée** (fichier détaillé 2026-04-24, 16 décisions structurantes tranchées) — voir [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]]

### Rôle
Interface dédiée aux **3 prestataires principaux** (Strike, Marathon, A Toutes!) pour accepter les collectes attribuées, gérer leur parc (chauffeurs, véhicules, types de véhicules), consulter leurs revenus et déposer leurs factures. Les prestataires province sont gérés par Ops Savr (hors portail V1).

### Fonctionnement V1 (synthèse — détail complet dans fichier M03)

**Accès** : sous-domaine `portail.tms.gosavr.io`, responsive web desktop + mobile. Auth **email + password** (min 8 caractères, argon2id, retournement 2026-04-24 de l'auth magic link initiale — cf. D1/D24 M03 et addendum §09). Reset via magic link 30 min.

**Périmètre fonctionnel** (10 écrans + 3 auth) :
- E1 Accueil (collectes en attente d'action — revue sobriété 2026-04-29 : indicateur urgence créneau remplace compteur SLA), E2 Liste collectes, E3 Fiche collecte (accepter/refuser), E4 Assignation tournée (chauffeur + véhicule + plaque si requise), E5 Liste chauffeurs, E6 Fiche chauffeur (création incluse), E7 Liste véhicules, E8 Fiche véhicule (création type véhicule incluse), E9 Dashboard revenus, E10 Factures
- EA1 Login email+password, EA2 Reset password, EA3 Nouveau password

> **Supprimé revue sobriété 2026-04-29** : SLA acceptation 3 paliers (R_M03.1) + escalade auto SLA dépassé + alerte M11 `m03_sla_acceptation_expire` + paramètres `m03.sla_*`. Acceptation libre côté manager. Supervision manuelle Ops via M02 E1 Zone 2. Alerte warning `m03_prestataire_refus_consecutifs` conservée (2 refus en 7j glissants — R_M03.3).
>
> **Mise à jour 2026-06-03 (arbitrage Val — révise D4 M02)** : une **alerte Ops de supervision** est réintroduite, mais **sans** la machinerie SLA supprimée ci-dessus (pas d'escalade auto, pas d'auto-accept, pas de KPI). Une collecte attribuée sans réponse au-delà d'un seuil paramétrable (48h si collecte > 48h, 3h si collecte ≤ 48h) émet l'alerte warning `m02_acceptation_sans_reponse` (cron 15 min, M02 W6, §05 R1.4). Pas de bascule de statut automatique.

**Workflow acceptation (A1)** :
1. Ops Savr attribue une collecte au prestataire (M02 ou M12 R1 via suggestion)
2. Le manager prestataire reçoit une notification email
3. Dans le portail M03 E2 : liste des collectes attribuées, indicateur urgence créneau (revue sobriété 2026-04-29 — ex-compteur SLA)
4. Manager ouvre la fiche collecte (E3) → accepte ou refuse
5. Si accepte → E4 Assignation tournée (chauffeur + véhicule ; plaque ET affectation chauffeur obligatoires si `controle_acces_requis=true`, sinon plaque optionnelle)
6. Si refuse → motif obligatoire (liste déroulante) → retour Ops Savr pour réattribution manuelle
7. TMS émet webhook S3 `tournee-upsert` (avec plaque si pré-saisie) + mise à jour statut collecte

**Contrôle d'accès conditionnel (D8 propagation CDC Plateforme — renommé 2026-05-03, sémantique étendue plaque + nom chauffeur)** :
- Toggle `controle_acces_requis_default` niveau `plateforme.lieux` (cf. [[../01 - Cahier des charges App/04 - Data Model]]) — ex `plaque_requise_default`
- Saisi une fois au niveau événement (formulaire §06.01) puis copié sur chaque `plateforme.collectes.controle_acces_requis` à l'INSERT (override per-collecte possible) — ex `plaque_requise`
- Si `controle_acces_requis=true` → le manager doit saisir **la plaque ET affecter un chauffeur** avant validation tournée (blocage trigger `validate_tournee_controle_acces`, ex `tournee_plaque_requise`). **Exception A Toutes! vélo cargo** : la plaque n'est pas exigée, mais le chauffeur reste obligatoire dans tous les cas.
- Si `controle_acces_requis=false` → saisie plaque optionnelle manager (le chauffeur peut renseigner en M05 E3 début de tournée)

**Gestion du parc** :
- **Chauffeurs** (E5/E6) : création + édition par manager (nom, email, téléphone, permis upload, date visite médicale). Archivage soft (invalide sessions actives). Password provisoire auto envoyé à la création.
- **Véhicules** (E7/E8) : plaque, type, frigorifique (bool), hayon (bool), capacité. Le manager peut **créer un nouveau type de véhicule** si absent (Q11 option c validée : `valide_ops=false` → alerte M11 Ops pour valider ou merger via fonction SQL `tms.merger_type_vehicule`).
- **Équipiers** : implicite, tout chauffeur peut l'être sur une tournée (pas de table séparée).

**Dashboard revenus** (E9) :
- CA HT par mois (12 derniers mois), nb tournées, nb collectes
- Drill-down par tournée (date, lieu, durée, coût calculé M07)
- RLS strict `prestataire_id = current_user_prestataire_id()`, coûts internes Plateforme masqués
- Export CSV autorisé (périmètre prestataire uniquement)

**Dépôt factures** (E10, R_M03.9) :
- Upload PDF **1 fois par mois par prestataire** (V1 strict — pas de bimestriel ni quotidien)
- Rappel auto email le 5 du mois si facture absente, escalade Ops + alerte M11 warning le 15
- Rapprochement auto déclenché après upload (M08)

**Multi-tenant RLS strict** :
- Strike ne voit jamais les données de Marathon ni A Toutes! ni prestataires province
- Politique unifiée `shared.prestataires` (§09 cross-schema RLS)
- Tests pgTAP bloquants CI (100% policies)

### Politique password unifiée manager + chauffeur (D1/D24 M03, 2026-04-24)

Retournement méthode d'auth chauffeur M05 (magic link → email+password) — unification stack TMS :
- Scope : `manager_prestataire` + `chauffeur` (Ops/Admin restent SSO Google + MFA TOTP)
- Min 8 caractères, pas de contrainte complexité, argon2id Supabase
- Rate limit 5 tentatives échouées / 15 min / IP
- Session JWT 30j rolling, reset via magic link 30 min
- **Manager** : multi-device illimité / **Chauffeur** : 1 device actif (D12 M05 conservé)

### Périmètre V1
Portail self-service web pour Strike, Marathon, A Toutes! uniquement. Les 30 prestataires province sont gérés par Ops Savr (M02).

### Références détaillées
- [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] — 16 sections, 16 décisions, 12 workflows, 14 edge cases
- [[05 - Règles métier TMS#R8 — Portail prestataire self-service]] — 10 règles R_M03.1 à R_M03.10 + R_M04.CONTROLE_ACCES (ex R_M04.PLAQUE — renommé + étendu 2026-05-03 refonte formulaire §06.01 Plateforme : flag unique plaque + nom chauffeur)
- [[09 - Authentification et permissions TMS#Addendum 2026-04-24 (propagation M03)]] — politique password, rate limit, device binding
- [[15 - Sécurité et conformité TMS#15.4.4 Politique password]] — audit auth, rétention

---

## M04 — Gestion des tournées (vacations)

### Rôle
Regroupement de N collectes dans une vacation (1 camion + 1 chauffeur + 4h). Calcul du coût de la tournée. Push de l'info vers la Plateforme.

### Définitions accrochées
- **Vacation** = unité de base Strike/Marathon : 4h, 1 camion + 1 chauffeur (+ équipier supplémentaire en option)
- **Tournée Savr** = 1 vacation = 1 camion → N collectes (N ≥ 1), même créneau, même zone
- **1 événement → N tournées possible** : un grand événement peut nécessiter plusieurs camions → plusieurs tournées

### Fonctionnement V1

**Constitution d'une tournée** :
- Ops Savr (ou suggestion automatique si même créneau + même prestataire) regroupe les collectes
- Regroupement manuel V1 — automatisation possible V2
- Une collecte appartient à une seule tournée
- Une tournée contient au moins 1 collecte

**Données d'une tournée** :
- `tournee_id` (natif TMS, poussé vers Plateforme)
- `prestataire_id`, `chauffeur_id`, `vehicule_id`, `equipier_id` (optionnel)
- `collecte_ids[]` : liste des collectes de la tournée
- `heure_debut_prevue`, `heure_fin_prevue`
- `heure_debut_reelle`, `heure_fin_reelle` (horodatage auto app mobile chauffeur)
- `duree_reelle_heures` : calculée depuis les horodatages. Base pour le calcul des heures supplémentaires.
- `statut` : enum `planifiee` | `en_cours` | `realisee` | `annulee`
- `cout_total_calcule` : voir M07
- `plaque_immatriculation` : saisie par chauffeur sur app mobile (déclenche webhook `plaque-saisie` vers Plateforme)

**Ajustement a posteriori** :
- La durée réelle d'une vacation peut être corrigée manuellement par Ops Savr après la course (base de recalcul automatique du coût)
- Toute correction est tracée dans l'audit log (before/after + auteur)

**Push vers Plateforme** :
- Webhook `tms/tournee-upsert` à chaque création ou modification de tournée
- Webhook `tms/plaque-saisie` (S7) émis à la pré-saisie de la plaque par le manager prestataire en M03 E4 → alimente la Plateforme pour le contrôle d'accès + registre transport. *(L'email plaque T+3h côté Plateforme est retiré V1 — Q10 2026-04-24.)*

### Périmètre V1
Tout. Regroupement manuel. L'ordre des collectes dans une tournée est défini par Ops Savr au dispatch (pas d'optimisation routing V1 — voir M15 V2).

---

## M05 — App mobile chauffeur

**V1 rédigée** : [[06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur]] (2026-04-24, 20 décisions structurantes tranchées, 10 écrans, 12 workflows, 14 edge cases, 17 règles métier R_M05.x, 15 paramètres M13).

### Rôle
Interface terrain unique du chauffeur prestataire. PWA offline-first (Android Chrome / iOS Safari 16.4+). Pilote l'exécution d'une tournée M04 de bout en bout : prise de connaissance, checklist pré-départ, navigation, pesées, signatures AG, signalements, clôture géolocalisée.

### Synthèse fonctionnelle V1

**Auth** : magic link + device binding 1 seul device actif (D12) + session 30j rolling (D13). Fallback renvoi magic link 1 clic + Ops dernier recours (D14).

**Architecture offline-first** : queue IndexedDB + Service Worker + Background Sync API. Cap 3 tournées + 150 photos + 300 Mo (D2). Idempotency key par item. Policy conflit = merge si compatible, sinon DLQ + alerte M11 (D1).

**Écrans V1** (10) : E1 login → E2 accueil (tournées du jour + J+1 chronologique, D19) → E3 checklist pré-départ bloquante → E4 liste collectes tournée active → E5 détail collecte ZD/AG → E6 pesée auto-tare → E7 signature AG + équivalent repas → E8 clôture GPS → E9 signalement rapide → E10 historique 30j.

**Checklist pré-départ** (R_M05.1) : EPI, véhicule, plaque obligatoire sauf vélo cargo (D10). Vélo cargo A Toutes! : checklist allégée, pas de plaque.

**Pesées auto-tare** (D7/D8/D9) : dropdown contenant à chaque pesée (peut varier au sein d'une même collecte), tare auto snapshot `types_contenants.tare_kg`, override manuel avec motif obligatoire (R_M05.4), contenant `sans_contenant` pour pesée sac direct (R_M05.5). Paramétrable Admin TMS M13.

**Géolocalisation** : geofence uniforme 300m (D4 override Val), fréquence permanent basse + boost transitions (D6), fallback "J'arrive" immédiat (D5 override Val, audit + widget M11). RGPD purge coords 30j (R_M05.13).

**Plaque véhicule** (D10 override Val) : plaque obligatoire sauf vélo cargo. Webhook S7 `plaque-saisie` émis. **Email client T+3h retiré V1** (propagation Q10 CDC Plateforme 2026-04-24) — webhook conservé uniquement pour registre transport + monitoring Admin.

**Bouton "Aucun repas à collecter" (AG uniquement)** : inchangé V1 (motif + photo obligatoires, statut `realisee_sans_collecte` cf. mémoire AG vs ZD, tarif "course incomplète" R2.10 M07, signature court-circuitée, alerte M11 Ops). Accessible M05 E5 parcours AG après arrivée sur site. Conséquences et gating documentés M05 + §05 R2.10.

**Signalements rapides** (E9, D18) : 7 catégories pré-définies (accès refusé, lieu fermé, client absent, bacs vides, bacs non conformes, panne véhicule, autre) + boutons appel traiteur + Ops. Webhook S9 `incident` émis avec enum enrichi (cf. §08 propagation M05).

**Notifications push** (D15, D16) : Web Push API V1 (iOS 16.4+ supporté). Déclencheurs : attribution tournée + rappel H-30 + alerte Ops. Skip J-1 20h. Cap 1 push / collecte / heure.

**UX** : contraste élevé par défaut (D17, pas de toggle ni API ambient light), mobile-first stricto sensu, boutons 48×48 px min, 1 main / 1 doigt friendly.

**Enchaînement 2 tournées/jour** (D19) : accueil liste chronologique toutes tournées (matin + AM).

**Non-périmètre V1** : V1.1 reporté — changement véhicule in-flight (D11), switch contexte manager↔chauffeur (D20), déclaration stocks matériel fin tournée (W10, intégration M09), recherche textuelle historique, mode soleil auto ambient light, multi-langue.

### Contrainte photo
Compression obligatoire avant upload : JPEG 80%, cible ≤ 2 Mo/photo. Max 5 photos par pesée (paramètre `m05_photo_max_par_pesee`). Non négociable (quota Storage Supabase sur 3 ans).

### Périmètre V1
PWA V1 installable (add to home screen Android/iOS). App native reportée V2 selon retours terrain.

---

## M06 — Référentiel prestataires

### Rôle
Source de vérité TMS sur les prestataires logistiques, leurs chauffeurs, leurs véhicules et leurs grilles tarifaires. Environ 30 prestataires actifs (Strike, Marathon, A Toutes! + prestataires province).

### Données d'un prestataire

> Source de vérité : [[04 - Data Model TMS|§04 `shared.prestataires`]] + détail écrans [[06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires|M06 détaillé]]. Propagation M06 2026-04-24 : 2 contacts typés, trigger archivage J+30.

| Champ | Type | Notes |
|-------|------|-------|
| `code` | texte | Slug unique immuable (ex: `strike`, `marathon`) |
| `nom` | texte | Raison sociale |
| `siret` | texte | Unique strict (nullable prestataires étrangers) |
| `adresse_siege` | jsonb | `{rue, code_postal, ville, pays}` |
| `contact_operationnel` | jsonb | `{nom, email, telephone}` — contact quotidien |
| `contact_facturation` | jsonb | `{nom, email, telephone}` — contact factures (peut être identique à opérationnel via copie) |
| `type_prestation` | text[] | Valeurs `zd`, `ag` — un prestataire peut faire les 2 |
| `coords_siege_lat/lng` | numeric | Siège, pour M12 haversine |
| `rayon_intervention_km` | entier | Prestataires province uniquement |
| `statut` | enum | `actif` \| `suspendu` \| `archive` |
| `date_fin_contrat` | date | NULL sauf pendant suspension 30j (trigger cron J+30) |
| `has_portail_self_service` | bool | true pour Strike, Marathon, A Toutes! |
| `integration_externe` | enum | `aucune` \| `everest` (A Toutes! uniquement) |
| `everest_client_id` | text | NULL sauf `integration_externe=everest` |
| `commentaire_interne` | texte | Libre Ops |

### Données d'un chauffeur

> Source de vérité : [[04 - Data Model TMS|§04 `chauffeurs`]] + [[06 - Fonctionnalités détaillées TMS/M06 - Référentiel prestataires|M06 détaillé]]. Propagation M06 2026-04-24 : retrait colonne `visite_medicale_date` (reporté V2), upload docs non bloquant pour activation compte.

| Champ | Notes |
|-------|-------|
| `prestataire_id` | FK `shared.prestataires(id)` |
| `nom`, `prenom`, `telephone` | Obligatoires |
| `email` | Nullable (sauf si compte `users_tms` activé) |
| `peut_conduire` | true = chauffeur (permis requis au dispatch), false = équipier |
| `numero_permis` | Optionnel V1, pas de contrainte d'unicité (alerte info doublon) |
| `date_fin_validite_permis` | Optionnel V1 (pas d'alerte échéance V1, reporté V2) |
| `permis_url` | Supabase Storage `tms-docs-chauffeurs`, non bloquant activation compte |
| `piece_identite_url` | Idem |
| `statut` | `actif` \| `suspendu` \| `archive` |

Cumul chauffeur+manager : géré via `users_tms.roles text[]` (pas via flag dédié). Un chauffeur peut changer de prestataire via workflow M06 W5 (soft delete + création nouveau).

**Conservation docs RGPD** : chauffeur archivé + 3 ans → purge cron (cf. §09 TMS). Suppression sur demande : bouton M06 E5 "Supprimer documents sans archiver".

### Données d'un véhicule

> Source de vérité : [[04 - Data Model TMS|§04 `vehicules`]]. Propagation M06 2026-04-24 : retrait colonnes `assurance_date_fin` + `controle_technique_date_fin` (reporté V2).

| Champ | Notes |
|-------|-------|
| `prestataire_id` | FK `shared.prestataires(id)` |
| `type_vehicule_id` | FK `types_vehicules` — catalogue paramétrable Ops Savr |
| `plaque` | Unique globale active (réutilisable après archive). Pour vélo cargo : identifiant interne |
| `volume_m3` | Override du standard type |
| `statut` | `actif` \| `maintenance` \| `archive` |

### Synchronisation Plateforme ↔ TMS (prestataires)

**plus applicable depuis le retournement D14 seconde salve M01 (2026-04-23)**. Table unique `shared.prestataires`, écriture TMS uniquement via M06, lecture Plateforme via RLS cross-schema. Le module prestataires Plateforme est devenu read-only.

### Périmètre V1
Tout. La saisie des 30 prestataires est une tâche de seed data à planifier (voir §01 — action Val : seed data depuis MTS-1).

---

## M07 — Pilotage financier logistique

### Rôle
Calcul automatique du coût de chaque tournée à partir de la grille tarifaire négociée avec chaque prestataire. Push du coût vers la Plateforme pour le calcul de marge. La Plateforme reçoit le coût total, pas le détail tarifaire (privé TMS).

### Grilles tarifaires V1

**Strike** (paramétrable dans Admin TMS) :

| Composante | Tarif V1 | Paramétrable |
|-----------|----------|--------------|
| Camion 16m3 + chauffeur | 220 €/vacation (4h) | Oui |
| Camion 20m3 + chauffeur | 300 €/vacation (4h) | Oui |
| Équipier supplémentaire | 125 €/vacation (4h) | Oui |
| Heures sup (4h → 6h) | 31,25 €/h × nb_personnes | Oui |
| Seuil déclenchement heures sup | 4h | Oui |
| Seuil déclenchement nouvelle vacation | 6h | Oui |

**Mécanique de facturation Strike — règle à paliers configurables (mise à jour 2026-04-22)** :

Les paliers, tarif de base et coût horaire sont **tous paramétrables par l'Admin TMS** dans `grilles_tarifaires_prestataires.parametres_formule` — aucune valeur en dur dans le code. Si Strike renégocie, l'Admin modifie le JSON, sans redéploiement.

```
Algorithme M07 (générique, lit les paliers JSON) :

palier = trouver le palier dont de_h ≤ duree_heures < a_h
cout   = palier.nb_vacations × tarif_vacation_base_ht
si palier.prolongation :
    cout += nb_personnes × cout_horaire_supplementaire_ht × (duree_heures - palier.base_h)
```

**Paliers V1 (seed Strike, modifiables Admin TMS)** :

| De | À | Nb vacations | Prolongation |
|----|---|--------------|--------------|
| 0h | 4h | 1 | Non |
| 4h | 6h | 1 | Oui (base 4h) |
| 6h | 8h | 2 | Non |
| 8h | 10h | 2 | Oui (base 8h) |
| 10h | 12h | 3 | Non |
| 12h | 14h | 3 | Oui (base 12h) |

**Exemples numériques (camion 16m3, chauffeur seul, tarif_base=220€, cout_horaire=31,25€)** :

| Durée réelle | Palier | Calcul | Coût |
|-------------|--------|--------|------|
| 3h | 0-4h, 1 vacation, pas de prolongation | 1 × 220 | 220 € |
| 5h | 4-6h, 1 vacation + prolongation (5-4=1h) | 220 + 1 × 31,25 | 251,25 € |
| 6h | 4-6h, 1 vacation + prolongation (6-4=2h) | 220 + 2 × 31,25 | 282,50 € |
| 7h | 6-8h, 2 vacations, pas de prolongation | 2 × 220 | 440 € |
| 9h | 8-10h, 2 vacations + prolongation (9-8=1h) | 2 × 220 + 1 × 31,25 | 471,25 € |
| 11h | 10-12h, 3 vacations, pas de prolongation | 3 × 220 | 660 € |

**Même exemple avec équipier** (nb_personnes = 2, base_equip = 125€/vacation) :
- 5h → 220 + 125 + 1h × 31,25 × 2 = 407,50 €
- 7h (6-8h, 2 vacations) → 2 × (220 + 125) = 690 €

**Marathon** (paramétrable dans Admin TMS) :

| Composante | Tarif V1 | Paramétrable |
|-----------|----------|--------------|
| Vacation de base | 100 €/vacation (4h) | Oui |
| Dépassement 4h | Nouvelle vacation complète (100 €) | Oui |

**Mécanique de facturation Marathon (tranches de 4h pleines)** :

```
n_vacations = ceil(durée_totale / 4h)
coût_total  = n_vacations × 100€
```

Pas d'heures sup partielles chez Marathon : toute heure entamée au-delà d'une tranche de 4h déclenche une vacation complète supplémentaire.

**A Toutes!** (vélo cargo + camion frigo, via Everest) :

**Grille tarifaire vélo A Toutes! (tarifs HT négociés Savr)** :

| Service | ID Everest | Course complète — Paris | Course complète — Communes limitrophes | Course incomplète — Paris | Course incomplète — Communes limitrophes |
|---------|-----------|------------------------|----------------------------------------|---------------------------|------------------------------------------|
| Vélo Frais – Programmé H+2 | 71 | **38 €** | **51 €** | 19 € | 25,5 € |
| Vélo Frais – Express >1,5h | 75 | **57 €** | **75 €** | 28,5 € | 37,5 € |

**Course complète** : collecte ET livraison réalisées (repas collectés > 0 kg).
**Course incomplète** : chauffeur arrivé sur site, mais aucun repas à collecter (0 kg). Tarif réduit ~50%.

**Conséquence UX app mobile (M05)** : lors d'une collecte AG avec pesée = 0 kg, l'app doit proposer une confirmation explicite "Aucun repas à collecter" → le TMS applique automatiquement le tarif "course incomplète" et signale l'événement à Ops Savr (anomalie à documenter).

**Grille tarifaire camion A Toutes! (service ID 91, tarifs HT — backup Marathon)** :

| Service | Zone 1 (Paris + limitrophes) | Zone 2 (92/93/94 hors limitrophes) | Zone 3 (91/78/95/77) |
|---------|------------------------------|-------------------------------------|----------------------|
| Camion Frais – Programmé H+4, créneau 30 min (ID 91) | 90 € | 145 € | 190 € |

Tarifs fixes indépendants du temps passé (pas d'heures sup camion A Toutes!).

**Règle zone A Toutes!** : si le lieu de chargement OU de livraison est en zone supérieure, le tarif de la zone la plus haute s'applique.

**Frais fixes A Toutes!** : frais de dispatch mensuel (159 €) **non applicables à Savr** — exclus du pilotage financier.

**Zones A Toutes!** :
- Zone 1 : Paris intra-muros (1er–20e) + communes limitrophes listées dans la grille (Issy, Vanves, Montrouge, Clichy, Neuilly, Boulogne, Levallois, Malakoff, Montreuil, Bagnolet, Les Lilas, Pantin, Aubervilliers, Saint-Ouen, Le Pré-Saint-Gervais, Saint-Mandé, Gentilly, Le Kremlin-Bicêtre, Ivry, Vincennes, Charenton)
- Zone 2 : reste du 92, 93, 94
- Zone 3 : 91, 78, 95, 77

**Calcul coût A Toutes! dans le TMS** :

- **Vélo** : tarif en base TMS (grille négociée Savr). Le TMS détermine :
  1. La zone (Paris vs Communes limitrophes) depuis le code postal du lieu — lookup table en base
  2. Le type de service (ID 71 standard ou ID 75 last-minute)
  3. Le type de course (complète ou incomplète, déclaré par chauffeur sur app mobile)
  → Coût = intersection des 3 paramètres dans la grille ci-dessus

- **Camion (ID 91)** : tarif fixe par zone depuis la grille en base TMS. Zone déterminée par code postal du lieu.

- **Alternative via `/missions/estimate`** : l'API Everest peut retourner le coût Everest, mais c'est le tarif Everest (pas le tarif Savr négocié). Utiliser la grille TMS en base pour les vélos. Pour le camion, les deux méthodes devraient converger — à confirmer en §08.

**Autres prestataires** :
- Grille tarifaire paramétrable par prestataire dans Admin TMS (schéma flexible : forfait / km / heures ou combinaison)
- Ajout d'un nouveau prestataire sans refactoring du code

### Calcul automatique du coût d'une tournée

```
Coût_tournée = Coût_vacation_base
             + Coût_équipier (si présent)
             + Heures_sup × tarif_heure_sup × nb_personnes
             + Ajustements_manuels (Ops Savr, tracés en audit log)
```

- Durée réelle calculée depuis `heure_debut_reelle` et `heure_fin_reelle` (app mobile chauffeur)
- Heures sup = max(0, durée_reelle - 4h)
- Ajustement a posteriori possible par Ops Savr (avec trace audit)

### Répartition par collecte

- Répartition **égale** entre les N collectes de la tournée (V1)
- `coût_par_collecte` = `cout_total_tournee` / N
- Affinement possible V2 (répartition au poids, au temps passé, etc.) si besoin pilotage marge plus précis

### Push vers Plateforme

- **Supprimé revue sobriété §08 Bloc A 2026-05-01 A2** — remplacé par lecture cross-schema directe via vue `plateforme.v_courses_logistiques` (SELECT depuis `tms.tournees`) + trigger DB `fn_recalc_marge_tournee()` cross-schema.
- La Plateforme calcule ensuite la marge = facture client − coût collecte logistique

### Périmètre V1
Tout. Calcul automatique dès la clôture de la tournée (horodatage fin réel saisi par chauffeur).

### Propagation M07 détaillée — 2026-04-24, revue sobriété 2026-04-30

La spec macro ci-dessus est complétée par [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique|M07 détaillé]] (V1 rédigée 2026-04-24, simplifiée 2026-04-30 — 7 écrans E1-E6+E9, 6 workflows W1/W2/W4-W7, 14 edge cases EC1-EC15 dont EC4/EC8 fusionnés, 13 décisions structurantes restantes, 2 règles actives R2.7+R2.8+R2.10). Éléments clés :

- **Figement post-clôture + anti-rétroactivité grilles** (R2.8 authoritative §05, sobriété C4 2026-04-30) : `cout_calcule_ht` immuable, `cout_ajuste_ht` séparé. Modification rétroactive grille interdite (CHECK SQL). Exception unique EC1.
- **Ajustement manuel auto-validé** (sobriété A3 2026-04-30) : champ `cout_ajuste_ht` + motif obligatoire (≥30 chars), push S6 v+1 immédiat, audit log append-only. Plus de workflow validation Admin TMS — supervision a posteriori via digest quotidien (M07 N3). Paramètre `seuil_validation_ajustement_pourcent` supprimé.
- **Flag `tarif_sans_collecte_applicable`** (D4, R2.10) : par grille, défaut false.
- **Règle annulation uniforme 3h** (R2.7, sobriété C3 2026-04-30 ex-1h) : ≥ 3h avant démarrage = 0€, < 3h = vacation facturée. Authoritative §05 R2.7. Paramètre `m07.delai_annulation_sans_facturation_minutes` default `180`.
- **Dashboard pilotage V1** (D6, sobriété A5 2026-04-30) : 5 widgets (coût total mois, coût moyen par prestataire, coût par collecte AG/ZD, top 10 tournées, pie prestataires). **Retiré V1** (info dans M08 quand livré). **Reporté V2**.
- **Retiré V1** (D9, reporté V1.1)
- **`nb_personnes_facturation` = source de vérité Ops au dispatch** (D10)
- **Export CSV contrôle manuel M07** (D11, sobriété A2 2026-04-30 — sync only, cap 5000 lignes), Pennylane via Plateforme (pas TMS)
- **Trigger DB calcul sync, push S6 async versionné, retries 1h/24h** (D13, sobriété B4 2026-04-30) : `push_s6_version` incrémentée, idempotence `tournee_id + version`
- **Statut financier 2 valeurs** (sobriété D1 2026-04-30 puis revue sobriété §05 2026-05-01 D2 — `cout_manquant` retiré, cas impossible par construction grâce à R_M06.X grille obligatoire) : `calcule`, `ajuste`. Verrouillage facture = flag boolean orthogonal `cout_final_verrouille`.
- **Statut grille 2 valeurs** (sobriété D2 2026-04-30) : `actif`/`archive` persistées + vue `vue_grilles_etat_courant` pour dérivation temporelle.
- **Création grille = E6 unique** (sobriété A4 2026-04-30 — wizard E7 supprimé)

Propagations effectuées : §04 (enum `statut_financier` 3 valeurs, suppression `validation_admin_requise`, `cout_final_ht` non GENERATED, `cout_final_verrouille` boolean unique, contrainte `EXCLUDE USING gist` grilles, vue `vue_grilles_etat_courant`, suppression `m07.seuil_validation_ajustement_pourcent` + `m07.alerte_expiration_grille_jours`), §05 (R2.7 seuil 3h authoritative, R2.8 anti-rétroactivité unifiée, R2.9 supprimée), §08 S6 (retries 1h/24h, annulation 3h), §09 (suppression policies E8 + état `ajuste_en_validation`), §04 Plateforme (`courses_logistiques` inchangée — `cout_ajuste`/`version_paiement`/`snapshot_cout_detail` conservés), M11 catalogue (suppression codes `m07_grille_expiration_imminente` + `m07_ajustement_manuel_seuil_depasse` + `m07_formule_non_implementee` fusionné), M08 (référence `cout_final_verrouille` boolean unique).

---

## M08 — Facturation prestataires

### Rôle
Centraliser la réception des factures prestataires, automatiser le rapprochement avec les coûts calculés (M07), réduire le temps de rapprochement manuel (actuellement ~1h/prestataire/mois).

### Contexte actuel
- Factures envoyées par email PDF, fréquence mensuelle
- Rapprochement manuel → environ 1h/prestataire/mois
- Avec 30 prestataires actifs : jusqu'à 30h/mois de rapprochement potentiel
- Suivi difficile, risque d'erreur et de litige non détecté

### Fonctionnement V1

**V1 rédigée 2026-04-24** — cf. [[06 - Fonctionnalités détaillées TMS/M08 - Facturation prestataires]].

**Upload factures** :
- Via portail prestataire self-service M03 W10 (Strike, Marathon, A Toutes!, province avec manager actif) — upload PDF direct + OCR Mistral préremplit montants
- Pour prestataires province sans portail : upload par Ops Savr via M08 E3 (réception email → upload manuel, OCR préremplit)
- À l'upload : notification email automatique Ops + Admin TMS (N1/N3)

**Rapprochement automatique — zéro tolérance (D4 + revue sobriété §05 2026-05-01 D1)** :
1. TMS calcule `montant_ht_calcule_tms = SUM(tournees.cout_final_ht)` pour les tournées du prestataire dans la période facturée (statut terminee, non verrouillées par autre facture)
2. Comparaison au centime près :
   - `montant_ht_prestataire = montant_ht_calcule_tms` → **`valide` direct (auto-validation, refondu D1 2026-05-01)** + verrouillage tournées + audit_log + N1 informative
   - Tout écart (même 0,01€) → `ecart_detecte` → W5 validation manuelle avec motif OU W6 contestation
3. Au moins une tournée `cout_final_ht IS NULL` (A Toutes! grille absente) → `rapprochement_manuel_requis` → Ops saisit grille M07 puis re-rapproche
4. → **étape supprimée V1** (validation auto match exact)
5. Contestation → prestataire émet avoir + nouvelle facture avec numéro différent (D7), ancienne passe `remplacee_par_avoir`
6. Déverrouillage Admin TMS (W9) possible post-validation avec motif ≥ 30 car

**OCR V1** : Mistral OCR préremplit le formulaire (numéro, date, période, montants HT/TVA/TTC, lignes si détectables). Blocage upload si champ required incomplet (D3). Pas d'INSERT en mode draft.

**Statuts facture** (refonte D4/D5/D11, simplifié revue sobriété 2026-04-30 D1 + §05 2026-05-01 D1) — enum 7 valeurs :
- `en_attente` → `valide` (auto match exact) ou `ecart_detecte` (→ `valide` via W5 motif) ou `rapprochement_manuel_requis` → `valide` → `regle`
- Branches : `conteste` (avec flag `conteste_apres_validation` boolean : `false` = W6 Ops avant validation, `true` = W9 Admin déverrouille post-validation, ex-statut `rejetee_pour_correction` fusionné) → `remplacee_par_avoir`
- → fusionné dans `valide` direct (revue sobriété §05 2026-05-01 D1)

**Règlement V1** : saisie manuelle Val/Louis après virement Pennylane (D9). V2 : API Pennylane.

**Export Pennylane V1** : CSV manuel + marquage Ops `exporte_pennylane_at` (D10). V2 : API push.

**Économie estimée** :
- V1 : ~30 min économisées/prestataire/mois (rapprochement auto + alertes)
- Sur 30 prestataires actifs : potentiel 15h/mois récupérées
- Audit 5 ans obligatoire (Registre transport + obligations compta)

### Périmètre V1
Upload portail/Ops + OCR Mistral préremplissage + rapprochement auto zéro tolérance + contestation via avoir + validation Ops/Admin + règlement manuel + export Pennylane CSV manuel + déverrouillage Admin TMS. API Pennylane V2.

---

## M09 — Stock matériel Savr

> **Spec détaillée V1 rédigée 2026-04-25** : [[06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr]] — 5 écrans E1-E5 (dashboard stocks rolls, détail traiteur, modal recompte, référentiel types_contenants intégré M13, paramétrage paliers intégré M13), 4 workflows W1-W4, 12 edge cases EC1-EC12, 10 décisions structurantes D1-D10 (D1 = **frontière documentaire option e avec M10** : M09 owne sémantique stock matériel + tables rolls traiteurs + référentiel `types_contenants` + tares + paliers ; M10 garde tables `stocks_bacs_entrepot` + `passages_veolia` + workflow Veolia + UI page `/exutoires`), R4.1-R4.4 (existantes) + R_M09.5-R_M09.8 (nouvelles : recompte trace écarts, tare modification audit, push S8 obligatoire, archivage type interdit si stock>0), codes alertes M11 V1 (révisé Bloc 3 sobriété 2026-04-25 A1) : `m09_stock_bas` (warning, corrigé V1.1→V1) + `m09_stock_negatif` (warning audit) + `m09_tare_manquante` (warning) + `m09_webhook_s8_dlq` (critical). Codes ex-`info` retirés du catalogue Bloc 3 (`m09_recompte_ecart_rolls`, `m09_tare_modifiee`, `m09_stock_initial_inconnu`) tracés directement en `tms.audit_logs`. Inventaire trimestriel reporté V1.1 (D4).

### Rôle
Suivi du stock de contenants Savr (rolls, bacs) déployés chez les traiteurs et à l'entrepôt. Déclaratif côté chauffeur, alertes automatiques.

### Contenants suivis

| Type | Volume | Tare (à confirmer) |
|------|--------|--------------------|
| Roll Savr | ~400L | À peser à blanc |
| Bac biodéchet | 240L | À confirmer fiche technique |
| Bac verre | 240L | À confirmer fiche technique |
| Bac déchet résiduel | 1 100L | À confirmer fiche technique |
| Bac emballage | 1 100L | À confirmer fiche technique |

**Granularité** : par type (X rolls, Y bacs 240L biodéchet, etc.) — pas par numéro de série unique (reporté V2).

### Stock rolls chez les traiteurs

- **Déclaration chauffeur à chaque collecte** : rolls pleins récupérés + rolls vides laissés chez le traiteur
- **Calcul TMS** : stock_traiteur = stock_précédent − rolls_pleins_récupérés + rolls_vides_laissés
- **Paliers recommandés par pax** (paramétrables par Ops Savr) :

| Nb pax | Rolls recommandés |
|--------|-------------------|
| < 100 | 1 |
| 100 – 200 | 2 |
| 200 – 400 | 4 |
| 400 – 800 | 8 |
| > 800 | Saisie manuelle Ops |

- **Supprimé revue sobriété §08 Bloc A 2026-05-01 A3** — remplacé par lecture cross-schema directe via vue `plateforme.v_stocks_rolls` (SELECT depuis `tms.stocks_rolls_traiteurs`).

### Stock bacs à l'entrepôt

- **Déclaration chauffeur au retour entrepôt** : pour chaque bac (biodéchet 240L, verre 240L, déchet résiduel 1100L, emballage 1100L), palier de remplissage : 50% / 75% / 100%
- **Calcul TMS** : remplissage estimé = somme des paliers déclarés / capacité totale
- **Alerte à 85%** : notification Ops Savr → action M10 (déclenchement Veolia)

### Inventaire trimestriel

- Tous les 3 mois, le TMS envoie un email automatique au contact Ops de chaque traiteur (magic link) pour confirmer le stock théorique
- Écarts détectés → remontée dashboard Ops Savr
- Contacts Ops traiteurs paramétrés manuellement dans Admin TMS

### Périmètre V1
Tout (upgrade depuis V1.1 prévu dans la roadmap initiale — finalement intégré en V1 sur décision 2026-04-21).

---

## M10 — Gestion exutoires Veolia

> **Spec détaillée V2 sobre 2026-04-30** (revue de sobriété — refonte M10) : [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia]] — 8 écrans E1-E8 (E5b supprimé), 10 workflows W1-W10 (W11/W12 supprimés), 13 edge cases EC1-EC15 (EC11 supprimé), 15 décisions structurantes D1-D15, 6 règles métier R5.1-R5.8 (R5.4 bis/R5.9/R5.10 supprimées), 7 codes alertes M11 canoniques (5 codes supprimés), page dédiée `/exutoires` + tuiles-jauges dashboard Ops global M02.

### Rôle
Suivre en temps quasi-réel le stock de bacs (pleins / vides disponibles) à l'entrepôt Savr central et piloter les passages Veolia (planning + confirmations terrain) pour éviter le débordement entrepôt. Remplace le suivi actuel par caméra de vidéosurveillance + déclenchements manuels par téléphone non tracés.

### Contexte actuel
- Val décide manuellement des passages Veolia en surveillant les caméras de l'entrepôt
- Déclenchement : via la plateforme web Veolia ou par téléphone
- Risque si bac déborde : coût de nettoyage + bacs inutilisables → impact opérationnel direct

### Périmètre V1 (D1-D13 M10)

**Dashboard exutoires + tuiles-jauges (D8)** :
- Page dédiée `/exutoires` avec onglets Stock + Passages
- Tuiles-jauges sur dashboard Ops global M02 (1 jauge par couple `flux × type_contenant`, click → drill-down)
- Format jauge : `{pleins}/{capacite_max} ({%})` + couleur palier (vert <50%, jaune 50-84%, orange 85-99%, rouge ≥100%)

**Stock entrepôt (D2/D3/D7/D9)** :
- 1 ligne par couple `(flux, type_contenant_id)` figé V1 (pas de bac multi-flux, traçabilité contamination)
- `quantite_pleine` alimentée auto par trigger DB clôture tournée ZD W1 (estimation continue) + recomptage Ops via E7 directement (V3 sobre 2026-04-30 B5 — colonne `quantite_pleine_recomptee` séparée supprimée)
- Seuil saturation **absolu en bacs pleins** par couple (R5.3 reformulée — plus de seuil global ni %)
- Jauge dashboard = `pleins / capacite_max × 100` (capacité paramétrable Admin via M13)
- Alertes saturation se basent sur l'estimation auto, pas sur le recompte (D3)

**Planning + saisie passages Veolia (D4) — V3 sobre 2026-04-30** :
- Saisie manuelle Ops (E4) — pas d'import CSV V1 (volume faible ~3/sem). Bascule V1.5 si >5/sem
- **Statut simplifié** (D1/B1/B2 revue sobriété 2026-04-30) : 3 valeurs `planifie / realise / annule` (statuts `confirme` et `reporte` supprimés). Le report = `annule` avec `motif_annulation = 'report'`.
- **Déclaration `realise` vaut confirmation effective** (D14 v3) : Ops vérifie via vidéosurveillance avant déclaration (case à cocher `verification_video_at` audit simple inline). La transition `planifie → realise` déclenche immédiatement le **reset TOTAL stock** (R5.4 v3) via trigger `trg_m10_reset_total_pleins`. Plus de second axe `confirme_at` ni de 3 sources de confirmation ni de cron escalade J+1/J+3/J+7 ni d'auto-confirmation J+7.
- **Reset TOTAL stock R5.4 v3** : à la transition `statut: planifie → realise`, reset à 0 la `quantite_pleine` du couple `(flux, type_contenant)`. Justification : cas terrain "Veolia vide tout ou rien".
- **Cron unique W7 horaire avec criticité dynamique** (D15 v3) : un seul code `m10_passage_non_confirme` couvre J-1 anticipation (warning) et > 1j de retard (critical). Plus de gradient j1/j3/j7 ni d'auto-confirmation.

**Bouton "Déclencher collecte Veolia" (D5)** :
- Action manuelle Ops dans interface web Veolia ou téléphone (pas d'API V1)
- TMS crée un `passages_veolia` `planifie` `cree_par_action='bouton_declencher'` pour traçabilité
- Affiche infos contextuelles à copier-coller (flux, nb pleins, contact Veolia)

**Recomptage manuel (D2/D10)** :
- E7 → INSERT `recomptages_stocks_entrepot_log` (append-only) + UPDATE stock
- Motif obligatoire si écart absolu ≥ 5 bacs OU écart relatif ≥ 20% (paramétrable Admin)
- INSERT `tms.audit_logs` action `M10_RECOMPTAGE_ECART` si écart significatif (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m10_recomptage_ecart` info dégagée, audit_logs reste source de vérité). Exploitation V2 dashboard qualité saisie chauffeur via SQL d'audit

**Hors scope V1 (reportés V2)** :
- Coûts Veolia (D6) — `passages_veolia.cout_ht` non créé V1, pilotage exutoire reporté
- API Veolia (pas de doc) — déclenchement manuel humain V1
- BSD Trackdéchets — M16 V2
- Multi-prestataires exutoires (D1) — Veolia hardcodé V1, refacto V2 si nouveau prestataire (rename + FK trivial)
- SMS/email auto vers Veolia — pas d'API V1
- Module dédié commandes fournisseur bacs vides — reporté V2 (V1 = recomptage E7 motif "Réception commande")

### Codes alertes M11 émis par M10

Cf. [[06 - Fonctionnalités détaillées TMS/M10 - Gestion exutoires Veolia#9. Notifications + alertes M11 émises|§9 M10]] : 7 codes M11 V3 sobre 2026-04-30 (`m10_bac_satur` criticité dynamique fusion B3, `m10_passage_non_confirme` criticité dynamique fusion C1, `m10_passage_reporte`, `m10_passage_annule`, `m10_bacs_vides_sous_seuil`, `m10_capacite_max_diminuee_satur`, `m10_stock_incoherence`). **Suppressions revue sobriété 2026-04-30** : 5 codes (`m10_bac_remplissage_85` fusionné B3, `m10_passage_realise_non_confirme_j1`/`_j3` corollaire A2/A4, `m10_passage_auto_confirmee_j7` corollaire A3, `m10_chauffeur_signale_bacs_pleins` corollaire A1). **Bloc 3 sobriété 2026-04-25 A1** : `m10_recomptage_ecart` (info) retiré du catalogue, événement tracé directement dans `tms.audit_logs` action `M10_RECOMPTAGE_ECART`.

### Périmètre V2
- API Veolia (déclenchement automatique, polling planning)
- Saisie coûts Veolia + intégration facturation mensuelle
- Multi-prestataires exutoires (génériser `passages_exutoires` + FK `prestataires_exutoires`)
- Compte délégué agent entrepôt (E5/E7 limités) — V1.5 selon retour terrain
- Module dédié commandes fournisseur bacs vides
- Multi-entrepôts (FK `entrepot_id` sur `stocks_bacs_entrepot`)

---

## M11 — Alerting et monitoring ops

> **Spec détaillée V1 rédigée 2026-04-24** : [[06 - Fonctionnalités détaillées TMS/M11 - Alerting transverse]] — point d'entrée unique `tms.alerte_emit`, catalogue configurable 40+ codes, debounce 5 min, cycle de vie ack/snooze/résolution, 13 décisions structurantes.

### Rôle
Centraliser toutes les alertes opérationnelles TMS via une fonction SQL unique `tms.alerte_emit` + dashboard Ops Savr + notifications critical email. Point d'entrée unique, catalogue configurable par Admin TMS sans redéploiement.

### Taxonomie criticité V1 (D1, simplifiée Bloc 3 sobriété 2026-04-25 A1)

- `warning` : anomalie à traiter, in-app uniquement (ex : `m02_lieu_snapshot_divergent`)
- `critical` : incident bloquant, in-app + email Resend immédiat (ex : `m07_ajustement_pendant_facturation`, `m04_evenement_dlq`)

**Bloc 3 sobriété 2026-04-25 A1** : criticité `info` (audit tracé sans notif) dégagée V1. Events ex-`info` désormais tracés directement dans `tms.audit_logs` ou `tms.integrations_logs` selon le module — duplication avec ces tables d'audit identifiée et résolue.

### Canaux V1 (D4)

| Criticité | In-app | Email | SMS |
|-----------|--------|-------|-----|
| `info` | Oui | Non | Non |
| `warning` | Oui | Non | Non |
| `critical` | Oui | Oui (Resend, latence < 60s) | Non |

**Revue sobriété 2026-04-25 (A6)** : canal Slack dégagé V1 (infra dormante = anti-pattern code mort).

V2 : digest matinal 7h, SMS critical Val/Louis, SLA 2h ack + escalade.

### Catalogue canonique V1 (extrait — cf. spec détaillée §11.7)

40+ codes seed en migration initiale, regroupés par module (`m01_*`, `m02_*`, …, `m14_*`, `integration_*`, `m11_*` méta). Exemples :

| Code | Criticité | Module | Libellé |
|------|-----------|--------|---------|
| `m01_webhook_gap_critical` | critical | M01 | Gap webhook Plateforme > 72h |
| `m02_acceptation_sans_reponse` | warning | M02 | Collecte attribuée sans réponse > seuil (48h lointaine / 3h proche) — alerte de supervision, pas un SLA *(2026-06-03)* |
| `m04_cloture_manuelle_forcee` | warning | M04 | Tournée clôturée manuellement Ops |
| `m05_realisee_sans_collecte` | info | M05 | Collecte AG marquée "aucun repas" |
| `m08_facture_ecart_detecte` | warning | M08 | Facture prestataire ne match pas |
| `m10_bac_satur` | dynamic (warning ≥85%, critical au-delà) | M10 | Saturation entrepôt — fusion B3 V3 sobre 2026-04-30 |
| `m12_aucun_prestataire` | critical | M12 | 0 prestataire couvre la zone |

### Dashboard Ops (E1 — liste + filtres + KPI)

- 4 tuiles KPI header (Ouvertes / Critical non ackées / Résolues 24h / Taux résolution 7j), rafraîchissement polling 30s
- Barre filtres (criticité, code, statut, période, destinataire, entity)
- Table paginée 50 lignes, tri par défaut `critical DESC, emise_at DESC`
- Actions rapides : `Ack` | `Snooze ▾ (1h/4h/24h)` | `Résoudre ▾ (motif opt.)` | drawer détail
- Pas de realtime V1 (polling suffit, simplicité D9)

### Cycle de vie alerte (D5, simplifié Bloc 3 sobriété 2026-04-25 A1+A7, Bloc 6 2026-04-28 B2)

`ouverte` → `snoozee` (1h/4h/24h, motif obligatoire si critical) → `resolue` (manuel OU auto trigger disparu). Enum `alerte_statut` = 3 valeurs `ouverte/snoozee/resolue` (R_M11.11). L'**ack** n'est pas un statut : c'est une metadata (`ackee_at`) posée sur une alerte `ouverte` sans transition d'état (Bloc 6 B2).

**Bloc 3 sobriété 2026-04-25 A1+A7** : statut `expiree` retiré V1 (criticité `info` dégagée → plus aucune source de transition vers `expiree`, cron `m11_expirer_info` supprimé).

Résolution auto W7 : modules émetteurs appellent `tms.alerte_resoudre_auto(code, entity_type, entity_id, raison)` quand la condition sous-jacente disparaît (ex : M08 remplacement facture par avoir, M07 création grille manquante).

### Vue Ops — Suivi comportemental chauffeurs (E5 M11)

**Dégagée revue sobriété 2026-04-25 (A2)**. Section conservée pour mémoire ci-dessous mais hors scope V1. Réactivation V1.1+ quand >5 chauffeurs ZD ou besoin avéré. Donnée brute désormais portée par `tms.collectes_tms.statut = 'realisee_sans_collecte'` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m05_realisee_sans_collecte` info retirée du catalogue, statut métier sur la collecte reste source de vérité), exploitation via export Supabase Studio à la demande V1.

#### Contenu original (référence)

Widget analytique dédié séparé du dashboard alertes (vue agrégée ≠ alerte événementielle) :

- Fenêtre glissante `30j | 60j | 90j` (défaut 30j)
- Taux `m05_realisee_sans_collecte` par chauffeur : count alertes / count collectes AG affectées
- Tri décroissant (les plus anormaux en tête), drill-down collectes avec traiteur/date/motif/photo, export CSV
- Pas de garde-fou automatique V1 (objectif = visibilité Ops, pas blocage chauffeur)

---

## M12 — Attribution transporteur

> **Spec détaillée V1 rédigée 2026-04-24** : [[06 - Fonctionnalités détaillées TMS/M12 - Attribution transporteur]] — 5 triggers, 7 branches, 16 décisions structurantes, dashboard monitoring M13.

### Rôle
Suggérer automatiquement le bon prestataire pour chaque collecte selon des règles métier prédéfinies. La suggestion nécessite toujours une validation manuelle Ops Savr en V1.

### Règles d'attribution V1

**Collectes ZD (Zéro Déchet)** :
- Règle fixe V1 : **Strike** pour 100% des collectes ZD Paris / Île-de-France
- Architecture générique : la règle n'est pas codée en dur — configurable pour permettre d'ajouter d'autres prestataires ZD sans refactoring

**Collectes AG (Alimentaire anti-gaspi)** :

| Condition | Prestataire suggéré | Service Everest | Raison |
|-----------|--------------------|-----------------|---------| 
| 7h–20h ET < 600 pax ET H+2 min | A Toutes! vélo | ID 71 (36,8€) | Vélo cargo frais, tarif optimal |
| 7h–20h ET < 600 pax ET last-minute (<1,5h) | A Toutes! vélo express | ID 75 (55,2€) | Délai incompatible avec H+2 |
| 7h–20h ET ≥ 600 pax | Marathon (camion frigo) | — | Volume trop important pour vélo |
| 7h–20h ET ≥ 600 pax ET Marathon indisponible | A Toutes! camion | ID 91 (grille zonée) | Backup Marathon |
| Après 23h (quelle que soit la taille) | Marathon | — | A Toutes! indisponible la nuit |
| Province | Prestataire province le plus proche | — | Voir règles province ci-dessous |

**Détection last-minute A Toutes!** : si `heure_collecte − heure_actuelle_dispatch < 1h30`, le TMS sélectionne automatiquement le service ID 75 (Express) au lieu du ID 71 (Programmé H+2). Le surcoût (+18,4€) est documenté dans l'audit log.

**Vérification couverture A Toutes! via Everest** : avant de sélectionner A Toutes!, le TMS peut appeler `POST /is-handled-address` (API Everest) pour confirmer que l'adresse est dans la zone de chalandise. Si non couverte → fallback Marathon.

**Règles province** :
1. Filtrer les prestataires avec `type_prestation` incluant le type de collecte (ZD ou AG) ET `rayon_intervention_km` > 0
2. Pour chaque prestataire province actif : calculer la distance entre coords GPS lieu de collecte (payload webhook Plateforme) et coords GPS prestataire
3. Garder les prestataires dont `distance ≤ rayon_intervention_km`
4. Trier par distance croissante → suggérer le plus proche
5. Si aucun prestataire dans le rayon → alerte Ops Savr (assignation 100% manuelle)
6. Si plusieurs prestataires à distance égale → tri secondaire par score fiabilité (V2 — V1 : ordre alphabétique)

**Override Ops Savr** :
- Ops peut ignorer la suggestion à tout moment
- Raison d'override non obligatoire V1 (optionnel, traçable dans audit log)

**Suggestions non supportées V1** :
- Disponibilité temps réel des chauffeurs (non vérifiée — supposée par le prestataire)
- Optimisation coût multi-prestataires sur un même créneau (V2)

### Périmètre V2
Attribution entièrement automatique (sans validation manuelle Ops) — uniquement si le taux de suggestion correcte V1 dépasse 95% sur 3 mois.

---

## M13 — Administration TMS

> **V1 rédigée 2026-04-25** : [[06 - Fonctionnalités détaillées TMS/M13 - Administration TMS]] — 9 écrans E1-E9 (dashboard admin, paramètres, users, audit, secrets Vault, monitoring intégrations, wizard onboarding, codes alertes overrides, impersonation), 12 workflows W1-W12, 18 edge cases, 20 règles R_M13.1-R_M13.20, 15 décisions D1-D15, 17 paramètres `m13_*`, 10 codes alertes `m13_*`. Décisions clés : hub navigation + écrans transverses (D1), override criticité runtime (D2), CRUD users + impersonation V1 (D3), secrets Vault + Edge Function (D4), audit log immutable strict (D5), cache 60s params (D6), soft delete user V1 (D7), wizard onboarding 4 étapes (D8), replay events admin only (D9), session 30j glissantes admin+ops sans re-MFA (D10 risque assumé), MFA TOTP admin 1ère fois device (D11), flag `requires_redeploy` (D12), bandeau impersonation persistant (D13), cap 3 devices trusted (D14), audit double acteur impersonation (D15).

### Rôle
Interface réservée aux admins (Val + Louis) pour configurer le TMS, paramétrer les règles métier, auditer les actions et gérer la conformité.

### Fonctionnalités V1

**Paramétrage tarifaire** :
- Grilles tarifaires par prestataire (Strike, Marathon, province)
- Coefficient kg/repas AG (défaut : **0,45 kg/repas** — propagation revue sobriété M05 E7 2026-04-30, alignement strict TMS+Plateforme — à valider avec assos ou ADEME)
- Seuil alerte bacs Veolia (défaut : 85%)
- Paliers rolls par pax (éditables)
- Contacts Ops traiteurs (pour inventaire trimestriel)

**Onboarding prestataire** :
- Formulaire de création : nom, SIRET, contact, email, téléphone, adresse, type de prestation, véhicules, grille tarifaire, coords GPS, rayon d'intervention (km)
- Activation portail self-service (Strike, Marathon, A Toutes! uniquement)
- Envoi magic link initial au manager prestataire

**Audit log** :
- Append-only (aucune modification possible)
- Rétention 5 ans (obligation comptable + légale)
- Champs : timestamp, auteur, action, entité concernée, before_jsonb, after_jsonb
- Filtrable par date / auteur / type d'action / entité
- Actions tracées : toute modification tarifaire, toute validation/contestation facture, toute modification pesée, toute attribution collecte, tout ajustement de durée vacation

**RGPD** :
- Suppression docs chauffeurs sur demande du prestataire (permis + pièce d'identité)
- Workflow V1 : demande par email à Val/Louis → suppression manuelle dans Supabase Storage + traçage en audit log
- V2 : interface self-service dans le portail prestataire

**Impersonation** :
- Admin peut se connecter en tant que n'importe quel utilisateur TMS (pour support)
- Action tracée dans l'audit log

**Droits V1** :
- Val + Louis = tous droits, aucune granularité
- À revoir si 3ème admin recruté à 12-18 mois

---

## M14 — Intégration Everest (A Toutes!)

### Rôle
Relayer les ordres de collecte AG vers le système propriétaire d'A Toutes! (Everest) et recevoir les confirmations d'acceptation. Déjà live côté Bubble — à migrer vers le TMS Savr.

### Flux complet

```
Plateforme (collecte AG validée)
  → webhook Plateforme → TMS (M01)
    → TMS identifie prestataire = A Toutes! (M12)
      → TMS pousse l'ordre à Everest (POST Everest API)
        → A Toutes! valide dans Everest
          → Everest retourne statut au TMS (webhook Everest → TMS)
            → TMS met à jour statut collecte (`acceptee` ou `refusee`)
              → TMS pousse webhook vers Plateforme (M01 flux retour)
                → Chauffeur A Toutes! exécute via app mobile TMS Savr (M05)
```

### API Everest — références techniques

- **Documentation** : https://a-toute.everst.io/api/documentation
- **Swagger JSON** : https://a-toute.everst.io/api/swagger.json
- **Auth** : Bearer token via `POST /auth` (client_id + client_secret → token). Token à stocker dans Supabase Vault.

**Endpoints TMS → Everest** :

| Action | Endpoint | Paramètres clés |
|--------|----------|----------------|
| Créer une mission | `POST /missions/create` | `service_id`, `address_start`, `address_end`, `start_date` (timestamp), `client_ref` (= collecte_id Savr) |
| Estimer le prix | `POST /missions/estimate` | Mêmes params — retourne le coût avant création |
| Vérifier zone couverture | `POST /is-handled-address` | adresse → bool |
| Vérifier disponibilité | `POST /availabilities` | service_id + date |
| Annuler une mission | `POST /missions/cancel` | mission_id |
| Récupérer statut | `POST /missions/get` | mission_id |

**Service IDs utilisés par Savr** :

| ID | Service | Tarif Savr | Usage |
|----|---------|-----------|-------|
| 71 | Vélo Frais – Programmé H+2, créneau 30 min | 36,8 € HT | Standard AG <600 pax |
| 75 | Vélo Frais – Express >1,5h, créneau 1h | 55,2 € HT | Last-minute |
| 91 | Camion Frais – Programmé H+4, créneau 30 min | Grille zonée (voir M07) | Backup Marathon >600 pax |

**Webhooks Everest → TMS** (format `application/x-www-form-urlencoded`) :

| Événement Everest | Signification | Action TMS |
|-------------------|--------------|------------|
| `mission_dispatched` | Chauffeur assigné par A Toutes! | MAJ statut collecte : `en_preparation` |
| `mission_pickedup` | Collecte démarrée (chauffeur parti) | MAJ statut : `en_cours` |
| `mission_finished` / `mission_success` | Collecte + livraison terminées | MAJ statut : `realisee` → webhook TMS → Plateforme |
| `mission_failed` | Collecte échouée | Alerte Ops Savr + statut : `incident` |
| `mission_cancelled` | Mission annulée côté Everest | Alerte Ops Savr → réattribution |
| `mission_late` | Retard chauffeur | Alerte Ops Savr (M11) |

**Mapping client_ref** : le champ `client_ref` de chaque mission Everest est alimenté avec le `collecte_id` Savr. C'est la clé de réconciliation TMS ↔ Everest.

### Failover Everest indisponible
- Alerte Ops Savr immédiate (email + dashboard M11)
- Ops contacte A Toutes! directement par téléphone
- Confirmation manuelle de l'acceptation saisie dans le TMS (statut `acceptee_manuellement`)
- Logging de l'incident dans `integrations_logs`

### Périmètre V1
Migration du contrat Bubble ↔ Everest vers le TMS + supervision Ops + alerting transverse. Pas de refonte du contrat API Everest. Les chauffeurs A Toutes! utilisent l'app mobile TMS Savr pour la saisie terrain (pas l'interface Everest).

### Statut V1 — V1 rédigée 2026-04-25, revue sobriété appliquée 2026-04-30

Spec détaillée : [[06 - Fonctionnalités détaillées TMS/M14 - Intégration Everest]]. 10 décisions D1-D10, **4 écrans** (E1-E2-E4 page `/everest` + E5 sous-écran M13 E6 monitoring qui absorbe l'ex-E3 — sobriété 2026-04-30 A_M14_05), **7 workflows** (W7 Replay supprimé sobriété 2026-04-30 A_M14_04), 12 edge cases EC1-EC12, 8 règles R_M14.1-R_M14.8, **10 codes alertes** catalogue M11 (1 existant `m14_everest_timeout` + 9 nouveaux ; `m14_everest_mission_late` seedé `active=false` V1 sobriété 2026-04-30 A_M14_07), **5 paramètres** `m14_*` namespace (suppression `m14_dashboard_polling_ms` sobriété 2026-04-30 A_M14_01), 1 trigger DB `trg_m14_cascade_cancel`, 1 fonction SQL helper. **Single source of truth** : colonne `tms.collectes_tms.everest_service_id_target smallint` posée par M12 lors de l'attribution (sobriété 2026-04-30 B_M14_02), M14 W1 ne re-calcule plus la fenêtre last-minute. Sécurité webhook = filet token header par défaut V1, upgrade HMAC à confirmer dev Everest pendant développement. 2 questions ouvertes critiques pré-go-live : Q1 endpoint Everest course incomplète, Q2 HMAC vs token webhook.

---

## M15 — Optimisation tournées (routing) `V2`

### Pourquoi reporté
Le volume actuel (~20 événements/mois, rarement plus de 5 collectes/soir dans la même zone) ne justifie pas un algorithme d'optimisation. L'ordre manuel défini par Ops Savr est suffisant.

### Déclencheur de passage en V2
Volume > 50 collectes/jour, ou retours terrain montrant un temps perdu significatif sur l'ordre des arrêts.

### Ce que ça implique en V2
- Algorithme TSP (Travelling Salesman Problem) pour calculer l'ordre optimal des collectes dans une tournée
- Prise en compte : distance GPS entre lieux, créneaux horaires contraints, capacité camion
- Suggestion d'ordre à Ops Savr (pas d'automatisation complète V2)

---

## M16 — BSD Trackdéchets `V2`

### Pourquoi reporté
Complexité d'intégration API gouvernementale + validation juriste RSE requise. Risque amende 7 500 €/bordereau en cas de contrôle acté et assumé par Val pour 4-6 mois.

### Action recommandée avant V2
Validation par juriste RSE du niveau d'exposition réel et de l'acceptabilité du report. À lotir avec la validation Registre transport (même lot, même juriste).

---

## Synthèse priorités V1

```
Fondations (bloquer le reste) :
  M01 Réception ordres + M13 Admin TMS + M06 Référentiel prestataires

Dispatch et attribution (cœur journalier) :
  M02 Dispatch Ops + M12 Attribution transporteur + M03 Portail prestataire

Exécution terrain (sans ça, 0 collecte tracée) :
  M04 Tournées + M05 App mobile chauffeur

Pilotage et finance :
  M07 Pilotage financier + M08 Facturation prestataires + M11 Alerting

Stock et Veolia :
  M09 Stock matériel + M10 Exutoires Veolia

Intégration externe :
  M14 Everest (A Toutes!)
```

---

## Décisions prises

- **14 modules V1 + 2 modules V2** — structure validée 2026-04-22
- **Portail self-service V1** : Strike, Marathon, A Toutes! uniquement. Les ~30 prestataires province sont gérés par Ops Savr (M02 dispatch + M05 app mobile chauffeur pour la saisie terrain) — 2026-04-22
- **GPS lieux** : géocodage automatique côté Plateforme depuis l'adresse du lieu. Coords incluses dans le payload webhook Plateforme → TMS. Le TMS ne géocode pas — 2026-04-22
- **Formulaire MTS-1 simplifié** : les champs "Process de création de collecte" et "Type de TMS" de MTS-1 ne sont pas repris tels quels. Le process est déterminé par le type de prestataire (Everest pour A Toutes!, portail direct pour Strike/Marathon, manuel pour province) — 2026-04-22
- **Attribution transporteur V1** : suggestion automatique + validation manuelle Ops. Règles : ZD→Strike, AG journée ≤600pax→A Toutes!, AG nuit ou >600pax→Marathon, province→le plus proche par rayon GPS — 2026-04-22
- **Architecture M12 générique** : la règle "ZD = Strike" n'est pas codée en dur, configurable pour permettre l'ajout d'autres prestataires ZD sans refactoring — 2026-04-22
- **M08 rapprochement — Option A V1** : saisie manuelle du montant facturé + calcul auto de l'écart vs coût théorique. OCR automatique reporté V2 — 2026-04-22
- **M15 routing** : reporté V2, déclencheur = volume > 50 collectes/jour — 2026-04-22
- **M16 BSD Trackdéchets** : reporté V2, risque amende assumé par Val, validation juriste RSE recommandée — 2026-04-22
- **App mobile V1** : PWA (Progressive Web App) — permet l'installation sur écran d'accueil sans passer par un store. App native iOS/Android reportée V2 selon retours terrain — 2026-04-22
- **Strike — vacation facturée dans tous les cas** : même collecte ZD avec 0 kg (rolls vides, départ annulé post-démarrage chauffeur). Pas de "course incomplète" côté ZD/Strike — 2026-04-22
- **Conditions d'annulation uniformes** : annulation Savr **avant** l'heure de début de créneau → 0 € facturé (Strike, Marathon, A Toutes!). Annulation après démarrage → vacation facturée. Règle à câbler dans le workflow annulation TMS (M02 + M04) : si `statut_tournee = en_cours` au moment de l'annulation → alerte Ops, coût généré — 2026-04-22
- **Grille vélo A Toutes! (tarifs négociés Savr HT)** : 2 dimensions — zone (Paris / Communes limitrophes) × type de course (complète / incomplète). Course incomplète = 0 kg collecté, déclaration explicite chauffeur sur app mobile, tarif ~50% — 2026-04-22
- **Camion A Toutes! (ID 91)** : tarif fixe par zone (90€/145€/190€), indépendant du temps passé. Frais dispatch 159€/mois non applicables à Savr — 2026-04-22
- **API Everest** : auth Bearer token, création mission via `POST /missions/create` (service_id + adresses + start_date + client_ref=collecte_id), annulation via `POST /missions/cancel` avant heure prévue. 7 webhooks mappés vers TMS — 2026-04-22
- **Bouton "Aucun repas à collecter" (M05, AG uniquement)** : flow dédié avec photo du lieu + commentaire obligatoires. Déclenche tarif "course incomplète" A Toutes!, statut `realisee_sans_collecte`, pesée = 0 kg pushée à la Plateforme. Strike non concerné (vacation toujours facturée) — 2026-04-22
- **Remontée "Aucun repas à collecter" Plateforme** : le motif + la photo sont visibles dans l'historique des collectes du tableau de bord traiteur côté Plateforme (badge + motif + photo). En parallèle, alerte interne Ops Savr (M11). Dépendance à câbler dans le CDC Plateforme §03 (historique traiteur) et §08 (payload S5 `collecte-terminee` batch étendu avec `source=ag_sans_collecte`, `motif_chauffeur` et `photo_url` dans `pesees[]`) — 2026-04-22 / aligné M05 propagation 2026-04-24
- **Pas de garde-fou automatique V1 sur le bouton "Aucun repas à collecter"** : un chauffeur peut l'utiliser librement. Le contrôle se fait a posteriori via le widget Ops M11 "Taux Aucun repas / chauffeur" (fenêtre 30/60/90 jours, drill-down collecte, export CSV) — 2026-04-22

---

## Questions ouvertes

1. **Coords GPS lieux dans le payload webhook** — à confirmer dans le Data Model Plateforme §04 que `lieux.coordonnees_gps` est bien alimenté et inclus dans le payload `POST /collectes` vers le TMS. Sinon M12 province ne peut pas fonctionner.
2. — **Tranché 2026-06-03 (arbitrage Val)** : pas de SLA système (escalade/auto-accept) — supprimé dès la sobriété 2026-04-29. À la place, **alerte Ops de supervision** (M02 W6, §05 R1.4) : collecte attribuée sans réponse > **48h** (collecte lointaine, `heure_collecte − now > 48h`) ou > **3h** (collecte proche, ≤ 48h) → alerte warning `m02_acceptation_sans_reponse`. Seuils paramétrables `parametres_tms` namespace `m02`, calibrables sans redéploiement.
3. **Extraction montant facture (M08)** — V1 : saisie manuelle par Ops. Si le volume de factures augmente (>20 factures/mois actives), OCR à anticiper pour V1.1.
4. **Doc API Everest (M14)** — ✅ Récupérée 2026-04-22. Swagger : https://a-toute.everst.io/api/swagger.json. Service IDs Savr documentés dans M07 et M14. Détail du contrat dans §08.
5. **Tarif Strike prolongation vacation camion** — seuils (4h/6h) et tarifs (31,25€/h) définis 2026-04-22. À confirmer contractuellement avec Strike avant go-live V1.
7. — **Tranché 2026-06-03 (arbitrage Val) : V1**. Carte des collectes du jour (M02 E6), pins GPS depuis `collectes_tms.lieu_adresse.lat/lng` (déjà fournis par la Plateforme, pas de géocodage TMS), MapLibre + tuiles OSM (§07). Pas de routing/optimisation de tournée (V2).
8. — **Résolu revue sobriété 2026-04-25 (A6)** : Slack dégagé V1 entièrement (infra dormante retirée).
9. **Score fiabilité prestataire** — prévu en V2 pour M12 (tri secondaire province). Implique de définir dès V1 les métriques à collecter (taux d'acceptation, retards, incidents).
10. **Frais de dispatch 159€** — ✅ Non applicables à Savr. Exclus du pilotage financier — 2026-04-22.
11. **Tarif A Toutes! camion ID 91** — ✅ Grille PDF applicable, tarif fixe par zone (90€/145€/190€), indépendant du temps — 2026-04-22.
12. **Conditions d'annulation prestataires** — ✅ Règle uniforme : si Savr annule une collecte **avant l'heure prévue de début de créneau** → pas de facturation par le prestataire (Strike, Marathon, A Toutes!). Si annulation après le début du créneau (chauffeur déjà mobilisé) → vacation facturée — 2026-04-22.
13. **Strike — vacation facturée dans tous les cas** — ✅ Même si rien à collecter (rolls vides, collecte ZD annulée après départ chauffeur), la vacation Strike est facturée. Pas de tarif "course incomplète" côté ZD. Le TMS calcule le coût sur la durée réelle de présence — 2026-04-22.
10. **Tares des contenants** — valeurs nécessaires pour M05 auto-tare (voir §01 Question 1). À confirmer avec fournisseurs.
14. **Affichage "Aucun repas à collecter" côté Plateforme** — à intégrer dans le CDC Plateforme §03 (tableau de bord traiteur → historique des collectes) + §08 (payload S5 `collecte-terminee` avec `source=ag_sans_collecte`, `motif_chauffeur`, `photo_url` dans `pesees[]`). Rappel : Ops Savr doit aussi voir le motif dans l'admin Plateforme (vue collecte côté commercial). Aligné M05 propagation 2026-04-24.

---

## Liens

- [[00 - Index]]
- [[01 - Vision et objectifs TMS]]
- [[04 - Data Model TMS]] — à créer, découle de ce §03
- [[08 - Contrat API Plateforme-TMS]] — à créer, détail des webhooks M01 / M04 / M07 / M09
- [[01 - Cahier des charges App/03 - Périmètre fonctionnel global]] — Module 9 (Intégration TMS Savr)
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — Contrat API côté Plateforme
- [[01 - Cahier des charges App/04 - Data Model]] — `lieux.coordonnees_gps` à vérifier pour M12
