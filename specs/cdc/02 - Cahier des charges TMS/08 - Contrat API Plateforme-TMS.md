# 08 - Contrat API Plateforme ↔ TMS


**Rôle du document** : spécification contractuelle détaillée des échanges entre la Plateforme Savr (`app.gosavr.io`) et le Savr TMS (`tms.gosavr.io`). Ce fichier est le **pendant TMS** de [[01 - Cahier des charges App/08 - APIs et intégrations]] section 1 ("API Plateforme ↔ TMS Savr"). Les deux documents doivent rester strictement alignés — toute modification d'un payload ou endpoint doit être répercutée dans les deux.

---

## ⚠ Addendum 2026-06-03 — Bloc 2 : JSON Schemas du contrat API (`savr-api-contracts`)

Formalisation des 12 endpoints en JSON Schema (résolution Q1). Livrable dans le sous-dossier [[08 - savr-api-contracts]] (`schemas/common.schema.json` + `schemas/entrants/` + `schemas/sortants/`). Choix d'authoring (arbitrages Val 2026-06-03) : **draft 2020-12**, **un `common.schema.json` partagé** (`$defs` enveloppe + enums + sous-objets `lieu`/`contacts`/`pesee`/... = source unique, zéro divergence), **`additionalProperties: false`** partout (strictness — attrape typos et champs périmés ; sans impact sur le dev Plateforme V1 qui parle à MTS-1, ce contrat ne s'active qu'au temps 2). Validés Ajv v8 : 21/21 cas (12 payloads valides + 9 invalides correctement rejetés).

**Divergences trouvées et corrigées en propagant la prose §08 vers les schémas** :
1. **Sous-objet `lieu` E1 — 3 enums périmés depuis la refonte App 2026-05-08, jamais propagés côté TMS** (corrigés ce jour) : `stationnement` (type d'emplacement 4 valeurs → difficulté d'accès `facile|difficile|tres_difficile`), `acces_office` (text libre → même enum), `type_vehicule_max` (`vl|camion_16m3|...` → enum véhicule unifié `velo_cargo|camionnette|fourgon|vul|poids_lourd`).
2. **`gravite` S9** : l'exemple prose listait `info|warning|critical` ; la décision sobriété §04 2026-04-30 D1 (retrait `info`) fait foi → **2 valeurs `warning|critical`**.

**Normalisations appliquées dans les schémas (à valider en `coherence-inter-cdc`, prose non encore réécrite des 2 côtés)** :
- **`type` discriminant des sortants sans préfixe `tms.`** (`collecte.acceptee` et non `tms.collecte.acceptee`) — la prose ne préfixait que S1, incohérent avec le format commun, S11 et les entrants ; le champ `source` porte déjà la direction.
- **S7 normalisé au format commun** (enveloppe + `data`) — la prose montrait un payload plat sans `data`/`source`/`type`.
- **Plusieurs payloads sortants** (S2, S3, S4, S5, S9) ne montraient que `data` dans la prose ; l'enveloppe complète (`event_id`/`occurred_at`/`source`/`type`) leur est appliquée.
- **`data.type` de S5** : `cloture` (sans accent, ex `clôture`) — décision Val 2026-06-03.

**Contrat vivant** : ces schémas reflètent l'état Plateforme actuel mais le data model Plateforme V1 bougera d'ici le temps 2. **Re-audit obligatoire au démarrage du dev TMS (temps 2)** avant de coder contre ces contrats.

---

## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc D (simplifications enums)

Issu de la revue de sobriété §08, après Blocs A+B+C. 5 simplifications enums appliquées :

1. **Suppression 7 valeurs `type_incident` S9** (D1+D2 étendu Val) — retrait de `vehicule_panne`, `accident_route`, `chauffeur_indisponible`, `absence_contenant`, `materiel_casse`, `erreur_pesee`, `blessure`. Justification : (a) cas de fréquence quasi-nulle V1 (pas de chauffeurs salariés Savr) ; (b) catégories Hors-M05 Ops uniquement, peu déclenchées ; (c) `blessure` rentre dans `autre` si cas réel ; (d) panne véhicule + accident route + chauffeur indisponible = même comportement applicatif côté Plateforme et TMS (alerte Ops, réattribution). Enum **14 → 6 valeurs** : `acces_refuse`, `client_absent`, `probleme_tri`, `pas_excedents`, `autre`, `client_annule_avant_arrivee`.
2. **Fusion `incident` + `inchange` dans `statut_collecte_apres`** (D3) — les 2 valeurs déclenchaient le même effet côté Plateforme (entrée `incidents_collectes` + alerte Ops + statut collecte non modifié). Fusion en `inchange` (plus explicite). Enum **6 → 5 valeurs**.
3. **Suppression `stationnement.non_defini`** (D4) — sémantiquement équivalent à NULL Postgres standard. Champ `stationnement` E1 devient nullable. Enum **5 → 4 valeurs**.
4. **Enum `motif_dlq` S11 → text libre côté payload** (D5) — Plateforme stocke pour audit, aucun branchement applicatif distinct selon valeur. Le `commentaire_admin` (≥10 chars obligatoire) porte l'info utile. Enum conservé côté TMS pour catégorisation interne dashboards M11. Côté payload S11 + Plateforme : text libre.
5. **Suppression valeur `recu` de `integrations_inbox.statut`** (D6) — insertion BDD APRÈS traitement réussi seulement → `recu` n'existe jamais en pratique. Dédup garantie par PK `event_id`. Enum **4 → 3 valeurs** : `traite`, `ignore_doublon`, `ignore_out_of_order`.

**Réduction nette Bloc D** : enum `type_incident` 14→6 (-8 valeurs), `statut_collecte_apres` 6→5 (-1), `stationnement` 5→4 (-1), `motif_dlq` 5 → text libre côté payload, `integrations_inbox.statut` 4→3 (-1). Total : -10 valeurs d'enum + 1 enum migré en text libre côté payload.

**Compteur cumulé revue sobriété §08 (Blocs A+B+C+D — COMPLET) + restauration S7 audit cohérence inter-CDC 2026-05-01** : 16 endpoints API V1 → **12 endpoints actifs** (4 entrants : E1, E2, E3, E5 + 8 sortants : S1, S2, S3, S4, S5, **S7 restauré**, S9, S11) + 2 vues cross-schema. S7 restauré pour couvrir le besoin métier "commercial traiteur demande plaque pour contrôle d'accès anticipé → manager prestataire pré-saisit M03 E4 → blocage validation tournée si manquante" (R_M03.3) — annulation Bloc C C3. Payload simplifié (photos array unique, pas de geoloc S4, pas de version doublon). Auth simplifiée (pas d'`Idempotency-Key` header). Retry 3 paliers. Dédup 7j. 10 valeurs d'enum supprimées.

---

## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc C (duplications à fusionner)

Issu de la revue de sobriété §08, après Blocs A + B. 2 simplifications appliquées (C1 et C2 du rapport initial sont sans objet — résolus respectivement par A3 suppression `lieux_stocks_rolls` et A4+B1 suppression polling + retry 5→3) :

1. **C3 ANNULÉ 2026-05-01 (audit cohérence inter-CDC)** — restauration S7 + colonnes Plateforme. Justification : besoin métier "commercial traiteur demande plaque pour contrôle d'accès anticipé → manager prestataire pré-saisit M03 E4 → blocage validation tournée si manquante" (R_M03.3) non couvert par lecture cross-schema seule (la plaque chauffeur terrain M05 E3 arrive trop tard). S7 restauré, déclenché à la saisie manager M03 E4 uniquement. **Saisie plaque chauffeur supprimée V1 (propagation 2026-06-04, arbitrage Val)** : il ne reste qu'une plaque (pré-saisie manager). Colonne `plaque_saisie_terrain` supprimée, exposition cross-schema retirée. La vue `v_courses_logistiques` ne porte plus que `heure_reelle_*`.
2. **Header `Idempotency-Key` supprimé** (C4) — duplication 1:1 avec `event_id` du payload (le header était explicitement défini comme = `event_id`). La dédup côté serveur lit `body.event_id` directement. Standard REST `Idempotency-Key` est utile quand le body change entre retries — pas notre cas (event_id stable, payload immuable). Réduction des headers HTTP requis = moins de risque erreur configuration émetteur.

**Réduction nette Bloc C (post-restauration S7 2026-05-01)** : -1 header HTTP (`Idempotency-Key`) seulement. C3 annulé (S7 + colonnes Plateforme restaurés). 8 webhooks sortants actifs (S1, S2, S3, S4, S5, **S7**, S9, S11).

**Compteur cumulé revue sobriété §08 (Bloc A+B+C) + restauration S7 audit cohérence inter-CDC 2026-05-01** : 16 endpoints API V1 → **12 endpoints actifs** (4 entrants : E1, E2, E3, E5 + 8 sortants : S1, S2, S3, S4, S5, **S7**, S9, S11) + 2 vues cross-schema (`v_courses_logistiques`, `v_stocks_rolls`) + 0 endpoint utilitaire + 0 polling.

---

## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc B (simplifications payload + auth)

Issu de la revue de sobriété §08, après Bloc A. 5 simplifications appliquées :

1. **Retry policy 5→3 paliers** (B1) — uniformisée à `5 min / 1h / 24h` sur tous les webhooks actifs (S1, S2, S3, S4, S5, S7, S9, S11). 99% erreurs transitoires résolues <5 min. Si pas résolu <1h = bug applicatif (retry 2h/6h sans gain). >24h = alerte critical M11 + intervention humaine. Suppression des paliers intermédiaires 30 min, 2h, 6h.
2. **Fusion `photos`/`photos_urls` → champ unique `photos: string[]`** (B2) — suppression de la dualité legacy `photo_url` (singulier) + `photos_urls` (array) dans S5 et S9. Un seul champ array même si 1 photo. Pas de migration progressive V1 (la compat invoquée était avec un système qui n'existe pas — Bubble n'utilise pas ces webhooks).
3. **Header `X-API-Version` seul fait foi** (B3) — suppression de la "double ceinture" version. Le champ `version` est retiré du payload JSON. Si payload contient `version` divergente du header → ignoré (header autoritatif). Schéma payload simplifié.
4. **Geoloc chauffeur supprimée du payload S4 `collecte-en-cours`** (B4) — la Plateforme n'utilise pas la géoloc du chauffeur. Le champ `geoloc { lat, lng, precision_m }` est retiré du payload S4. La géoloc retard reste traitée côté TMS (M11). Bonus RGPD : pas de question géoloc côté Plateforme. Question ouverte Q4 §08 résolue.
5. **Dédup `integrations_inbox` 30j → 7j** (B5) — retour à la valeur initiale. Justification : avec le polling supprimé (Bloc A A4), le retry max va à 24h, donc pas de re-émission >7j possible. Logs 2 ans assurent l'audit forensic. M01 B_M01_01 obsolète.

**Réduction nette Bloc B** : retry policy de 5→3 paliers (-2 paliers à coder/tester), 1 champ payload simplifié (S5 + S9), 1 champ payload supprimé (S4), 1 champ header authoritatif unique, dédup TTL réduit (table inbox 4× plus petite).

---

## ⚠ Addendum 2026-05-01 — Revue sobriété §08 Bloc A (suppressions)

Issu de la revue de sobriété §08. 6 suppressions appliquées :

1. **Endpoint E10 `GET /me/has-profile` (SSO cross-app) supprimé** (A1) — confort UX pur (≤4 users cumul concernés). Bouton sidebar « → Plateforme/TMS » affiché inconditionnellement, page d'accès refusé propre côté cible si user sans profil. Symétrique `tms.gosavr.io/api/v1/me/has-profile` également supprimé. Voir [[10 - Design System TMS|§11 TMS]] et [[../01 - Cahier des charges App/09 - Authentification et permissions|§09 Plateforme]].
2. **Webhook S6 `course-cout-calculee` supprimé** (A2) — remplacé par **vue cross-schema `plateforme.v_courses_logistiques`** qui SELECT depuis `tms.tournees` + `tms.collectes_tms`. Refresh sur trigger DB on UPDATE `tms.tournees.cout_final_ht` / `push_s6_version` *(noms corrigés audit cohérence 2026-05-26 A2 + 2026-06-04 — `version_paiement` est l'alias de vue de `push_s6_version`, pas une colonne de la table)*. La grille tarifaire reste privée TMS (vue n'expose que les colonnes autorisées). Suppression : retry policy spéciale 1h/24h, idempotency composite `(tournee_id, version)`, anti-replay applicatif, alerte M11 DLQ S6.
3. **Webhook S8 `traiteur-stock-rolls-update` supprimé** (A3) — remplacé par **vue cross-schema `plateforme.v_stocks_rolls`** qui SELECT depuis `tms.stocks_rolls_traiteurs` + `tms.types_contenants` (filtre RLS par traiteur — les rolls sont attribués aux traiteurs uniquement, pas aux gestionnaires de lieux). Suppression : table miroir `plateforme.lieux_stocks_rolls`, alerte M11 `m09_webhook_s8_dlq`, R_M09.7 (TMS = source de vérité unique en lecture directe).
4. **Endpoints fallback polling E6 + S10 (`GET /sync/poll`) supprimés** (A4) — retry policy 3 paliers (5 min / 1h / 24h, Bloc B B1) + dédup `integrations_inbox` couvrent 99.99% des pannes <24h. Au-delà → alerte critical + intervention manuelle (pas de cas nominal à automatiser). Suppression : 2 jobs cron Edge Function 60 min, pagination cursor, tests panne réseau simulée.
5. **Alerting "latence p95 > 30s" supprimé** (A5) — métrique sans action métier (webhooks async, aucun client/prestataire impacté par latence p95). Conservation des 2 alertes critiques : 5 retries échoués + taux d'erreur >5% sur 1h.
6. **Widget "Dérive horaire entre les 2 apps" supprimé** (A6) — DB partagée + même zone Vercel/Supabase eu-west-3 = artefact sans signal opérationnel. Dashboard sync M13 conserve : events/jour, taux succès 1er essai vs retry, liste échec final + bouton Rejouer.

**Réduction nette** : de 6 endpoints entrants → 4 (E1, E2, E3, E5) + de 11 webhooks sortants → 8 (S1-S5, S7, S9, S11) + 0 endpoint utilitaire (-1) + 0 polling (-2). Total : **12 endpoints API V1** vs 16 avant.

---

## ⚠ Addendum 2026-04-24 — Propagation M03 (Portail prestataire)

Issu de la rédaction [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service]] et de l'arbitrage Q8 (plaque conditionnelle niveau lieu + override collecte). 1 impact sur le contrat API :

1. **Payload E1 `POST /collectes` enrichi** — nouveau champ `plaque_requise: boolean` (propagé depuis `plateforme.collectes.plaque_requise`, défaut hérité de `plateforme.lieux.plaque_requise_default`). Pilote la règle M03 : si `true` → saisie plaque obligatoire par le manager avant validation tournée M04 ; si `false` → saisie optionnelle, chauffeur peut renseigner la plaque en début de tournée M05. **Breaking change ? Non** — champ optionnel avec défaut `false` côté TMS si absent du payload (rétrocompatibilité assurée V1, obligatoire V2). Voir [[06 - Fonctionnalités détaillées TMS/M03 - Portail prestataire self-service#§13 Décisions — D8]] et [[../01 - Cahier des charges App/04 - Data Model#Addendum 2026-04-24 (propagation M03 TMS)]].

---

## ⚠ Addendum 2026-04-23 — Impacts atelier

1. **DB unique partagée, contrat API conservé** : les 2 apps partagent désormais un projet Supabase avec schémas `plateforme.*` + `tms.*` isolés par RLS cross-schema deny. **Le contrat API HMAC+JWT est conservé intégralement** malgré la DB unique — les 2 fronts Next.js restent distincts sur Vercel et la discipline webhook évite le couplage applicatif.
2. **Rotation HMAC annuelle** (retournement vs décision 9.3.16 semestrielle). Simplification opérationnelle V1, procédure documentée dans runbook sécurité.
3. **Payloads et références de fichiers** : les URLs directes de fichiers (photos, PDFs) sont remplacées par des **références `shared.fichiers.id`** dans les payloads. L'API destinataire demande l'URL pré-signée (15 min) via endpoint dédié si besoin d'accès direct au fichier. Payloads plus légers, URLs non leakées dans les logs.
4. **Hébergement des webhooks entrants côté TMS** : Next.js API Routes sur Vercel (pas Supabase Edge Functions). Même chose côté Plateforme.
5. **Versioning `YYYY.MM` conservé**, breaking change interdit V1, double publication 30j V2 (décision 9.3.17).

---

## ⚠ Addendum 2026-04-23 (seconde salve M01) — Contrat API simplifié

Issu de la seconde salve M01 ([[06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte]]). 6 impacts sur le contrat API :

1. **Endpoint E4 `PATCH /prestataires/:id` supprimé** (D14). Retournement prestataires → table unique `shared.prestataires` écrite côté TMS (M06). Plus de sync bidirectionnelle, plus d'endpoint. Webhook S2 `prestataire-upsert` également supprimé (n'existait qu'implicitement — aucune référence historique).
2. **Endpoint E5 `PATCH /lieux/:id` allégé** (D16). Sert uniquement à notifier le TMS qu'un champ critique du lieu a changé côté Plateforme → alerte M02 `dispatch_lieu_snapshot_divergent` + bouton "Synchroniser snapshot". Pas de rétroactivité sur les collectes existantes (lieu_snapshot cristallisé, cf. M01 D15).
3. **Payload E1 `POST /collectes`** : retrait du champ `prestataire_id_pre_affecte` (D10 supprimée). Toutes les collectes arrivent en `statut_dispatch='a_attribuer'`. Les règles d'attribution forte vivent désormais côté TMS dans M12.
4. **Nouveau webhook S11 `POST /webhooks/tms/collecte-rejetee`** (D20). Émis par le TMS lorsqu'un Admin TMS rejette définitivement un event DLQ. Permet à la Plateforme de passer la collecte concernée en `statut_tms='rejetee_par_tms'` + alerte Admin Plateforme.
5. **Taille max payload 256 KB** (D22). Limite appliquée sur tous les endpoints. Rejet 413 au-delà + DLQ motif `schema_invalide`. Protection zéro coût.
6. **Versioning `X-API-Version` unique global** (D21). Un seul numéro de version partagé par tous les endpoints Plateforme↔TMS — valeur courante `2026.04`. Pas de versioning par endpoint. Justification : petite équipe, monorepo, déploiement synchrone.
7. **Sérialisation par `occurred_at`** : chaque UPDATE sur `collectes_tms` vérifie `occurred_at > last_occurred_at`. Si out-of-order → skip + log INFO `statut='skipped_out_of_order'` + 200. FIFO naturelle Supabase. Pas de rate limiting V1 (D23 — volume le rend inutile).

---

## Vue d'ensemble

Architecture **2 fronts Next.js distincts partageant 1 projet Supabase** (schémas cloisonnés), communiquant en **event-driven** via webhooks HTTPS. **Pas de polling fallback V1** *(supprimé revue sobriété 2026-05-01 A4 — retry policy + dédup couvrent les pannes <24h, au-delà = intervention manuelle)*. Idempotence imposée sur toutes les routes. Retry policy uniforme **3 paliers : 5 min / 1h / 24h** *(simplifié revue sobriété Bloc B 2026-05-01 B1 — ex-5 paliers)*.

**Données accessibles en lecture directe cross-schema** (sans webhook V1) :
- Coût tournée TMS + horaires réels via vue `plateforme.v_courses_logistiques` *(remplace ex-S6 Bloc A A2)*. **retiré (propagation suppression saisie plaque terrain 2026-06-04)** — la colonne `plaque_saisie_terrain` est supprimée ; la plaque pour contrôle d'accès est `plateforme.tournees.plaque_immatriculation`, alimentée par le webhook S7 émis par le manager (M03 E4), pas par lecture cross-schema.
- Stocks rolls traiteurs TMS via vue `plateforme.v_stocks_rolls` *(remplace ex-S8 Bloc A A3)*.

Voir [[04 - Data Model TMS]] + [[../01 - Cahier des charges App/04 - Data Model]] pour le détail des vues.

### Topologie des flux

```
                        Plateforme (app.gosavr.io)
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
   POST /collectes        Lecture cross-schema           Vault
   PATCH /collectes/:id   (v_courses_logistiques,    (secrets partagés)
   DELETE /collectes/:id   v_stocks_rolls)
   PATCH /lieux/:id
         │
         ▼
                     Savr TMS (tms.gosavr.io)
         │
         ├── POST /webhooks/tms/collecte-acceptee       (S1)
         ├── POST /webhooks/tms/collecte-refusee        (S2)
         ├── POST /webhooks/tms/tournee-upsert          (S3)
         ├── POST /webhooks/tms/collecte-en-cours       (S4)
         ├── POST /webhooks/tms/collecte-terminee       (S5)
         ├── POST /webhooks/tms/incident                (S9)
         └── POST /webhooks/tms/collecte-rejetee        (S11)
                        │
                        ▼
                  Plateforme
```

### Inventaire des endpoints V1

| # | Sens | Endpoint | Déclencheur métier |
|---|------|----------|---------------------|
| E1 | Plateforme → TMS | `POST /collectes` | Collecte **soumise au formulaire** côté Plateforme (statut `programmee`, `statut_tms` `non_envoye`→`a_attribuer`) — payload sans `prestataire_id_pre_affecte` (cf. seconde salve M01). *(Corrigé Sujet 2 2026-05-26 — ex « statut `validee` ».)* |
| E2 | Plateforme → TMS | `PATCH /collectes/:id` | Modification d'une collecte **déjà transmise au TMS** (`statut_tms ≠ non_envoye`) *(corrigé Sujet 2 2026-05-26 — ex « déjà validée »)* |
| E3 | Plateforme → TMS | `DELETE /collectes/:id` | Annulation d'une collecte |
| E5 | Plateforme → TMS | `PATCH /lieux/:id` | **Allégé 2026-04-23 seconde salve** — notification seule de changement champ critique lieu, pas de rétroactivité |
| S1 | TMS → Plateforme | `POST /webhooks/tms/collecte-acceptee` | Prestataire accepte une collecte |
| S2 | TMS → Plateforme | `POST /webhooks/tms/collecte-refusee` | Prestataire refuse → réattribution Ops |
| S3 | TMS → Plateforme | `POST /webhooks/tms/tournee-upsert` | Création ou modification d'une tournée |
| S4 | TMS → Plateforme | `POST /webhooks/tms/collecte-en-cours` | Chauffeur démarre la collecte |
| S5 | TMS → Plateforme | `POST /webhooks/tms/collecte-terminee` | Clôture collecte (pesées + photos + signature OU aucun repas) |
| S7 | TMS → Plateforme | `POST /webhooks/tms/plaque-saisie` | **Restauré 2026-05-01 — payload enrichi 2026-05-03 (refonte formulaire §06.01 Plateforme : flag `controle_acces_requis` plaque + nom chauffeur)** — émis à la saisie manager prestataire en M03 E4 (saisie plaque OU affectation chauffeur sur tournée avec `controle_acces_requis=true`). Payload : `{plaque, chauffeur_nom}` (plaque nullable pour vélo cargo). Alimente `plateforme.tournees.plaque_immatriculation` + `tournees.chauffeur_nom` + `plaque_saisie_at`. Plaque chauffeur terrain M05 E3 reste TMS-only (Option B Val). **Émis pour vélo cargo A Toutes!** avec `plaque=null` + `chauffeur_nom` renseigné (le nom chauffeur reste requis même en vélo cargo pour le contrôle d'accès — correction audit cohérence Run 5 2026-05-03). |
| S9 | TMS → Plateforme | `POST /webhooks/tms/incident` | Incident terrain déclaré par chauffeur |
| S11 | TMS → Plateforme | `POST /webhooks/tms/collecte-rejetee` | **Nouveau 2026-04-23 seconde salve** — Admin TMS rejette définitivement un event DLQ → Plateforme passe la collecte en `rejetee_par_tms` |

> **Note numérotation (mise à jour 2026-05-01 revue sobriété Bloc A+C + restauration S7 audit cohérence inter-CDC)** : 4 endpoints entrants actifs (E1, E2, E3, E5) sur 6 slots historiques — E4 supprimé seconde salve 2026-04-23, E6 supprimé revue sobriété Bloc A 2026-05-01. **8 webhooks sortants actifs** (S1, S2, S3, S4, S5, **S7**, S9, S11) sur 11 slots historiques — S6 + S8 + S10 supprimés Bloc A 2026-05-01. **S7 restauré 2026-05-01** (annulation Bloc C C3, audit cohérence inter-CDC) pour couvrir le besoin métier R_M03.3 (manager prestataire pré-saisit plaque). Les slots supprimés sont conservés en strikethrough volontairement pour préserver les références historiques dans les modules M01/M06/M07/M08/M09 et éviter une renumérotation cascade.

---

## Principes généraux

### 1. Event-driven sans polling

- **Canal unique** : webhook HTTPS push dès que l'événement métier se produit (latence < 5s)
- Si le webhook échoue → retry policy uniforme **3 paliers : 5 min / 1h / 24h** *(simplifié Bloc B B1)* + dédup `integrations_inbox`
- Échec final retry (>24h) → alerte critical M11 + bouton "Rejouer" manuel dashboard sync M13
- **Pas de polling fallback V1** *(supprimé revue sobriété 2026-05-01 A4)* — le retry 3 paliers (Bloc B B1) couvre 99.99% des pannes <24h, au-delà = intervention manuelle (pas un cas nominal à automatiser)

### 2. Idempotence stricte

Chaque événement porte un `event_id` UUID unique. Le consommateur stocke les `event_id` traités (table `integrations_inbox`) et ignore les doublons. L'émetteur peut rejouer un même `event_id` sans provoquer de modification en double.

**Clé métier secondaire** selon l'événement :
- Collectes : `collecte_id`
- Tournées : `tournee_id`
- Prestataires : `prestataire_id`
- Lieux : `lieu_id`

### 2bis. Émission côté TMS — outbox transactionnelle (arbitrage Val 2026-07-06, revue adversariale RC-M04-06)

Tous les webhooks sortants S1-S11 sont produits via la table **`tms.outbox_events`** (cf. §04 TMS) : INSERT de l'événement (payload figé, `event_id`, `occurred_at`, `seq`) **dans la même transaction** que la mutation métier qui le déclenche ; worker consommateur en lease/claim (claim court avant tout HTTP, POST hors transaction, reaper + `requires_reconciliation`), retry 3 paliers, **head-of-line par agrégat**. Aucun webhook n'est émis directement depuis un trigger ou un handler HTTP ; `pg_notify` = réveil du worker uniquement, jamais transport (non durable). Garantie : at-least-once + zéro perte silencieuse — un event non livré reste visible (`status IN ('pending','processing','failed')`, dashboard sync M13 + bouton « Rejouer » avec `event_id` d'origine). Le `seq` d'émission tranche aussi les `occurred_at` égaux côté consommateur.

### 3. Horodatage et ordre

Chaque payload contient :
- `event_id` (UUID v4)
- `emis_le` (ISO 8601 UTC, précision milliseconde)
- `occurred_at` (horodatage métier — quand l'événement est réellement survenu côté émetteur, peut différer de `emis_le` si retry)
- **Champ payload supprimé revue sobriété Bloc B 2026-05-01 B3** — header HTTP `X-API-Version` autoritatif unique (cf. section 5 Versioning ci-dessous).

**Ordre des événements** : le consommateur compare `occurred_at` à celui du dernier événement traité pour la même entité. Si `occurred_at` reçu < dernier traité → event out-of-order, **ignoré** (pas d'écrasement d'un état plus récent par un plus ancien).

### 4. Retry policy

Si le consommateur retourne autre chose que 2xx :

**Policy uniforme 3 paliers (S1, S2, S3, S4, S5, S7, S9, S11)** *(simplifiée revue sobriété Bloc B 2026-05-01 B1 — ex-5 paliers)* :
- Retry 1 : **5 min**
- Retry 2 : **1h**
- Retry 3 : **24h**

**Justification** : 99% des erreurs transitoires (timeout réseau bref, déploiement, restart) sont résolues sous 5 min. Si pas résolu sous 1h → bug applicatif (le récepteur a un problème métier : schema invalide, conflit de données), retry à 2h/6h ne change rien au verdict. Si pas résolu sous 24h → alerte critical M11 + intervention humaine via bouton "Rejouer" dashboard sync M13. Les paliers intermédiaires 30 min / 2h / 6h supprimés étaient sur-ingénierie défensive sans ROI mesurable.

> **Note 2026-05-01** : la policy spécifique ex-S6 (1h/24h, sobriété B4 2026-04-30) est sans objet — S6 supprimé revue sobriété A2, remplacé par vue cross-schema `plateforme.v_courses_logistiques` (pas de retry car lecture directe DB).

Échec final → alerte Admin (email + dashboard M11 TMS) + statut `echec_sync` dans `integrations_logs` + bouton "Rejouer" manuel.

Backoff exponentiel avec jitter aléatoire ± 10% pour éviter les rafales synchrones.

### 5. Versioning

- Header HTTP `X-API-Version: 2026.04` (**autoritatif unique** — revue sobriété Bloc B 2026-05-01 B3)
- **Supprimé revue sobriété Bloc B 2026-05-01 B3** — la "double ceinture" était un artefact défensif sans ROI. Le header HTTP fait foi côté validateur middleware. Schéma payload simplifié.
- Breaking changes interdits en V1 — toute évolution se fait en ajoutant des champs optionnels
- Si breaking change nécessaire : nouvelle version `2026.10`, double publication pendant 30 jours, migration des consommateurs, puis dépréciation

---

## Authentification et sécurité

### Schéma d'auth

**Mutual HMAC-SHA256** sur tous les appels Plateforme ↔ TMS (bidirectionnel).

**Header des requêtes** *(simplifiés revue sobriété Bloc C 2026-05-01 C4 — `Idempotency-Key` retiré)* :
```
Authorization: Bearer <jwt>
X-Savr-Signature: sha256=<hmac>
X-Savr-Timestamp: <unix_ms>
X-API-Version: 2026.04
Content-Type: application/json
```

- `jwt` : JWT signé avec clé partagée (env var par app, **rotée annuellement** — alignement addendum 2026-04-23 / sweep audit cohérence 2026-04-29 B3)
- `hmac` : HMAC-SHA256 du body brut (UTF-8) avec clé secrète partagée (différente du JWT)
- `timestamp` : Unix ms. Le serveur rejette si `|now - timestamp| > 5 min` (protection replay)
- **Supprimé revue sobriété Bloc C 2026-05-01 C4** — duplication 1:1 avec `body.event_id`. La dédup côté serveur lit directement `event_id` du payload. Standard REST `Idempotency-Key` est utile quand le body change entre retries — pas notre cas (event_id stable, payload immuable). Dédup côté serveur via `integrations_inbox` (PK `event_id`, TTL 7j Bloc B B5).

### Vault et rotation

- Secrets stockés dans **Supabase Vault** des deux côtés (jamais en clair dans le code ni les logs)
- **Rotation manuelle annuelle** (V1, alignement addendum 2026-04-23 / sweep audit cohérence 2026-04-29 B3) : 2 clés actives en même temps pendant 7 jours pour permettre la bascule sans downtime
- Rotation automatique V2

### Allow-list IP

- TMS n'accepte les requêtes Plateforme que depuis les IPs sortantes de Supabase (région `eu-west-3` en V1)
- Plateforme idem pour TMS
- Liste maintenue dans Admin TMS (M13) et Admin Plateforme

### Journalisation obligatoire

Toute requête entrante et sortante est loggée dans `integrations_logs` (voir section Observabilité) avec :
- `event_id`, `endpoint`, `direction`, `request_headers` (sans `Authorization`), `request_body`, `response_status`, `response_body`, `latence_ms`, `tentative_numero`, `erreur_si_echec`
- **Aucun secret ni PII chauffeur dans les logs** — pièces d'identité, permis, photos sont référencés par URL signée, pas en contenu

---

## Conventions de payload

### Format commun

```json
{
  "event_id": "uuid-v4",
  "emis_le": "2026-04-22T14:30:00.123Z",
  "occurred_at": "2026-04-22T14:29:58.000Z",
  "source": "tms" | "plateforme",
  "type": "collecte.terminee",
  "data": { ... }
}
```

> **Note 2026-05-01 (revue sobriété Bloc B B3)** : champ `version` retiré du payload — le header HTTP `X-API-Version: 2026.04` fait foi (cf. section Authentification). La "double ceinture" version (header + payload) était un artefact défensif sans ROI : un émetteur défaillant a la même version dans les 2 endroits, et une divergence header/payload était traitée comme erreur applicative. Schéma simplifié.

### Enums normalisés

Les enums **doivent être identiques** dans les deux apps. Liste de référence :

| Enum                                                     | Valeurs autorisées                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statut_tms` (Plateforme) / `statut_dispatch` (TMS)      | **8 valeurs miroir** (alignement audit cohérence inter-CDC 2026-04-25 A1+B2 + sweep 2026-04-29 B4) : `non_envoye`, `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur`, `rejetee_par_tms`. Côté Plateforme : 8 valeurs. Côté TMS `statut_dispatch` : 6 valeurs (sans `non_envoye` initial Plateforme avant push E1, sans `rejetee_par_tms` qui est Plateforme-only après réception S11). Toute divergence est un bug. |
| `statut_final` (payload S5 collecte-terminee uniquement) | `realisee`, `realisee_sans_collecte`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `type_collecte`                                          | `zd`, `ag`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `statut_tournee`                                         | `planifiee`, `en_cours`, `terminee`, `annulee` (**enum exposé Plateforme = 4 valeurs, aligné `plateforme.tournees.statut` — réaligné 2026-06-11**). **Mapping TMS → payload S3** (le statut tournée TMS interne a 5 valeurs `planifiee/acceptee/en_cours/terminee/annulee`, R6.2) : `planifiee`→`planifiee`, **`acceptee`→`planifiee`** (l'état « tournée prête » est interne TMS, non exposé — décision cycle de vie 2026-06-06 ; la Plateforme suit déjà l'acceptation au niveau **collecte** via S1), `en_cours`→`en_cours`, `terminee`→`terminee` *(1:1, ex-`realisee` — réaligné 2026-06-11 sur `plateforme.tournees.statut`, plus aucun renommage wire↔colonne)*, `annulee`→`annulee`. **L'enum exposé = la colonne App** : 4 valeurs, vocab identique des deux côtés.                                                                                                                                                                                                                                                                                                                                                            |
| `type_flux_zd`                                           | **Enum fermée V1 (post-refonte 2026-05-02)** : `biodechet`, `verre`, `dechet_residuel`, `emballage`, `carton`. Renommage `dib`→`dechet_residuel`. Suppressions définitives : `dangereux`, `huiles`, `papier`, `deee`, `gravats`, `terre` (Savr ne collecte aucun de ces flux). Alignement §04 App `flux_dechets` + §04 TMS `pesees.flux`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `type_flux_ag`                                           | `don_alimentaire`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `devise`                                                 | `EUR` (V1 mono-devise)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `type_incident`                                          | **5 valeurs** (décision 2026-06-06 — `pas_excedents` retiré, cf. décision chemin unique ci-dessous) : `acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee`. Suppressions antérieures Bloc D : `vehicule_panne`/`accident_route`/`chauffeur_indisponible`/`retard_chauffeur`/`absence_contenant`/`materiel_casse`/`erreur_pesee`/`blessure`. `pas_excedents` (ex-6e valeur) retiré 2026-06-06 : le cas AG « aucun repas » passe par E5 → S5 `collecte-terminee` (`realisee_sans_collecte`), plus par S9.                                                                                                                                                                                                                                                                                                                                              |
| `statut_collecte_apres` (payload S9 incident) | **4 valeurs** (décision 2026-06-06 — `realisee_sans_collecte` retiré, plus atteignable via S9 depuis le retrait de `pas_excedents`) : `realisee`, `echec_acces`, `inchange`, `annulee`. fusionné dans `inchange` (Bloc D D3). *(`realisee_sans_collecte` reste émis par S5 `collecte-terminee` via `statut_final`, enum distinct.)* |
| `motif_dlq` (payload S11)                                | **Text libre** (post-Bloc D D5 — ex-enum 5 valeurs). Enum conservé en interne TMS pour catégorisation dashboards M11. Côté payload + Plateforme : text libre, info utile portée par `commentaire_admin` ≥10 chars.                                                                                                                                                                                                                                                                                          |
| `stationnement` (sous-objet `lieu` E1) | **3 valeurs + nullable** (propagation refonte App 2026-05-08 → §08 TMS 2026-06-03) : `facile`, `difficile`, `tres_difficile`, ou `null`. Reframe "type d'emplacement" → "difficulté d'accès". périmés ; supprimé (Bloc D D4). |
| `acces_office` (sous-objet `lieu` E1) | **3 valeurs + nullable** (propagation refonte App 2026-05-08 → §08 TMS 2026-06-03) : `facile`, `difficile`, `tres_difficile`, ou `null`. périmé (même enum que `stationnement`). |
| `type_vehicule_max` (sous-objet `lieu` E1) | **5 valeurs** (propagation refonte App 2026-05-08 → §08 TMS 2026-06-03) : `velo_cargo`, `camionnette`, `fourgon`, `vul`, `poids_lourd` (enum véhicule unifié, hiérarchie ordonnée). périmés. Identique à `type_vehicule_categorie_plateforme` (S3). |
| `integrations_inbox.statut` (table dédup) | **3 valeurs** (post-Bloc D D6) : `traite`, `ignore_doublon`, `ignore_out_of_order`. supprimé (insertion BDD APRÈS traitement réussi seulement, donc valeur jamais atteinte en pratique). Dédup garantie par PK `event_id`. |
| `imputable_a`                                            | `traiteur`, `chauffeur`, `savr`, `externe`, `indetermine`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Formats

- **Timestamps** : ISO 8601 UTC (`2026-04-22T14:30:00.123Z`)
- **Identifiants** : UUID v4 partout — pas d'ID séquentiel exposé
- **Monnaie** : integer centimes (`15025` pour 150,25 €) + `devise`
- **Poids** : `numeric(7,2)` en kilogrammes (réaligné 2026-06-11 sur les data models `pesees.poids_*_kg` / `collecte_flux.poids_reel_kg` — ex-grammes entiers)
- **Photos** : URL signée Supabase Storage (TTL 7 jours). Consommateur télécharge et ré-uploade dans son propre Storage pour persistance.

### Réponses

**Succès** : 2xx avec body minimal
```json
{ "event_id": "uuid-v4", "received_at": "2026-04-22T14:30:00.500Z" }
```

**Erreur** :
```json
{ "error": "code_machine", "message": "description humaine", "retryable": true|false }
```

Codes d'erreur normalisés :
- `400 invalid_payload` — schéma invalide (non retryable)
- `401 unauthorized` — JWT ou HMAC invalide (non retryable)
- `409 event_out_of_order` — event plus ancien que le dernier traité (non retryable, ignoré)
- `409 duplicate_event` — `event_id` déjà traité (non retryable, idempotent)
- `409 collecte_sur_tournee_active` — PATCH E2 refusé : la collecte est rattachée (via `collecte_tournees`) à au moins une tournée `acceptee`/`en_cours` (arbitrage Val 2026-07-06 RC-M04-07 — la Plateforme alerte Ops, modification traitée manuellement, non retryable)
- `409 collecte_non_modifiable` — PATCH E2 refusé : `statut_operationnel ∈ (en_cours, realisee, realisee_sans_collecte, incident)`, exécution démarrée ou terminée (code nommé audit cohérence 2026-07-06, arbitrage Val — ex-409 générique sans code ; même traitement Plateforme : alerte Ops, non retryable)
- `422 business_conflict` — état métier incompatible (ex: collecte déjà annulée)
- `429 rate_limited` — quota dépassé (retryable après `Retry-After` header)
- `500 internal_error` — erreur serveur (retryable)

---

## Webhooks entrants (Plateforme → TMS)

### E1 — `POST /collectes`

**Déclencheur** : **soumission du formulaire de programmation** côté Plateforme — la collecte est créée au statut `programmee` et E1 part immédiatement (`statut_tms` `non_envoye`→`a_attribuer`). *(Corrigé Sujet 2 2026-05-26 — ex « collecte passée au statut `validee` (validation Admin…) » : il n'y a **pas** de validation Admin à la création, le cycle est 100 % automatisé côté Plateforme ; `validee` est un état postérieur dérivé de l'acceptation prestataire — cf. App §05 §4. Le TMS reste inchangé : il reçoit la collecte à la soumission, comme aujourd'hui.)*

**Payload** :
```json
{
  "event_id": "uuid",
  "type": "collecte.creee",
  "data": {
    "collecte_id": "uuid",
    "evenement_id": "uuid",
    "traiteur_id": "uuid", // Conservé V1 : pointe sur le traiteur opérationnel (= producteur juridique du déchet) pour rétrocompatibilité TMS
    "traiteur_operationnel": {
      // Ajout 2026-05-07 — extension programmation 3 types côté Plateforme
      // Producteur juridique du déchet, possiblement fiche shadow (créée par une agence pour un traiteur hors référentiel Savr)
      "organisation_id": "uuid",
      "nom": "string",
      "raison_sociale": "string",
      "siret": "string|null", // null si fiche shadow sans SIRET → bordereau Cerfa bloqué côté Plateforme (ne concerne pas le TMS)
      "est_shadow": false // true si fiche traiteur "hors référentiel Savr" — TMS doit l'accepter normalement, pas d'impact opérationnel
    },
    "programmateur": {
      // Ajout 2026-05-07 — donneur d'ordre (qui paye Savr)
      "organisation_id": "uuid",
      "nom": "string",
      "type": "traiteur|agence|gestionnaire_lieux"
      // Si programmateur.organisation_id == traiteur_operationnel.organisation_id → cas classique traiteur=programmateur
      // Sinon → la collecte a été programmée par une agence ou un gestionnaire de lieux pour le compte d'un traiteur opérationnel tiers
      // Côté TMS : information UX uniquement (M01 réception : afficher "Programmée par X, traiteur opérationnel = Y" si différents). Aucun impact sur le dispatch ni l'attribution chauffeur.
    },
    "lieu": {
      "lieu_id": "uuid",
      "nom": "string",
      "adresse": "string",
      "code_postal": "string",
      "ville": "string",
      "coordonnees_gps": { "lat": 48.8566, "lng": 2.3522 },
      "acces_details": "string|null",
"acces_office": "facile|difficile|tres_difficile|null", // **propagation refonte App 2026-05-08 → §08 TMS 2026-06-03 (Bloc 2 JSON Schema)** : enum difficulté d'accès
"stationnement": "facile|difficile|tres_difficile|null", // **propagation refonte App 2026-05-08 → §08 TMS 2026-06-03** : reframe "type d'emplacement" → "difficulté d'accès"
      "contraintes_horaires": "string|null",
"type_vehicule_max": "velo_cargo|camionnette|fourgon|vul|poids_lourd", // **propagation refonte App 2026-05-08 → §08 TMS 2026-06-03** : enum véhicule unifié (hiérarchie velo_cargo<camionnette<fourgon<vul<poids_lourd)
      "volume_max_bacs": 0
    },
    "contacts": {
      "principal": { "nom": "string", "telephone": "string" },
      "secours": { "nom": "string", "telephone": "string" }
    },
    "heure_collecte": {
      "date": "2026-05-10", // = plateforme.collectes.date_collecte (date d'intervention logistique, vérité TMS). **Clarification 2026-05-21 (D2)** : ce champ porte la DATE DE COLLECTE, distincte de evenements.date_evenement (date client) qui n'est PAS transmise au TMS (non nécessaire à l'opérationnel). Peut différer de la date événement (collecte de nuit/lendemain).
      "heure": "18:30",
      "fuseau": "Europe/Paris"
    },
    "type_collecte": "zd|ag",
"nb_pax": 250, // = evenements.pax (pax unique niveau événement). **`collectes.pax_collecte` retiré V1 le 2026-05-29** : plus d'override par collecte, le pax transmis est toujours celui de l'événement. Comportement TMS inchangé (reçoit la valeur résolue côté Plateforme). Multi-jours à pax variable reporté V2.
    "controle_acces_requis": false, // Booléen — propagation M03 2026-04-24 + restauré 2026-05-01 + **renommé 2026-05-03 (refonte formulaire §06.01 Plateforme : flag unique plaque + nom chauffeur, ex `plaque_requise`)**. Si true → manager prestataire doit pré-saisir la plaque ET affecter un chauffeur en M03 E4 → trigger validate_tournee_controle_acces bloque validation tournée si plaque OU chauffeur_id manquant (R_M03.4 + R_M04.CONTROLE_ACCES, sauf exception A Toutes! vélo cargo sur le critère plaque uniquement — chauffeur reste obligatoire).
    "informations_supplementaires": "string|null" // Texte libre max 1000 car. — ajout refonte 2026-05-06 (§06.01 §2.a Plateforme). Informations logistiques saisies par le programmeur (ex: "Sonner interphone B au RDC", "Quai N°2 fermé le lundi"). Source plateforme.collectes.informations_supplementaires, figé dans tms.collectes_tms.informations_supplementaires à la création TMS. Visible côté TMS : manager prestataire (M01 réception, M03 dispatch) + chauffeur app mobile (M05 tournée). **Remplace l'ancien champ `notes_commerciales` (orphelin, supprimé du payload 2026-05-06).**
  }
}
```

**Note 2026-04-23 seconde salve** : le champ `prestataire_id_pre_affecte` a été **retiré du payload** (D10 supprimée). Toutes les collectes arrivent désormais en `statut_dispatch='a_attribuer'`. Les règles d'attribution forte (ex : "client X = toujours Strike") vivent dans M12 TMS (paramétrable). Voir [[../06 - Fonctionnalités détaillées TMS/M01 - Réception ordres de collecte#Addendum 2026-04-23 (seconde salve) — Arbitrages de simplification]].

**Note 2026-04-28 audit cohérence A2** — restructuration `lieu` + `contacts` :
- Sous-objet `lieu` : ajout `acces_details`, `acces_office`, `stationnement`, `contraintes_horaires`, `type_vehicule_max`, `volume_max_bacs`. Retrait `contraintes_acces` (legacy, fusionné dans `acces_details`).
- Nouveau sous-objet racine `contacts` (sorti de `lieu` car contacts dépendent du couple lieu × traiteur, pas du lieu seul). Contient `principal` (obligatoire) et `secours` (optionnel — peut être absent ou avec champs vides si traiteur n'a pas saisi).
- Source : `contacts.principal` ← `evenements.contact_principal_nom/telephone` ; `contacts.secours` ← `evenements.contact_secours_nom/telephone` (nullable). Les contacts sont figés dans `tms.collectes_tms.contact_principal_*` + `contact_secours_*` à la création TMS (pas dans `lieu_snapshot`).
- Champ `email` retiré des contacts (non utilisé en pratique, téléphone seul suffit jour J — V1.1 si besoin réel).

**Note 2026-04-24 M03 + restauration 2026-05-01 + renommage 2026-05-03 (refonte formulaire §06.01 Plateforme)** : champ `controle_acces_requis` (booléen, défaut `false`, ex `plaque_requise`) propagé depuis `plateforme.collectes.controle_acces_requis` (lui-même hérité de `lieux.controle_acces_requis_default`). Sémantique étendue : flag unique couvrant plaque ET nom chauffeur. Côté TMS : si `true` → manager prestataire **doit** pré-saisir la plaque en M03 E4 (`tms.tournees.plaque_preassignee_manager`) ET affecter un chauffeur (`tms.tournees.chauffeur_id`) avant validation tournée. Trigger `validate_tournee_controle_acces` bloque transition `tournees.statut → acceptee` si plaque OU chauffeur manquant (R_M03.4 + R_M04.CONTROLE_ACCES). **Exception A Toutes! vélo cargo** : trigger autorise validation même si `controle_acces_requis=true` sur le critère plaque uniquement (le chauffeur reste obligatoire dans tous les cas). Webhook S7 `plaque-saisie` émis à la saisie manager M03 E4 — payload enrichi 2026-05-03 : `{plaque, chauffeur_nom}` (lus via JOIN `chauffeurs.nom_complet` sur `tournees.chauffeur_id`). Alimente Plateforme `tournees.plaque_immatriculation` + `tournees.chauffeur_nom`. Plaque chauffeur terrain M05 E3 reste TMS-only V1 (Option B arbitrage Val 2026-05-01).

**Réponse TMS** : `201 Created` + `{ "collecte_id": "...", "statut_tms": "recue" }`

**Validations TMS bloquantes** :
- `collecte_id` absent ou non UUID → 400
- Taille payload > 256 KB → 413 + DLQ `schema_invalide` (D22 seconde salve)
- Coords GPS absentes si `type_collecte = ag` OU `lieu.code_postal` hors IDF → accept + flag `coords_manquantes=true` (D9 M01 — pas de rejet, Ops résout sur place)
- `heure_collecte` dans le passé → 422 (propagation 2026-04-29 — anciennement "Créneau dans le passé")

### E2 — `PATCH /collectes/:id` *(enrichi 2026-05-04 — refonte modification libre côté Plateforme)*

**Déclencheur** : modification d'une collecte déjà validée (changement `heure_collecte`, `date_collecte`, nb_pax, contacts, notes, `controle_acces_requis`, `informations_supplementaires`, type_evenement, taille). Voir [[../01 - Cahier des charges App/06 - Fonctionnalités détaillées/04 - Espace client traiteur#Édition d'une collecte à venir (refonte 2026-05-04 + sobriété 2026-05-04)]] *(alignement audit cohérence inter-CDC Run 6 2026-05-07 B1 — ancre cible alignée sur le titre réel §06.04 App)* et [[../01 - Cahier des charges App/08 - APIs et intégrations#Modification collecte (refonte 2026-05-04)]].

**Payload** *(refonte 2026-05-04 + sobriété B5 2026-05-04 — `side_effects` retiré, le TMS calcule sa propre logique sur le diff)* :

```json
{
  "event_id": "uuid v7 — clé idempotency (dédup serveur via integrations_inbox)",
  "occurred_at": "ISO 8601",
  "type": "collecte.modifiee",
  "data": {
    "collecte_id": "uuid",
    "modifie_par_user_id": "uuid (programmeur ou manager Plateforme)",
    "diff": {
      "date_collecte": { "ancien": "2026-05-15", "nouveau": "2026-05-16" },
      "heure_collecte": { "ancien": "14:00", "nouveau": "16:30" },
      "contacts": { "principal": { ... }, "secours": { ... } },
      "controle_acces_requis": { "ancien": false, "nouveau": true },
      "informations_supplementaires": { "ancien": "Sonner interphone B", "nouveau": "Quai N°2 fermé le lundi, passer par accès Nord" },
      "association_attribuee": {
        "ancien": null,
        "nouveau": {
          "association_id": "uuid",
          "nom": "string",
          "adresse": "string",
          "code_postal": "string",
          "ville": "string",
          "coordonnees_gps": { "lat": 48.8566, "lng": 2.3522 },
          "contact": { "nom": "string", "telephone": "string" },
          "horaires_ouverture": "string"
        }
      },
      "...": "uniquement les champs effectivement modifiés"
    }
  }
}
```

> **`association_attribuee` (AG uniquement — ajout 2026-05-29, arbitrage Val)** : destination de livraison des excédents AG. L'association est attribuée puis validée côté Plateforme (algo §06.09 + Admin) **après** la création de la collecte (E1 part à la soumission, l'association n'est pas encore connue). En V2, la cascade `attribution_validee` (App §06.09 §3) émet **E2** avec cet objet pour transmettre la destination au TMS. M01 W3 le fige dans `tms.collectes_tms.association_snapshot` → affiché au chauffeur en M05 E7 (pré-rempli). Ré-attribution association (refus asso Plateforme) → nouvel E2, snapshot écrasé. **Push silencieux** (pas de réacceptation : changer la destination de livraison n'affecte pas l'acceptation de la course par le transporteur). Champ jamais présent pour les collectes ZD.

**Règles métier (refonte 2026-05-04)** :
- Si `collectes_tms.statut_operationnel ∈ (en_cours, realisee, realisee_sans_collecte, incident)` → **refus `409 collecte_non_modifiable`** *(code nommé audit cohérence 2026-07-06)* (la collecte n'est plus modifiable, exécution démarrée ou terminée). Plateforme alerte Ops, ne réessaye pas. *(Alignement audit cohérence inter-CDC Run 6 2026-05-07 A3 : ex `statut_tms = realisee, en_cours, terminee, cloturee`, valeurs hors enum `statut_tms` 8 valeurs miroir + `cloturee` inexistant nulle part.)*
- Si `statut_dispatch = attribuee_en_attente_acceptation` → diff appliqué silencieusement (pas de réacceptation : le prestataire n'a pas encore accepté). Notification standard manager prestataire en M03. *(Alignement audit cohérence inter-CDC Run 6 2026-05-07 A2 : ex `statut_tms = attribuee`, valeur inexistante dans l'enum miroir 8 valeurs.)*
- Si `statut_dispatch = acceptee` :
  - Diff sur **date_collecte** ou **heure_collecte** : **réacceptation requise** → statut TMS repasse à `attribuee_en_attente_acceptation` (réutilisation enum existant, pas de 7e valeur), flag `flags_jsonb.re_confirmation_requise = true` sur `tms.collectes_tms` pour distinguer d'une 1ère acceptation côté UI portail M03 (cf. M04 W10). Push notification au prestataire (email + portail M03) pour re-confirmation.
  - Diff sur `controle_acces_requis` (passage à `true`) : **notification simple** au manager prestataire (« contrôle d'accès désormais requis — pré-saisir plaque + chauffeur en M03 E4 avant validation tournée »), **pas de réacceptation** (arbitrage Val 2026-06-05). MAJ donnée TMS.
  - Diff sur autres champs (notes, contact secours, `nb_pax`, `informations_supplementaires`, `association_attribuee`, etc.) : push silencieux, MAJ donnée TMS, pas de réacceptation. *(`nb_pax` explicitement retiré des champs déclenchant une réacceptation — arbitrage Val 2026-06-05 ; il reste déclencheur du re-run M12 « suggestion d'attribution », purement interne Ops, sans réengagement prestataire.)*
  - Logique réacceptation déduite du diff par le TMS (sobriété B5 2026-05-04 : pas de flag `side_effects` dans le payload, le TMS source de vérité sur le workflow prestataire).
- **Champs non modifiables au PATCH (sobriété A4 2026-05-04 — verrouillés UI Plateforme)** :
  - `collecte_id`, `evenement_id`, `traiteur_id` (immuables)
  - `lieu_id` : verrouillé UI côté Plateforme. Le traiteur doit annuler + reprogrammer. Si reçu en PATCH (anomalie) → refus 422.
  - `type_collecte` (ZD/AG) : idem `lieu_id`. Refus 422 si reçu en PATCH.

**Idempotency** : dédup serveur via `integrations_inbox` 7j (Bloc B B5) sur `event_id`. PATCH rejoué avec même `event_id` → 200 OK sans réappliquer (conforme C4).

**Cohérence inter-CDC** : impacts à propager sur [[06 - Fonctionnalités détaillées TMS/M04 - Gestion des tournées]] (workflow réacceptation prestataire post-modification date/heure).

### E3 — `DELETE /collectes/:id`

**Déclencheur** : annulation d'une collecte.

**Payload** :
```json
{
  "event_id": "uuid",
  "type": "collecte.annulee",
  "data": {
    "collecte_id": "uuid",
    "motif": "string",
    "annule_par_user_id": "uuid",
    "annule_le": "2026-04-22T14:30:00Z"
  }
}
```

**Conséquences côté TMS** (voir décision annulation §03) :
- Si `statut_tournee = planifiee` → tournée annulée, 0 € facturé prestataire
- Si `statut_tournee = en_cours` → alerte Ops, coût vacation prestataire généré (Strike/Marathon). **Remplacé revue sobriété 2026-05-01 A2** : trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()` invoqué par UPDATE `tms.tournees.cout_final_ht` *(nom corrigé audit 2026-05-26 A2)* (lecture via vue `plateforme.v_courses_logistiques`).
- Tournée associée dissoute si elle ne contenait que cette collecte

### E4 — `PATCH /prestataires/:id` (supprimé 2026-04-23 seconde salve)

> ⚠ **Endpoint supprimé le 2026-04-23 (seconde salve M01, décision D14)**. Retournement prestataires : table unique `shared.prestataires` écrite côté TMS (M06 Référentiel prestataires), lecture cross-schema Plateforme. Plus de sync bidirectionnelle webhook. Les payloads legacy éventuellement reçus sont traités en DLQ motif `endpoint_supprime` (archivage simple, pas de réémission).

### E5 — `PATCH /lieux/:id` (allégé 2026-04-23 seconde salve)

**Déclencheur** : notification par la Plateforme qu'un champ critique d'un lieu a changé (`adresse`, `coordonnees_gps`). Sert uniquement à alerter le TMS pour déclencher l'alerte M02 "snapshot divergent" sur les collectes futures non démarrées référençant ce lieu.

**Payload** :
```json
{
  "event_id": "uuid",
  "type": "lieu.upsert",
  "data": {
    "lieu_id": "uuid",
    "champs_modifies": ["adresse", "coordonnees_gps"],
    "nouvelle_valeur_snapshot": {
      "nom": "string",
      "adresse": "string",
      "code_postal": "string",
      "ville": "string",
      "coordonnees_gps": { "lat": 0, "lng": 0 }
    },
    "modifie_le": "2026-04-23T14:00:00Z"
  }
}
```

**Propagation TMS** :
- Le `lieu_snapshot` des collectes déjà reçues n'est **pas** mis à jour rétroactivement (cristallisé au moment de E1, cf. M01 D15).
- M01 émet une alerte M02 `m02_lieu_snapshot_divergent` warning (bandeau E1 dispatch + bouton "Synchroniser snapshot pour cette collecte" — *override ponctuel par collecte, sobriété M01 A_M01_05 — 2026-04-30 : sync batch lieu→futures retiré*) sur chaque collecte future non démarrée référençant ce lieu.
- Les colonnes logistiques partagées `acces_details`, `acces_office` (refonte 2026-04-28 audit cohérence A2) ne déclenchent **pas** E5 (elles sont écrites directement par le TMS via RLS cross-schema column-level, cf. §04 D16). Ex-4 colonnes addendum (`code_acces`, `parking`, `contact_ops_logistique`, `instructions_chauffeur`) supprimées et fusionnées sur l'existant.

**Note sur les colonnes enrichies par le TMS** : les 2 colonnes logistiques partagées (`acces_details`, `acces_office`) du lieu sont modifiées directement en DB par le TMS (write via RLS cross-schema column-level `plateforme.lieux`). Aucun endpoint API dans les deux sens — la cohérence est assurée par les policies RLS (§09). **Refonte 2026-04-28** : ex-4 colonnes addendum supprimées (fusion mapping). Contacts retirés (`lieux.contact_*` supprimés, relogés sur `evenements.contact_principal_*` + `contact_secours_*`).

### E6 — `GET /sync/poll` (fallback polling) (supprimé revue sobriété 2026-05-01 A4)

> ⚠ **Endpoint supprimé le 2026-05-01 (revue sobriété §08 Bloc A, A4)**. Justification : retry policy 3 paliers (5 min / 1h / 24h — Bloc B B1) + dédup `integrations_inbox` 7j (Bloc B B5) couvrent 99.99% des pannes <24h. Au-delà → alerte critical M11 + intervention manuelle (pas de cas nominal à automatiser). Suppression jobs cron Edge Function 60 min, pagination cursor `next_since`/`has_more`, tests panne réseau simulée.

---

## Webhooks sortants (TMS → Plateforme)

### S1 — `POST /webhooks/tms/collecte-acceptee`

**Déclencheur** : (a) manager prestataire **Strike/Marathon** accepte une collecte dans le portail M03 ; (b) **A Toutes!** (Everest, pas de portail M03) — réception du webhook Everest `mission_dispatched` qui mute `statut_dispatch → acceptee` (M14 W2 / R_M14.1bis, arbitrage Val 2026-05-29) ; (c) **A Toutes! Everest down** — failover acceptation manuelle Ops (M14 W4).

**Payload** :
```json
{
  "event_id": "uuid",
  "type": "collecte.acceptee",
  "data": {
    "collecte_id": "uuid",
    "prestataire_id": "uuid",
    "chauffeur": { "chauffeur_id": "uuid|null", "nom": "string", "prenom": "string|null" },
    "equipier": { "equipier_id": "uuid|null", "nom": "string|null" },
    "vehicule": { "vehicule_id": "uuid|null", "type": "camion_16m3|camion_20m3|velo_cargo|autre", "plaque": "string|null" },
    "acceptee_le": "2026-04-22T10:00:00Z"
  }
}
```

> **Nullables A Toutes! (arbitrage Val 2026-05-29)** : pour une acceptation déclenchée par `mission_dispatched`, le coursier A Toutes! n'est pas une entité Savr gérée au moment de l'acceptation → `chauffeur.chauffeur_id = null` (`nom` = `coursier_nom` Everest, `prenom` = null), `vehicule.vehicule_id = null`, `vehicule.plaque = null` (vélo cargo). Le `vehicule.type` est dérivé de `vehicule_type_everest` (vélo cargo → `velo_cargo`). La Plateforme accepte ces nulls sans bloquer (la donnée chauffeur terrain remonte ensuite via M05).

> **Multi-vélo AG — un seul S1 par collecte (généralisation 2026-05-29, arbitrage Val 2)** : quand une collecte est servie par N vélos (N missions Everest), c'est le `mission_dispatched` de la **1re** mission qui mute `statut_dispatch → acceptee` et émet **un seul** S1 `collecte-acceptee`. Les `mission_dispatched` des missions suivantes sont des no-op idempotents (`statut_dispatch` déjà `acceptee`) → pas de S1 redondant. La Plateforme ne voit donc qu'une acceptation par collecte, quel que soit le nombre de vélos. Le `chauffeur`/`vehicule` du S1 correspond au coursier de la 1re mission dispatchée.

**Effet Plateforme** : MAJ `collectes.statut_tms = 'acceptee'`, `statut_tms_at` (renommage propagation audit cohérence inter-CDC 2026-04-25, A1+B2 — alignement miroir 1:1 avec `tms.collectes_tms.statut_dispatch`). Email de confirmation automatique au traiteur (optionnel, configurable Admin Plateforme).

### S2 — `POST /webhooks/tms/collecte-refusee`

**Déclencheur** : manager prestataire refuse une collecte.

**Payload** :
```json
{
  "data": {
    "collecte_id": "uuid",
    "prestataire_id": "uuid",
    "motif": "string",
    "refusee_le": "2026-04-22T10:05:00Z"
  }
}
```

**Effet Plateforme** : MAJ statut + notification Admin Savr pour réattribution. Côté TMS, la collecte retourne en file d'attente dispatch Ops (M02).

### S3 — `POST /webhooks/tms/tournee-upsert`

**Déclencheur** : création ou modification d'une tournée (M04).

**Payload** :
```json
{
  "data": {
    "tournee_id": "uuid",
    "prestataire_id": "uuid",
    "collecte_ids": ["uuid", "uuid"],
    "heure_debut_prevue": "2026-05-10T18:30:00Z",
    "heure_fin_prevue": "2026-05-10T22:30:00Z",
    "statut": "planifiee|en_cours|realisee|annulee",
    "chauffeur_id": "uuid",
    "vehicule_id": "uuid",
    "type_vehicule_categorie_plateforme": "velo_cargo|camionnette|fourgon|vul|poids_lourd"
  }
}
```

**Effet Plateforme** : upsert `tournees` + réconciliation des liaisons via `plateforme.collecte_tournees` à partir de `collecte_ids[]` *(refonte multi-camions 2026-05-25, ex `collectes.tournee_id` singulier)* : l'App insère/supprime les lignes `(collecte_id, tournee_id)` pour ce `tournee_id`. Permet d'afficher que N collectes partagent un camion (mutualisation) **et** qu'une collecte est servie par N camions (multi-camions — la même `collecte_id` apparaît alors dans le `collecte_ids[]` de plusieurs tournées). **Refonte 2026-05-08** : ajout du champ `type_vehicule_categorie_plateforme` dérivé côté TMS (`vehicules.type_vehicule_id → types_vehicules.categorie_plateforme`). Alimente `plateforme.tournees.type_vehicule` (enum aligné). Évite à la Plateforme un lookup cross-schema à chaque lecture. Source unique de vérité reste `tms.types_vehicules.categorie_plateforme` — la Plateforme peut interroger la vue `v_tms_types_vehicules_categories` pour vérifier la cohérence ou récupérer le détail (`code`, `libelle`).

### S4 — `POST /webhooks/tms/collecte-en-cours`

**Déclencheur** : chauffeur clique "Je commence la collecte" sur app mobile.

**Payload** *(simplifié revue sobriété Bloc B 2026-05-01 B4 — champ `geoloc` retiré, la Plateforme n'utilise pas la géoloc chauffeur, retard traité côté TMS M11)* :
```json
{
  "data": {
    "collecte_id": "uuid",
    "tournee_id": "uuid",
    "demarree_le": "2026-05-10T18:32:00Z",
    "chauffeur_id": "uuid"
  }
}
```

> **Note RGPD 2026-05-01** : la géoloc chauffeur reste captée et stockée côté TMS (`tms.chauffeurs_geolocalisation`, purge 30j) pour les alertes M11 de retard et la traçabilité opérationnelle. Elle n'est plus transmise à la Plateforme — bonus de minimisation des données personnelles côté Plateforme (cohérent avec le scope RGPD défini §15 TMS).

### S5 — `POST /webhooks/tms/collecte-terminee`

**Déclencheur** : clôture collecte côté TMS, que ce soit :
- (a) collecte réalisée normalement (pesée effectuée + livraison asso si AG)
- (b) collecte clôturée sans pesée via bouton "Aucun repas à collecter" (AG uniquement, voir §03 M05)
- (c) correction de pesée post-clôture — **toute source** (étendu 2026-07-06, arbitrage Val RC-M05-04) : ajustement Ops Savr **OU** pesée tardive insérée après la dérivation `realisee` (item offline DLQ rejoué — trigger `trg_pesee_tardive_s5_correction` §04) → re-push avec `type = correction` (décision §05 R6 Q6 — 2026-04-22, étendue 2026-07-06)

> **Multi-véhicules — un seul S5 terminal par collecte (refonte 2026-05-25, arbitrage 4 + 6a ; couvre le multi-vélo AG 2026-05-29)** : pour une collecte servie par N tournées (N camions ZD **ou N vélos A Toutes! AG**), le TMS n'émet **qu'un seul** `collecte-terminee`, déclenché quand **toutes** ses tournées sont `terminee` (dérivation du statut collecte → `realisee`, trigger `fn_derive_statut_collecte_multi_tournees` §05 R6.1). Les `pesees[]` sont **agrégées sur les N véhicules** (`SUM ... GROUP BY collecte_tms_id, flux` — chaque véhicule a pesé sa portion sous le même `collecte_tms_id` avec son propre `tournee_id` ; AG : `don_alimentaire` total). Le champ `tournee_id` du payload est alors **informatif** (dernière tournée terminée) — la Plateforme clé sur `collecte_id`. **Cas standard (1 tournée)** : inchangé, un S5 à la clôture de l'unique tournée. *(La Plateforme ne voit jamais le nombre de véhicules : elle reçoit la collecte terminée + le coût logistique agrégé via `v_courses_logistiques`. Multi-vélo invisible côté Plateforme par design.)*

**Payload** :
```json
{
  "data": {
    "collecte_id": "uuid",
    "tournee_id": "uuid",
    "terminee_le": "2026-05-10T19:45:00Z",
    "type": "cloture" | "correction",
    "statut_final": "realisee" | "realisee_sans_collecte",
    "pesees": [
      {
        "pesee_id": "uuid",
        "idempotency_key": "uuid",
        "type_flux": "biodechet|verre|dechet_residuel|emballage|carton|don_alimentaire",
        "poids_brut_kg": 45.20,
        "tare_kg": 5.00,
        "poids_net_kg": 40.20,
        "contenant_code": "bac_240L|roll_240L|bac_1100L|sac|sans_contenant|null",
        "tare_override_motif": "string|null",
        "source": "chauffeur|ag_sans_collecte",
        "photos": ["https://...signed..."]
      }
    ],
    "photos_collecte": ["https://...", "https://..."],
    "rolls": {
      "pleins_recuperes": 4,
      "vides_laisses": 2
    },
    "signature_asso": {
      "nom": "string",
      "prenom": "string",
      "signature_url": "https://...",
      "signe_le": "2026-05-10T19:40:00Z"
    },
    "aucun_repas": {
      "motif_chauffeur": "string",
      "photo_lieu_url": "https://..."
    }
  }
}
```

**Règles de remplissage** :
- Si `statut_final = realisee` : `pesees[]` obligatoire (≥ 1), `rolls` obligatoire pour ZD, `signature_asso` obligatoire pour AG, `aucun_repas` absent
- Si `statut_final = realisee_sans_collecte` (AG uniquement) : `pesees[]` = `[]`, `rolls` absent, `signature_asso` absente, `aucun_repas` obligatoire (motif + photo)
- **Retiré V1 (revue sobriété 2026-04-29)** — suppression `flux_prevus` et R_M05.18 corrélativement. Plateforme reçoit uniquement les pesées **réellement** effectuées par le chauffeur. Plus de ligne auto-insérée à 0kg. Plus de mention "Flux non pesé" dans le rapport traiteur — un flux non pesé est simplement absent du rapport.
- **Champ `source`** (revue sobriété 2026-04-29 — enum 3→2 valeurs) : `chauffeur` (saisie terrain E6 — pesée réelle ZD ou AG), `ag_sans_collecte` (AG "Aucun repas" E5, poids 0 légitime). Valeur `presume_non_pese` retirée avec suppression R_M05.18.
- **Champ `idempotency_key`** (propagation M05 2026-04-24) : UUID généré par PWA M05 avant stockage queue IndexedDB. Garantit déduplication serveur en cas de retry offline (W11 M05).
- **Champ `contenant_code`** (propagation M05 2026-04-24) : slug du `types_contenants.code` utilisé pour la pesée (ex `bac_240L`, `sans_contenant`). Nullable si pesée historique (compat migration Bubble).
- **Champ `tare_override_motif`** (propagation M05 2026-04-24) : non-null si le chauffeur a saisi une tare différente de la snapshot attendue (R_M05.4, D8 M05). Min 10 caractères, audit trail.
- **Champ `photos`** *(simplifié revue sobriété Bloc B 2026-05-01 B2 — fusion `photo_url` singulier + `photos_urls` array → champ unique `photos: string[]`)* : array URLs photos (max 5 par pesée, paramètre `m05_photo_max_par_pesee`). Toujours array même si 1 photo. Pas de migration progressive V1 (Bubble n'utilise pas ces webhooks, fausse compat).

**Effet Plateforme** :
- MAJ `collectes.statut`, stockage des pesées, téléchargement et ré-upload des photos
- Si `statut_final = realisee_sans_collecte` : affichage badge "Aucun repas collecté" + motif + photo dans l'historique traiteur (tableau de bord) + alerte admin Ops Savr (voir §03 M05 et M11)
- Si `type = correction` : mise à jour des pesées existantes + régénération bordereau/attestation si déjà générés (version incrémentée, ancienne version archivée). Alerte Ops Savr Plateforme "Correction pesée reçue depuis TMS".
- Si `type = cloture` (défaut) : génération bordereau Savr (ZD) ou attestation de don 2041-GE (AG) déclenchée automatiquement.

### S6 — `POST /webhooks/tms/course-cout-calculee` (supprimé revue sobriété 2026-05-01 A2)

> ⚠ **Webhook supprimé le 2026-05-01 (revue sobriété §08 Bloc A, A2)**. Remplacé par **lecture cross-schema directe** via vue `plateforme.v_courses_logistiques`.

**Architecture remplaçante** :

La Plateforme accède au coût tournée et aux métadonnées non sensibles par **vue matérialisée cross-schema** :

```sql
-- Contrat de colonnes figé par l'audit de cohérence inter-CDC 2026-05-26 (convention € HT decimal, alignée tms.tournees).
-- Grain : 1 ligne par couple (collecte × tournée) — tournee_id N'EST PAS unique.
CREATE VIEW plateforme.v_courses_logistiques AS
SELECT
  t.id                              AS tournee_id,        -- non unique : 1 ligne par collecte servie
  t.prestataire_id,
  t.cout_final_ht,                                        -- € HT, = cout_ajuste_ht si statut_financier='ajuste', sinon cout_calcule_ht
  (t.statut_financier = 'ajuste')   AS cout_ajuste,       -- flag reporting "marge ajustée" (dérivé, ex colonne booléenne)
  t.push_s6_version                 AS version_paiement,  -- lecture reporting uniquement (pas de push)
  t.duree_reelle_minutes,
  jsonb_build_object(                                     -- A3 audit 2026-05-26 : whitelist NON sensible, exclut grille_snapshot
    'formule_code',             t.cout_detail->>'formule_code',
    'palier_applique',          t.cout_detail->'palier_applique',
    'nb_vacations',             t.cout_detail->'nb_vacations',
    'nb_personnes_facturation', t.cout_detail->'nb_personnes_facturation',
    'duree_reelle_minutes',     t.cout_detail->'duree_reelle_minutes',
    'raison',                   t.cout_detail->>'raison'
  )                                 AS snapshot_cout_detail,
  ct.collecte_tms_id                AS collecte_id,
  (ct.cout_reparti_centimes / 100.0)::numeric(10,2) AS cout_reparti_ht  -- € HT (stockage liaison en centimes, exposé en €)
FROM tms.tournees t
LEFT JOIN tms.collecte_tournees ct ON ct.tournee_id = t.id   -- refonte multi-camions 2026-05-25 : jointure via la liaison N↔N (ex c.tournee_id = t.id)
WHERE t.statut IN ('realisee', 'annulee');
```

> **Note unités (audit 2026-05-26 A1/A2)** : la table `tms.collecte_tournees` **stocke** la quote-part en centimes (`cout_reparti_centimes` integer, exact, pas d'arrondi flottant) ; la vue l'**expose** en € HT decimal (`cout_reparti_ht`). Le coût tournée est exposé via `cout_final_ht` (colonne réelle de `tms.tournees`). Plus de colonnes `cout_total_centimes` / `repartition_methode` / `cout_ajuste` (bool) / `version_paiement` / `snapshot_cout_detail` brutes : elles n'existent pas sur `tms.tournees`.

> **Multi-camions (2026-05-25)** : la jointure passe désormais par `tms.collecte_tournees` (relation N↔N) au lieu de `collectes_tms.tournee_id` (retiré). Le `cout_reparti_centimes` est lu sur la **ligne de liaison** (1 part par couple collecte×tournée). Une collecte servie par N tournées produit N lignes dans la vue → côté Plateforme, le coût logistique de la collecte = **somme** des `cout_reparti_centimes` de ses lignes (cf. calcul marge [[../01 - Cahier des charges App/04 - Data Model#Vue : `v_courses_logistiques`]]). Une tournée mutualisée (N collectes) produit N lignes avec sa part répartie par collecte — comportement inchangé.

**Trigger refresh marge Plateforme** : sur UPDATE de `tms.tournees.push_s6_version` ou `tms.tournees.cout_final_ht` *(noms corrigés audit 2026-05-26 A2 — ex `version_paiement`/`cout_total_centimes` inexistants sur la table)*, trigger DB cross-schema déclenche le recalcul `plateforme.factures.marge_logistique` pour **toutes les collectes liées à cette tournée via `tms.collecte_tournees`** (logique migrée depuis l'ex-effet S6 vers fonction Postgres `plateforme.fn_recalc_marge_tournee(tournee_id uuid)`).

**Sécurité grille tarifaire** : la vue ne SELECT **pas** les colonnes sensibles (`tms.formules_tarifaires.*`, `tms.grilles_tarifaires.*`, `tms.cellules_grille.*`, ni `tms.tournees.cout_detail` **brut**). `snapshot_cout_detail` est **construit par la vue** comme un sous-ensemble whitelisté de `cout_detail` (`formule_code`, `palier_applique`, `nb_vacations`, `nb_personnes_facturation`, `duree_reelle_minutes`, `raison`) qui **exclut `grille_snapshot`** *(audit 2026-05-26 A3 — `cout_detail` brut contient la grille)*. RLS schéma `tms.*` deny par défaut côté Plateforme, autorisations explicites colonne par colonne dans la vue.

**Cas spéciaux** (lus depuis `snapshot_cout_detail.raison` comme avant) :
- `"annulation_hors_delai_facturation"` → `cout_final_ht = 0`, annulation ≥ 3h avant démarrage (R2.7)
- `"realisee_sans_collecte_flag_applicable"` → `cout_final_ht = 0`, flag `tarif_sans_collecte_applicable = true`

**Gain net** : suppression retry policy spéciale 1h/24h, suppression idempotency key composite `(tournee_id + version)`, suppression anti-replay applicatif (DB gère naturellement via `version_paiement` UPDATE). Voir [[06 - Fonctionnalités détaillées TMS/M07 - Pilotage financier logistique]] et [[../01 - Cahier des charges App/04 - Data Model#vue v_courses_logistiques]].

### S7 — `POST /webhooks/tms/plaque-saisie` (restauré 2026-05-01 — payload enrichi 2026-05-03 refonte formulaire §06.01 Plateforme : ajout `chauffeur_nom`)

> ⚠ **Webhook restauré le 2026-05-01 (annulation revue sobriété §08 Bloc C C3, audit cohérence inter-CDC)** — besoin métier "commercial traiteur demande la plaque pour contrôle d'accès anticipé → manager prestataire pré-saisit en M03 E4 → blocage validation tournée si manquante" non couvert par la lecture cross-schema seule (la plaque chauffeur terrain M05 E3 arrive trop tard pour le contrôle d'accès anticipé). Décision Val 2026-05-01 (Option B) : restaurer S7 + colonnes miroir Plateforme `tournees.plaque_immatriculation` + `plaque_saisie_at`.

> ⚠ **Payload enrichi 2026-05-03 (refonte formulaire §06.01 Plateforme)** — le flag a été renommé `plaque_requise` → `controle_acces_requis` avec sémantique étendue à plaque + nom chauffeur. Conséquence : le payload S7 transporte désormais aussi `chauffeur_nom` (lu via JOIN `chauffeurs.nom_complet` sur `tournees.chauffeur_id`). Côté Plateforme, alimentation de `tournees.chauffeur_nom` en plus de `tournees.plaque_immatriculation`.

**Déclencheur** : manager prestataire saisit la plaque en M03 E4 (`tms.tournees.plaque_preassignee_manager` renseignée) **OU** affecte un chauffeur (`tms.tournees.chauffeur_id` renseigné) sur une tournée dont au moins une collecte a `controle_acces_requis=true`. Trigger DB après UPDATE → push S7. **Saisie chauffeur terrain supprimée V1 (propagation 2026-06-04)** — il n'existe plus qu'une plaque, celle pré-saisie par le manager (ce webhook). **Pour les tournées vélo cargo A Toutes!** : émis avec `plaque=null` + `chauffeur_nom` renseigné (le nom chauffeur reste requis même en vélo cargo).

**Payload** :
```json
{
  "event_id": "uuid",
  "occurred_at": "2026-05-10T14:00:00.000Z",
  "emis_le": "2026-05-10T14:00:01.123Z",
  "tournee_id": "uuid",
  "plaque": "AA-123-BB", // null si vélo cargo A Toutes!
  "chauffeur_nom": "Jean Dupont", // ajout 2026-05-03 — JOIN chauffeurs.nom_complet via tournees.chauffeur_id, requis si controle_acces_requis=true
  "saisie_par_user_id": "uuid",
  "saisie_at": "2026-05-10T14:00:00.000Z"
}
```

**Effet Plateforme** : UPSERT `plateforme.tournees.plaque_immatriculation` + `plateforme.tournees.chauffeur_nom` (ajout 2026-05-03) + `plaque_saisie_at`. Si manager modifie la plaque ou change le chauffeur post-saisie initiale → nouveau S7 émis avec nouvel `event_id`, Plateforme remplace.

**Idempotence** : dédup via `event_id` (PK `integrations_inbox`, TTL 7j Bloc B B5).

**Retry policy** : 3 paliers uniformes (5 min / 1h / 24h, Bloc B B1).

**Sources Plateforme alimentées** :
- Dashboard traiteur "plaque officielle reçue" (V1 visible, V2 email).
- Registre transport M08 (Plateforme).
- Monitoring Admin "délai acceptation tournée → saisie plaque manager".

**Supprimé V1 (propagation suppression saisie plaque terrain 2026-06-04, arbitrage Val)** — plus de saisie plaque chauffeur, colonne `plaque_saisie_terrain` supprimée (§04). Il ne reste qu'une seule plaque : `plaque_preassignee_manager` (pré-saisie manager M03 E4), émise via ce webhook S7.

### S8 — `POST /webhooks/tms/traiteur-stock-rolls-update` (supprimé revue sobriété 2026-05-01 A3)

> ⚠ **Webhook supprimé le 2026-05-01 (revue sobriété §08 Bloc A, A3)**. Remplacé par **lecture cross-schema directe** via vue `plateforme.v_stocks_rolls`.

**Architecture remplaçante** :

La Plateforme accède aux stocks rolls par **vue cross-schema** lue à la demande par les dashboards (Admin Savr + traiteurs) :

```sql
CREATE VIEW plateforme.v_stocks_rolls AS
SELECT
  s.traiteur_id,
  s.lieu_id,
  s.type_contenant_id,
  tc.code AS type_contenant_slug,
  tc.libelle AS type_contenant_libelle,
  s.quantite_actuelle,
  s.quantite_cible,
  (s.quantite_actuelle - COALESCE(s.quantite_cible, 0)) AS ecart_cible,
  s.derniere_maj_at,
  s.derniere_maj_source
FROM tms.stocks_rolls_traiteurs s
LEFT JOIN tms.types_contenants tc ON tc.id = s.type_contenant_id;
```

**Pas de joint `organisations_lieux`** *(décision Val 2026-05-01 — les rolls sont attribués aux traiteurs, pas aux gestionnaires de lieux ; suppression du dashboard "stocks rolls" côté gestionnaire de lieux)*.

**Conséquences architecturales** :
- Suppression de la table miroir `plateforme.lieux_stocks_rolls` (créée 2026-04-25, jamais déployée en prod).
- Suppression de R_M09.7 "TMS push obligatoire" (TMS = source de vérité unique en lecture directe DB, plus besoin de push).
- Suppression de la cardinalité 1:1 par type contenant (lecture directe = N rangs scannés en une requête).
- Suppression idempotence par clé naturelle `(traiteur_id, type_contenant_id, lieu_id, calcule_le)`.
- Suppression alerte M11 `m09_webhook_s8_dlq` (critical, EC5 M09).
- Suppression retry policy 5 paliers pour S8.

**Sécurité RLS** : la vue est en lecture seule pour les rôles Plateforme. Les rôles traiteur (`auth.uid()` correspondant à un user de l'organisation traiteur) voient uniquement leurs propres lignes via filtre RLS sur `s.traiteur_id`. Détail policies : voir [[09 - Authentification et permissions TMS]] + [[../01 - Cahier des charges App/09 - Authentification et permissions]].

**Gain net** : suppression d'un webhook + retry + DLQ + alerte M11 critical + table miroir + payload enrichi 11 champs. Voir [[06 - Fonctionnalités détaillées TMS/M09 - Stock matériel Savr]] et [[../01 - Cahier des charges App/04 - Data Model#vue v_stocks_rolls]].

### S9 — `POST /webhooks/tms/incident`

**Déclencheur** : chauffeur déclare un signalement via module M05 E9 (D18). Tout signalement terrain génère S9, indépendamment du statut opérationnel résultant côté collecte.

**Payload (enrichi propagation M05 2026-04-24)** :
```json
{
  "data": {
    "incident_id": "uuid",
    "idempotency_key": "uuid",
    "collecte_id": "uuid|null",
    "tournee_id": "uuid",
    "type_incident": "acces_refuse|client_absent|probleme_tri|autre|client_annule_avant_arrivee",
    "gravite": "info|warning|critical",
    "description": "string",
    "photos": ["https://...", "https://..."],
    "appels_effectues": [
      {"destinataire": "traiteur|ops", "created_at": "2026-05-10T18:42:00Z"}
    ],
    "imputable_a": "traiteur|chauffeur|savr|externe|indetermine",
    "declare_le": "2026-05-10T18:45:00Z",
    "chauffeur_id": "uuid",
    "statut_collecte_apres": "realisee|echec_acces|inchange|annulee",
    "geofence_status": "avant_arrivee|sur_place|apres_cloture"
  }
}
```

**Enum `type_incident` (décision 2026-06-06 — chemin unique « aucun repas »)** : enum simplifié à **5 valeurs** (ex-6 post-Bloc D ; avant : 14, ex-16) :

- **M05 E9 (3 catégories signalement chauffeur sur place + générique)** : `acces_refuse` (couvre lieu fermé), `client_absent`, `probleme_tri`. *(`pas_excedents` retiré 2026-06-06 : le cas AG « aucun repas » passe par E5 → S5 `collecte-terminee`, pas par S9.)*
- **M05 E4 (1 motif incident avant arrivée)** : `client_annule_avant_arrivee`.
- **Catégorie générique** : `autre` (couvre tous les cas exceptionnels — `blessure`, `materiel_casse`, etc. tombent dans `autre` + description libre).

**Suppressions Bloc D** (7 valeurs retirées 2026-05-01) : `vehicule_panne`, `accident_route`, `chauffeur_indisponible` (3 motifs avant arrivée fusionnés en gestion hors app — appel direct Ops via bouton tel:), `retard_chauffeur` / `absence_contenant` / `materiel_casse` / `erreur_pesee` / `blessure` (Hors-M05 Ops uniquement, fréquence quasi-nulle V1, `blessure` rentre dans `autre` si cas réel).

> **Note historique (caduque post-Bloc D)** : revue sobriété M05 E9 2026-04-30 avait simplifié 16→14 valeurs. Bloc D 2026-05-01 va plus loin : 14→6.
- **M05 E9 (5 catégories signalement chauffeur sur place)** : `acces_refuse` (couvre lieu fermé — fusion), `client_absent`, `probleme_tri` (renommé depuis `bacs_non_conformes`), `pas_excedents` (AG-only — nouveau), `autre`.
- **M05 E4 (4 motifs incident avant arrivée — propagation 2026-04-29)** : `client_annule_avant_arrivee`, `vehicule_panne`, `accident_route`, `chauffeur_indisponible`.
- **Hors-M05 (Ops uniquement, M02/M11)** : `retard_chauffeur`, `absence_contenant`, `materiel_casse`, `erreur_pesee`, `blessure`.
- **Suppressions 2026-04-30** : `lieu_ferme` (fusionné dans `acces_refuse`), `bacs_vides` (couvert par `pas_excedents` AG ou pesée 0 kg ZD), `bacs_non_conformes` (renommé `probleme_tri`), `panne_vehicule` (gestion hors app — appel direct Ops via bouton tel:).
- **Renommage cosmétique conservé** : `acces_bloque` → `acces_refuse` (alias lecture jusqu'à V1.1).

Voir [[../05 - Règles métier TMS#R6.1 — Cycle de vie collectes_tms]] et [[../06 - Fonctionnalités détaillées TMS/M05 - App mobile chauffeur#E4 — Liste collectes tournée active]].

**Nouveaux champs M05 (propagation 2026-04-24)** :
- `idempotency_key` (UUID) : déduplication retry offline PWA (W11 M05)
- **Fusion revue sobriété Bloc B 2026-05-01 B2** : un seul champ `photos: string[]` (array même si 1 photo). Suppression dualité legacy.
- `appels_effectues` (array d'objets) : trace des clics `tel:` M05 E5/E9 (D18). Capturé M05, remonté pour audit Plateforme
- `statut_collecte_apres` (enum, **4 valeurs** post-décision 2026-06-06) : statut opérationnel résultant après signalement. `echec_acces` si catégorie bloquante (`acces_refuse` / `client_absent`). `inchange` pour signalements informatifs (`probleme_tri`, `autre`, ex-`incident` fusionné). **`annulee`** pour `client_annule_avant_arrivee`. `realisee` rare (post-clôture). retiré 2026-06-06 (plus atteignable via S9 depuis le retrait de `pas_excedents` ; le cas AG « aucun repas » est émis par S5 `collecte-terminee` via `statut_final`). fusionné dans `inchange` (Bloc D D3).
- `gravite` (enum) : aligné avec `incidents.gravite` §04 (`warning`, `critical`) — **enum 2 valeurs** post revue sobriété §04 2026-04-30 D1 (`info` retirée V1, aucun comportement applicatif distinct).
- **`geofence_status`** (enum, propagation revue sobriété M05 2026-04-29) : indique le contexte spatial du signalement par rapport au lieu de collecte. 3 valeurs :
  - `avant_arrivee` : chauffeur signale incident avant d'avoir atteint le geofence 300m du lieu (collecte encore en `planifiee`). Utilisé pour le **motif unique `client_annule_avant_arrivee`** *(résidu « 4 motifs » corrigé audit cohérence 2026-07-06 — `vehicule_panne`/`accident_route`/`chauffeur_indisponible` retirés de l'enum revue sobriété Bloc D 2026-05-01, gérés hors app via appel Ops ; aligné §05 R6.1 patché RC-M05-07)*.
  - `sur_place` : chauffeur signale dans le geofence du lieu (collecte en `arrivee` / `en_cours`). Cas standard incidents terrain (`acces_refuse`, `client_absent`, `probleme_tri`, `autre` — `pas_excedents` retiré décision 2026-06-06, passe par E5→S5).
  - `apres_cloture` : signalement post-collecte (rare, ex: erreur pesée détectée ultérieurement).

**Effet Plateforme (précisé audit cohérence 2026-07-06, arbitrage Val)** : alerte admin Ops Savr + commercial en charge du compte traiteur + trace `audit_log`. *(table inexistante des deux côtés — le modèle incident Plateforme = colonnes `plateforme.collectes.motif_incident` + `incident_imputable_a`, cf. §04 App)*. Selon `statut_collecte_apres` :
- `∈ (echec_acces, annulee)` → `collectes.statut = 'annulee'` + `motif_incident` (= `description` S9) + `incident_imputable_a` (mappé depuis `imputable_a`) + annulation flux downstream (bordereau, attestation) ; facturation selon les règles d'annulation Plateforme §05 App §4bis (imputable client — dont `client_annule_avant_arrivee` et `echec_acces` — = plein tarif ZD / débit pack AG ; imputable prestataire = pas de facturation).
- `inchange` → statut collecte non modifié (entrée trace + alerte uniquement).
- `realisee` / `realisee_sans_collecte` → statut porté par le S5 `collecte-terminee` associé (S9 = signalement, pas de MAJ statut).

### S10 — `GET /sync/poll` (fallback) (supprimé revue sobriété 2026-05-01 A4)

> ⚠ **Endpoint supprimé le 2026-05-01 (revue sobriété §08 Bloc A, A4)**. Symétrique de E6 — même justification : retry 3 paliers (Bloc B B1) + dédup couvrent les pannes <24h, intervention manuelle au-delà.

### S11 — `POST /webhooks/tms/collecte-rejetee` (nouveau 2026-04-23 seconde salve)

**Déclencheur** : Admin TMS rejette définitivement un event DLQ (cf. M01 W8, D20). Uniquement pour les events de type `collecte.*` (ex: `collecte.creee` DLQé et jamais traité avec succès). Les events d'autres types (anciens `prestataire.upsert` legacy par ex.) sont simplement archivés localement, sans émission S11.

**Payload** :
```json
{
  "event_id": "uuid",
  "type": "collecte.rejetee_par_tms",
  "occurred_at": "2026-04-23T15:30:00Z",
  "data": {
    "event_id_tms_source": "uuid",
    "collecte_id": "uuid",
    "motif_dlq": "string (text libre côté payload — revue sobriété §08 Bloc D 2026-05-01 D5 ; enum conservé en interne TMS pour catégorisation dashboards M11, mais sérialisé en text dans le payload S11. Plateforme stocke en text + s'appuie sur `commentaire_admin` ≥10 chars pour l'info utile)",
    "commentaire_admin": "string (≥ 10 chars, obligatoire)",
    "rejete_par_admin_id": "uuid",
    "rejete_at": "2026-04-23T15:30:00Z"
  }
}
```

**Effet Plateforme** :
- Passage de `plateforme.collectes.statut_tms` à `rejetee_par_tms`.
- Alerte Admin Plateforme (email + bannière dashboard).
- La collecte n'est plus planifiable par le TMS (pas de reprise automatique). Si la collecte reste à honorer, la Plateforme doit re-émettre un nouveau `collecte.creee` avec un `event_id` frais (pas d'annulation automatique côté Plateforme, laissée à l'arbitrage Ops).

**Rotation retry** : policy standard 3 paliers 5 min / 1h / 24h *(simplifié Bloc B B1 — ex-5 paliers)*. Si échec final → DLQ côté TMS (circular, à traiter manuellement par Admin TMS + alerte `critical`).

**Idempotence** : dédup par `event_id` classique (rejouer S11 avec même event_id = no-op côté Plateforme, 200 OK).

---

## Endpoints utilitaires (hors webhooks event-driven) (supprimés revue sobriété 2026-05-01 A1)

> ⚠ **Section supprimée le 2026-05-01 (revue sobriété §08 Bloc A, A1)** — endpoint E10 `GET /me/has-profile` retiré V1.
>
> **Justification** : confort UX pur. Population concernée ≤ 4 users cumul (Val, Louis, Marwan, Anaïs). Si un user clique sur le bouton sidebar « → Plateforme/TMS » sans avoir de profil sur l'app cible → page d'accès refusé propre côté cible (pas de 403 brut). Coût opérationnel = 0.
>
> **Conséquences** :
> - Bouton sidebar cross-app affiché **inconditionnellement** dans §11 TMS (D3) et §11 Plateforme (à propager).
> - Suppression cookie httpOnly `savr.has_plateforme_profile` TTL 1h des deux côtés.
> - Suppression CORS `Origin: https://tms.gosavr.io` + `credentials: include` côté Plateforme (et symétrique).
> - Suppression endpoint `https://tms.gosavr.io/api/v1/me/has-profile`.

---

## Observabilité et gestion d'erreurs

### Table `integrations_logs` (chaque côté)

Schéma aligné des deux côtés :

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | uuid | PK |
| `event_id` | uuid | Référence au payload |
| `direction` | enum | `entrant` / `sortant` |
| `endpoint` | text | ex: `POST /webhooks/tms/collecte-terminee` |
| `systeme_contrepartie` | enum | `plateforme` / `tms` |
| `request_headers` | jsonb | Sans `Authorization` |
| `request_body` | jsonb | Sans URL signées complètes (tronquées) |
| `response_status` | int | |
| `response_body` | jsonb | |
| `latence_ms` | int | |
| `tentative_numero` | int | 1 à 5 |
| `statut` | enum | `succes` / `echec_retryable` / `echec_final` |
| `erreur_code` | text | Si échec |
| `created_at` | timestamptz | |

**Rétention** : 2 ans (alignement avec audit RGPD).

### Table `integrations_inbox` (dédup idempotence)

| Colonne | Type |
|---------|------|
| `event_id` | uuid (PK) |
| `type` | text |
| `recu_le` | timestamptz |
| `traite_le` | timestamptz |
| `statut` | enum **3 valeurs** (post-revue sobriété §08 Bloc D 2026-05-01 D6) : `traite` / `ignore_doublon` / `ignore_out_of_order`. supprimé (insertion BDD APRÈS traitement réussi seulement). |

**Rétention** : **7 jours** *(simplifié revue sobriété Bloc B 2026-05-01 B5 — ex-30j post-sobriété M01 B_M01_01. Avec polling supprimé Bloc A A4, le retry max va à 24h donc pas de re-émission >7j possible. Logs 2 ans assurent l'audit forensic. M01 B_M01_01 obsolète)*.

### Alerting (M11 TMS)

Alertes automatiques sur :
- 5 retries consécutifs échoués → criticité **Critique** (Val + Louis email + dashboard)
- Taux d'erreur > 5% sur 1h → criticité **Haute** (Ops Savr)

> **Note 2026-05-01 (revue sobriété A5)** : alerte "Latence p95 > 30s" supprimée — métrique sans action métier (webhooks async, aucun client/prestataire impacté par latence p95). La métrique reste lisible en dashboard sync M13 si besoin debug, mais ne déclenche plus d'alerte.

### Dashboard synchronisation

Vue dédiée dans Admin TMS (M13) :
- Nb events reçus / émis par jour
- Taux de succès 1er essai vs retry
- Liste des events en `echec_final` avec bouton "Rejouer"

> **Note 2026-05-01 (revue sobriété A6)** : widget "Dérive horaire entre les 2 apps" supprimé — DB partagée + même zone Vercel/Supabase eu-west-3 = artefact sans signal opérationnel.

---

## Stratégie de versioning et évolutions

### Versioning sémantique allégé

- Format `YYYY.MM` (ex: `2026.04`, `2026.10`)
- **Breaking change interdit V1** sur les endpoints existants
- Évolutions compatibles : ajout de champs optionnels uniquement
- Nouveau endpoint ou nouveau type d'événement → version inchangée (ajout non breaking)

### Procédure breaking change (post-V1)

1. Nouvelle version publiée (ex: `2026.10`)
2. Double publication pendant **30 jours** (les deux versions acceptées côté serveur)
3. Migration du consommateur : mise à jour header `X-API-Version`
4. Dépréciation de l'ancienne version après 30 jours + alerte

### Changelog obligatoire

Fichier `CHANGELOG-API.md` co-maintenu dans les 2 apps, entrée par version et par endpoint. Mis à jour à chaque PR touchant un payload.

---

## Tests et validation

### Contract tests

- Schémas JSON Schema publiés pour **chaque payload** dans un repo partagé (`savr-api-contracts`)
- CI des 2 apps valide le payload émis vs schéma avant déploiement
- Tests d'intégration end-to-end sur chaque endpoint avant go-live V1

### Environnements

| Environnement | URL Plateforme | URL TMS | Usage |
|---------------|---------------|---------|-------|
| Dev | `dev.app.gosavr.io` | `dev.tms.gosavr.io` | Devs |
| Preview (par branch) | `branch-x.app.gosavr.io` | `branch-x.tms.gosavr.io` | Revue PR |
| Staging | `staging.app.gosavr.io` | `staging.tms.gosavr.io` | Val/Louis qualif avant prod |
| Prod | `app.gosavr.io` | `tms.gosavr.io` | Clients |

**Règle absolue** : chaque environnement communique uniquement avec sa contrepartie (dev TMS ↔ dev Plateforme, etc.). Aucun cross-environnement.

### Checklist go-live V1

- [ ] Endpoints actifs E1, E2, E3, E5 (E4 supprimé seconde salve 2026-04-23, E6 supprimé revue sobriété Bloc A 2026-05-01) et S1, S2, S3, S4, S5, **S7 (restauré audit cohérence inter-CDC 2026-05-01 — annulation Bloc C C3)**, S9, S11 (S6, S8, S10 supprimés Bloc A 2026-05-01) implémentés et testés
- [ ] Webhook S7 `plaque-saisie` testé : déclenchement à la saisie manager M03 E4 + UPSERT Plateforme `tournees.plaque_immatriculation` + exception vélo cargo A Toutes! validée
- [ ] Vues cross-schema `plateforme.v_courses_logistiques` (colonne `heure_reelle_*` ; **retirée propagation 2026-06-04 — colonne supprimée**) + `plateforme.v_stocks_rolls` créées et testées (RLS deny par défaut + autorisations colonne par colonne validées)
- [ ] Trigger DB `plateforme.fn_recalc_marge_tournee()` déployé et testé (ex-effet S6)
- [ ] Contract tests passent sur CI des 2 apps
- [ ] Secrets Vault Plateforme + TMS configurés et rotés pour la 1ère fois
- [ ] Allow-list IPs configurée
- [ ] Dashboard sync (M13) actif (3 widgets : events/jour, taux succès, échec final)
- [ ] Runbook ops rédigé (fallback commandes manuelles si TMS down)
- [ ] Test de charge 100 events/min sur 1h (couvre les pics dispatch matinaux)

---

## Décisions prises

- **Architecture event-driven webhooks** — bidirectionnelle — 2026-04-21 *(polling 15 min → 60 min sobriété M01 B_M01_02 2026-04-30 puis polling **supprimé** revue sobriété A4 2026-05-01 — retry 3 paliers Bloc B B1 + dédup couvrent les pannes <24h)*
- **Auth Mutual HMAC + JWT** — rotation annuelle manuelle V1 (retournement addendum 2026-04-23 vs semestrielle initiale, sweep audit cohérence 2026-04-29 B3), auto V2 — 2026-04-22
- **Idempotence par `event_id` UUID payload** avec dédup **7 jours** dans `integrations_inbox` — 2026-04-22 *(TTL 7j → 30j sobriété M01 B_M01_01 — 2026-04-30, puis **30j → 7j** revue sobriété Bloc B 2026-05-01 B5 ; suppression 2ème check sur `integrations_logs` 2 ans, conservés pour audit/forensic uniquement ; **header `Idempotency-Key` HTTP retiré** revue sobriété Bloc C 2026-05-01 C4 — duplication 1:1 avec `body.event_id`, dédup serveur lit directement le payload)*
- **Ordre des événements via `occurred_at`** — out-of-order = ignoré (pas d'écrasement par ancien) — 2026-04-22
- **Retry policy uniforme 3 paliers** : 5 min / 1h / 24h — 2026-05-01 *(simplifié revue sobriété Bloc B B1 — ex-5 paliers 5 min/30 min/2h/6h/24h : paliers intermédiaires sans ROI mesurable)*
- **Webhook `collecte-terminee` unique** (avec discriminant `statut_final` = `realisee` ou `realisee_sans_collecte`) — pas de webhook séparé pour le cas "Aucun repas" — 2026-04-22
- **Pesées dans `collecte-terminee` (batch)** — pas d'event `pesee-brute-upsert` unitaire en V1 (simplification) — 2026-04-22
- **Coût tournée sans détail tarifaire** — la Plateforme reçoit `cout_final_ht` *(audit 2026-05-26 A2)* + `snapshot_cout_detail` (jsonb whitelisté, exclut `grille_snapshot` — A3), pas la grille — 2026-04-22 *(canal de transmission migré webhook S6 → vue cross-schema `plateforme.v_courses_logistiques` revue sobriété 2026-05-01 A2)*
- **Stocks rolls traiteurs lus en direct cross-schema** — vue `plateforme.v_stocks_rolls` (pas de webhook) — 2026-05-01 (revue sobriété A3, ex-S8 supprimé)
- **SSO cross-app sans endpoint utilitaire** — bouton sidebar affiché inconditionnellement, page d'accès refusé propre côté cible — 2026-05-01 (revue sobriété A1, ex-E10 supprimé)
- **Versioning `YYYY.MM`** — breaking change interdit V1, procédure double publication V2 — 2026-04-22 *(header `X-API-Version` autoritatif unique — champ `version` payload supprimé revue sobriété Bloc B 2026-05-01 B3)*
- **Photos en payload : champ unique `photos: string[]`** (array, même si 1 photo) — 2026-05-01 *(revue sobriété Bloc B B2 — fusion ex-`photo_url` singulier + `photos_urls` array, dualité legacy supprimée)*
- **Pas de géoloc chauffeur dans payload S4** — la Plateforme n'utilise pas la géoloc, retard traité côté TMS M11 — 2026-05-01 *(revue sobriété Bloc B B4)*
- **Plaque manager pré-saisie M03 E4 propagée Plateforme via S7** (restauré 2026-05-01 — annulation Bloc C C3, audit cohérence inter-CDC) — `tms.tournees.plaque_preassignee_manager` → webhook S7 → `plateforme.tournees.plaque_immatriculation`. **Plaque chauffeur terrain supprimée V1 (propagation 2026-06-04, arbitrage Val)** : il ne reste qu'une seule plaque (pré-saisie manager). Exception A Toutes! vélo cargo : pas de S7 émis (pas de plaque attribuable), trigger TMS autorise validation tournée.
- **Enum `type_incident` 5 valeurs** : `acces_refuse`, `client_absent`, `probleme_tri`, `autre`, `client_annule_avant_arrivee` — décision 2026-06-06 *(`pas_excedents` retiré → cas AG « aucun repas » via E5→S5 ; ex-6 valeurs post-Bloc D D1+D2)*
- **Enum `statut_collecte_apres` 4 valeurs** : `realisee`, `echec_acces`, `inchange`, `annulee` — décision 2026-06-06 *(`realisee_sans_collecte` retiré, plus atteignable via S9 ; `incident` déjà fusionné dans `inchange` Bloc D D3)*
- **Stationnement nullable au lieu de `non_defini`** — 2026-05-01 *(revue sobriété Bloc D D4)*
- **`motif_dlq` text libre côté payload S11** — enum interne TMS conservé pour dashboards, pas exposé dans le contrat — 2026-05-01 *(revue sobriété Bloc D D5)*
- **`integrations_inbox.statut` 3 valeurs** — `recu` supprimé (insertion BDD APRÈS traitement réussi seulement) — 2026-05-01 *(revue sobriété Bloc D D6)*
- **Environnements isolés** — pas de cross entre dev/staging/prod — 2026-04-22
- **Photos par URL signée Supabase Storage (TTL 7 jours)** — consommateur télécharge et ré-uploade — 2026-04-22

---

## Questions ouvertes

1. **Résolu 2026-06-03 (Bloc 2)** — 12 schémas draft 2020-12 + `common.schema.json` rédigés dans `08 - savr-api-contracts/` (commun + entrants E1/E2/E3/E5 + sortants S1/S2/S3/S4/S5/S7/S9/S11). `additionalProperties: false` partout, enums factorisés en source unique, validés Ajv (21/21 cas, valides + invalides). **À re-auditer au démarrage du temps 2** (le data model Plateforme V1 aura bougé d'ici là — contrat vivant, pas figé). 3 normalisations à valider en `coherence-inter-cdc` : (a) `type` discriminant sortant sans préfixe `tms.` (la prose montrait `tms.collecte.acceptee` sur S1 seul), (b) S7 normalisé au format commun enveloppe+`data` (prose = payload plat), (c) `gravite` S9 = 2 valeurs `warning|critical` (exemple prose listait `info` à tort).
2. **Signature photos / documents légaux** — les URLs signées Supabase Storage ont un TTL 7 jours. Pour l'archivage légal (bordereaux, attestations), il faut que la Plateforme ré-uploade les photos dans son propre Storage à la réception. OK en V1 ?
3. **Résolu revue sobriété 2026-05-01 A4** — endpoints `/sync/poll` supprimés des deux côtés.
4. — **Résolu revue sobriété Bloc B 2026-05-01 B4** : champ `geoloc` retiré du payload S4. La géoloc reste captée et stockée côté TMS pour M11 retard, plus transmise à la Plateforme (bonus RGPD minimisation).
5. **Versioning repo API contracts** — GitHub, GitLab, ou monorepo Nx ? Question infra à trancher avant le 1er commit.
6. **Protection DDoS webhook entrant** — Supabase Edge Functions ont un rate limit par défaut. Confirmer la capacité à monter à 100 req/min pics sans être bloqué.
7. **Format timestamps fuseau** — tout en UTC dans les payloads, conversion locale (Europe/Paris) uniquement en affichage côté UI. À confirmer avec les devs.
8. — **Résolu 2026-04-22**. CDC Plateforme §08 aligné :
   - Webhook `collecte-realisee` renommé `collecte-terminee` (discriminant `statut_final`) — propagé §05, §07, §12, §16
   - Champs `aucun_repas.motif_chauffeur` + `aucun_repas.photo_lieu_url` ajoutés dans payload + tableau de bord traiteur (§06-04)
 - supprimés revue sobriété 2026-05-01 A4
   - Tables `integrations_logs` (enrichie) et `integrations_inbox` (nouvelle) ajoutées dans §04 Data Model Plateforme (Niveau 7)
   - Enum `statut` de la table `collectes` étendu avec `realisee_sans_collecte`

---

## Liens

- [[00 - Index]]
- [[01 - Vision et objectifs TMS]] — vision et décisions structurantes
- [[03 - Périmètre fonctionnel TMS]] — référence métier de chaque webhook
- [[04 - Data Model TMS]] — à créer, schéma des tables `integrations_logs`, `integrations_inbox`
- [[01 - Cahier des charges App/08 - APIs et intégrations]] — pendant Plateforme (à aligner)
- [[01 - Cahier des charges App/04 - Data Model]] — table `collectes`, `tournees`, `integrations_logs` Plateforme
