# 08 - APIs et intégrations

**Dernière mise à jour précédente** : 2026-05-01 (propagation revue sobriété §08 TMS Bloc D — enum `type_incident` 14→6 valeurs, fusion `incident`/`inchange` dans `statut_collecte_apres` (6→5), `stationnement.non_defini` supprimé (5→4 + nullable), enum `motif_dlq` → text libre côté payload, `integrations_inbox.statut` 4→3 valeurs)

---

## ⚠ Addendum 2026-04-23 — Impacts atelier

1. **1 projet Supabase unique** pour Plateforme + TMS (schémas `plateforme.*` + `tms.*`) — le contrat API HMAC+JWT est **conservé intégralement** malgré la DB unique pour forcer la discipline architecturale (les 2 fronts restent distincts sur Vercel).
2. **Cloudflare R2** ajouté comme stockage principal des fichiers volumineux (photos, PDFs, factures OCR archivées). Les payloads API transportent des **clés de fichier** (`shared.fichiers.id`) plutôt que des URLs directes — les URLs pré-signées sont générées à la demande par les API Routes.
3. **Rotation HMAC annuelle** (retournement vs décision 9.3.16 semestrielle). Simplification opérationnelle V1.
4. **OCR factures = Mistral OCR** (API) — ~0.001$/facture, fallback saisie manuelle Ops si échec.
5. **Tranché V1 = polling J+1 3h uniquement (revue sobriété §08 App 2026-05-31 B1)** — webhook reporté V1.1.

---

## ⚠ Addendum 2026-04-23 (seconde salve M01) — Simplification contrat API TMS

Issu de la seconde salve M01 ([[../02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte]]). Impacts section 1 "API Plateforme ↔ TMS Savr" :

1. **`PATCH /prestataires/:id` supprimé** (ex-E4). Retournement : table unique `shared.prestataires` écrite côté TMS (M06), lecture cross-schema Plateforme. Plus de sync bidirectionnelle webhook.
2. **`PATCH /lieux/:id` allégé** (E5). Sert uniquement à **notifier** le TMS qu'un champ critique d'un lieu (adresse, coords) a changé côté Plateforme → alerte M02 "snapshot divergent". Pas de rétroactivité sur les collectes existantes.
3. **Enrichissement lieux côté TMS** : 2 colonnes existantes de `plateforme.lieux` (`acces_details`, `acces_office`) sont RW partagées (Admin Plateforme + Ops/Admin TMS) via RLS cross-schema column-level. **Aucun endpoint API** n'est nécessaire dans ce sens. **Refonte 2026-04-28 (audit cohérence A2)** : ex-4 colonnes addendum (`code_acces`, `parking`, `contact_ops_logistique`, `instructions_chauffeur`) supprimées et fusionnées sur l'existant. Suppression simultanée des contacts `lieux.contact_*` (relogés sur `evenements.contact_principal_*` + `contact_secours_*`, transmis via payload E1). **Refonte 2026-05-08** : `acces_office` passe de text libre à enum `facile/difficile/tres_difficile` (cohérence transversale `stationnement` même enum). Les 4 colonnes admin/ops only (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`) ajoutées 2026-05-08 sont **strictement exclues** du partage cross-schema TMS (pas de RLS GRANT côté `tms_ops_role` ni `tms_admin_role` sur ces colonnes — voir [[05 - Règles métier#R_lieux_admin_only_fields]]).
4. **Payload `POST /collectes` (E1)** : retrait du champ `prestataire_id_pre_affecte`. Plus de pré-affectation Plateforme. Les règles d'attribution forte vivent côté TMS dans M12.
5. **Nouveau webhook entrant S11 `POST /webhooks/tms/collecte-rejetee`** : Admin TMS rejette définitivement un event DLQ → Plateforme passe `collectes.statut_tms = 'rejetee_par_tms'` + alerte Admin Plateforme.
6. **Versioning unique global** `X-API-Version: 2026.04` partagé par tous les endpoints Plateforme↔TMS.
7. **Taille max payload 256 KB** sur tous les endpoints (rejet 413 + DLQ `schema_invalide`).

---

---

## Vue d'ensemble

La Plateforme Savr communique avec 4 systèmes externes en V1 :

| Système | Rôle | Sens | Criticité |
|---------|------|------|-----------|
| TMS Savr | Exécution opérationnelle des collectes (tous transporteurs : Strike, Marathon, A Toutes!) | Bidirectionnel | Critique |
| Pennylane | Comptabilité, envoi des factures | Plateforme → Pennylane | Critique |
| Resend | Envoi des emails transactionnels | Plateforme → Resend | Haute |
| Puppeteer (self-hosted) | Génération PDF (bordereaux, attestations, rapports) | Interne | Critique |

**Note importante** : Everest (système propriétaire A Toutes!) n'est plus une intégration directe de la Plateforme. L'intégration Everest est gérée côté Savr TMS depuis la décision CDC TMS du 2026-04-21. Voir section 3 ci-dessous et [[02 - Cahier des charges TMS/01 - Vision et objectifs TMS]].

**Principe général V1** : pattern **event-driven** (déclenché par un changement d'état business) avec fallback polling pour les intégrations critiques. Toutes les intégrations sortantes sont **idempotentes** (on peut rejouer un appel sans créer de doublon).

---

## 1. API Plateforme ↔ TMS Savr

> **Spécification contractuelle complète** : [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] (source de vérité du contrat, **12 endpoints actifs + 2 vues cross-schema** post-revue sobriété Blocs A+B+C+D 2026-05-01 et restauration S7 audit cohérence inter-CDC 2026-05-01, payloads JSON, schémas d'auth). Cette section du CDC Plateforme est une **vue synthétique alignée** sur ce document. Toute modification doit être répercutée des deux côtés.

### Pattern retenu

**Event-driven via webhooks** uniquement. **Pas de polling fallback V1** *(supprimé revue sobriété §08 Bloc A 2026-05-01 A4 — retry policy 3 paliers (5 min / 1h / 24h, simplifié Bloc B B1 ex-5 paliers) + dédup `integrations_inbox` 7j (Bloc B B5) couvrent les pannes <24h, intervention manuelle au-delà)*.

**Données accessibles en lecture directe cross-schema** (pas de webhook V1) :
- Coût tournée TMS via vue `plateforme.v_courses_logistiques` *(remplace ex-webhook S6, revue sobriété 2026-05-01 A2)*
- Stocks rolls traiteurs TMS via vue `plateforme.v_stocks_rolls` *(remplace ex-webhook S8, revue sobriété 2026-05-01 A3)*

Voir [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] section addendum 2026-05-01 pour le détail architectural.

### Flux Plateforme → TMS (ordres sortants)

| Événement déclencheur Plateforme  | Endpoint TMS                                | Payload clé                                                                      |
| --------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Collecte créée (**soumission du formulaire** — statut `programmee`, `statut_tms` `non_envoye`→`a_attribuer`) *(corrigé Sujet 2 2026-05-26 — ex « statut `validee` », logiquement impossible : `validee` = déjà acceptée par le prestataire, donc postérieure à l'envoi ; E1 part à la soumission, cf. [[05 - Règles métier]] §4)* | `POST /collectes`                           | `collecte_id, traiteur_id (= traiteur_operationnel.organisation_id, invariant), lieu_snapshot, heure_collecte, type_collecte (zd\|ag), nb_pax, contacts (principal + secours), controle_acces_requis, informations_supplementaires, traiteur_operationnel, programmateur` — plus de `prestataire_id_pre_affecte` (seconde salve M01) ; champ `flux[]` retiré revue sobriété 2026-04-29 (suppression `flux_prevus`). **Sous-objets organisations (ajout 2026-05-07 — alignement audit cohérence inter-CDC Run 6 2026-05-07 A1, suffixe `_snapshot` retiré pour cohérence avec spec contractuelle §08 TMS L342+L351)** : `traiteur_operationnel = { organisation_id, nom, raison_sociale, siret, est_shadow }` (producteur juridique du déchet — toujours `type='traiteur'`, possiblement shadow). `programmateur = { organisation_id, nom, type ('traiteur'|'agence'|'gestionnaire_lieux') }` (donneur d'ordre). **Invariant V1 (audit Run 6 2026-05-07 B2)** : `traiteur_id` racine = `traiteur_operationnel.organisation_id` (rétrocompatibilité TMS, pointe systématiquement sur le producteur juridique = traiteur opérationnel). Si `programmateur.organisation_id = traiteur_operationnel.organisation_id` (cas classique programmateur=traiteur), le TMS peut afficher un seul bloc. Sinon le TMS affiche les 2 distinctement (M01 réception + M05 app chauffeur — info "Programmé par {{nom}}, traiteur opérationnel = {{nom}}"). **Champ `heure_collecte`** (propagation 2026-04-29 — refonte 2026-05-03 §06.01 : pas de 15min, étape 1 du formulaire) : sous-objet structuré `{ date, heure, fuseau }` (cf. spec contractuelle [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS|§08 TMS E1]]). `heure` = heure d'arrivée souhaitée du prestataire (point fixe V1, pas de fenêtre) — remplace l'ancien sous-objet `creneau: { heure_debut, heure_fin }`. V2 dérivera une fenêtre opérationnelle TMS via tampon paramétrable. **Clarification dates (2026-05-21 D2)** : `heure_collecte.date` = `plateforme.collectes.date_collecte` (date d'intervention logistique, vérité TMS, peut différer de la date événement pour collecte de nuit/lendemain). `evenements.date_evenement` (date client) n'est **PAS** transmise au TMS (non nécessaire à l'opérationnel). **Champ `type_collecte`** (`zd`\|`ag`) et **`nb_pax`** (= `evenements.pax`, pax unique niveau événement — `collectes.pax_collecte` retiré V1 le 2026-05-29) transmis au TMS dans le payload E1. **Sous-objet racine `contacts`** (refonte audit cohérence A2 2026-04-28) : `principal` obligatoire (`nom` + `telephone`) + `secours` optionnel — sources `evenements.contact_principal_*` / `contact_secours_*` Plateforme, figés dans `tms.collectes_tms.contact_principal_*` / `contact_secours_*` à la création TMS. Champ `email` retiré V1 (téléphone seul suffit jour J). **Champ `controle_acces_requis`** (booléen, propagation M03 TMS 2026-04-24 — restauré 2026-05-01 audit cohérence inter-CDC — **renommé 2026-05-03 (refonte formulaire §06.01)** : ex `plaque_requise`, sémantique étendue plaque + nom chauffeur) : copié depuis `collectes.controle_acces_requis` (lui-même hérité de `lieux.controle_acces_requis_default` à l'INSERT, override possible au formulaire avec cascade upgrade-only sur le lieu). Côté TMS : si `true` → manager prestataire **doit** pré-saisir plaque + nom chauffeur en M03 E4 avant validation tournée → trigger `validate_tournee_controle_acces` bloque transition `tournees.statut → acceptee` si plaque OU nom chauffeur manquant (R_M03.4 + R_M04.CONTROLE_ACCES). Exception A Toutes! vélo cargo : trigger autorise validation tournée même si `controle_acces_requis=true`, message UX formulaire programmation Plateforme alerte le traiteur ("Vélo cargo — pas de plaque possible"). **Champ `informations_supplementaires`** (text nullable, max 1000 car., ajout refonte 2026-05-06 §06.01 §2.a) : informations logistiques saisies par le programmeur étape 2.a (ex: instructions accès, contraintes horaires manager lieu). Source `plateforme.collectes.informations_supplementaires`, figé dans `tms.collectes_tms.informations_supplementaires` à la création TMS. Visible côté TMS : manager prestataire (M01 réception, M03 dispatch) + chauffeur app mobile (M05 tournée). |
| Collecte modifiée                 | `PATCH /collectes/:id`                      | Diff complet — voir §Modification collecte (refonte 2026-05-04) ci-dessous       |
| Collecte annulée                  | `DELETE /collectes/:id` ou statut `annulee` | `collecte_id, motif`                                                             |
| Lieu critique modifié (notif seule) | `PATCH /lieux/:id`                        | `lieu_id, champs_modifies[], nouvelle_valeur_snapshot, modifie_le` (allégé). **Refonte 2026-05-08** : les colonnes admin/ops only (`commentaire_lieu`, `siren`, `email_gestionnaire`, `reference_citeo`) **ne sont jamais envoyées** dans `nouvelle_valeur_snapshot` — leur modification ne déclenche aucun PATCH TMS. Si une modif touche un de ces champs ET un champ partagé en même temps, seul le champ partagé est diffé. |

**Authentification** : Mutual HMAC-SHA256 + JWT signé clé secrète partagée. **Rotation annuelle manuelle V1** (retournement atelier 2026-04-23 vs semestrielle). Détails auth (`Authorization`, `X-Savr-Signature`, `X-Savr-Timestamp`, `X-API-Version`) dans [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS#Authentification et sécurité]]. *(Header `Idempotency-Key` retiré revue sobriété Bloc C 2026-05-01 C4 — duplication avec `body.event_id`, dédup serveur lit le payload directement.)*

### Flux TMS → Plateforme (events entrants)

| Événement TMS | Endpoint Plateforme | Payload clé |
|---------------|---------------------|-------------|
| Collecte démarrée | `POST /webhooks/tms/collecte-en-cours` | `collecte_id, tournee_id, demarree_le, chauffeur_id` *(champ `geoloc` retiré revue sobriété Bloc B 2026-05-01 B4 — la Plateforme n'utilise pas la géoloc, retard traité côté TMS M11. Bonus RGPD minimisation)* |
| **Collecte terminée** (réalisée OU aucun repas) | `POST /webhooks/tms/collecte-terminee` | `collecte_id, tournee_id, statut_final (realisee \| realisee_sans_collecte), pesees[] (uniquement flux réellement pesés — flag `presume_non_pese` retiré revue sobriété 2026-04-29 avec suppression `flux_prevus`), photos_collecte[], rolls, signature_asso, aucun_repas` |
| Incident collecte | `POST /webhooks/tms/incident` | `incident_id, collecte_id, type_incident, description, photos[], imputable_a` |
| **Collecte rejetée par TMS** (nouveau 2026-04-23 seconde salve, S11) | `POST /webhooks/tms/collecte-rejetee` | `event_id_tms_source, collecte_id, motif_dlq, commentaire_admin, rejete_par_admin_id, rejete_at` → Plateforme passe `collectes.statut_tms='rejetee_par_tms'` + alerte Admin |

> **Multi-vélo AG — un seul `collecte-acceptee` (S1) par collecte (généralisation 2026-05-29, arbitrage Val 2)** : quand une collecte AG est servie par N vélos (N missions Everest A Toutes!), seul le `mission_dispatched` de la **1re** mission mute `statut_dispatch → acceptee` et émet **un seul** S1. Les missions suivantes sont des no-op idempotents → la Plateforme ne voit qu'une acceptation par collecte, quel que soit le nombre de vélos. Le `chauffeur`/`vehicule` du S1 correspond au coursier de la 1re mission. Détail TMS : [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS|§08 TMS S1]].

**Webhook `collecte-terminee` unifié** : un seul webhook gère les deux cas métier. Discriminé par `statut_final` :
- `realisee` → `pesees[]` obligatoire, `rolls` pour ZD, `signature_asso` pour AG
- `realisee_sans_collecte` (AG uniquement) → `pesees[]` = `[]`, objet `aucun_repas = { motif_chauffeur, photo_lieu_url }` obligatoire

> **Multi-camions (refonte 2026-05-25)** : un seul `collecte-terminee` terminal par collecte, quel que soit le nombre de tournées. Les `pesees[]` sont **agrégées par le TMS sur les N camions** avant émission (option a). Le champ `tournee_id` du payload, dans le cas multi-camions, est informatif (dernière tournée terminée) — l'App clé sur `collecte_id` pour créer les `collecte_flux` et calculer `taux_recyclage`. Pas de S5 partiel par camion côté contrat App.

> ** retiré V1 (revue sobriété 2026-04-29)** — corollaire de la suppression `flux_prevus` côté TMS et "Flux attendus" côté formulaire programmation Plateforme. Plus d'auto-insertion de lignes pesées à 0kg. Le rapport de recyclage Plateforme se base désormais uniquement sur les flux **réellement** pesés par le chauffeur. Plus de mention "Flux non pesé" front traiteur — un flux non pesé est simplement absent du rapport. Embargo H+24 + batch J+1 6h conservés.

**Champ `source`** (enum 2 valeurs post-revue sobriété 2026-04-29, par ligne de `pesees[]`, cf. [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS|§08 TMS S5]]) : indique l'origine de la donnée pesée pour reporting Plateforme ventilé par origine.

| Valeur `source` | Origine | Contexte |
|-----------------|---------|----------|
| `chauffeur` | Saisie terrain TMS M05 E6 | Pesée réelle effectuée par le chauffeur (ZD ou AG) |
| `ag_sans_collecte` | AG E5 "Aucun repas à collecter", poids 0 | Cas AG `realisee_sans_collecte` uniquement |

**Règle de cohérence Plateforme** : valeur `presume_non_pese` retirée de l'enum (corrélation supprimée). Le parser Plateforme accepte uniquement `chauffeur` ou `ag_sans_collecte`. Toute autre valeur → DLQ Plateforme.

**Effets côté Plateforme pour `realisee_sans_collecte`** (AG uniquement — ce statut n'existe pas en ZD) :
- Ligne de collecte dans l'historique du tableau de bord traiteur affiche badge "Aucun repas collecté" + motif chauffeur + accès photo du lieu
- Alerte admin Ops Savr (module alerting Plateforme) pour documentation côté Commercial
- Pas de génération d'attestation de don 2041-GE (pas de don livré)
- **Facture client générée au tarif normal V1** (déplacement + mobilisation chauffeur dus). Facturation partielle possible en V2.

**Réponse webhook** : 2xx = ack. Si erreur, TMS retry selon la retry policy uniforme **3 paliers : 5 min / 1h / 24h** *(simplifié revue sobriété Bloc B 2026-05-01 B1 — ex-5 paliers)*.

**Contrainte photos** : le TMS Savr doit compresser les photos avant upload dans Supabase Storage (JPEG 80%, cible ≤ 2 Mo/photo). **Pas de limite de nombre** de photos par collecte V1 (ex: M05 AG = 1 photo pesée + ≥ 1 photo livraison asso + potentielle photo lieu pour "Aucun repas"). Cette contrainte est documentée dans le CDC TMS M05 comme prérequis technique non négociable.

**URLs photos** : les photos sont transmises par **URL signée Supabase Storage TTL 7 jours**. La Plateforme les télécharge et les ré-uploade dans son propre Storage pour persistance légale (5 ans archivage bordereaux + attestations).

### Notion de tournée (cf. `04 - Data Model`)

Une tournée = 1 camion. Relation **N↔N** entre `collectes` et `tournees` (refonte multi-camions 2026-05-25, table de liaison `collecte_tournees`) : une tournée peut couvrir N collectes (mutualisation — heures de collecte rapprochées dans une même zone, fenêtre opérationnelle calculée côté TMS, cf. M04) ET une collecte peut être couverte par N tournées (multi-camions — gros volume servi par plusieurs camions). Le TMS Savr décide en interne du découpage et pousse la (les) liaison(s) à la Plateforme via S3 `tournee-upsert`. La Plateforme reçoit :

> **Agrégation statut & pesées multi-camions (refonte 2026-05-25, arbitrage option a)** : pour une collecte servie par N tournées, l'App passe la collecte `en_cours` dès la **1ʳᵉ** tournée démarrée (`collecte-en-cours`), et `realisee`/`realisee_sans_collecte` au **S5 terminal unique** `collecte-terminee`. Le TMS n'émet ce S5 qu'une fois **toutes** les tournées terminées, avec `pesees[]` **déjà agrégées** sur les N camions → le contrat App `collecte-terminee` reste inchangé (pas de S5 partiel par camion). Le mécanisme TMS « attendre les N + agréger + émettre 1 S5 » est **différé en session `cdc-tms-savr`** (dispatch M02 + cardinalité `collectes_tms → N tournees`). Voir [[05 - Règles métier#R_statut_collecte_multi_tournees]].

| Événement TMS | Endpoint Plateforme | Effet |
|---|---|---|
| Collecte acceptée par prestataire | `POST /webhooks/tms/collecte-acceptee` | MAJ `collectes.statut_tms = 'acceptee'`, `statut_tms_at` (renommage propagation audit cohérence inter-CDC 2026-04-25, A1+B2). **+ dérive `collectes.statut` `programmee`→`validee`** via trigger `fn_sync_statut_collecte_from_tms` (Sujet 2 2026-05-26, arbitrage 2a — `statut_tms` est la source de vérité, `statut` suit). **V2 — origine A Toutes! (arbitrage Val 2026-05-29)** : pour A Toutes! (Everest, pas de portail M03), ce webhook est émis par le TMS à réception de l'événement Everest `mission_dispatched` (M14 W2/R_M14.1bis). Le handler doit accepter `chauffeur.chauffeur_id`, `vehicule.vehicule_id` et `vehicule.plaque` à `null` (coursier A Toutes! non géré comme entité Savr à l'acceptation) sans bloquer la dérivation `statut_tms = acceptee`. C'est l'équivalent V2 du modèle V1 §3 (confirmation Everest positive → `statut_tms = acceptee`). |
| Collecte refusée / à réattribuer | `POST /webhooks/tms/collecte-refusee` | MAJ `collectes.statut_tms = 'rejetee_par_prestataire'`, `statut_tms_at` + notif Admin (renommage + alignement enum miroir TMS 2026-04-25) |
| Tournée créée / mise à jour | `POST /webhooks/tms/tournee-upsert` | Upsert `tournees` + **liaison(s) via `collecte_tournees`** (N↔N — refonte multi-camions 2026-05-25, ex `collectes.tournee_id`). Payload : la tournée porte la **liste des `collecte_id`** qu'elle sert ; l'App réconcilie les lignes `collecte_tournees` (insert/delete) pour ce `tournee_id`. Une même `collecte_id` peut apparaître dans plusieurs tournées (multi-camions). |
| Plaque manager pré-saisie (M03 E4) | `POST /webhooks/tms/plaque-saisie` | **Restauré 2026-05-01 (annulation Bloc C C3, audit cohérence inter-CDC)** — émis à la saisie manager prestataire en M03 E4 (`tms.tournees.plaque_preassignee_manager`), alimente `plateforme.tournees.plaque_immatriculation` + `plaque_saisie_at`. **Pas émis à la saisie chauffeur terrain M05 E3** (Option B arbitrage Val 2026-05-01) — la plaque chauffeur reste TMS-only. Pas émis non plus pour les tournées vélo cargo A Toutes! (pas de plaque). Payload : `{ event_id, occurred_at, tournee_id, plaque, saisie_par_user_id, saisie_at }`. Sert : (1) dashboard traiteur "plaque officielle reçue", (2) registre transport M08, (3) monitoring Admin "délai acceptation→saisie plaque". |

### Modification collecte (refonte 2026-05-04) — endpoint `PATCH /collectes/:id`

> **Contexte** : refonte 2026-05-04 §06.04 Espace traiteur — ouverture de la modification libre des informations collectes futures côté Plateforme. Ce paragraphe spécifie le comportement attendu côté contrat API quand la Plateforme déclenche `PATCH /collectes/:id` vers le TMS suite à une modification utilisateur.

**Déclencheur** : `UPDATE` côté Plateforme sur les champs métier d'une collecte avec `collectes.statut_tms ≠ non_envoye` (collecte déjà poussée via `POST /collectes`, statut TMS connu — voir [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]]). Si `statut_tms = non_envoye` (collecte `programmee` dont l'envoi E1 n'a pas encore réussi — état transitoire avant succès E1, ou en retry) → modification locale Plateforme uniquement, pas d'appel TMS.

**Payload** *(sobriété B5 2026-05-04 — `side_effects` retiré, le TMS calcule sa propre logique sur le diff)* : diff JSON avec champs modifiés uniquement (PATCH partiel) :

```json
{
  "event_id": "uuid v7 — idempotency key (cf. §08 TMS C4 dédup serveur lit body.event_id)",
  "occurred_at": "ISO 8601",
  "collecte_id": "uuid",
  "modifie_par_user_id": "uuid (programmeur ou manager Plateforme)",
  "diff": {
    "date_collecte": { "ancien": "2026-05-15", "nouveau": "2026-05-16" },
    "heure_collecte": { "ancien": "14:00", "nouveau": "16:30" },
    "contacts": { "principal": { ... }, "secours": { ... } },
    "controle_acces_requis": { "ancien": false, "nouveau": true },
    "informations_supplementaires": { "ancien": "Sonner interphone B", "nouveau": "Quai N°2 fermé le lundi, passer par accès Nord" },
    "association_attribuee": { "ancien": null, "nouveau": { "association_id": "uuid", "nom": "...", "adresse": "...", "code_postal": "...", "ville": "...", "coordonnees_gps": { "lat": 48.8566, "lng": 2.3522 }, "contact": { "nom": "...", "telephone": "..." }, "horaires_ouverture": "..." } },
    "...": "uniquement les champs effectivement modifiés"
  }
}
```

> **`association_attribuee` (AG uniquement — ajout 2026-05-29, arbitrage Val)** : émis par la **cascade `attribution_validee`** (§06.09 §3, V2) pour transmettre au TMS la destination de livraison des excédents AG. L'association est attribuée + validée par l'Admin **après** la création de la collecte (E1 part à la soumission, l'association n'est pas encore connue), d'où l'usage d'E2. Le TMS le fige dans `collectes_tms.association_snapshot` → affiché au chauffeur en M05 E7. Push silencieux (ne déclenche pas de réacceptation transporteur). Ré-attribution (refus asso) → nouvel E2. Jamais émis pour ZD.

**Champs autorisés au diff** : tous les champs métier collecte/événement (date, heure, pax, contacts, notes, type d'événement, taille, `controle_acces_requis`, `informations_supplementaires`, `association_attribuee` AG). **Liste catch-all volontaire (décision consciente 2026-05-21, audit cohérence inter-CDC)** : la liste est délibérément large pour ne pas avoir à la maintenir à chaque évolution. Le TMS applique le diff uniquement sur les champs qu'il persiste dans `tms.collectes_tms` et **ignore silencieusement** les champs hors de son data model (ex: `type d'événement`, `taille` — non stockés côté TMS ; `notes` = alias historique de `informations_supplementaires`). **Champs interdits au PATCH (sobriété A4 2026-05-04 + refonte 2026-05-05)** :
- `traiteur_organisation_id` (immuable)
- `lieu_id` : verrouillé UI Plateforme. Si reçu en PATCH (anomalie) → refus 422.
- `type_collecte` (ZD/AG) : idem `lieu_id`. Refus 422 si reçu en PATCH.
- `type_pesee` : **retiré V1 (refonte 2026-05-05)** — champ orphelin, jamais défini en data model. Si reçu en PATCH (anomalie historique) → ignoré silencieusement côté TMS (pas de 422 pour rester rétro-compatible si un client legacy l'envoie).

> Pour ces 2 cas (lieu / type), la Plateforme demande au traiteur d'annuler + reprogrammer (workflow standard). Pas de cascade DELETE+POST automatisée côté Plateforme — le traiteur est l'acteur, pas le système.

**Side-effects côté TMS attendus** :
| Champ modifié | `statut_dispatch` TMS pré-PATCH | Comportement attendu côté TMS |
|---|---|---|
| Notes, contact secours, `informations_supplementaires` | quel que soit le statut | Push silencieux, MAJ donnée, pas de notification prestataire |
| `controle_acces_requis` (passage à `true`) | quel que soit le statut | MAJ donnée + **notification simple** au manager prestataire (« contrôle d'accès désormais requis — pré-saisir plaque + chauffeur M03 E4 »), **pas de réacceptation** (arbitrage Val 2026-06-05) |
| `date_collecte` ou `heure_collecte` | `acceptee` | **Réacceptation requise** : statut TMS repasse à `attribuee_en_attente_acceptation` + flag `flags_jsonb.re_confirmation_requise = true`, push notification au prestataire (M03 / M04) pour re-confirmation |
| `date_collecte` ou `heure_collecte` | `attribuee_en_attente_acceptation` | MAJ de la donnée, pas de réacceptation supplémentaire (le prestataire n'a pas encore accepté) |
| `pax`, `type_evenement`, `taille_evenement` | quel que soit | Push silencieux. La tournée TMS peut nécessiter recalcul opérationnel par M04 (à la discrétion du TMS) |

**Idempotency** : l'`event_id` du payload sert de clé de dédup côté TMS (cohérent avec `integrations_inbox` 7j Bloc B B5). Un `PATCH` rejoué avec le même `event_id` retourne 200 sans réappliquer le diff.

**Auth** : Mutual HMAC-SHA256 + JWT (cf. supra). Pas de différence vs `POST /collectes`.

**Réponse TMS attendue** :
- `200 OK` : diff appliqué, side-effects exécutés
- `409 Conflict` : la collecte est passée à un statut non modifiable côté TMS entre la décision Plateforme et la réception du PATCH (ex : passée à `en_cours`). Plateforme alerte Ops, ne réessaye pas.
- `404 Not Found` : la collecte n'existe pas côté TMS (jamais créée ou rejet DLQ). Plateforme alerte Ops.
- `5xx` : retry selon retry policy 3 paliers (5 min / 1h / 24h).

**Email Ops Savr alertée en parallèle** : voir template `admin_modification_collecte_traiteur` dans [[06 - Fonctionnalités détaillées/02 - Templates emails V1]]. L'email reste envoyé même si le PATCH TMS échoue (mécanismes indépendants).

**Cohérence inter-CDC** : impacts à propager sur [[02 - Cahier des charges TMS/06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] (acceptation modif collecte attribuée + workflow réacceptation prestataire) + [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] (spec endpoint `PATCH /collectes/:id` côté TMS).

---

### Fallback TMS Savr indisponible

> **Note de scope 2026-05-29 (à réconcilier en `cdc-v1-scoping`)** : ce bloc décrit l'**état final** (écosystème Plateforme + Savr TMS, MTS-1 décommissionné). Dans le **fork V1** (Plateforme seule + MTS-1 + Everest, sans Savr TMS — cf. roadmap V1/V2 et §3bis), MTS-1 n'est **pas** terminé : c'est le **système de dispatch actif** des transporteurs `type_tms = 'mts1'`, pas un fallback. La formulation « licence MTS-1 terminée » ci-dessous vaut pour l'après-cutover V2. À aligner formellement lors de la dérivation du CDC V1 (Phase 5). Même réserve pour [[01 - Vision et objectifs]], [[03 - Périmètre fonctionnel global]], [[07 - Architecture technique]].

Licence MTS-1 terminée *(état final post-V2)*. Plus de fallback système. Si TMS Savr indisponible > 30 min :
- Notification Admin Savr urgente (email + Slack ops)
- Bascule **commandes manuelles** : Admin Savr envoie l'ordre de mission directement au prestataire logistique (PDF ou email) depuis les données Plateforme
- Saisie manuelle des pesées a posteriori dans la Plateforme par Admin
- Runbook ops à rédiger avant mise en prod

---

## 2. API Plateforme ↔ Pennylane

### Pattern retenu

**Push synchrone** à la validation Admin de la facture. Pas de polling (Pennylane est source de vérité comptable, on pousse en confiance).

### Version API Pennylane

**API v2** retenue (confirmée par Val). Pennylane v2 est la nouvelle génération stable, schéma JSON plus propre, meilleur support webhooks. Endpoints en `/api/external/v2/*`.

### Endpoints utilisés

| Action | Endpoint Pennylane v2 | Doc |
|--------|------------------------|-----|
| Créer facture | `POST /api/external/v2/customer_invoices` | `https://pennylane.readme.io/v2.0/reference` |
| Créer avoir | `POST /api/external/v2/customer_invoices` (type=credit_note) | |
| Finaliser facture | `POST /api/external/v2/customer_invoices/:id/finalize` | |
| Envoyer par email | `POST /api/external/v2/customer_invoices/:id/send_email` | |
| Récupérer statut paiement | `GET /api/external/v2/customer_invoices/:id` (polling J+1 à 3h du matin) | |
| Créer client | `POST /api/external/v2/customers` | |

### Logique V1

1. Admin Savr valide un brouillon dans la Plateforme
2. Plateforme appelle `POST customer_invoices` → récupère ID Pennylane → stocke dans `factures.pennylane_id`
3. Plateforme appelle `finalize` → facture verrouillée côté Pennylane
4. Plateforme appelle `send_email` → Pennylane envoie au client
5. Statut côté Plateforme : `emise`
6. Job quotidien à 3h du matin : poll statuts de paiement **de toutes les factures `emise`** (sans borne temporelle — Option B retenue 2026-06-07 F2) → MAJ `factures.statut` si `payee`. Implémentation : requête `WHERE statut = 'emise'` avec index partiel sur `(statut)` — volumes V1 < 500 lignes, scan instantané. Pas de fenêtre glissante : garantit qu'aucune facture ancienne ne reste `emise` indéfiniment. Revisiter en V1.1 si les volumes justifient une vue matérialisée.

**Gestion erreurs (2026-04-28, simplifié revue sobriété 2026-05-08)** :
- **4xx (données invalides)** : facture reste en `brouillon`, notification Admin avec message d'erreur Pennylane précis. Pas de retry.
- **5xx / timeout (Pennylane down)** : `factures.statut = en_attente_pennylane`, retry automatique **3 paliers : 5 min → 1h → 24h** *(simplifié 2026-05-08 — ex-5 paliers 5 min/30 min/2h/6h/24h, retry policy unifiée avec celle des webhooks Plateforme↔TMS §1)*. Si les 3 tentatives échouent → notification Admin urgente (email + bandeau orange sur fiche facture, pas de widget dashboard dédié). Retry manuel Admin via bouton "Renvoyer" sur la fiche facture. Email client envoyé uniquement après succès. Voir [[06 - Fonctionnalités détaillées/08 - Génération et édition facture (Admin)#2. Synchro Pennylane — flux unique (nominal + erreurs + retry)]].

---

## 3. API Plateforme ↔ Everest (A Toutes!)

### V1 — appel direct Plateforme → Everest *(actualisation 2026-05-09)*

> ⚠ **Décision 2026-06-08 (revue frère, validée) — Everest hors périmètre go-live → V1.1.** Everest (vélo cargo A Toutes!, volume marginal) est **retiré du chemin critique du lancement** : API fragile (token sans refresh, webhooks sans HMAC, pas de sandbox) + questions ouvertes non résolues (re-fetch course par id, IP sources stables — mail dev Everest du 2026-06-07, en attente). **Le détail technique de cette section §3 V1 reste gelé** tant que le dev Everest n'a pas répondu et que le compte test n'est pas fourni. Pattern de sécu retenu (à appliquer en V1.1) : **webhook = simple signal → re-fetch API Everest pour la vérité** (ne jamais faire confiance au payload) + rate-limit + dédup (re-fetch sur event nouveau seulement) + **aucune action irréversible** (paiement, email client) déclenchée directement depuis le webhook. Au go-live, les AG IDF qui auraient été routées vers Everest basculent sur le fallback MTS-1 (Marathon, cf. §3bis et §06.09 §2.3). Cf. [[_PENDING - Everest API V1 (à intégrer §08 §3)]].

**En V1, la Plateforme appelle directement Everest** car le Savr TMS n'est pas encore en production (V1 Plateforme seule, MTS-1 + Everest, cf. roadmap V1/V2). La Plateforme orchestre les ordres A Toutes! pour les attributions AG IDF résultant des branches dur §06.09 §2.3.

**Flux V1** :

```
Plateforme (validation attribution AG IDF par Admin Savr ou auto-accept)
  → collecte = `programmee`, `statut_tms = non_envoye` (cf. §06.09 §3, alignement ZD/AG 2026-05-29)
  → calcul branche §06.09 §2.3 → transporteur résultant
    → envoi de l'ordre → `collectes.statut_tms = 'attribuee_en_attente_acceptation'` (saute `a_attribuer` : transporteur déjà désigné)
    → si transporteur.type_tms = 'a_toutes' → appel direct Everest API selon mapping branche → service
    → si transporteur.type_tms = 'mts1' → appel MTS-1 (cf. §3bis ci-dessous)
      → réponse stockée dans `attributions_antgaspi.confirmation_transporteur`
      → acceptation = **confirmation positive explicite du transporteur** → `statut_tms = 'acceptee'`
        → trigger `fn_sync_statut_collecte_from_tms` dérive `programmee → validee`
      → rejet → `statut_tms = 'rejetee_par_prestataire'` + notif Admin + retour file (statut reste `programmee`)
```

**Pilotage `statut_tms` par la Plateforme en V1 (Sujet AG statuts, 2026-05-29, arbitrage 2a)** : faute de TMS Savr en V1, c'est la Plateforme qui écrit `collectes.statut_tms` pour l'AG (et non un webhook TMS). La machine à états reste **identique à la ZD** : `validee` est dérivée par le trigger à l'acceptation, jamais forcée à la validation d'attribution. En V2, ce pilotage passe au TMS Savr via webhooks (`collecte-acceptee`, etc.).

**Mapping `branche_attribution` → service Everest V1 (audit cohérence C2 2026-05-09)** :

| `branche_attribution` Plateforme | Service Everest | ID service | Cas métier |
|----------------------------------|-----------------|------------|-----------|
| `ag_velo_express` | Vélo cargo express (< 90 min avant collecte) | **74** | A Toutes! vélo last-minute (corrigé 2026-06-15, M2.5 DIV-1 — 75 abandonné par Everest) |
| `ag_velo_programme` | Vélo cargo programmé H+2 | **71** | A Toutes! vélo standard |
| `ag_marathon_volume_backup_camion` | Camion (backup grand événement) | **91** | A Toutes! camion fallback Marathon |
| `ag_everest_camion_express` | Camion express last-minute (Marathon indisponible) | **77** | A Toutes! camion last-minute — nouvelle branche (DIV-3, décision Val 2026-06-15) |
| `ag_marathon_nuit` / `ag_marathon_volume` / `ag_velo_fallback_marathon` | — (non Everest, MTS-1) | n/a | Marathon — appel MTS-1 §3bis |
| `ag_province_proximite` | — (non Everest, MTS-1) | n/a | Province — appel MTS-1 §3bis |

**Acceptation = signal positif explicite uniquement (révision 2026-05-29 — suppression de l'acceptation implicite par délai)** : la Plateforme ne bascule **jamais** une collecte en `acceptee` par simple écoulement de temps. La règle est :
- Une confirmation Everest synchrone positive (`confirmation_transporteur.statut = accepté`) déclenche `statut_tms = 'acceptee'` (→ trigger `fn_sync_statut_collecte_from_tms` → `statut = validee`).
- **Tant qu'aucun signal positif n'est reçu**, la collecte reste en `attribuee_en_attente_acceptation` (le `statut` métier reste `programmee`). Aucune bascule automatique. La collecte non confirmée est remontée dans le **monitoring Admin des collectes non confirmées** (cf. dashboard §06.06) pour relance manuelle Ops à l'approche de la `date_collecte`.
- Le rejet (HTTP error synchrone, webhook async Everest, ou refus Marathon) positionne `statut_tms = 'rejetee_par_prestataire'`, déclenche une notification Admin Savr + remet l'attribution en file d'attente avec motif preset (le `statut` métier reste `programmee`).
- **Supprimé 2026-05-29 (décision Val)** : trop de risque de collecte « fantôme acceptée » jamais réalisée. Remplacé par l'acceptation sur signal explicite + surveillance Ops ci-dessus.

**Spec technique V1 (implémentée M2.5)** : services actifs Everest = **71** (vélo programmé), **74** (vélo express — ex-75 abandonné), **77** (camion express — branche attribution à confirmer, DIV-3 pending Val), **91** (camion fallback Marathon). Auth clé API + secret en Supabase Vault. Retry policy 3 paliers 5 min / 1h / 24h. Webhook = signal → re-fetch API (pas de HMAC, secret dans URL). Gate levée 2026-06-15.

**Course sans marchandise (V1, implémentée M2.5 — décision Val 2026-06-29, option « re-fetch mission_status ») :** sur webhook terminal Everest (`mission_finished` / `mission_success` / `mission_failed`), l'adapter ne fait **jamais** confiance au payload — il **re-fetch la mission** (pattern §3 « webhook = signal → re-fetch ») et lit son `mission_status` :

- `mission_status` ∈ {`Pas de commande`, `Client absent / Marchandise refusée`} (comparaison normalisée minuscule/espaces) **ET** collecte `type = anti_gaspi` **ET** statut non terminal → `statut = realisee_sans_collecte`, `realisee_at = now()`, `aucun_repas_motif = <libellé mission_status>` (le libellé EST le motif), `aucun_repas_photo_url =` preuve re-fetchée si fournie sinon `NULL` (colonne nullable §04 ; Everest n'expose pas systématiquement de photo de lieu en V1) + alerte Ops in-app `type = collecte_aucun_repas`. ZD → trace seule, jamais de transition.
- `mission_failed` / annulation externe **avant acceptation** (`statut_tms = attribuee_en_attente_acceptation`) → `statut_tms = rejetee_par_prestataire` + alerte Ops.
- ⚠ **Wire à figer au compte de test Everest** (non encore fourni, cf. [[_PENDING - Everest API V1 (à intégrer §08 §3)]] §3 Q1) : (1) l'`event_type` réel porteur du signal (catégorie `fail` vs `success`) ; (2) les libellés `mission_status` exacts (`POST /statuses`) ; (3) la disponibilité d'une photo de lieu (sinon `aucun_repas_photo_url` NULL entériné pour les courses vides Everest V1). Seul le **mapping de détection** (`COURSE_VIDE_MISSION_STATUSES` + les `case` du switch) serait alors à ajuster — la transition et ses effets restent valides.

### V2 — intégration Everest déplacée vers le Savr TMS *(décision 2026-04-21)*

Au cutover V2, Everest est connecté au Savr TMS et plus à la Plateforme. Le flux métier devient :

```
Plateforme (programmation collecte AG jour)
  → webhook E2 vers TMS Savr
    → TMS ré-applique M12 §4 (mêmes branches IDF, paramètres `parametres_tms.attribution`)
      → TMS pousse l'ordre à Everest
        → A Toutes! valide dans Everest
          → Everest retourne le statut au TMS
            → TMS remonte à la Plateforme via webhook S2
              → Chauffeur A Toutes! exécute la collecte via l'app mobile TMS Savr
```

La spécification technique de l'intégration Everest ↔ TMS (endpoints, payloads, webhooks, gestion d'erreur, retry) est traitée dans le CDC TMS, section "Intégrations externes TMS". Voir :

- [[02 - Cahier des charges TMS/01 - Vision et objectifs TMS]]
- [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] (à rédiger)
- [[02 - Cahier des charges TMS/06 - Fonctionnalités détaillées/M12 - Attribution transporteur|TMS — M12 §4]] (source de vérité branches IDF V2)

---

## 3bis. API Plateforme ↔ MTS-1 *(ajout 2026-05-29 ; flux sortant + URLs réconciliés sur le relevé as-built Bubble 2026-06-06)*


> ⚠ **CORRECTION 2026-06-05 (relevé Bubble réel)** : l'intégration **Bubble** actuelle est en **POLLING** (GET `GET /v3/customerOrders?minDate&maxDate`, `GET /v3/customerOrders/{id}`, `GET /v3/tours/{id}`, photos). MTS-1 supporte aussi des webhooks push natifs, mais **DÉCISION VAL 2026-06-05 (relevé §9) : V1 = POLLING uniquement, pas de webhooks** (cron `GET /v3/customerOrders` + `GET /v3/tours` + photos, cadence 15-30 min, dédup `integrations_inbox` ; webhooks reportés si un besoin temps réel émerge). Auth V1 = **API Key statique `Authorization: Bearer <clé>`** (générée console MTS-1, stockée Supabase Vault, server-side ; flow `gateway/v2/auth/token` client-credentials = plan B). **Plaque = `numberPlate` via `GET /v3/carrier` (vehicles[]), matché par `vehicleShareableCode`.** Pesées réelles sur `GET /v3/tours/{id}` → `stops[].weight` ; photos = URLs téléchargées. Voir le relevé complet : [[Adapter MTS-1 (MyTroopers) — relevé as-built Bubble]]. Le découpage S1-S11 ci-dessous décrit le **contrat cible TMS Savr V2** (event-driven), pas l'adapter MTS-1 V1.
>
> ✅ **RÉCONCILIÉ 2026-06-06 (session MTS-1)** : les deux divergences §3bis ↔ relevé as-built sont alignées sur le relevé as-built (source de vérité). (1) Modèle hand-off — l'ancien `delegate/customerOrder/toCarrier` (dérivé de la doc V3, jamais implémenté par Bubble) est remplacé par le flux réel **`POST /v3/customerOrders` → create tour (DRAFT) → `POST /v3/tours/{tourId}/dispatch` (`carrierShareableCode`) → `PUT` validate** (cf. 3bis.5, 3bis.12, Q3bis-3 close). (2) Base URL — `api.mts-1.com/v3` → host data **`*.mytroopers.io/v3`** + auth **`gateway.*.mytroopers.com/v2`** (MTS-1 = produit MyTroopers ; cf. 3bis.2). **Aucun impact enum/colonne** : `statut_tms` reste piloté par lecture de `customerOrderStatus` au polling (figé). Doc/console/support éditeur restent `mts-1.com` **à confirmer** (hors relevé). Naming `mts1` (enums, `code_transporteur_mts1`, `source='mts1'`) conservé inchangé.

> **Statut** : V1 rédigée 2026-05-29. Lève l'incohérence historique « MTS-1 retiré » (cf. §08 Décisions + §04 ligne `mts1_reference`). En V1, MTS-1 reste le système de dispatch terrain des transporteurs `type_tms = 'mts1'` (Strike, Marathon). La Plateforme **pilote** l'intégration MTS-1 (le Savr TMS n'existe pas encore — cf. roadmap V1/V2).
> **Source** : relevé as-built Bubble↔MTS-1 ([[Adapter MTS-1 (MyTroopers) — relevé as-built Bubble]], 2026-06-05) = source de vérité du flux réel + des hosts. Complété par la doc officielle MTS-1 API **V3** (URL doc `mts-1.com/docs` **à confirmer**). API **V3** uniquement (V2 dépréciée, à ne pas implémenter).

### 3bis.1 Cadrage V1

En V1, la nouvelle Plateforme remplace Bubble mais **pas** la couche logistique terrain. Pour les transporteurs `type_tms = 'mts1'` (Strike + Marathon), la Plateforme :

1. crée l'ordre de collecte côté MTS-1 (API V3) puis la tournée qui le porte,
2. dispatch la tournée au bon transporteur (Strike ou Marathon) et la valide,
3. **récupère les statuts d'avancement par POLLING V3 de MTS-1** (cron `GET /v3/customerOrders` + `GET /v3/tours`, cadence 15-30 min — **décision Val 2026-06-05, pas de webhooks V1**),
4. synchronise ces statuts dans `collectes.statut_tms` (machine à états identique à la ZD, cf. §3 Everest et §06.09 §3).

En V2, ce pilotage bascule vers le Savr TMS et MTS-1 est coupé (cf. 3bis.11 + §13 TMS Migration MTS-1).

**Discriminant de routage** (cf. §3 Everest, mêmes branches §06.09 §2.3) :
- `transporteur.type_tms = 'mts1'` → flux MTS-1 décrit ici (Marathon, branches `ag_marathon_*`, `ag_velo_fallback_marathon`, `province`).
- `transporteur.type_tms = 'a_toutes'` → Everest (§3).
- `transporteur.type_tms = 'autre'` → dispatch manuel (email + téléphone, aucun appel API).

### 3bis.2 Version, base URL, documentation

| Élément | Valeur |
|---|---|
| Version API | **V3** (V2 dépréciée, à ne pas utiliser) |
| Base URL data (customer orders / tours / dispatch / carrier) | **`https://<connector>-customer.<env>.mytroopers.io/v3`** — relevé DEMO : `https://demo-connector-customer.prod.mytroopers.io/v3`. **URL prod à récupérer** (remplacer `demo-connector` / `pre`) — action Val avant go-live, non bloquant. |
| Base URL auth (si fallback OAuth) | **`https://gateway.<env>.mytroopers.com/v2`** — relevé : `https://gateway.pre.mytroopers.com/v2/auth/token`. Non appelée si auth = API Key statique (décision 3bis.3). |
| Documentation | `mts-1.com/docs` (OpenAPI / Redocly) — **URL exacte à confirmer** (hors relevé as-built) |
| Console paramétrage | `console.mts-1.com` → Compte pro → Intégration API/EDI — **à confirmer** (hors relevé) |
| Support éditeur | `supportit@mts-1.com` — **à confirmer** (hors relevé) |

> **Note hosts** : MTS-1 est le produit de l'éditeur **MyTroopers** — les appels d'API techniques transitent par les domaines `mytroopers.io` (data) / `mytroopers.com` (auth gateway), relevés dans le projet Bubble. Les URLs prod restent à générer en console avant go-live. Le naming `mts1` côté Savr (enums, `transporteurs.code_transporteur_mts1`, `integrations_inbox.source='mts1'`) est **inchangé** — seuls les hosts d'appel changent.

### 3bis.3 Authentification

- **Sortant (Plateforme → MTS-1)** : token API Bearer généré dans la console MTS-1 (Compte pro → Intégration API/EDI → Token API). Header `Authorization: Bearer <token>` sur **chaque** requête. Token stocké côté Plateforme dans **Supabase Vault** (jamais en clair en base ni en repo). Rotation manuelle (pas d'expiration documentée — cf. question ouverte Q3bis-4).
- **Entrant (MTS-1 → Plateforme)** : **sans objet en V1 — pas de webhook entrant** (ingestion = polling, décision Val 2026-06-05). La Plateforme n'expose **aucun endpoint de réception MTS-1** ; il n'y a donc pas de header de sécurité entrant ni de signature à vérifier côté Savr (la surface d'attaque entrante est nulle). **Conservé pour V1.1/V2 si activation des webhooks** : MTS-1 signe ses appels avec un token configuré console (header `Authorization`/`Bearer` par défaut, configurable → header dédié `X-Mts1-Webhook-Token` vérifié à la réception). Q3bis-1 (header webhook) reste **fermée mais sans objet V1**.

### 3bis.4 Référentiels MTS-1

| Référentiel MTS-1 | Endpoint | Usage Plateforme |
|---|---|---|
| Transporteurs (carriers) | `GET /v3/carrier` | Récupère la liste des `carrierShareableCode`. C'est le code qui identifie Strike / Marathon côté MTS-1 lors du **dispatch de la tournée** (`POST /v3/tours/{tourId}/dispatch`). Stocké sur `transporteurs.code_transporteur_mts1` (cf. §04 propagation 3bis). |
| Lieux favoris (favoritePlaces) | `PUT /v3/favoritePlaces`, `GET /v3/favoritePlaces` | Pré-enregistre les points récurrents (associations destinataires AG). `placeId` fonctionnel stocké sur `associations.id_point_collecte_mts1`. Le lieu d'enlèvement (traiteur) peut être passé en adresse inline (pas de pré-enregistrement requis). |

### 3bis.5 Flux nominal V1 (création commande + tournée + dispatch)

> **Modèle as-built (relevé Bubble 2026-06-05)** : Savr ne « délègue » pas une commande isolée ; il **crée la commande, crée la tournée qui la porte, la dispatch au transporteur, puis la valide**. Une collecte Savr = **1 customerOrder + 1 tour** côté MTS-1 par camion (iso-fonctionnel Bubble). L'ancien `delegate/customerOrder/toCarrier` (dérivé de la doc V3, jamais utilisé par Bubble) est abandonné.
>
> **Multi-camions V1 (précisé 2026-06-08)** : pour une grosse collecte, **Ops Savr fixe N camions** (`collectes.nb_camions_demande`, cf. [[04 - Data Model#Table : `collectes`]]). L'adapter **répète les étapes 1→4 pour chaque camion `rang = 1..N`** (même transporteur, volume global). Chaque itération produit 1 customerOrder + 1 tour, persistés dans une ligne `tournees` (`external_ref_commande` = customerOrderId, `tms_reference` = tourId) reliée par `collecte_tournees`. **Côté outbox, rien ne change** : l'event reste `collecte.creee` (par collecte) ; c'est l'**adapter** qui le déploie en N appels selon `nb_camions_demande`. En V2, le même event `collecte.creee` est reçu par le TMS natif qui décide N lui-même → contrat identique.
>
> **Changement de N après envoi — réconciliation par rang (arbitrage Val 2026-06-10, challenge logistique — remplace « N figé par Ops »)** : si Ops modifie `nb_camions_demande` après le déploiement initial, l'adapter **réconcilie l'état MTS-1 sur la nouvelle cible** :
> - **Augmentation (N→N+k)** : répéter les étapes 1→4 pour les **seuls rangs manquants** (rangs sans ligne `tournees`/`external_ref_commande`). L'idempotence par `orderNumber = reference-{rang}` protège les rangs existants de toute double-création.
> - **Réduction (N→N−k)** : `DELETE /v3/customerOrders/{customerOrderId}` des rangs retirés (rangs > N cible), suppression des lignes `tournees`/`collecte_tournees` correspondantes. Soumis à la règle MTS-1 « DELETE bloqué < 1h avant mission » (3bis.8) : si bloqué → **alerte Ops** + contact transporteur direct, les lignes locales ne sont supprimées qu'après succès du DELETE.
> - L'agrégation terminale (3bis.5 infra + [[05 - Règles métier#R_statut_collecte_multi_tournees]]) porte toujours sur l'**état courant** de `collecte_tournees`, jamais sur une valeur N historique.

```
Plateforme (validation attribution AG IDF/province par Admin Savr ou auto-accept)
  → collecte = `programmee`, `statut_tms = non_envoye`
  → calcul branche §06.09 §2.3 → transporteur résultant (type_tms = 'mts1')

  ── 1. Créer la commande ──────────────────────────────────────────────
    → POST /v3/customerOrders
        payload : orderDate (date de collecte), timezone, serviceTime,
                  orderCategories (["Alimentaire"] AG | ["Déchets"] ZD),
                  orderNumber = collecte.reference + '-' + rang (clé fonctionnelle de corrélation, UNIQUE par camion ; rang=1 si mono-camion),
                  place (lieu d'enlèvement : address.addressSingleLine inline ou placeId favori),
                  contact (contact_principal de l'événement),
                  timeslots[{ start, end }], stuffs (volume estimé repas / poids),
                  comment (informations_supplementaires)
      → réponse : { customerOrderId, customerOrderStatus, trackingUrl }

  ── 2. Créer la tournée (DRAFT) qui porte la commande ─────────────────
    → POST /v3/tours   (statut DRAFT)
        payload : la commande créée + (ZD) volume_du_camion (ex 9m3)
                  + MTS_1_delivery_place (exutoire, ex BlueSpaceIvry)
      → réponse : { tourId, status{ dispatch, payment, validation } }

  ── 3. Dispatcher la tournée au transporteur ─────────────────────────
    → POST /v3/tours/{tourId}/dispatch
        payload : { carrierShareableCode = transporteur.code_transporteur_mts1 }   // ex CA_49TWSU
        → `collectes.statut_tms = 'attribuee_en_attente_acceptation'`
        → réponse stockée dans `attributions_antgaspi.confirmation_transporteur`
              = { statut, reference_externe = customerOrderId, tour_id = tourId, recu_at, brut }

  ── 4. Valider la tournée ────────────────────────────────────────────
    → PUT /v3/tours/{tourId}/validate   (body vide → status.validation = VALIDATED)
```

`external_ref_commande` (= `customerOrderId` MTS-1, corrélé par `orderNumber = collecte.reference-{rang}`) est la **clé de corrélation** stockée **sur chaque tournée** (`tournees`, reliée par `collecte_tournees`) pour rapprocher les états remontés au polling (3bis.7) à la collecte Plateforme. `tms_reference` (= tourId) sert à lire les pesées et le statut de dispatch sur `GET /v3/tours/{tourId}`. *(En multi-camions, `attributions_antgaspi.confirmation_transporteur` singulier ne suffit plus : la vérité par camion est portée par les N lignes `tournees`.)*

**Agrégation terminale V1 (pas de webhook S5)** : l'adapter poll les N tours et, **une fois tous les tours `rang=1..N` en état terminal** (`OK`/`PARTIAL`/`CANCELED`/`KO` — jamais d'attente infinie sur un tour annulé, ajout 2026-06-10), agrège les pesées (depuis `pesees_tournees`, cf. [[04 - Data Model#Table : `pesees_tournees`]]) et produit l'effet terminal unique `collectes.statut = realisee` + `realisee_at` (cf. [[05 - Règles métier#R_statut_collecte_multi_tournees]] précision V1 + règle « Tour KO partiel » : ≥ 1 tour `OK`/`PARTIAL` → `realisee` sur les pesées disponibles + alerte Ops in-app si camions manquants ; tous `CANCELED`/`KO` → `rejetee_par_prestataire`). Sémantique identique au S5 V2, seul le déclencheur diffère. **Verrouillage de l'agrégation (ajout 2026-06-11, revue adversariale R5/R6)** : l'agrégation s'exécute dans une transaction qui (1) prend `SELECT … FOR UPDATE` sur la ligne `collectes`, (2) **relit sous ce lock** `collecte_tournees` ET `nb_camions_demande` (jamais un set lu avant — Ops peut avoir augmenté N pendant le poll : `COUNT(collecte_tournees) < nb_camions_demande` relu → abort, rangs en cours de création), (3) pose la transition par **garde idempotente** : `UPDATE collectes SET statut='realisee', realisee_at=now() WHERE id=$1 AND statut IN ('validee','en_cours')` — 0 ligne affectée = no-op strict (un poll concurrent a déjà agrégé ; `realisee_at` n'est **jamais** écrasé, c'est le départ de l'embargo H+24).

**Exécution par rang — commit immédiat + curseur de reprise (ajout 2026-06-11, R3/R4)** : le pipeline 1→4 s'exécute rang par rang ; après chaque réponse 201 de l'étape 1, la ligne `tournees` (`external_ref_commande`) est **commitée immédiatement**, avant toute étape suivante — jamais de persistance groupée en fin d'event (un crash entre un 201 MTS-1 et le commit local = commande orpheline indétectable → doublon au retry). La reprise d'un event interrompu se positionne sur le **curseur persisté par rang** : `external_ref_commande IS NULL` → réconciliation (3bis.9) puis étape 1 ; `external_ref_commande NOT NULL` + `tms_reference IS NULL` → reprendre à l'étape 2 **sur l'order existant** (jamais de re-création) ; `tms_reference NOT NULL` → reprendre au dispatch/validate (étapes 3-4, idempotentes par re-lecture du `status` du tour).

> ⚠ **Idempotence du push sortant — TRANCHÉE (Val 2026-06-11, revue adversariale — remplace la QO revue frère 2026-06-08) : `POST /v3/customerOrders` est présumé NON idempotent.** La clé fonctionnelle reste **`orderNumber = collecte.reference-{rang}`** (pas `collecte.reference` seule, plus unique en multi-camions), mais elle ne protège rien côté MTS-1 — toute la protection est côté Savr : (1) ne POSTer que si `external_ref_commande IS NULL` pour ce rang ; (2) ne retenter automatiquement que sur erreur `TRANSIENT` certaine (5xx/réseau) ; (3) **timeout ambigu ou reprise post-crash (`requires_reconciliation`, cf. [[04 - Data Model#Table : `outbox_events`]]) → réconciliation 3bis.9 obligatoire AVANT tout re-POST**. La confirmation éditeur reste souhaitable (Q3bis-5 incluse) mais n'est plus bloquante : le plan B (scan fenêtre + match `orderNumber` côté Savr) est codé dès V1. ⚠ `POST /v3/tours` porte la même ambiguïté de timeout **sans clé de recherche connue** → **QO éditeur (nouvelle, 2026-06-11)** : comment lister les tours d'un customerOrder ? À défaut, la reprise étape 2 post-timeout passe par `GET /v3/customerOrders/{id}` (la commande référence-t-elle son tour ?) — à vérifier en DEMO avant le module logistique.

### 3bis.6 Mapping statut MTS-1 → `statut_tms` Plateforme

La machine à états reste **identique à la ZD et à Everest** (cf. §3) : `validee` est dérivée par le trigger `fn_sync_statut_collecte_from_tms` à l'acceptation, jamais forcée à la validation d'attribution.

| Événement MTS-1 | `customerOrderStatus` MTS-1 | `collectes.statut_tms` | `collectes.statut` (dérivé trigger) |
|---|---|---|---|
| Tour créé + dispatché (HTTP 200/201) | `PLANNED` / `VALIDATED` | `attribuee_en_attente_acceptation` | `programmee` |
| Signal positif explicite (commande intégrée à une tournée acceptée — détecté au polling) | `PLANNED` / `VALIDATED` | `acceptee` | `validee` |
| `customerOrder/progress` `STARTED` | `IN_PROGRESSION` | `acceptee` | `en_cours` |
| `customerOrder/progress` `FINISHED` | `OK` / `PARTIAL` | `acceptee` | `realisee` |
| Refus / annulation transporteur — au polling : `customerOrderStatus ∈ {CANCELED, KO}` (ou, en V1.1/V2 webhook, `tour/update` eventType `CANCELED`/`UNVALIDATED` au niveau tournée) | `CANCELED` / `KO` | `rejetee_par_prestataire` | reste `programmee` (retour file + notif Admin) |

**Acceptation = signal positif explicite uniquement** : règle **commune Everest + MTS-1**, définie une fois en **§3** (« Acceptation = signal positif explicite uniquement », révision 2026-05-29) — la Plateforme ne bascule **jamais** en `acceptee` par délai écoulé, tant qu'aucun signal positif n'est reçu la collecte reste `attribuee_en_attente_acceptation` + monitoring Ops (§06.06). *(Dédupliqué revue sobriété §08 App 2026-05-31 B2 — source unique §3.)*

Spécificités MTS-1 (mapping concret de la règle §3) :
- **Acceptation** : MTS-1 V3 n'expose **pas** de signal « ordre accepté » dédié → signal positif déduit, au polling, du passage de la commande à `PLANNED`/`VALIDATED` (commande intégrée à une tournée acceptée — `tour.status.dispatch = ACCEPTED`) ou de `customerOrderProgressionStatus = STARTED` → `statut_tms = 'acceptee'`.
- **Refus transporteur** : détecté **au polling V1** par lecture du `customerOrderStatus` qui passe à `CANCELED`/`KO` (la tournée dispatchée n'est pas acceptée — `tour.status.dispatch` rejeté / `appointmentStatus = RESPONSE_KO`). → `statut_tms = 'rejetee_par_prestataire'` + notif Admin + retour file (motif preset). En V1.1/V2 (webhooks), le refus remonte au niveau **tournée** via `tour/update` (`CANCELED`/`UNVALIDATED`), le dispatch étant désormais porté par la tournée et non par une délégation de commande. Q3bis-2 **fermée**.

### 3bis.7 Remontée entrante V1 — POLLING (MTS-1 → Plateforme)

> **Décision Val 2026-06-05 (relevé §9)** : la remontée est en **polling**, pas en webhooks. La Plateforme n'expose **aucun endpoint entrant** ; un cron (`SERVICE_ROLE`) interroge MTS-1 sur une fenêtre `minDate/maxDate` glissante.
>
> **Cadence figée 2026-06-10 (challenge logistique — remplace « 15-30 min en journée », ambiguïté dangereuse)** : **cron 24/7, toutes les 15 min, sans restriction horaire**. Les collectes s'exécutent entre 22h et 3h et le batch bordereaux/attestations tourne à J+1 6h : un cron diurne raterait les pesées de nuit. Aligné CLAUDE.md §12 (« polling MTS-1 15 min »).

**Cron de polling** :

| Appel MTS-1 (GET) | Lu | Traitement Plateforme |
|---|---|---|
| `GET /v3/customerOrders?minDate&maxDate` + `GET /v3/customerOrders/{id}` | `customerOrderStatus` + `customerOrderProgressionStatus` | MAJ `statut_tms` / `statut` selon mapping 3bis.6. Corrélation via `customerOrderId` (= `attributions_antgaspi.confirmation_transporteur.reference_externe`). Le **refus transporteur** se déduit du passage à `customerOrderStatus ∈ {CANCELED, KO}` (logique 3bis.6 inchangée, simplement détectée par lecture d'état au lieu d'un push). |
| `GET /v3/tours/{tourId}` | `stops[].weight` (+ `quantityAfter*`), `status{dispatch,payment,validation}`, photos URLs | Pesées ZD → `collectes`/lignes flux ; photos téléchargées et ré-uploadées dans le Storage Savr (persistance légale). |

**Dédup / idempotence** : chaque event détecté au polling passe par `integrations_inbox` (fenêtre 7 j, cf. §6) avant traitement. **Clé de dédup = `(source='mts1', customerOrderId, customerOrderStatus)`** — `occurred_at` exclu de la clé *(tranchée F1 2026-06-07 : au polling, `occurred_at` = `NOW()` côté Plateforme, non natif MTS-1 → deux polls successifs sur le même état produiraient des `occurred_at` différents et passeraient le dédup → double traitement)*. Le `event_id` stocké dans `integrations_inbox` est généré synthétiquement = `md5(source || customerOrderId || customerOrderStatus)` converti en UUID. Un même état pour une même commande est traité exactement une fois ; si l'état change (`PLANNED` → `IN_PROGRESSION`), c'est une nouvelle clé → traité normalement. **Claim atomique (ajout 2026-06-11, revue adversariale R10)** : le poll n'a **aucun verrou global de run** (assumé — §07 ligne « verrous applicatifs ») ; deux runs qui se chevauchent (run lent > 15 min) sont donc possibles. La dédup ne doit JAMAIS être un check-then-act : **`INSERT INTO integrations_inbox … ON CONFLICT (event_id) DO NOTHING RETURNING id`** — pas de ligne retournée = l'event est pris par un run concurrent, skip. UNIQUE sur `event_id` obligatoire (§6). Le traitement est isolé **par collecte** (try/catch : l'échec d'une collecte ne fait pas échouer le run entier, R12) ; les transitions d'état sont protégées par les gardes idempotentes (3bis.5 agrégation, trigger `fn_sync_statut_collecte_from_tms` déjà conditionnel).

**Upsert pesées & photos — la clé de dédup ci-dessus ne couvre QUE les statuts (ajout 2026-06-10, challenge logistique)** : le poll relit `stops[].weight` et les URLs photos à chaque run, indépendamment de tout changement de `customerOrderStatus`. Règles d'idempotence dédiées :

- **Pesées** : **upsert idempotent par clé naturelle `(tournee_id, stop_id, flux_id)` dans la table `pesees_tournees`** (tournée Savr corrélée par `tms_reference = tourId` ; table créée 2026-06-11, revue adversariale INC-0 — la clé d'upsert était spécifiée sans table porteuse, `collecte_flux` étant l'agrégat par collecte dérivé à l'agrégation terminale). Re-lecture du même poids = no-op ; **poids modifié côté MTS-1 (correction chauffeur) = UPDATE écrasant** tant que la collecte n'est pas `cloturee` — après clôture, aucune écriture (correction = flux Admin §05 édition + avoir). Jamais d'INSERT en doublon sur re-poll. **Divergence post-clôture (ajout 2026-06-11, R7)** : la clôture étant immédiate après `realisee` (§05), une correction chauffeur tardive arrive presque toujours sur une collecte `cloturee` → l'adapter qui lit un poids distant ≠ poids local sur une collecte `cloturee` n'écrit **rien** mais lève une **alerte Ops in-app « divergence pesée post-clôture »** + trace `integrations_logs` (`erreur_code='PESEE_DIVERGENCE_POST_CLOTURE'`) — sans ce signal, la vérité MTS-1 diverge silencieusement du bordereau réglementaire. L'Admin corrige via le flux existant (édition + recalcul + régénération + avoir).
- **Identification du flux d'une pesée — RELEVÉ AS-BUILT, QO SOLDÉE (2026-06-10, lecture API Connector Bubble, appel `Create customer order dechet`)** : Bubble crée la commande ZD avec **1 `stuff` par flux**, `task: PICKUP`, `relatedAddress.placeId = <MTS_1_delivery_place_id>` (exutoire), `quantity: 0` à la création. Le poids remonte ensuite par stuff (`stops[].weight`). **Libellés exacts relevés → mapping `flux_dechets`** (rapprochement par `name` strict, ces chaînes sont la clé) :

  | `stuffs[].name` MTS-1 (exact, as-built) | Flux canonique Plateforme |
  |---|---|
  | `<volume_du_camion>` (quantity 1) | — pas un flux : stuff « camion », à **ignorer** dans les pesées |
  | `Bio-déchets (en kg)` | `biodechet` |
  | `Carton (en kg)` | `carton` |
  | `D.I.B (en kg)` | `dechet_residuel` (ex-DIB, renommage 2026-05-02) |
  | `Film plastique (en kg)` | `emballage` |
  | `Verre (en kg)` | `verre` |

  L'adapter V1 **reproduit ces libellés à l'identique** en sortant (iso-Bubble, ne pas « canoniser ») et rapproche en entrant par match exact sur `name` (fallback normalisé casse/accents + alerte Ops si stuff inconnu). `equivalent_roll` / `nb_bacs` : non remontés par MTS-1 → laissés NULL (colonnes nullables) ; `quantity`/`quantityAfterPickup` loggés mais non mappés V1.
- **Photos** : dédup par **clé `(tourId, stopId, photoId)`** (ou hash de l'URL si `photoId` absent du payload) avant téléchargement — une photo déjà ré-uploadée dans le Storage Savr (ligne `shared.fichiers` existante) n'est **jamais** re-téléchargée.
- **Photo en erreur (404 / timeout au download)** : pas de retry immédiat — **retentée au prochain poll** (15 min). Si toujours absente quand la collecte atteint son état terminal : la collecte passe `realisee` quand même (photo **non bloquante**), **alerte Ops in-app** « photo manquante », bordereau/attestation générés sans photo. Trace `integrations_logs` (`erreur_code='PHOTO_DOWNLOAD_FAILED'`).
- **Batch J+1 6h vs pesées indisponibles** (MTS-1 down toute la nuit, poll en échec) : le batch bordereaux/attestations **skippe** toute collecte `realisee` dont les pesées sont incomplètes + alerte Admin in-app — il ne génère **jamais** un bordereau vide. Les collectes skippées sont rattrapées au batch suivant une fois le poll rétabli. **Définition « complet » + escalade anti-famine (ajout 2026-06-11, revue adversariale R9)** : complet = chaque tour `OK`/`PARTIAL` de la collecte a ≥ 1 ligne `pesees_tournees` avec `poids_kg NOT NULL` par flux attendu (stuff « camion » exclu). Si la donnée n'arrive **jamais** (chauffeur n'a pas pesé, tour `OK` sans weight), le skip est sinon infini : bordereau jamais généré, facturation ZD bloquée sans échéance. **Règle : collecte skippée depuis > 48h (2 batchs)** → escalade Admin explicite « saisie manuelle des pesées requise » (flux `cf_update_staff` §06.06, motif obligatoire + `audit_log`) ; après saisie, le batch suivant la prend.

> **Webhooks MTS-1 = option différée V1.1/V2 (décision Val 2026-06-05)** : MTS-1 supporte des webhooks push natifs (`customerOrder/progress`, `customerOrder/update`, `stop/progress`, `tour/progress`, `tour/update`) + un filet `GET /v3/webhook` / `POST /v3/webhook/{id}`. Non implémentés V1 (le polling couvre le besoin batch J+1, surface d'attaque entrante nulle, un seul chemin de code). Réactivation si un besoin temps réel émerge — alors l'avancement (started/finished, pesées) resterait piloté **au niveau commande** (`customerOrder/progress`) et l'acceptation/refus du dispatch **au niveau tournée** (`tour/update` : `DISPATCHED`/`VALIDATED`/`CANCELED`/`UNVALIDATED`), le grain Savr restant la collecte = 1 commande + 1 tournée MTS-1.

### 3bis.8 Modification / annulation d'un ordre

| Action Plateforme | Endpoint MTS-1 | Contrainte |
|---|---|---|
| Modifier une commande | `PUT /v3/customerOrders/{customerOrderId}` | Re-push des champs modifiés (créneau, volume, contact). |
| Annuler une commande | `DELETE /v3/customerOrders/{customerOrderId}` | **Bloqué si < 1h avant le début de la mission** (règle MTS-1). Au-delà : contact opérationnel direct transporteur. La tournée associée (3bis.5 étape 2) est annulée avec la commande. |

Toute modification d'une collecte côté Plateforme déjà poussée à MTS-1 (`statut_tms ∈ {attribuee_en_attente_acceptation, acceptee}`) déclenche un re-push `PUT` (cf. règle existante `PATCH /collectes/:id` E2 + flag `dirty_tms`).

### 3bis.9 Gestion des erreurs, retry, idempotence

- **Idempotence sortante** *(corrigé 2026-06-10, challenge Frontière — **durci 2026-06-11, revue adversariale : MTS-1 présumé NON idempotent, tranché Val**)* : clé fonctionnelle = **`orderNumber = collecte.reference-{rang}`** (une par commande/camion, `rang=1` si mono-camion). **Garde primaire côté Savr** : avant tout POST, vérifier `tournees.external_ref_commande IS NULL` pour ce rang — ne jamais re-POSTer une commande déjà corrélée (cf. 3bis.5). **Réconciliation (séquencement figé 2026-06-11)** : déclenchée par timeout ambigu (`AMBIGUOUS`) OU reprise post-crash (`outbox_events.requires_reconciliation=true`) ; exécutée au run suivant, **avant** la garde `external_ref_commande IS NULL` : recherche par `orderNumber` côté MTS-1 — ⚠ le paramètre de filtre `GET /v3/customerOrders?orderNumber=...` n'est **pas confirmé** par le relevé as-built (Q3bis-5) ; **le plan B est codé dès V1** : scanner la fenêtre `minDate/maxDate` autour de `orderDate` et matcher `orderNumber` côté Savr. Commande trouvée → adopter le `customerOrderId` (renseigner `external_ref_commande`), reprendre le pipeline au curseur (3bis.5) ; absente → re-POST autorisé. *(Le modèle create-order-puis-tour-puis-dispatch est confirmé as-built — Q3bis-3 close ; la variante `POST /v3/customerOrders/import` n'est plus envisagée V1.)*
- **Retry** : politique alignée §08 et §6 — **3 paliers 5 min / 1h / 24h**. Au-delà, notification Admin urgente + bouton « Renvoyer à MTS-1 » (cf. §06 §3 Bloc 0).
- **Erreurs** : 4xx (données invalides) → pas de retry, collecte reste `non_envoye`/`attribuee_en_attente_acceptation` + notif Admin avec message MTS-1. 5xx/timeout → retry 3 paliers.

### 3bis.10 Réconciliation / archive *(différé V2 — revue sobriété §08 App 2026-05-31 A2)*

> **Non implémenté V1** : l'extraction `GET /v3/extract/activitysheet?minDate&maxDate` (CSV) sert (1) le rapprochement coûts logistiques (besoin M07 TMS, **V2**) et (2) l'archive de clôture à la résiliation MTS-1 (**cutover V2**). Les deux usages sont V2 → endpoint **non intégré V1**. D'ici là, extraction manuelle ponctuelle via la console MTS-1 si nécessaire. À spécifier au moment du cutover (§13 TMS Migration MTS-1).

### 3bis.11 Frontière V2 — déprécation MTS-1

Au cutover V2, l'intégration MTS-1 est **entièrement coupée** : le Savr TMS prend le relais du dispatch terrain (webhooks S1-S11 / E1-E10, cf. §1 et CDC TMS). Les champs `transporteurs.code_transporteur_mts1`, `associations.id_point_collecte_mts1` deviennent dépréciés (conservés en lecture pour audit historique). La bascule est pilotée par §13 TMS (Migration MTS-1).

### 3bis.12 Décisions prises

- **MTS-1 conservé en V1 comme système de dispatch terrain** des transporteurs `type_tms = 'mts1'` (Strike, Marathon). Annule la décision historique « MTS-1 retiré » (qui anticipait à tort une coupure dès V1 ; la coupure est en réalité V2). Le fallback « commandes manuelles Admin » reste le plan de secours en cas d'indisponibilité MTS-1, pas le mode nominal.
- **API V3 uniquement** (V2 dépréciée par l'éditeur).
- **Corrigé 2026-06-06 (relevé as-built)** : le modèle réel est **création commande + création tournée (DRAFT) + dispatch tournée (`carrierShareableCode`) + validation** (`POST /v3/customerOrders` → `POST /v3/tours` → `POST /v3/tours/{tourId}/dispatch` → `PUT /v3/tours/{tourId}/validate`). L'endpoint `delegate/customerOrder/toCarrier` était dérivé de la doc V3 et n'a jamais été implémenté par Bubble. Une collecte Savr = 1 customerOrder + 1 tour. Q3bis-3 **close** par le relevé.
- **Acceptation sur signal positif explicite uniquement** (pas d'auto-accept au temps écoulé — décision Val 2026-05-29), alignée sur Everest. Sans signal, la collecte reste en attente + monitoring Ops.
- **Pilotage `statut_tms` par la Plateforme en V1** (pas de webhook TMS Savr) ; bascule TMS en V2.
- **Remontée MTS-1 = POLLING en V1** (décision Val 2026-06-05, relevé §9) : cron `GET /v3/customerOrders` + `GET /v3/tours` + photos, cadence 15-30 min, dédup `integrations_inbox`. **Pas de webhook entrant V1** → aucun endpoint exposé, surface entrante nulle. Webhooks = option V1.1/V2.
- **Auth sortante V1 = API Key statique** `Authorization: Bearer <clé>` (console MTS-1, Supabase Vault, server-side) ; flow `gateway/v2/auth/token` client-credentials = plan B.
- **Tests d'intégration sur l'environnement de DEMO MTS-1** (confirmé éditeur 2026-05-31, invitations reçues) — pas de mission réelle déclenchée.
- **Refus transporteur** discriminé par `customerOrderStatus ∈ {CANCELED, KO}` (détecté au polling V1 ; en webhook = event `customerOrder/update` type `UPDATE`, confirmé éditeur 2026-05-31).
- → **sans objet V1** (pas de webhook entrant). Conservé pour activation V1.1/V2 : header dédié `X-Mts1-Webhook-Token`.

### 3bis.13 Questions ouvertes (éditeur MTS-1)

1. **Fermée 2026-05-31** : token dans header `Authorization`/`Bearer` par défaut, nom + préfixe configurables (Compte pro → Intégration API). V1 = header dédié `X-Mts1-Webhook-Token`, vérifié à la réception (cf. 3bis.3).
2. **Fermée 2026-05-31** : en délégation, le refus = événement **`customerOrder/update` type `UPDATE`** (discriminé par `customerOrderStatus ∈ {CANCELED, KO}`, pas un `eventType CANCELED`). Mapping 3bis.6 + 3bis.7 corrigés.
3. **Fermée 2026-06-06 par le relevé as-built Bubble** : le flux réel est **`POST /v3/customerOrders` → `POST /v3/tours` (DRAFT) → `POST /v3/tours/{tourId}/dispatch` (`carrierShareableCode`) → `PUT /v3/tours/{tourId}/validate`**. 1 collecte = 1 commande + 1 tournée. Pas de `delegate`, pas d'`import`. *(Confirmation éditeur facultative — le comportement Bubble en prod fait foi.)*
4. **Partiellement fermée 2026-05-31** : environnement de **DEMO** disponible pour les tests d'intégration (invitations reçues). **Reste à confirmer** : rate limits + durée de vie / rotation du token API.
5. **Q3bis-5 — Filtre `GET /v3/customerOrders?orderNumber=...` (ouverte 2026-06-10, challenge logistique)** : le rattrapage post-timeout (3bis.9 « recherche par `orderNumber` avant recréation ») suppose un paramètre de filtre `orderNumber` — **non confirmé par le relevé as-built** (seuls `minDate`/`maxDate` relevés). À confirmer auprès de l'éditeur (avec Q4 rate limits/TTL). **Plan B si le filtre n'existe pas** : scan de la fenêtre `minDate/maxDate` autour de `orderDate` + match `orderNumber` côté Savr (même garantie, un appel plus large). **Dé-bloquée 2026-06-11 (revue adversariale)** : le plan B est codé dès V1, la réponse éditeur n'optimise que le coût de l'appel.
6. **Q3bis-6 — Retrouver le tour d'un customerOrder (ouverte 2026-06-11, revue adversariale R4)** : `POST /v3/tours` a la même ambiguïté de timeout que le POST commande, **sans clé de recherche connue**. Comment lister/retrouver le tour créé pour un `customerOrderId` donné (la réponse `GET /v3/customerOrders/{id}` référence-t-elle son tour ?) — à vérifier en DEMO avant de coder l'adapter ; conditionne la reprise étape 2 du curseur 3bis.5.

---

## 4. Service email — Resend

### Pattern retenu

**Resend** comme provider unique V1. Intégration via SDK officiel dans Supabase Edge Functions.

### Raisons du choix

- Gratuit jusqu'à 3 000 emails/mois (bon pour V1 + ramp-up)
- 20 $/mois pour 50 000 emails (couvre 2026 complet à la louche)
- Délivrabilité moderne (SPF, DKIM, DMARC)
- Webhooks de délivrance (ouvert, cliqué, bounce, spam)

### Architecture envoi

```
Événement métier (ex: collecte clôturée)
  → Trigger Supabase (DB trigger ou Edge Function)
  → Edge Function `send-email.ts`
    → Lecture template en DB (table `email_templates`)
    → Interpolation des variables ({{prenom}}, {{date_collecte}})
    → Appel API Resend
    → Enregistrement dans `emails_envoyes` (historique)
```

### Table `emails_envoyes`

- `id`, `destinataire_user_id`, `destinataire_email`, `template_slug`, `objet`, `variables_jsonb`, `resend_id`, `statut` (`envoye`/`ouvert`/`clique`/`bounce`/**`echec`** — *valeur ajoutée 2026-06-07, F3*), `tentative_numero`, `created_at`, `delivered_at`
- **Définition canonique intégrée [[04 - Data Model]] le 2026-06-07 (F1)** — schéma complet + RLS (write SERVICE_ROLE seul, SELECT admin_savr).

### Gestion des échecs d'envoi *(spécifié 2026-06-07 — F3 tranchée Val, session test-scenarios §06.02)*

- **Échec API Resend** (5xx, timeout) : **3 retries** espacés **5 min / 1h / 24h** (`tentative_numero` 2-4, retry policy unifiée §08 §1/§2/§3bis, alignée 2026-06-29 R10b). Après échec final : `emails_envoyes.statut = echec` + ligne `integrations_logs` (`system='resend'`, `statut='echec_final'`). Pas de DLQ dédiée V1 — requête dashboard Admin sur `statut='echec'`.
- **Variable requise manquante au rendu** (déclarée dans `email_templates.variables`, absente du payload) : **refus d'envoi** (jamais d'email avec `undefined`/placeholder brut) + `integrations_logs` `erreur_code='MISSING_VARIABLE'`.
- **Slug inexistant ou template `actif=false`** : aucun appel Resend, trace `integrations_logs` (`TEMPLATE_NOT_FOUND` / skip inactif).
- `bounce` et `echec` sont **terminaux** : un event Resend tardif (ex. `opened` après `bounce`) ne régresse pas le statut.

### Webhooks Resend

Endpoint Plateforme : `POST /webhooks/resend/events` — MAJ `emails_envoyes.statut` selon event Resend.

*Sécurisation (2026-06-07, F3)* :
- **Signature svix vérifiée** (headers `svix-id`/`svix-timestamp`/`svix-signature`, secret signing Resend). Signature absente ou invalide → **401**, aucune écriture.
- **`resend_id` inconnu** (aucune ligne `emails_envoyes`) → **200** (évite la boucle de retry Resend) + anomalie tracée `integrations_logs`.
- Dédup : event déjà appliqué (même `svix-id`) → no-op idempotent.

---

## 5. Génération PDF — Puppeteer self-hosted

### Pattern retenu

**Puppeteer** (Chrome headless) déployé dans un container dédié. Templates HTML/CSS versionnés dans le repo. Choix de Val pour maîtriser parfaitement le graphisme et limiter les coûts.

### Architecture

```
Déclenchement (ex: clôture collecte)
  → Edge Function `generate-pdf.ts`
    → Construction payload (données snapshot)
    → Appel micro-service Puppeteer (container dédié, HTTP interne)
      → Rendu HTML depuis template + payload
      → Export PDF
      → Upload vers Supabase Storage
    → Retour URL PDF
    → MAJ table (bordereaux_savr / attestations_don / rapports)
```

### Déploiement Puppeteer

Options pour le container Puppeteer :

| Option | Coût | Avantage |
|--------|------|----------|
| Railway | ~5-10$/mois | Simple, CI/CD intégrée |
| Fly.io | ~5$/mois | Plus de contrôle infra |
| Render | ~7$/mois | UI simple |

**Reco** : Railway V1 (plus simple, bonne DX). Bascule Fly.io si besoins infra avancés.

### Templates

3 templates V1 :
1. **Bordereau Savr** (ZD)
2. **Attestation de don** (AG, 2041-GE)
3. **Rapport RSE post-collecte** (tous types)

Templates HTML/CSS co-construits avec Val avant dev.

### Versioning des templates

Chaque template a un numéro de version. Lors de la génération, la version utilisée est enregistrée dans la table (ex: `bordereaux_savr.template_version`). Si le template évolue, les anciens PDFs restent cohérents.

---

## 6. Stratégie d'idempotence et de retry

### Idempotence

Toutes les intégrations utilisent une clé d'idempotence :
- **Plateforme ↔ TMS** : **simplifié revue sobriété Bloc C 2026-05-01 C4** — `event_id` UUID v4 lu directement depuis `body.event_id`, dédup côté consommateur via table `integrations_inbox` PK `event_id` (fenêtre **7 jours** Bloc B B5)
- Pennylane : `idempotency_key` header avec `facture_id`
- TMS Savr (clé métier secondaire) : `collecte_id`, `tournee_id`, `prestataire_id`, `lieu_id` selon l'entité concernée

### Ordre des événements (Plateforme ↔ TMS)

Les événements portent un champ `occurred_at` (horodatage métier). Si un event reçu a un `occurred_at` antérieur au dernier traité pour la même entité → event **ignoré** (pas d'écrasement d'un état plus récent par un plus ancien). Protège contre les reorderings réseau et les retries tardifs.

### Retry policy

**Uniforme sur toutes les intégrations externes**, alignée avec [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] :
- 5xx ou timeout → retry **3 fois : 5 min / 1h / 24h** *(simplifié revue sobriété Bloc B 2026-05-01 B1 — ex-5 fois 5 min/30 min/2h/6h/24h)*
- Backoff exponentiel avec jitter aléatoire ± 10%
- Échec après les 3 retries (4 tentatives au total) → notification Admin Savr + statut `echec_final` dans `integrations_logs` *(corrigé revue sobriété §08 App 2026-05-31 C1 — ex « après 5 tentatives », résidu de l'ex-politique 5 paliers)*
- Resume manuel par Admin (bouton "rejouer la sync")

> **Source de vérité retry** *(revue sobriété §08 App 2026-05-31 C2)* : cette section §6 est la **définition authoritative** de la retry policy Plateforme (3 paliers 5 min / 1h / 24h). Les sections §1 (TMS), §2 (Pennylane) et §3bis.9 (MTS-1) y renvoient et ne la redéfinissent pas — éviter la dérive (cf. bug C1 ci-dessus, né d'une définition dupliquée).

### Table `integrations_logs`

- `id`, `system` (enum: tms/pennylane/resend/**everest**/**mts1** — ajout 2026-05-31 D1, appels directs V1), `direction` (entrant/sortant), `endpoint`, `action`, `entite_id`, `event_id`, `request_headers` (sans Authorization), `request_jsonb`, `response_jsonb`, `response_status`, `latence_ms`, `statut` (succes/echec_retryable/echec_final), `tentative_numero`, `erreur_code`, `created_at`
- **Rétention** : 2 ans

### Table `integrations_inbox` (nouveau V1, dédup idempotence TMS ↔ Plateforme)

- `event_id` (UUID, PK), `type`, `source` (enum: tms/**mts1** — ajout 2026-05-31 D2, dédup webhooks MTS-1 entrants §3bis.7), `recu_le`, `traite_le`, `statut` (traite/ignore_doublon/ignore_out_of_order)
- **Rétention** : 7 jours (suffisant pour couvrir les 3 retries jusqu'à 24h, simplifié revue sobriété Bloc B 2026-05-01 B5 ex-5 retries)
- Permet de rejeter un `event_id` déjà traité (idempotence stricte) et de détecter les events out-of-order

---

## 7. Sécurité des intégrations

- **Secrets** : stockés dans Supabase Vault (pas en clair dans le code)
- **Rotation** : clés API rotées **annuellement** par Admin Savr (alignement décision 9.1.20 atelier 2026-04-23, cohérence §07 + addendum §08, sweep audit cohérence 2026-04-29 B3)
- **Audit** : table `integrations_logs` archivée 2 ans min
- **Webhooks entrants** : signature vérifiée (HMAC) sur chaque webhook pour rejet des requêtes non authentifiées
- **Rate limiting** : imposé côté Plateforme pour éviter dépassement quotas (Pennylane 120 req/min, Everest à valider, Resend 10 req/s sur plan payant)

---

## 8. Endpoint utilitaire SSO cross-app (supprimé revue sobriété 2026-05-01 A1)

> ⚠ **Section supprimée le 2026-05-01 (revue sobriété §08 TMS Bloc A, A1)** — endpoint `GET /api/v1/me/has-profile` retiré V1.
>
> **Justification** : confort UX pur (≤4 users cumul concernés). Bouton sidebar cross-app affiché inconditionnellement, page d'accès refusé propre côté cible si user sans profil. Coût opérationnel = 0.
>
> **Conséquences** :
> - Suppression endpoints des deux côtés (`app.gosavr.io/api/v1/me/has-profile` + `tms.gosavr.io/api/v1/me/has-profile`).
> - Suppression cookie httpOnly `savr.has_plateforme_profile` TTL 1h.
> - Suppression CORS dédié `Origin: https://tms.gosavr.io` + `credentials: include`.
> - §11 D3 TMS et §11 Plateforme : bouton sidebar inconditionnel (à propager).

---

## 9. Endpoints Admin — Paramètres Taux de recyclage *(ajout 2026-05-06)*

Endpoints internes Plateforme dédiés à l'administration des **taux de captation par filière** utilisés pour le calcul du **Taux de recyclage** (cf. [[04 - Data Model]] addendum 2026-05-06 + table `parametres_taux_recyclage`).

### Pattern retenu

REST + JSON. Auth JWT Supabase. Réservé `admin_savr` (Val + Louis). Lecture autorisée à `ops_savr`. Audit trail automatique via trigger DB sur `parametres_taux_recyclage_history`.

### Endpoints

#### 9.1 Lister les filières et leurs taux

```
GET /api/v1/admin/parametres/taux-recyclage
Authorization: Bearer <jwt>
```

Retour : tableau des 4 filières actives avec leurs taux de captation, prestataire, source, date de dernière modification.

```json
{
  "filieres": [
    {
      "id": "uuid",
      "code_filiere": "verre",
      "nom_filiere": "Verre",
      "taux_captation": 0.96,
      "prestataire": "Citeo",
      "source_donnee": "Citeo 2023",
      "commentaire": null,
      "actif": true,
      "date_maj": "2026-05-06T10:00:00Z"
    },
    { "code_filiere": "carton", "taux_captation": 0.90, "...": "..." },
    { "code_filiere": "biodechet", "taux_captation": 0.87, "...": "..." },
    { "code_filiere": "emballage", "taux_captation": 0.77, "...": "..." }
  ]
}
```

**Permissions** : `admin_savr` + `ops_savr`. Autres rôles → 403.

#### 9.2 Modifier le taux d'une filière

```
PUT /api/v1/admin/parametres/taux-recyclage/{filiere_id}
Authorization: Bearer <jwt>
Idempotency-Key: <uuid v4>
Content-Type: application/json

{
  "taux_captation": 0.92,
  "prestataire": "Citeo",
  "source_donnee": "Citeo 2024 — rapport annuel",
  "commentaire_modif": "MAJ Citeo 2024 publiée le 15 mars"
}
```

Validation serveur :
- `taux_captation` : decimal 0 ≤ x ≤ 1, sinon 422
- `commentaire_modif` : NOT NULL, ≥ 5 caractères (motif obligatoire)
- `Idempotency-Key` : si déjà reçu dans les 24h → renvoie le résultat précédent (cf. §6 Idempotence)

Retour 200 :
```json
{
  "id": "uuid",
  "code_filiere": "carton",
  "taux_captation": 0.92,
  "prestataire": "Citeo",
  "source_donnee": "Citeo 2024 — rapport annuel",
  "date_maj": "2026-05-06T11:30:00Z",
  "history_id": "uuid"
}
```

**Permissions** : `admin_savr` uniquement. `ops_savr` → 403.

**Effets de bord** :
- UPDATE `parametres_taux_recyclage` (champs modifiés + `date_maj` + `updated_at`)
- INSERT `parametres_taux_recyclage_history` (via trigger DB) avec snapshot avant/après + `modifie_par = auth.uid()` + `commentaire_modif`
- **Pas de recalcul des collectes existantes** : les anciens `collectes.caps_appliques` restent figés (PDF Rapport RSE déjà générés inchangés). Les nouveaux taux s'appliquent uniquement aux collectes clôturées **après** la modification.

#### 9.3 Consulter l'historique d'une filière

```
GET /api/v1/admin/parametres/taux-recyclage/{filiere_id}/history?limit=50
Authorization: Bearer <jwt>
```

Retour : liste antéchronologique des modifications.

```json
{
  "history": [
    {
      "modifie_le": "2026-05-06T11:30:00Z",
      "modifie_par": { "id": "uuid", "nom": "Val" },
      "taux_captation_avant": 0.90,
      "taux_captation_apres": 0.92,
      "prestataire_avant": "Citeo",
      "prestataire_apres": "Citeo",
      "source_donnee_avant": "Citeo 2023",
      "source_donnee_apres": "Citeo 2024 — rapport annuel",
      "commentaire_modif": "MAJ Citeo 2024 publiée le 15 mars"
    }
  ]
}
```

**Permissions** : `admin_savr` + `ops_savr`. Autres rôles → 403.

### Trigger DB de calcul `taux_recyclage` (collecte clôturée)

À chaque transition `collectes.statut → cloturee` (et `type = zero_dechet`), un trigger DB `AFTER UPDATE` :

1. Lit les `collecte_flux` (5 lignes max — `verre`, `carton`, `biodechet`, `emballage`, `dechet_residuel`)
2. Lit `parametres_taux_recyclage` actifs (4 lignes)
3. Calcule `taux_recyclage = SUM(P_X × cap_X) / SUM(P_X + P_omr) × 100` (cf. §05 Règles métier R_taux_recyclage)
4. Si `SUM(P_X + P_omr) = 0` → `taux_recyclage = NULL`
5. Snapshot `caps_appliques jsonb = {"verre": 0.96, "carton": 0.90, ..., "version_parametres_at": NOW()}`
6. UPDATE `collectes` (taux_recyclage + caps_appliques)

**Pas d'endpoint API** pour ce calcul (purement DB). Le PDF Rapport RSE généré ensuite par Puppeteer (§5) lit `collectes.taux_recyclage` + `collectes.caps_appliques` (figés).

### Idempotence et erreurs

- `Idempotency-Key` obligatoire sur `PUT` (§6 — fenêtre dédup 24h via `integrations_logs`)
- Erreur 422 si `taux_captation` hors [0, 1]
- Erreur 422 si `commentaire_modif` manquant ou < 5 caractères
- Erreur 403 si rôle ≠ `admin_savr`
- Erreur 404 si `filiere_id` inconnu
- Pas de DELETE (suppression d'une filière interdite V1 — bascule via `actif=false` réservée Admin via UPDATE).

---

## 9ter. Endpoints Admin — Facteurs CO₂ *(ajout 2026-06-04, Sujet 3)*

Endpoints internes Plateforme pour administrer les **facteurs d'impact carbone** (cf. [[04 - Data Model]] addendum 2026-06-04 + tables `parametres_facteurs_co2` / `parametres_mix_emballages` / `parametres_co2_divers`). Pattern identique au §9 (REST+JSON, JWT Supabase, écriture `admin_savr`, lecture `ops_savr`, `Idempotency-Key` sur PUT, commentaire obligatoire). Audit : `_history` (facteurs + mix) ; `audit_log` (divers).

> **Mécanisme d'audit-write (admin)** *(précision 2026-06-25, divergence M2.4)* : chaque PUT de paramètre (facteurs CO₂, mix emballages, CO₂ AG, CO₂ divers, **et taux de recyclage §9**) passe par une **RPC `SECURITY DEFINER` par famille** (`rpc_maj_facteurs_co2`, `rpc_maj_mix_emballages`, `rpc_maj_facteur_co2_ag`, `rpc_maj_co2_divers`, `rpc_maj_taux_recyclage`) — **jamais d'`UPDATE` direct via le client service-role**. La RPC, en transaction unique : (1) pose le `commentaire_modif` (≥ 5 car.) dans `savr.audit_motif` + l'identité de l'auteur en `SET LOCAL` ; (2) exécute l'UPDATE → les triggers d'audit (rendus **`SECURITY DEFINER`**) insèrent dans `_history` avec `modifie_par` = auteur courant. Un trigger d'historisation alimente `parametres_mix_emballages_history`. Sans ce mécanisme, l'écriture échoue au niveau DB (service-role : `auth.uid()`=NULL viole `modifie_par NOT NULL` ; user-scoped : trigger non-DEFINER bloqué par la policy SELECT-only de `_history`). **Modèle de référence transverse** pour toute route admin écrivant une table auditée par trigger. Cf. [[05 - Règles métier#R_co2_snapshot_fige — Reproductibilité (snapshot figé à la clôture)]].

### 9ter.1 Facteurs CO₂ par flux

```
GET  /api/v1/admin/parametres/co2/facteurs                  → 5 flux (induit, evite, energie, source, actif, date_maj)
PUT  /api/v1/admin/parametres/co2/facteurs/{flux_id}        → modifie un facteur
GET  /api/v1/admin/parametres/co2/facteurs/{flux_id}/history
```

PUT body : `{ "fe_induit_kg_t", "fe_evite_kg_t", "energie_primaire_evitee_kwh_t", "source_donnee", "commentaire_modif" }`.
Validation : FE ≥ 0 (422 sinon) ; `commentaire_modif` ≥ 5 car. (422) ; **flux `emballage`** → `fe_induit`/`fe_evite` **rejetés en écriture** (409, dérivés du mix) — seul `energie_primaire_evitee_kwh_t` éditable. Effets : UPDATE + INSERT `parametres_facteurs_co2_history` (trigger) ; **pas de recalcul des collectes figées** (snapshots inchangés, PDF déjà générés intacts).

### 9ter.2 Mix emballages

```
GET  /api/v1/admin/parametres/co2/mix-emballages            → 7 matériaux (part_pct, induit, evite)
PUT  /api/v1/admin/parametres/co2/mix-emballages            → met à jour le mix complet (atomique)
GET  /api/v1/admin/parametres/co2/mix-emballages/history
```

PUT = mise à jour **transactionnelle de l'ensemble du mix** (les 7 parts ensemble) pour garantir la somme. Body : `{ "materiaux": [{ "code_materiau", "part_pct", "fe_induit_kg_t", "fe_evite_kg_t", "source_donnee" }...], "commentaire_modif" }`. Validation : **`Σ part_pct = 100`** (tolérance 0,05, sinon 422) ; FE ≥ 0 ; commentaire ≥ 5 car. Effets : UPDATE lignes + INSERT `parametres_mix_emballages_history` + **trigger `fn_recompute_emballage_fe`** recalcule la ligne `emballage` de `parametres_facteurs_co2` (`Σ part×FE`). Retour : mix mis à jour + `fe_emballage_recalcule: { induit, evite }`.

### 9ter.3 Paramètres divers (forfait collecte + équivalences)

```
GET  /api/v1/admin/parametres/co2/divers                    → 5 clés
PUT  /api/v1/admin/parametres/co2/divers/{cle}              → modifie une valeur
```

PUT body : `{ "valeur", "source_donnee", "commentaire_modif" }`. Validation : `valeur` > 0 (422) ; commentaire ≥ 5 car. Audit via `audit_log` (`action = "parametres_co2_divers_update"`, `details = { cle, ancienne_valeur, nouvelle_valeur, motif }`). Pas de table history dédiée.

### 9ter.4 Calcul CO₂ (collecte clôturée) — même trigger que taux_recyclage

Le calcul CO₂ est **fusionné dans le trigger DB `taux_recyclage`** (§9 « Trigger DB de calcul `taux_recyclage` » ci-dessus) : à la transition `collectes.statut → cloturee` (ZD), le trigger calcule aussi `co2_induit_kg`, `co2_evite_kg`, `co2_net_kg`, `energie_primaire_evitee_kwh` (cf. §05 R_co2_calcul) à partir des `parametres_facteurs_co2` / `parametres_co2_divers` actifs, et écrit `co2_facteurs_snapshot jsonb` (facteurs + mix + équivalences + forfait + horodatage). **Pas d'endpoint API** (purement DB). Le PDF rapport RSE (§5 Puppeteer) lit les colonnes figées. **Pas de recalcul rétroactif.**

### 9ter.5 Facteur CO₂ AG (repas donnés) *(ajout 2026-06-04 bis)*

```
GET  /api/v1/admin/parametres/co2/ag                        → facteur (kgCO₂e/repas)
PUT  /api/v1/admin/parametres/co2/ag                        → modifie le facteur
GET  /api/v1/admin/parametres/co2/ag/history
```

PUT body : `{ "facteur_co2_evite_par_repas_kg", "source_donnee", "commentaire_modif" }`. Validation : facteur ≥ 0 (422) ; commentaire ≥ 5 car. (422). Effets : UPDATE `parametres_facteurs_co2_ag` + INSERT `parametres_facteurs_co2_ag_history` (trigger). Pas de recalcul rétroactif (snapshots AG figés). Le calcul `co2_evite_kg` AG est figé par le **même trigger** que ZD à la clôture (`type = anti_gaspi`, cf. §05 R_co2_ag). Écriture `admin_savr`, lecture `ops_savr`.

### 9ter.6 Idempotence et erreurs

`Idempotency-Key` obligatoire sur PUT ; 422 (FE < 0 / valeur ≤ 0 / Σ mix ≠ 100 / commentaire < 5 car.) ; 409 (FE emballage en écriture directe) ; 403 (rôle ≠ admin_savr) ; 404 (id/clé inconnu) ; pas de DELETE (bascule `actif=false`).

---

## 9bis. Endpoints Admin — Coefficient de perte labo *(ajout 2026-05-22)*

Endpoints internes Plateforme dédiés à la saisie du **coefficient de perte labo** par traiteur × année (cf. [[04 - Data Model]] addendum 2026-05-22 + table `coefficients_perte_labo` + [[05 - Règles métier#R_dechets_labo_estimes]]). Réservé `admin_savr` (saisie), `ops_savr` lecture seule. Audit via `audit_log` central.

### 9bis.1 Lister les coefficients d'un traiteur

```
GET /api/v1/admin/organisations/{organisation_id}/coefficients-perte-labo
Authorization: Bearer <jwt>
```

Retour : liste antéchronologique des coefficients du traiteur.

```json
{
  "coefficients": [
    {
      "id": "uuid",
      "annee_reference": 2025,
      "annee_application": 2026,
      "coefficient_kg_couvert": 0.15,
      "source_commentaire": "Déclaratif traiteur, méthode interne",
      "saisi_par": { "id": "uuid", "nom": "Val" },
      "saisi_le": "2026-05-22T10:00:00Z"
    }
  ]
}
```

`annee_application` = `annee_reference + 1` (calculé côté serveur, non stocké). **Permissions** : `admin_savr` + `ops_savr`. Autres rôles → 403.

### 9bis.2 Créer un coefficient

```
POST /api/v1/admin/organisations/{organisation_id}/coefficients-perte-labo
Authorization: Bearer <jwt>
Idempotency-Key: <uuid v4>
Content-Type: application/json

{
  "annee_reference": 2025,
  "coefficient_kg_couvert": 0.15,
  "source_commentaire": "Déclaratif traiteur, méthode interne"
}
```

Validation serveur :
- `organisation_id` doit pointer une organisation `type='traiteur'`, sinon 422.
- `annee_reference` : integer 2020-2100, sinon 422.
- `coefficient_kg_couvert` : numeric ≥ 0 (4 décimales max), sinon 422.
- Unicité `(organisation_id, annee_reference)` : si déjà existant → 409 (utiliser PATCH pour corriger).

Retour 201 : l'objet créé. **Permissions** : `admin_savr` uniquement. `ops_savr` → 403.

### 9bis.3 Modifier un coefficient

```
PATCH /api/v1/admin/coefficients-perte-labo/{id}
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "coefficient_kg_couvert": 0.1620,
  "source_commentaire": "Correction valeur communiquée 2025"
}
```

Validation : `coefficient_kg_couvert ≥ 0`. `annee_reference` non modifiable (créer une autre ligne sinon). Retour 200. **Effets de bord** : UPDATE + `audit_log` (valeur avant/après + `auth.uid()`). Pas de recalcul stocké — l'estimation gestionnaire est calculée à la volée. **Permissions** : `admin_savr` uniquement.

### Erreurs

- 422 si organisation non traiteur, `annee_reference` hors borne, ou `coefficient_kg_couvert < 0`.
- 409 si coefficient déjà existant pour `(organisation_id, annee_reference)` sur POST.
- 403 si rôle ≠ `admin_savr` en écriture.
- Pas de DELETE V1 (correction via PATCH).

### Pas de cascade TMS

Endpoints 100 % Plateforme. Aucun flux vers `tms.*`, aucun champ ajouté au contrat API Plateforme-TMS.

---

## 10. Endpoints Admin — Dispatch manuel & Tableau revenus *(ajout 2026-05-07)*

Endpoints internes Plateforme dédiés à la refonte back-office §06 (cf. [[06 - Fonctionnalités détaillées/06 - Back-office Admin Savr]] §1 Dashboard Admin et §3 Collectes Bloc 0).

### Pattern retenu

REST + JSON. Auth JWT Supabase. Réservé `admin_savr` + `ops_savr` selon endpoint (cf. RLS §11 ci-dessous).

### Endpoints

#### 10.1 Renvoi / Envoi manuel d'une collecte au TMS

`POST /api/v1/admin/collectes/{collecte_id}/dispatch`

**Auth** : `admin_savr` ou `ops_savr` (les deux peuvent renvoyer le dispatch) *(« S7 » → « dispatch » 2026-06-07 F5 — S7 = webhook TMS→App `plaque-saisie`, sans rapport avec ce flux sortant)*.

**Body** (option override AG admin-only) :
```json
{
  "prestataire_id": "uuid (optional)",
  "motif_override": "text (optional, obligatoire si prestataire_id fourni et != top 1 algo)"
}
```

**Comportement** :
- Si `prestataire_id` non fourni : branche selon `collectes.statut_tms` *(tranchée F3 2026-06-07)* :
  - `statut_tms = non_envoye` → émet **E1** (`POST /collectes` TMS ou création MTS-1) + passe `statut_tms = a_attribuer` au succès.
  - `statut_tms ∈ {a_attribuer, attribuee_en_attente_acceptation}` avec `dirty_tms = true` → émet **E2** (`PATCH /collectes/:id`) + reset `dirty_tms = false`.
  - `statut_tms = rejetee_par_tms` → émet **E1** (recréation — le TMS a définitivement rejeté l'ordre, il faut recréer l'entité côté TMS). Permis admin + ops.
- Si `prestataire_id` fourni (override AG) : valide rôle `admin_savr` (403 si ops_savr), valide `motif_override` ≥ 5 caractères, met à jour `collectes.prestataire_logistique_id` + `collectes.motif_override_prestataire`, émet le dispatch avec nouveau prestataire selon la même logique de branche ci-dessus. Audit_log automatique.

**Erreurs** :
- 403 si `prestataire_id` fourni par un `ops_savr`
- 404 si `collecte_id` inconnu
- 422 si motif manquant lors d'un override
- 409 si la collecte est en statut `realisee`, `cloturee` ou `annulee`

**V1 fork (cdc-v1-scoping ultérieur)** : ce même endpoint reste utilisé V1, mais le client distingue 2 destinations selon `prestataire.integration_externe` :
- Strike / Marathon → push MTS-1 (API V1)
- A Toutes! → workflow A Toutes! distinct (Everest)

#### 10.2 Tableau revenus par organisation (Dashboard Admin)

`GET /api/v1/admin/dashboard/revenus-organisations?from=&to=&type_organisation=&order_by=&page=&page_size=`

**Auth** : `admin_savr` ou `ops_savr` (lecture).

**Query params** :
- `from` (required, date ISO) : début période `date_collecte`
- `to` (required, date ISO) : fin période `date_collecte`
- `type_organisation` (optional, multi) : filtre `organisations.type` (`traiteur` | `agence` | `gestionnaire_lieux` | `client_organisateur`)
- `order_by` (optional, default `montant_total_desc`) : `montant_total_desc` | `nb_collectes_desc` | `nom_asc`
- `page` (default 1), `page_size` (default 50, max 200)

**Réponse** :
```json
{
  "data": [
    {
      "organisation_id": "uuid",
      "nom": "...",
      "type": "traiteur",
      "nb_zd": 12,
      "montant_zd": 4800.00,
      "nb_ag": 8,
      "montant_ag": 2400.00
    }
  ],
  "total_organisations": 142,
  "page": 1,
  "page_size": 50,
  "totaux_periode": {
    "nb_zd_total": 350,
    "montant_zd_total": 124000.00,
    "nb_ag_total": 180,
    "montant_ag_total": 54000.00
  }
}
```

Implémentation : requête SQL agrégée définie [[05 - Règles métier#R_revenus_imputation_organisation]]. V1 = requête live (≤ ~150 orgs actives). V1.1 = vue matérialisée si justifié.

**Export CSV** : `GET /api/v1/admin/dashboard/revenus-organisations.csv?from=&to=&...` (mêmes query params, header `Content-Type: text/csv`).

#### 10.3 KPIs Dashboard Admin (5 cartes)

`GET /api/v1/admin/dashboard/kpis`

**Auth** : `admin_savr` + `ops_savr`.

**Réponse** :
```json
{
  "collectes_a_valider": { "total": 12, "zd": 7, "ag": 5 },
  "en_attente_validation_prestataire": 3,
  "modifiees_sans_renvoi_tms": 2,
  "zd_48h": 18,
  "ag_48h": 11
}
```

Live, pas de cache V1 (volumes faibles).

### 11. RLS extension `ops_savr` sur back-office *(ajout 2026-05-07)*

Mise à jour des policies RLS (cf. [[09 - Authentification et permissions]] matrice détaillée) :

| Table | `ops_savr` SELECT | `ops_savr` INSERT/UPDATE | `ops_savr` DELETE |
|-------|-------------------|--------------------------|-------------------|
| `collectes` | ALL | ALL (sauf `motif_override_prestataire` admin-only) | — |
| `evenements` | ALL | ALL | — |
| `factures` | ALL | UPDATE statut (valider, renvoyer Pennylane) ; **PAS** d'édition lignes, **PAS** d'annulation, **PAS** d'avoir *(refonte 2026-05-08 — "relance facture" retirée : les relances sont gérées dans Pennylane)* | — |
| `associations` | ALL | UPDATE contacts/horaires/instructions/capacité/description ; **PAS** SIREN, **PAS** habilitation 2041-GE, **PAS** `actif=false` | — |
| `transporteurs` | ALL | ALL (V1) | — |
| `lieux` | ALL | ALL (V1) | — |
| `organisations` | ALL | UPDATE infos générales ; **PAS** `tarif_refacture_pax_zd`, **PAS** `grille_tarifaire_zd_id`, **PAS** fusion, **PAS** hard delete | — |
| `users` | ALL | INSERT/UPDATE rôle (sauf admin_savr promotion), suspension ; **PAS** impersonation, **PAS** hard delete | — |
| `parametres_taux_recyclage` | ALL | — | — |
| `grilles_tarifaires_zd` / `tarifs_zero_dechet` / `tarifs_negocie` | ALL | — | — |
| `audit_log` | ALL | — (insertion automatique trigger) | — |

**Endpoint dispatch override AG** (`POST /admin/collectes/:id/dispatch` avec `prestataire_id`) : middleware `requireRole(['admin_savr'])` (403 si ops_savr).

**Endpoint édition `tarif_refacture_pax_zd` + `grille_tarifaire_zd_id`** (`PATCH /admin/organisations/:id`) : middleware `requireRole(['admin_savr'])` sur ces champs uniquement (les autres champs restent ouverts à `ops_savr`). Gestion du catalogue `grilles_tarifaires_zd` et des remises `tarifs_negocie` : `admin_savr` only *(refonte 2026-05-26)*.

---

## Sous-domaines techniques

Architecture DNS retenue :

| Sous-domaine | Usage | Application |
|--------------|-------|-------------|
| `app.gosavr.io` | Plateforme Savr (espace client) | Front Plateforme |
| `tms.gosavr.io` | Savr TMS (ops logistiques) | Front TMS |
| `api.gosavr.io` | Endpoints API publics | Backend (Supabase Edge Functions) |
| `api.gosavr.io/webhooks/tms/*` | Webhooks entrants TMS | Backend |
| | — **non exposé V1 (sobriété B1 2026-05-31, polling J+1 only)**, à rouvrir V1.1 si webhook `invoice.paid` retenu | Backend |
| `api.gosavr.io/webhooks/resend/*` | Webhooks entrants Resend | Backend |
| `www.gosavr.io` | Site vitrine (hors scope refonte) | Webflow actuel |

TLS géré par la plateforme d'hébergement (Supabase / Railway). Zones DNS chez OVH.

---

## Décisions prises

- **Event-driven par défaut** *(polling supprimé revue sobriété 2026-05-01 Bloc A A4 — retry 3 paliers + dédup `integrations_inbox` 7j couvrent les pannes <24h, intervention manuelle au-delà)*
- **Pennylane API v2** retenue (endpoints `/api/external/v2/*`)
- **Corrigé 2026-05-29 (propagation §3bis)** : MTS-1 n'est **pas** retiré en V1 — il reste le système de dispatch terrain des transporteurs `type_tms = 'mts1'` (Strike, Marathon) via l'API V3 (cf. §3bis). Sa coupure est planifiée en V2 (cutover TMS Savr, cf. §13 TMS). Le fallback « commandes manuelles Admin » reste le plan de secours en cas d'indisponibilité MTS-1, pas le mode nominal.
- **Intégration Everest rattachée au Savr TMS, pas à la Plateforme** (décision CDC TMS 2026-04-21) — tous les transporteurs (Strike, Marathon, A Toutes!) passent par le TMS pour la saisie terrain et la communication via Everest
- **Tournées V1** : le TMS regroupe des collectes en tournées et pousse l'info à la Plateforme (webhook `tournee-upsert`)
- **Contrôle d'accès manager (propagation Q10 M05 2026-04-24 + restauration audit cohérence inter-CDC 2026-05-01 — renommé + étendu 2026-05-03 refonte formulaire §06.01)** : webhook `plaque-saisie` (S7) émis à la saisie manager prestataire en M03 E4 (payload enrichi 2026-05-03 : `plaque` + `chauffeur_nom`), persiste `plateforme.tournees.plaque_immatriculation` + `tournees.chauffeur_nom` + `tournees.plaque_saisie_at` Plateforme (registre transport, audit M08, monitoring Admin, dashboard traiteur "Contrôle d'accès"). Trigger TMS `validate_tournee_controle_acces` (ex `validate_tournee_plaque_requise`) bloque validation tournée si `controle_acces_requis=true` ET (plaque OU nom chauffeur) manager manquant (R_M03.4 + R_M04.CONTROLE_ACCES, sauf exception A Toutes! vélo cargo). Plaque chauffeur terrain M05 E3 reste TMS-only V1 (pas de re-push Plateforme — Option B arbitrage Val 2026-05-01). Trigger email Resend + scheduler `scheduler-email-plaque` + agrégation multi-tournées T+3h supprimés V1 — confirmation refonte 2026-05-03.
- **Supprimé V1 (revue sobriété 2026-04-29)** — flag `presume_non_pese` + R_M05.18 retirés (cf. note barrée autoritative ci-dessus). Plus d'auto-insert `poids_kg=0` : un flux non pesé est simplement absent du rapport de recyclage. Résidu stale soldé audit cohérence inter-CDC 2026-06-05.
- **Sous-domaines** : `app.gosavr.io` / `tms.gosavr.io` / `api.gosavr.io/webhooks/*`
- **Resend** retenu comme provider email (20$/mois pour 50k envois)
- **Puppeteer self-hosted** retenu pour PDF (co-construction du graphisme avec Val, coût marginal ~10$/mois)
- **Pattern d'idempotence** imposé sur toutes les intégrations sortantes
- **Retry policy uniforme TMS** *(3 paliers depuis 2026-05-01 Bloc B B1 — ex-5 paliers)* : 5 min / 1h / 24h (alignement avec §08 TMS) — 2026-04-22 / 2026-05-01
- **Webhook `collecte-terminee` unifié** : un seul endpoint côté Plateforme gère la clôture normale et le cas "Aucun repas à collecter". Discriminé par `statut_final`. Remplace l'ancien `collecte-realisee` — 2026-04-22
- **Cas "Aucun repas à collecter" (AG uniquement)** : affichage badge + motif + photo dans l'historique des collectes du tableau de bord traiteur + alerte Ops Savr. Champs dans payload : `aucun_repas = { motif_chauffeur, photo_lieu_url }`. Facture client générée au **tarif normal V1** (option B), facturation partielle possible V2. Pas d'attestation 2041-GE (pas de don). N'existe pas en ZD (il y a toujours des déchets) — 2026-04-22
- **Supprimés revue sobriété 2026-05-01 Bloc A A4** — retry 3 paliers + dédup `integrations_inbox` 7j couvrent les pannes <24h, intervention manuelle au-delà.
- **Table `integrations_inbox`** côté Plateforme : dédup idempotence des events entrants TMS (fenêtre 7 jours) — 2026-04-22
- **Auth Mutual HMAC-SHA256 + JWT** : headers `Authorization` + `X-Savr-Signature` + `X-Savr-Timestamp` + `X-API-Version` *(header `Idempotency-Key` retiré revue sobriété Bloc C 2026-05-01 C4)*, rotation **annuelle** manuelle V1 (retournement atelier tech 2026-04-23 vs semestrielle décidée 2026-04-22). Justification : simplification opérationnelle, risque acceptable vu petite surface API, alignement avec rotation JWT signing key Supabase
- **Versioning API `YYYY.MM`** : breaking change interdit V1, procédure double publication 30 jours V2 — 2026-04-22
- **Supprimé revue sobriété 2026-05-01 Bloc A A1** — bouton sidebar inconditionnel + page d'accès refusé propre côté cible si user sans profil (≤4 users cumul concernés V1).
- **Webhook S7 `plaque-saisie` restauré** (audit cohérence inter-CDC 2026-05-01) : émis à la saisie manager prestataire en M03 E4, alimente `plateforme.tournees.plaque_immatriculation` + `plaque_saisie_at`. Plaque chauffeur terrain M05 E3 reste TMS-only V1 (Option B arbitrage Val). Annulation revue sobriété Bloc C C3.
- **Endpoints Admin Taux de recyclage** (2026-05-06) : 3 endpoints internes Plateforme (`GET /admin/parametres/taux-recyclage`, `PUT /.../{filiere_id}`, `GET /.../{filiere_id}/history`). Auth JWT Supabase, écriture `admin_savr` uniquement, `Idempotency-Key` 24h sur PUT. Trigger DB calcule `collectes.taux_recyclage` à la clôture collecte ZD, snapshot `caps_appliques` jsonb pour reproductibilité PDF. Pas de recalcul rétroactif des collectes déjà clôturées.
- **Endpoints Admin Facteurs CO₂** (2026-06-04, Sujet 3, §9ter) : CRUD `parametres_facteurs_co2` (5 flux ; FE emballage en lecture seule, dérivé du mix), `parametres_mix_emballages` (PUT atomique avec validation `Σ part=100` + trigger `fn_recompute_emballage_fe`), `parametres_co2_divers` (forfait collecte + équivalences, audit `audit_log`). Écriture `admin_savr`, `Idempotency-Key` + commentaire obligatoire. Calcul CO₂ (induit/évité/net/énergie + `co2_facteurs_snapshot`) **fusionné dans le trigger `taux_recyclage`** à la clôture ZD. Pas de recalcul rétroactif. Cf. §05 R_co2_*. **+ AG (2026-06-04 bis)** : endpoint 9ter.5 `parametres_facteurs_co2_ag` (facteur 2,5 kgCO₂e/repas FAO) ; `co2_evite_kg` AG = `volume_repas_realise × facteur` figé par le même trigger (branche `type=anti_gaspi`).

## Questions ouvertes

1. **Fermée 2026-05-31 (sobriété §08 B1)** — V1 = polling J+1 3h. Webhook V1.1.

## Liens

- [[04 - Data Model]] (tables `integrations_logs`, `integrations_inbox`, `emails_envoyes`, `factures`, `bordereaux_savr`)
- [[05 - Règles métier]] (notifications, SLAs)
- [[07 - Architecture technique]]
- [[15 - Sécurité et conformité]]
- [[02 - Cahier des charges TMS/08 - Contrat API Plateforme-TMS]] — **source de vérité** du contrat API bidirectionnel (12 endpoints actifs + 2 vues cross-schema post-revue sobriété et restauration S7 2026-05-01, payloads JSON, auth détaillée, observabilité, versioning)
- [[02 - Cahier des charges TMS/03 - Périmètre fonctionnel TMS]] — modules TMS référencés par les webhooks (M01 réception, M04 tournées, M05 bouton "Aucun repas", M07 coût, M09 stock rolls, M11 alerting)
