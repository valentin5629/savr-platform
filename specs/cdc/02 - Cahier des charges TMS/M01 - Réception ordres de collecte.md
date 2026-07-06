# M01 — Réception ordres de collecte

**Persona principal** : Système (traitement auto) + Admin TMS (supervision) + Ops Savr (consommateur indirect via M02).
**Contexte d'usage** : backend permanent 24/7, supervision occasionnelle Admin TMS.

---

## ⚠ Addendum 2026-05-01 — Propagation revue sobriété §08 Bloc A (A4)

**Polling fallback E6 `GET /sync/poll` supprimé V1** (revue sobriété §08 A4).

Conséquences sur M01 :

1. **B_M01_02 sans objet** — la cadence "15 min → 60 min" du cron polling E6 est obsolète : pas de cron du tout V1. La règle reste documentée pour traçabilité historique mais le job Edge Function n'est pas déployé.
2. **W2 « Polling fallback E6 » supprimé** — workflow obsolète V1. La justification "Plateforme retry natif (5/30/2h/6h/24h) couvre quasi tout" tient debout : c'est pourquoi on supprime aussi le filet de sécurité polling.
3. **A_M01_02 « Forcer polling full history »** déjà supprimé revue sobriété 2026-04-30 → reste sans objet.
4. **Gap de synchronisation max** : redéfini à **24h** (= durée max retry Plateforme), au lieu de "60 minutes (polling E6)". Au-delà → alerte critical M11 + intervention manuelle (runbook).
5. **Tableau §08 références** : ligne `§08 E6 | GET /sync/poll polling 60 min` → strikethrough, suppression du lien Cron W2.

Voir [[../08 - Contrat API Plateforme-TMS#Addendum 2026-05-01 — Revue sobriété §08 Bloc A]].

---

## Addendum 2026-04-30 (revue de sobriété V1) — 14 simplifications appliquées

Cette revue a simplifié M01 sur 14 axes. Codes canoniques `A_M01_*` (suppressions), `B_M01_*` (simplifications), `C_M01_*` (fusions doc), `D_M01_*` (enums/états) :

1. **A_M01_01 — Action « Requalifier manuellement » DLQ supprimée** (W6 + audit `REQUALIFICATION_DLQ` + UI drawer édition + état `requalifié`). Si payload invalide → fix Plateforme + ré-émission, ou rejet définitif S11. Évite divergence Plateforme/TMS.
2. **A_M01_02 — Bouton « Forcer polling full history » supprimé** (E1 dashboard). Scénario gap > 72h = quasi-nul V1. En crise → Val déclenche polling manuel via curl/Edge Function avec `since=` (runbook). Cap 72h conservé en automatique.
3. **A_M01_03 — Action « Escalader Dev » DLQ supprimée** (flag `escalade` + état `escalated` + handler email Val + frère). V1 = Val seul Admin déjà alerté par email auto sur events critiques.
4. **A_M01_04 — Zone 2 « Timeline graphique multi-courbes » E1 supprimée**. Remplacée par 5 compteurs simples (events 24h par type) + lien CSV export 7j. Volume V1 (~100 webhooks/jour) ne justifie pas un graphique.
5. **A_M01_05 — Mécanisme « Sync snapshot batch lieu→collectes futures » supprimé** (D15 simplifiée). Override ponctuel par collecte (drawer M02) seul conservé.
6. **Sans objet 2026-05-01 — TTL revenu à 7j (revue sobriété §08 Bloc B B5)** : avec polling supprimé Bloc A A4, retry max va à 24h, donc pas de re-émission >7j possible. Suppression du 2ème check sur `integrations_logs` reste valide (logs conservés 2 ans pour audit/forensic uniquement).
7. **Sans objet 2026-05-01 — polling supprimé entièrement (revue sobriété §08 A4)** : retry natif Plateforme + dédup couvrent les pannes <24h, intervention manuelle au-delà. La justification originale "polling = filet de sécurité, pas canal primaire" tient debout — on supprime aussi le filet.
8. **B_M01_03 — Push browser supprimé pour alertes Admin TMS M01**. Email seul V1 (HMAC KO, schema divergence, gap, polling KO, DLQ overflow).
9. **B_M01_04 + D_M01_03 — Colonne `attribuee_source` SUPPRIMÉE complètement** (alignement §05 ligne 732 — auto-relance M12 W3 déjà supprimée donc enum à 1 valeur = colonne morte).
10. **B_M01_05 + D_M01_01 — État `failed_dlq_again` fusionné avec `failed_dlq`** (le compteur `retry_count_manual` D19 cap 5 porte la distinction).
11. **C_M01_01 — Workflows W6/W8 « Rejeter définitivement » fusionnés** : W8 devient le workflow canonique unique. W6 ne mentionne plus que les 2 actions restantes (Rejouer + Rejeter via W8).
12. **C_M01_02 — Règle unifiée `heure_collecte` passée invalide création + modification** (W1 + W3). Refus 422 DLQ `validation_metier_echec` cohérent sur les deux endpoints.
13. **D_M01_01 — État `failed_dlq_again` retiré du diagramme d'états** (cf. B_M01_05).
14. **D_M01_02 — État `escalated` retiré du diagramme d'états** (flag column-level supprimé avec A_M01_03).

Propagations effectuées 2026-04-30 : §04 TMS (suppression `attribuee_source` + dedup 2 ans + flag escalade), §05 TMS (R6.1 + règle heure_collecte unifiée), §08 TMS (E6 cadence 60 min), §11 TMS (E1 Dashboard Ingress allégé), M02 (suppression bouton sync snapshot batch + colonne `attribuee_source`), M11 (catalogue alertes M01 — retrait push browser), M13 (onglet Intégrations actions DLQ 2 au lieu de 4), §04 Plateforme (mention `attribuee_source` retirée), 00-Index TMS (récap).

---

## Addendum 2026-04-23 (seconde salve) — Arbitrages de simplification

Cette salve a simplifié M01 sur 8 axes majeurs :

1. **Suppression totale de la pré-affectation Plateforme** : plus de champ `prestataire_id_pre_affecte` dans E1, plus de workflow W7, plus de D10. Toutes les collectes arrivent en `a_attribuer`. Les règles d'attribution vivent dans M12 TMS (paramétrable).
2. **Retournement prestataires** : plus d'endpoint E4 `PATCH /prestataires/:id`. Table unique `shared.prestataires`, écriture TMS via M06, lecture cross-schema Plateforme. Workflow W9 caduc.
3. **Retournement lieux (Option C — refonte 2026-04-28 audit cohérence A2)** : E5 `PATCH /lieux/:id` allégé (notif seule pour alerte snapshot). `plateforme.lieux` reste source de vérité Plateforme, TMS peut enrichir 2 colonnes logistiques existantes (`acces_details`, `acces_office`) via RLS cross-schema column-level. Ex-4 colonnes addendum (`code_acces`, `parking`, `contact_ops_logistique`, `instructions_chauffeur`) supprimées et fusionnées sur l'existant. Contacts retirés des `lieux` (relogés sur `evenements.contact_principal_*` + `contact_secours_*`, transmis via E1).
4. **Traiteurs** : reste `plateforme.traiteurs`, aucun partage, TMS accède via lecture cross-schema sur `collectes.traiteur_id` uniquement.
5. **Nouveau webhook sortant S11 `tms/collecte-rejetee`** (numéro S11 car S7 `plaque-saisie` est déjà pris) : déclenché quand Admin TMS rejette définitivement un événement DLQ → Plateforme passe la collecte en statut `rejetee_par_tms` + alerte Admin Plateforme.
6. **Snapshot lieu** : photo figée (`collectes_tms.lieu_snapshot` JSONB) + alerte M02 si champs critiques changent + override ponctuel par collecte *(sobriété A_M01_05 — 2026-04-30 : sync batch lieu→collectes futures retiré)*.
7. **Concurrence par `occurred_at`** : chaque UPDATE applique une sérialisation stricte (skip si out-of-order).
8. **Simplifications ops** : pas de rate limiting V1, cap 256 KB payload, FIFO naturelle Supabase, cap 5 retries manuels DLQ, versioning API unique global.

---

## 1. Objectif métier

M01 est **le point d'entrée** du TMS. Il garantit que chaque collecte validée côté Plateforme Savr arrive dans le TMS, une seule fois, dans un état métier cohérent, et est disponible pour M02 Dispatch.

**Ce que M01 résout vs MTS-1** :
- Intégration native webhook (vs exports CSV manuels)
- Idempotence stricte (vs risque de doublons dispatch)
- Robustesse via retry natif Plateforme ≤24h + dédup `integrations_inbox` (vs silence en cas de webhook perdu ; polling fallback supprimé Bloc A A4)
- DLQ + supervision Admin TMS (vs incidents non tracés)
- Détection de gap au cold-start (TMS down → alerte si > 24h)

**KPI cibles V1** :
- Taux de succès webhook E1 first-try : > 99%
- Latence réception → disponibilité en M02 : p95 < 3 secondes
- Taux d'événements arrivant en DLQ : < 0.5% (hors incident Plateforme)
- Gap de synchronisation max (détection auto) : **24h** (= durée max retry natif Plateforme ; polling E6 supprimé Bloc A A4 — au-delà = alerte critical + intervention manuelle)

**Ce que M01 ne fait pas** :
- Aucune UI Ops Savr (les conséquences métier apparaissent dans M02)
- Aucune logique de dispatch (c'est M12)
- Aucun géocodage (les coords viennent de la Plateforme, §08 E1)

---

## 2. Personas et contexte d'usage

### Système (acteur principal)
- Edge Functions Supabase en écoute sur `POST /collectes`, `PATCH /collectes/:id`, `DELETE /collectes/:id`, `PATCH /lieux/:id` (E4 `PATCH /prestataires/:id` supprimé seconde salve 2026-04-23)
- **Pas de cron polling V1** (E6 supprimé Bloc A A4 — la robustesse repose sur le retry natif Plateforme 3 paliers ≤24h + dédup `integrations_inbox`)
- Traitement automatique : validation, dedup, insertion, propagation à M02/M06

### Admin TMS
- Consulte le dashboard Ingress (E1) pour monitoring santé de l'intégration
- Triage la DLQ (E2) quand des événements y arrivent
- Déclenche retry manuel ou rejet définitif
- Environ 5-15 minutes par semaine en régime normal, plus en cas d'incident

### Ops Savr (indirect)
- Ne voit pas M01. Constate les effets via M02 :
  - Nouvelle collecte apparaît en E1 dashboard (notif toast + email)
  - Flags métier (`coords_manquantes`, `re_confirmation_requise`) déclenchent alertes M02
- Ne peut pas déclencher de retry ou d'action sur l'ingress (réservé Admin)

---

## 3. Architecture des écrans

Deux écrans Admin TMS uniquement. M01 est majoritairement backend.

| # | Écran | Rôle | Accès |
|---|-------|------|-------|
| E1 | Dashboard Ingress | Santé des intégrations entrantes | Admin TMS (lecture seule Ops Savr en V1.1 si demandé) |
| E2 | DLQ triage | Gestion des événements en quarantaine | Admin TMS uniquement |

Ces écrans sont intégrés à **M13 Administration TMS** (onglet "Intégrations") mais spécifiés ici pour cohérence fonctionnelle.

---

## 4. Écran par écran

### E1 — Dashboard Ingress (Admin TMS)

**Route** : `tms.gosavr.io/admin/ingress` (cf. [[11 - Dashboards TMS]] D9, propagation §11 2026-04-27).

**Layout** : 3 zones verticales.

**Zone 1 — KPIs temps réel (top)** :
- Événements reçus dernière heure / dernière 24h
- Taux succès (first-try) / retry / DLQ
- Compteur DLQ ouvert (badge rouge si > 0)
- Statut last ack Plateforme (timestamp + couleur vert/orange/rouge selon lag ; **alerte critical si > 24h** = gap de synchronisation, polling E6 supprimé Bloc A A4)

**Zone 2 — Compteurs par type (milieu)** *(simplifié sobriété A_M01_04 — 2026-04-30)* :
- 5 compteurs simples « events 24h par type » : `collecte.creee`, `collecte.modifiee`, `collecte.annulee`, `prestataire.upsert`, `lieu.upsert`
- Lien « Exporter CSV 7j » (analyse offline si besoin investigation)
- Pas de graphique multi-courbes V1 (volume ~100 webhooks/jour ne le justifie pas — V1.1+ si besoin)

**Zone 3 — Dernières anomalies (bas)** :
- Liste 20 derniers événements en retry ou DLQ
- Colonnes : `event_id` (copy-clipboard), type, source (webhook), tentatives, dernière erreur, actions
- Actions : "Voir détail", "Rejouer" (retry manuel), "Accéder DLQ" si applicable

**Accessibilité** : navigation clavier complète, exportable en CSV (audit, RGPD).

### E2 — DLQ triage (Admin TMS)

**Layout** : table + drawer détail.

**Table** :
- Colonnes : `event_id`, `type`, `received_at`, `motif_dlq` (enum), `tentatives`, `derniere_erreur` (extrait 100 char)
- Filtres : motif DLQ, type événement, plage dates
- Tri : par `received_at` DESC par défaut

**Motifs DLQ (enum `dlq_motif`)** :
- `schema_invalide` : JSON mal formé ou signature HMAC KO
- `validation_metier_echec` : `heure_collecte_passee`, `prestataire_inconnu`, etc. (renommage 2026-04-29 — anciennement `creneau_passe`) *(règle `nb_pax > max` supprimée 2026-06-05 — arbitrage Val : aucun plafond métier nb_pax, schéma E1 borne uniquement `minimum:0`)*
- `schema_version_divergence` : version payload future/inconnue (cf. arbitrage 4)
- `ref_plateforme_manquante` : FK attendue absente dans l'état courant du TMS
- `erreur_technique` : exception non gérée, timeout DB, etc.

**Drawer détail** :
- Payload brut complet (JSON `<pre>` simple)
- Historique des tentatives (timestamps + erreurs)
- Actions *(simplifié sobriété A_M01_01 + A_M01_03 — 2026-04-30 : 4 actions → 2)* :
  - **Rejouer** : remet l'événement en file de traitement (avec dedup event_id pour éviter double)
  - **Rejeter définitivement** : déclenche workflow W8 (émission webhook S11 si event de type `collecte.*`, archivage local sinon). Commentaire obligatoire ≥10 caractères.
 - — *Supprimée 2026-04-30 (A_M01_01)*. Si payload contient une donnée invalide → fix Plateforme + ré-émission, ou rejet définitif via S11 (évite divergence Plateforme/TMS sans accord côté source).
 - — *Supprimée 2026-04-30 (A_M01_03)*. V1 = Val seul Admin TMS, déjà alerté par email automatique sur events critiques (HMAC KO, schema divergence). Forward email manuel suffit pour escalade au frère.

**Règle DLQ** :
- Un événement en DLQ n'est jamais purgé automatiquement V1 (rétention illimitée, coût négligeable car volume faible)
- Taille max DLQ V1 : 10 000 événements (seuil alerte critical si dépassé)

---

## 5. Workflows détaillés

### W1 — Réception webhook E1 `POST /collectes` (cas nominal)

1. Plateforme push webhook signé HMAC vers `tms.gosavr.io/api/webhooks/collectes`
2. Edge Function Supabase :
   - Vérifie signature HMAC (rejet 401 si KO + log `integrations_logs.erreur_code=auth_failed`)
   - Vérifie `schema_version` = version globale courante (rejet 422 + DLQ si inconnue, arbitrage 4 — version unique `X-API-Version`)
   - Vérifie taille payload ≤ 256 KB (rejet 413 + DLQ `schema_invalide` si dépassé)
   - Vérifie `event_id` non présent dans `integrations_inbox` (TTL **7j** — revue sobriété Bloc B 2026-05-01 B5 : retour 30j → 7j ; avec polling supprimé Bloc A A4, retry max va à 24h donc re-émission >7j = scénario inexistant. Dedup `integrations_logs` 2 ans supprimée 2026-04-30 reste valide).
   - Insertion optimiste dans `integrations_inbox` avec lock Postgres `INSERT ... ON CONFLICT DO NOTHING`
3. Validations métier bloquantes (§08) :
   - `collecte_id` non UUID → 400
   - `heure_collecte` passée → 422 DLQ (propagation 2026-04-29)
4. Si coords GPS absentes (cf. §08 E1) :
   - Si `type_collecte='zd'` ET `code_postal` en IDF → accept + flag `coords_manquantes=false` (ZD Strike IDF fonctionne sans coords précises)
   - Sinon → accept + flag `coords_manquantes=true` (arbitrage 9)
5. Stockage du `lieu_snapshot` reçu dans `collectes_tms.lieu_snapshot` (JSONB, photo figée au moment T, D15)
6. INSERT dans `collectes_tms` avec `statut_dispatch='a_attribuer'` (plus de pré-affectation, D10 supprimée ; colonne `attribuee_source` retirée sobriété B_M01_04 2026-04-30 — auto-relance M12 W3 supprimée donc enum mort)
7. Run M12 trigger **T1** (création collecte) pour calculer suggestion + stockage `suggestion_prestataire_id`, `suggestion_branche_r1_code`, `suggestion_detail`, `suggestion_calculee_at` + INSERT `suggestions_attribution_log` avec `trigger_source='T1_creation'` (cf. [[M12 - Attribution transporteur]] §3, propagation 2026-04-24)
8. Push notification M02 Ops Savr (toast + email 100%, cf. M02 décision D9)
9. INSERT `integrations_logs` : `statut=success`, `duration_ms`, `retry_count=0`
10. Retour HTTP `201 Created` + `{"collecte_id": "...", "statut_tms": "recue"}`

**Latence cible** : p95 < 3 s (de réception HTTP à ACK).

### W2 — Polling fallback E6 `GET /sync/poll` (rattrapage) (supprimé revue sobriété §08 A4 2026-05-01, corps purgé revue sobriété M01 2026-06-04 C1)

> ⚠ **Workflow supprimé V1 — aucun code polling**. Pas de cron, pas d'endpoint `GET /sync/poll`, pas de table `integrations_polling_state`, pas de bouton « Forcer polling ». La robustesse repose entièrement sur :
> - **Retry natif Plateforme** (3 paliers 5 min / 1h / 24h, §08 Bloc B B1) qui re-pousse automatiquement tout event non acquitté, y compris après un downtime TMS ≤ 24h ;
> - **Dédup `integrations_inbox`** (TTL 7j, Bloc B B5) qui absorbe les re-émissions sans double traitement.
>
> **Gap > 24h** (= au-delà du retry natif Plateforme) : pas de rattrapage automatique. Détection passive (cf. W5) → alerte critical M11 + intervention manuelle (runbook : la Plateforme ré-émet via re-trigger retry ou ré-émission ciblée `event_id`).

### W3 — PATCH E2 `/collectes/:id` (modification)

1. Webhook signé reçu, dedup standard
2. Lecture `collectes_tms` existant (si introuvable → 404 + DLQ `ref_plateforme_manquante`)
3. **Sérialisation par `occurred_at`** (D18 — concurrence) :
   - Si `occurred_at` du message ≤ `last_occurred_at` de la collecte → skip + log INFO `statut='skipped_out_of_order'` + return 200
   - Sinon → poursuite
4. Vérification statut + heure (§08, règle unifiée C_M01_02 — 2026-04-30) :
   - Si `statut_operationnel IN ('en_cours','realisee','realisee_sans_collecte','incident')` → refus 422 DLQ `validation_metier_echec` motif "modification trop tardive"
   - Si payload contient `heure_collecte` ET la nouvelle valeur est dans le passé → refus 422 DLQ `validation_metier_echec` motif "heure_collecte rétrograde dans le passé" (cohérent avec W1 étape 3 — règle unique R_M01.X applicable création + modification)
   - Sinon → poursuite
5. Application diff champ par champ (seuls les champs présents sont mis à jour) + update `last_occurred_at = occurred_at`
   - **`association_attribuee` (AG uniquement — ajout 2026-05-29, arbitrage Val)** : si le diff contient `association_attribuee.nouveau`, figer l'objet dans `collectes_tms.association_snapshot` (destination de livraison des excédents AG, validée côté Plateforme via §06.09). **Champ non sensible** → push silencieux, **jamais** de re-confirmation transporteur (étape 7 ne s'applique pas : la destination de livraison n'affecte pas l'acceptation de la course). Le chauffeur le voit pré-rempli en M05 E7. Ré-attribution (refus asso Plateforme) → nouvel E2, snapshot écrasé.
6. **Détection re-run M12** (arbitrage 7) — trigger **T3** (re-confirmation post-modif, cf. [[M12 - Attribution transporteur]] §3, propagation 2026-04-24) :
   - Si diff touche `lieu_id`, `heure_collecte`, `nb_pax`, `type_collecte` → re-run M12 avec `trigger_source='T3_re_confirmation'`
   - Si suggestion change → update `collectes_tms.suggestion_prestataire_id` + alerte M02 Ops "Suggestion modifiée"
6bis. **Garde tournée active (2026-07-06 COH-09, arbitrage RC-M04-07)** : si le diff touche `date_collecte` ou `heure_collecte` ET la collecte est rattachée via `collecte_tournees` à ≥ 1 tournée `statut IN ('acceptee','en_cours')` → **refus 409 `collecte_sur_tournee_active`** (cf. M04 W10 step 3 + §08 L345), **pas de re-confirmation** (l'étape 7 ne s'exécute pas). La Plateforme doit d'abord retirer la collecte de la tournée (M04 W10) ou attendre la clôture. Sans cette garde, le pipeline E2 re-confirmerait une collecte déjà engagée sur une tournée active (bug RC-M04-07).
7. **Gestion re-confirmation** (arbitrage 6 ; champs déclencheurs alignés sur §08 E2 canonique 2026-06-05) :
   - Si `statut_dispatch IN ('acceptee','en_attente_execution')` ET diff touche **`date_collecte` ou `heure_collecte`** → `collectes_tms.re_confirmation_requise=true` (propagation A1 2026-04-25 — couvre acceptee manager + en_attente_execution post-assignation ; champ `flux` retiré revue sobriété 2026-04-29 ; renommage `creneau` → `heure_collecte` propagation 2026-04-29)
     - **`nb_pax` retiré des déclencheurs de réacceptation (arbitrage Val 2026-06-05)** : une modification du pax met à jour la donnée + re-run M12 (étape 6, suggestion interne) mais **ne redemande pas** d'acceptation au prestataire. Push silencieux côté prestataire.
     - **`lieu` non concerné** : `lieu_id` est non modifiable au PATCH E2 (verrou UI Plateforme, refus 422 si reçu — §08). Aucune réacceptation possible sur ce champ.
   - Badge "Modifiée — re-confirm" affiché côté M02 et côté M03 prestataire
   - Notification manager prestataire (email + push) "Collecte modifiée, merci de re-confirmer"
   - Manager ack dans M03 → reset flag + webhook `tms/collecte-acceptee` re-émis avec `re_confirmation=true`
   - **Cas `controle_acces_requis` passe à `true` (notification simple, sans réacceptation — arbitrage Val 2026-06-05)** : pas de `re_confirmation_requise`, mais **notification au manager prestataire** « contrôle d'accès désormais requis — pré-saisir plaque + nom chauffeur en M03 E4 avant validation tournée ». La donnée est mise à jour et le blocage `validate_tournee_controle_acces` (§05) s'appliquera à la validation. `informations_supplementaires`, `contacts`, `association_attribuee` → push 100 % silencieux.
8. Audit log diff complet

### W4 — DELETE E3 `/collectes/:id` (annulation)

1. Webhook reçu, dedup standard
2. Lecture collecte
3. Routage selon état (propagation A1 2026-04-25 — alignement enum statut_dispatch 6 valeurs) :
   - `statut_dispatch IN ('a_attribuer','attribuee_en_attente_acceptation','rejetee_par_prestataire')` → `statut_dispatch='annulee_par_traiteur'` simple, 0 € facturé
   - `statut_dispatch IN ('acceptee','en_attente_execution')` + `statut_operationnel='planifiee'` → `statut_dispatch='annulee_par_traiteur'`, tournée dissoute si vide, 0 € facturé, notif manager prestataire
   - `statut_operationnel='en_cours'` (arbitrage 8) → `statut_dispatch='annulee_par_traiteur'` + flag `annulee_pendant_en_cours=true` + `statut_operationnel` reste `en_cours` jusqu'à clôture chauffeur :
     - Côté M05 app mobile : banner "Collecte annulée par le client — saisir les pesées et terminer la vacation"
     - Chauffeur peut saisir pesées (justif facturation prestataire)
     - À clôture : `statut_operationnel='realisee'` mais pas de notif client ni facturation client
     - Coût vacation prestataire généré côté M07 (R2.7 bis)
     - Marge Plateforme recalculée via **trigger DB cross-schema `plateforme.fn_recalc_marge_tournee()`** (sur UPDATE `tms.tournees.cout_final_ht`, lecture vue `plateforme.v_courses_logistiques`) — *webhook S6 supprimé Bloc A A2, plus d'émission HTTP*
4. Si tournée dissoute (vide) → statut tournée `annulee`, webhook S3 `tournee-upsert`
5. Notification manager prestataire (email template `annulation_collecte`)
6. Audit log complet

### W5 — Détection de gap au redémarrage TMS (cold start)

*Refondu revue sobriété M01 2026-06-04 (A1 + B1) : ex-« Rattrapage cold-start via polling » supprimé. Sans polling (E6 supprimé Bloc A A4), le cold-start ne rattrape plus activement — il détecte et alerte. Le rattrapage réel est assuré passivement par le retry natif Plateforme qui re-pousse tout event non acquitté ≤ 24h.*

1. TMS démarre après downtime (déploiement, incident infra)
2. Edge Function `on_startup` lit le timestamp du dernier event reçu : `SELECT MAX(occurred_at) FROM integrations_logs WHERE statut='success'` *(plus de table `integrations_polling_state`, supprimée Bloc A A4)*
3. Calcule gap = `now() - last_event_at`
4. Selon gap :
   - **≤ 24h** : aucune action. Le retry natif Plateforme (3 paliers ≤ 24h) re-pousse automatiquement les events manqués pendant le downtime ; dédup `integrations_inbox` absorbe les éventuels doublons. Rattrapage silencieux et passif.
   - **> 24h** : alerte Admin TMS `critical` `m01_webhook_gap_critical` "Gap > 24h détecté — vérifier dashboard M02 + déclencher ré-émission Plateforme (runbook)". Pas de rattrapage automatique.

### W6 — DLQ triage manuel (Admin TMS depuis E2)

*Workflow simplifié sobriété A_M01_01 + A_M01_03 + C_M01_01 (2026-04-30) : 4 actions → 2 actions (Rejouer + Rejeter via W8 canonique).*

1. Admin ouvre un événement DLQ
2. Examine payload + historique tentatives
3. Options :
   - **Rejouer tel quel** : remise en file, dedup check, nouveau cycle de traitement (compteur `retry_count_manual` incrémenté ; cap 5 D19)
   - **Rejeter définitivement** : déclenche **W8** (workflow canonique unique — émission webhook S11 si event de type `collecte.*`, archivage local sinon)
4. Tout le workflow tracé dans `integrations_logs` + `audit_logs`

**Actions historiques retirées** :
- (A_M01_01) : risque divergence Plateforme/TMS. Si payload invalide → fix Plateforme et ré-émission, ou rejet définitif via S11.
- (A_M01_03) : V1 = Val seul Admin déjà alerté par email auto. Forward email manuel suffit pour escalade frère.

### W7 — [SUPPRIMÉ] — Pré-affectation prestataire

**Supprimé le 2026-04-23 (seconde salve)**. La pré-affectation par la Plateforme a été abandonnée : toutes les collectes arrivent en `statut_dispatch='a_attribuer'`. Les règles d'attribution forte (ex : "client X = toujours Strike") vivent dans M12 TMS (paramétrable). Pas d'engagement contractuel avec les prestataires qui justifie une pré-affectation imposée par la Plateforme.

### W8 — Rejet définitif depuis DLQ (Admin TMS) → webhook S11

1. Admin TMS ouvre un event en DLQ dans E2 "DLQ triage"
2. Après examen (payload + historique tentatives), Admin choisit "Rejeter définitivement"
3. **Garde-fou F2** : si l'event a déjà fait l'objet de 5 retries manuels → bouton "Rejouer" grisé, seule l'option "Rejeter" reste dispo *(option « Escalader Dev » retirée sobriété A_M01_03 — 2026-04-30)*
4. Commentaire obligatoire (min 10 caractères)
5. Backend :
   - Event marqué `statut='rejected_manual'` dans `integrations_logs`
   - Extraction du `collecte_id` depuis le payload (si applicable — event de type `collecte.*`)
   - Émission webhook sortant **S11 `tms/collecte-rejetee`** vers Plateforme avec payload `{event_id_tms_source, collecte_id, motif_dlq, commentaire_admin, rejete_par_admin_id, rejete_at}`
   - Plateforme passe la collecte en `statut_tms='rejetee_par_tms'` + alerte email Admin Plateforme + bannière dashboard
   - Audit log complet (`action='REJET_DEFINITIF_DLQ'`)
6. Si l'event n'est pas de type `collecte.*` (ex: `prestataire.upsert` historique avant la suppression de E4 — cas legacy uniquement) → pas d'émission S11, simple archivage local
7. Event reste consultable en E2 avec badge "Rejeté définitivement" (lecture seule), pas de reprise possible

**Cap retries manuels (D19)** : 5 retries max depuis DLQ pour un même event_id, compté dans `integrations_logs.retry_count_manual`.

---

## 6. Règles métier appliquées

| Ref | Règle | Application dans M01 |
|-----|-------|----------------------|
| §08 E1 | Webhook POST /collectes | Handler principal W1 |
| §08 E2 | PATCH /collectes/:id | Handler W3 |
| §08 E3 | DELETE /collectes/:id | Handler W4 |
| §08 E5 | PATCH /lieux/:id (notif seule, pas rétroactif) | Allégé 2026-04-23 — sert uniquement à alerter M02 en cas de changement champ critique sur collectes futures non démarrées (pour déclencher la Synchronisation du snapshot, D16) |
| §08 principe 2 | Idempotence via event_id | `integrations_inbox` TTL 7j (dédup `integrations_logs` 2 ans retirée — D3 ; logs = audit/forensic only) |
| §08 principe 3 | Horodatage occurred_at | Ordre garanti, out-of-order ignoré |
| §08 principe 4 | Retry 5 min / 30 min / 2h / 6h / 24h | Queue retry Supabase + DLQ au 5ème échec |
| §08 principe 5 | Versioning schema YYYY.MM | Rejet strict W1 étape 2 (arbitrage 4) |
| §05 R6.1 | Cycle de vie dispatch collectes_tms | W1 → `a_attribuer` ou `attribuee` |
| §05 R2.7 bis | Annulation pendant en_cours = vacation facturée | W4 route `en_cours` |
| §09 | RLS `admin_tms` sur tables `integrations_*` | Accès E1/E2 restreint Admin |

---

## 7. Edge cases

### 7.1 — Signature HMAC invalide
- Rejet immédiat 401
- Log `integrations_logs.erreur_code='auth_failed'` + alerte Admin TMS `critical` (tentative intrusion potentielle)
- Pas de DLQ (protection contre pollution par attaquant)

### 7.2 — Payload malformé (JSON cassé)
- Rejet 400 + DLQ motif `schema_invalide` (arbitrage 1 hybride C)
- Alerte Admin TMS `high`

### 7.3 — Validation métier échoue (`heure_collecte` passée, `prestataire_inconnu`, etc.)
- Rejet 422 + DLQ motif `validation_metier_echec`
- Alerte Admin TMS `medium`
- *(`nb_pax hors bornes` retiré 2026-06-05 — pas de plafond métier ; seule la borne `minimum:0` du schéma E1 s'applique, gérée en amont comme `schema_invalide`)*

### 7.4 — Schema version divergence (arbitrage 4)
- Rejet 422 + DLQ motif `schema_version_divergence`
- Alerte Admin TMS `critical` "Plateforme utilise schema vX non supporté par TMS (vY)"
- Pas de retry automatique (c'est un bug de déploiement, pas un incident transitoire)
- À résoudre : deploy TMS mise à jour ou rollback Plateforme

### 7.5 — Doublon event_id (dedup arbitrage 3)
- Dedup `integrations_inbox` (TTL 7j) — fallback `integrations_logs` 2 ans retiré (D3), logs = audit/forensic only
- Skip traitement + log INFO `statut='skipped_duplicate'`
- Retour HTTP `200 OK` + `{"status":"already_processed"}`
- Pas d'alerte

### 7.6 — Webhook timeout (Plateforme n'a pas reçu ACK dans les 30s)
- Plateforme retry (pas de responsabilité TMS)
- Si TMS a commencé traitement et DB commit, 2ème retry Plateforme → skip via dedup event_id
- Zéro risque double traitement

### 7.7 — TMS down 6h
- Le retry natif Plateforme (3 paliers ≤ 24h) re-pousse les events manqués dès le redémarrage TMS
- Dédup `integrations_inbox` absorbe les doublons
- Rattrapage silencieux et passif (gap < 24h), pas d'alerte

### 7.8 — TMS down 48h
- Gap > 24h détecté au cold-start (W5) → alerte Admin TMS `critical` "Gap 48h — vérifier dashboard M02 + déclencher ré-émission Plateforme"
- Le retry natif Plateforme s'arrête à 24h → les events plus anciens ne sont **pas** re-poussés automatiquement : Val déclenche une ré-émission ciblée côté Plateforme (runbook)
- Admin vérifie qu'aucune collecte urgente n'a été traitée en retard

### 7.9 — TMS down 5 jours
- Gap > 24h détecté (W5) → alerte `critical` + scénario runbook ops
- Aucun rattrapage automatique (polling supprimé Bloc A A4) — ré-émission Plateforme manuelle des events > 24h, suivi progression

### 7.10 — Plateforme push avec `lieu_id` inconnu côté TMS
- M01 gère les collectes même si lieu/traiteur pas encore sync côté TMS (FK logiques, pas physiques — cf. §04 principe isolation)
- Collecte créée avec `plateforme_lieu_id` + `lieu_snapshot` complet dans payload (pas dépendance au sync du référentiel)
- Si lieu synchronisé plus tard via E5 `PATCH /lieux/:id` → pas de rétroactivité sur collectes existantes (lieu_snapshot cristallisé, §08 E5)

### 7.11 — Coords GPS absentes (arbitrage 9)
- Accept + `coords_manquantes=true`
- Alerte Ops M02 `high` si type AG ou hors IDF
- Ops saisit coords depuis drawer E4 de M02 (ajout future enhancement : bouton "Géocoder via API externe" si volume important)

### 7.12 — Coords GPS présentes mais incohérentes (ex: `lat=0, lng=0`)
- Sanity check : si coords dans zone impossible (océan, hors France métropolitaine si pays=FR dans adresse) → flag `coords_manquantes=true` + alerte Ops
- V1 : check basique (lat in [41,51], lng in [-5,10] pour FR métro). V2 : check réseau-routier.

### 7.13 — PATCH E2 sur collecte `en_cours` (trop tardif)
- Refus 422 DLQ `validation_metier_echec` motif "modification trop tardive"
- Alerte Admin TMS pour investigation (indique un bug côté Plateforme normalement)

### 7.14 — DELETE E3 sur collecte déjà terminée
- Refus 422 + log warn
- Ne pas DLQ (Plateforme a pu tarder, mais pas d'action à prendre)

### 7.15 — Out-of-order (event J+2 reçu avant event J+1)
- §08 principe 3 : vérifier `occurred_at` vs état courant
- Si out-of-order détecté → skip + log warn
- DLQ uniquement si incohérence bloquante (ex: DELETE reçu avant CREATE)

### 7.16 — Polling Plateforme répond erreur 500 (caduc — polling supprimé Bloc A A4)
- Sans objet V1 : pas de polling, donc pas d'appel TMS→Plateforme `GET /sync/poll`. Les pannes côté Plateforme sont gérées par le retry natif Plateforme sur ses webhooks sortants (pas de responsabilité TMS).

---

## 8. États et transitions

### Flags et colonnes introduits sur `collectes_tms` par M01

| Colonne | Type | Défaut | Utilité | Impact |
|------|------|--------|---------|--------|
| `coords_manquantes` | BOOLEAN | false | Flag absence coords GPS depuis webhook E1 | Alerte M02 `high` si AG ou hors IDF, bloque suggestion M12 |
| `re_confirmation_requise` | BOOLEAN | false | Flag modification post-acceptation | Badge M02 + M03, notif prestataire, reset à l'ack M03 |
| `annulee_pendant_en_cours` | BOOLEAN | false | Flag annulation durant vacation | Banner M05 mobile, facturation prestataire maintenue |
| `lieu_snapshot` | JSONB | — | Photo figée du lieu au moment de la création de la collecte (D15) | Affichée M02 / M05 chauffeur, override ponctuel par collecte depuis M02 (sync batch lieu→collectes futures retirée sobriété A_M01_05) |
| `last_occurred_at` | TIMESTAMPTZ | — | Horodatage du dernier update appliqué (D18 sérialisation) | Empêche les out-of-order silencieux |

**Propagation à §04** : 5 colonnes (et non 6) à `collectes_tms` (`attribuee_source` retirée — propagation 2026-04-30).
**Propagation à §05 R6.1** : `annulee_pendant_en_cours=true` compatible avec `statut_operationnel='en_cours'` temporairement puis `realisee`. Colonne supprimée (cf. B_M01_04).

### États de l'événement d'intégration (`integrations_inbox` + `integrations_logs`)

*Diagramme simplifié sobriété D_M01_01 + D_M01_02 + A_M01_01 + A_M01_03 (2026-04-30) : 11 états → 7 états. Suppression `failed_dlq_again` (compteur `retry_count_manual` D19 cap 5 porte la distinction), `requalifié`, `escalated` (flag colonne supprimé).*

```
received → validated → processed (success)
received → validated → retry (1-5) → processed
received → validated → retry (1-5) → failed_dlq
received → rejected_auth (signature HMAC KO, pas de DLQ)
received → duplicate (skip, no action)

Depuis DLQ (2 actions Admin uniquement) :
failed_dlq → rejouer → processed | failed_dlq (retry_count_manual incrémenté, cap 5)
failed_dlq → rejected_manual (commentaire Admin ≥10 car, terminal, déclenche W8/S11 si event collecte)
```

---

## 9. Notifications

### Côté Admin TMS

*Tableau simplifié sobriété B_M01_03 (2026-04-30) : push browser supprimé, email seul V1 partout (pas de Web Push / Service Worker pour alertes M01 V1).*

| Trigger | Gravité | Canal | Template |
|---------|---------|-------|----------|
| Signature HMAC KO | critical | Email | `ingress_auth_failed` |
| Schema version divergence | critical | Email | `ingress_schema_divergence` |
| Gap > 24h détecté (cold-start W5) | critical | Email | `ingress_gap_critique` |
| DLQ nouveau événement | medium (batch) | Email digest 1h | `ingress_dlq_digest` |
| DLQ > 100 événements accumulés | critical | Email | `ingress_dlq_overflow` |

**Décision** : digest 1h pour DLQ medium (pas 1 email par événement), car volume attendu bas mais non nul lors d'onboarding Plateforme modifiée.

### Côté Ops Savr (via M02)

| Trigger M01 | Propagation Ops | Template |
|-------------|-----------------|----------|
| Nouvelle collecte reçue | Toast + email 100% (M02 D9) | `dispatch_new_collecte` |
| Collecte avec `coords_manquantes=true` + AG/hors IDF | Bandeau E1 high + email | `dispatch_coords_manquantes` |
| PATCH E2 change suggestion M12 (arbitrage 7) | Toast + email si collecte `attribuee` ou `acceptee` | `dispatch_suggestion_modifiee` |
| PATCH E5 champ critique lieu (snapshot divergent) | Bandeau E1 medium + bouton "Synchroniser snapshot" | `dispatch_lieu_snapshot_divergent` |
| Collecte annulée pendant en_cours (W4) | Bandeau E1 high + email | `dispatch_annulee_en_cours` |

### Côté Manager prestataire (via M03)

| Trigger | Canal | Template |
|---------|-------|----------|
| PATCH post-acceptation date/heure (W3) | Email + push, `re_confirmation_requise=true` | `prestataire_collecte_modifiee` |
| PATCH `controle_acces_requis` → `true` (W3, notification simple, **pas** de re-confirmation — arbitrage Val 2026-06-05) | Email + push | `prestataire_controle_acces_active` |
| Annulation collecte acceptée (W4) | Email | `prestataire_collecte_annulee` |

### Côté Chauffeur (via M05, si applicable)

| Trigger | Canal | Template |
|---------|-------|----------|
| Annulation pendant en_cours (W4) | Push app + banner permanent | `chauffeur_annulation_en_cours` |

---

## 10. Performance cibles

| Métrique | Cible V1 | Méthode |
|----------|----------|---------|
| Latence webhook E1 (ACK) | p95 < 3 s | Edge Function + INSERT transactionnel + notif async |
| Latence webhook E2 (PATCH) | p95 < 2 s | Edge Function + UPDATE |
| Débit max webhook soutenu | 50 req/s | Supabase Edge scaling horizontal |
| Détection gap cold-start (W5) | < 5 s au boot | Query `MAX(occurred_at)` indexée |
| Disponibilité M01 | 99.5% V1 (SLO) | Monitoring Supabase + alerting |

**Non-goal V1** :
- Support > 500 req/s (Plateforme ne génère pas ce volume V1)
- Traitement multi-region (tout en EU-West-1 / Paris)
- Rattrapage actif par polling (supprimé Bloc A A4 — retry natif Plateforme ≤24h + ré-émission manuelle au-delà)

---

## 11. Décisions structurantes prises

| # | Décision | Alternative écartée | Raison |
|---|----------|---------------------|--------|
| D1 | Payload invalide = hybride : 400 rejet / 422 DLQ | Rejet pur / DLQ pur | Distingue bug technique Plateforme (fix déploiement) de problème donnée (triage Admin) |
| D4 | Schema version inconnue = rejet strict + DLQ | Accept best-effort | Défaut de déploiement à fixer, pas à masquer |
| D5 | Supervision ingress = Admin TMS only | Intégré M02 Ops | Sépare tech (M13 Admin) de métier (M02 Ops) |
| D6 | PATCH E2 post-acceptation = flag `re_confirmation_requise` | Nouveau statut `re_confirm_requise` | Évite polluer enum R6.1, simple badge UI + notif |
| D7 | PATCH E2 sur lieu/`heure_collecte`/pax/type = re-run M12 + force re-confirm si `acceptee` | Re-run seul / Pas de re-run | Cohérence terrain : modif significative = prestataire revalide (renommage `creneau` → `heure_collecte` propagation 2026-04-29) |
| D8 | DELETE E3 sur en_cours = flag `annulee_pendant_en_cours` + chauffeur termine | Disparition immédiate / Arrêt chauffeur | Justif facturation prestataire + UX chauffeur claire |
| D9 | Coords GPS manquantes = accept + flag `coords_manquantes` | Rejet 422 | Ne rejette pas une collecte métier valide, Ops résout en 30s |
| D11 | DLQ rétention illimitée V1 (cap 10k) | Purge 30j | Volume faible attendu, traçabilité forte |
| D12 | Signature HMAC KO = no DLQ, rejet pur + alerte | DLQ standard | Protection contre pollution malveillante |
| D13 | Flags sur `collectes_tms` (cf. §8) | Nouveaux statuts ou tables annexes | Évite pollution enum, propagation simple à §04 + §05. **Mise à jour sobriété 2026-04-30** : 5 colonnes M01 (et non 6) — `attribuee_source` retirée (B_M01_04 + D_M01_03). |
| **D14** | **Retournement prestataires** : table unique `shared.prestataires`, écriture TMS via M06, lecture Plateforme cross-schema | 2 tables synchronisées via webhook | Une seule saisie, pas de sync, pas de guerre de sources de vérité |
| **D15** | **Lieu snapshot** : photo figée `collectes_tms.lieu_snapshot` JSONB + alerte M02 si PATCH lieu touche champ critique sur collecte future + override ponctuel par collecte (drawer M02). *Sync batch lieu→collectes futures retiré sobriété A_M01_05 — 2026-04-30 : action rare avec impact N collectes, override ponctuel couvre 99% des besoins.* | Toujours version courante / pas de snapshot / sync batch | Cohérent avec "no rétroactif" Plateforme, chauffeur voit ce qui était prévu, Ops a la main collecte par collecte si besoin |
| **D16** | **Retournement lieux (Option C — refonte 2026-04-28 audit cohérence A2)** : `plateforme.lieux` reste Plateforme, TMS enrichit 2 colonnes logistiques existantes (`acces_details`, `acces_office`) via RLS cross-schema column-level. Ex-4 colonnes addendum supprimées et fusionnées sur l'existant. Contacts retirés (relogés sur `evenements.contact_principal_*`/`contact_secours_*`). | Écriture TMS only / table `shared` | Ne casse pas workflow création événement Plateforme, plus simple côté code, dette doc réduite |
| **D17** | **Traiteurs** : `plateforme.traiteurs` reste Plateforme, TMS accède par lecture cross-schema sur `collectes.traiteur_id` | Table partagée `shared` | Val choisit : pas de saisie logistique pour traiteurs, pas de valeur à partager |
| **D18** | **Concurrence messages** : chaque UPDATE sur `collectes_tms` skip si `occurred_at ≤ last_occurred_at`, FIFO naturelle Supabase, pas de priorisation | File globale / priorisation webhook-polling-retry | Volume V1 minime, pas de saturation, complexité inutile |
| **D19** | **Cap retries manuels DLQ** : 5 max par event_id | Illimité | Évite cycle infini sur event structurellement cassé |
| **D20** | **Webhook sortant S11 `tms/collecte-rejetee`** (numéro S11 car S7 est déjà pris par `plaque-saisie`) quand Admin TMS rejette définitivement un event DLQ, 1 admin suffit V1 (pas de 4-eyes), 1 commentaire obligatoire | Email manuel / 4-eyes principle / rien | Évite collectes fantômes (Plateforme notifiée automatiquement). 4-eyes impraticable seul Admin V1 |
| **D21** | **Versioning API** : un numéro unique global `X-API-Version` partagé par tous les endpoints Plateforme↔TMS | Version par endpoint | Petite équipe, monorepo, déploiement synchrone trivial |
| **D22** | **Taille max payload** : 256 KB, rejet 413 au-delà | Limite 1 MB / pas de limite | Protection basique zéro coût |
| **D23** | **Rate limiting** : aucun V1 | 429 sur burst | Volume V1 ne le justifie pas (100 webhooks/jour max) |
| **D24** | **Maintenance TMS planifiée** : retry Plateforme natif (3 paliers 5 min / 1h / 24h) re-pousse tout event manqué au redémarrage ; gap > 24h = ré-émission manuelle (runbook) | Mode lecture seule / queue interne Plateforme / polling | Policy retry couvre déjà ≤24h, rien à développer (polling rattrapage supprimé Bloc A A4 / B1 2026-06-04) |
| **D25** | **Invariant `traiteur_id = traiteur_operationnel.organisation_id` = Trust, pas de validation TMS** (arbitrage Val 2026-06-05). M01 stocke les deux valeurs telles que reçues sans contrôler leur égalité. | Validation bloquante (422 DLQ si écart) | Invariant garanti à la source (même Plateforme, monorepo, déploiement synchrone) → écart = scénario quasi-inexistant ; et la garantie devra de toute façon sauter en V2 (sous-traitance opérationnelle où les deux divergent). Coût d'un check inutile + à retirer. Simplicité max. |

---

## 12. Questions ouvertes

### Résolues 2026-04-23 (seconde salve)

- → **Résolu (D13)** : 5 colonnes confirmées (`coords_manquantes`, `re_confirmation_requise`, `annulee_pendant_en_cours`, `lieu_snapshot`, `last_occurred_at`). *Mise à jour sobriété 2026-04-30 : `attribuee_source` retirée (B_M01_04).*
- → **Résolu** : documentation `annulee_pendant_en_cours` + suppression branche pré-affectation. *Mise à jour sobriété 2026-04-30 : `attribuee_source` colonne supprimée.*
- → **Résolu (F1)** : V1 email uniquement (Val + frère). Slack V1.1+ si volume suffisant. *Caduc sobriété A_M01_03 — escalation Dev supprimée entièrement V1 (forward email manuel suffit).*
- → **Caduc sobriété A_M01_03** (2026-04-30) : action « Escalader Dev » DLQ supprimée.
- → **Caduc revue sobriété M01 2026-06-04 (A1)** : table supprimée avec le polling (Bloc A A4). Le cold-start W5 lit désormais `MAX(occurred_at)` sur `integrations_logs`.

### Reportées V1.1+

1. **Sanity check coords GPS** : seuils FR métro simples (lat ∈ [41,51], lng ∈ [-5,10]) V1. Check réseau-routier V2 si besoin.
2. **Seed DLQ motifs complémentaires** : ajouter `traiteur_inconnu`, `evenement_annule_deja` à l'enum `dlq_motif` si volume observé le justifie (V1.1).
3. **Geocoding fallback API externe** : si volume `coords_manquantes` > 5% des collectes après 3 mois V1 → intégrer Google Maps / OpenStreetMap. Coût + RGPD (adresses envoyées à tiers) à évaluer alors.
4. → **Dégagé revue sobriété 2026-04-25 (A6)** : Slack retiré V1 entièrement (anti-pattern code mort en prod). Réactivation ultérieure = recoder à partir de zéro (~1 jour dev) si channel dédié + besoin avéré.

---

## 12bis. Alertes M11 émises par M01 (propagation M11 2026-04-24)

> **Normatif (R_M11.1)** : tous les triggers M01 utilisent `tms.alerte_emit(code, ...)` avec codes canoniques catalogue.

| Code canonique | Criticité | Trigger M01 |
|----------------|-----------|-------------|
| `m01_webhook_gap_critical` | critical | Gap webhook Plateforme > 24h détecté (cold-start W5 ou heartbeat) |
| `m01_dlq_event_rejected` | critical | Event Plateforme en DLQ après 5 retries |
| `m01_push_plateforme_dlq` | critical | Webhook sortant TMS → Plateforme en DLQ |
| `m01_hmac_invalide` | critical | Signature HMAC invalide sur endpoint ingress (tentative intrusion possible) |
| `m01_payload_rejete` | warning | Payload webhook invalide (schéma JSON) — émission S11 `collecte-rejetee` |

**Résolution auto W7** : `m01_dlq_event_rejected` + `m01_push_plateforme_dlq` résolues auto dès rejeu réussi via Admin M13. `m01_webhook_gap_critical` résolue auto dès réception d'un nouvel event valide (flux nominal restauré — gap comblé par retry natif Plateforme ou ré-émission manuelle).

---

## 13. Liens

- Vue macro : [[../03 - Périmètre fonctionnel TMS#M01 — Réception ordres de collecte]]
- Data Model : [[../04 - Data Model TMS]] — tables `collectes_tms` (5 nouveaux flags dont `lieu_snapshot` JSONB et `last_occurred_at`; `attribuee_source` retirée sobriété B_M01_04 — 2026-04-30), `integrations_inbox` (TTL **7j** revue sobriété Bloc B 2026-05-01 B5, ex-30j post-B_M01_01), `integrations_logs` (audit/forensic 2 ans, plus utilisée pour dedup), (supprimée Bloc A A4 polling), `integrations_dlq`, `audit_logs`
- Règles métier : [[../05 - Règles métier TMS#R6.1 — Cycle de vie collectes_tms|R6.1]], [[../05 - Règles métier TMS#R2.7 — Annulation avant démarrage|R2.7]]
- Contrat API : [[../08 - Contrat API Plateforme-TMS]] — **E1**, **E2**, **E3**, (supprimé), E5 (allégé, notif seule), (polling supprimé Bloc A A4), (course-cout-calculee supprimé Bloc A A2 → trigger DB `plateforme.fn_recalc_marge_tournee()`), **S11** (collecte-rejetee, nouveau)
- Auth et permissions : [[../09 - Authentification et permissions TMS]] — RLS `integrations_*` restreinte Admin TMS + RLS cross-schema `shared.prestataires` + `plateforme.lieux` colonnes logistiques
- Modules dépendants :
  - [[M02 - Dispatch Ops Savr]] (aval direct — consommateur, override ponctuel `lieu_snapshot` par collecte ; sync batch lieu→futures retiré sobriété A_M01_05)
  - [[M04 - Gestion des tournées]] (aval — annulation en_cours déclenche M04)
  - [[M05 - App mobile chauffeur]] (aval — banner annulation en_cours, affichage `lieu_snapshot`)
  - [[M06 - Référentiel prestataires]] (source de vérité prestataires TMS via `shared.prestataires`, D14)
  - [[M07 - Pilotage financier logistique]] (aval — vacation facturée si annulation en_cours)
  - [[M11 - Alerting et monitoring ops]] (aval — alertes techniques Admin)
  - [[M12 - Attribution transporteur]] (aval — toutes collectes `a_attribuer`, règles d'attribution forte paramétrables ici)
  - [[M13 - Administration TMS]] (UI hôte — onglet "Intégrations")
- CDC Plateforme : [[../../01 - Cahier des charges App/08 - APIs et intégrations]] (émetteur webhooks + récepteur S11)
