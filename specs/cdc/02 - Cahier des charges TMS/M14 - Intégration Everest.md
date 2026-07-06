# M14 — Intégration Everest (A Toutes!)

**Persona principal** : Système (intégration) + Ops Savr (supervision + failover) + Admin TMS (replay manuel + monitoring système)
**Contexte d'usage** : intégration backend permanente pendant exécution d'une journée logistique. UI réservée à la supervision Ops (page `/everest`) + tab système M13 E6 monitoring intégrations.
**Précédente mise à jour** : 2026-05-29 (**généralisation multi-vélo AG V2** — granularité Everest reformulée « 1 mission = 1 tournée » : N vélos pour 1 collecte = N missions (même `collecte_tms_id`, `tournee_id` distinct), `client_ref`/idempotence keyés `tournee_id`, multi-facturation N courses A Toutes! ; acceptation = 1re mission `mission_dispatched` (idempotent) ; cascade-cancel W3/R_M14.7 itère sur les N missions actives + correction lookup `collectes_tms.tournee_id` retiré → jointure `collecte_tournees` ; helper `m14_lookup_mission_by_collecte` → SETOF. R_M14.2 + D3 + W1 étape 3 + W2 + W3 mis à jour) / 2026-05-01 (revue sobriété §05 A5 — W5 `notify_incomplete` reporté V1.1 (Q1 endpoint Everest non confirmé), R_M14.8 reportée, EC10 retiré, code alerte `m14_everest_incomplete_notify_failed` retiré du catalogue M11, transition `in_progress → completed_incomplete` jamais déclenchée V1, valeur enum conservée seedée mais inatteignable. V1 fallback : webhook S5 émis vers Plateforme + Ops appel manuel A Toutes! à la clôture `realisee_sans_collecte`. Workflows V1 : 7 (W1/W2/W3/W4/W6/W7/W8 — W5 retiré). Règles V1 : 7 (R_M14.1-R_M14.7). Edge cases V1 : 11 (EC10 retiré). Catalogue M11 M14 : 10 → 9 codes effectivement seedés (`m14_everest_incomplete_notify_failed` retiré).)
**Précédente mise à jour** : 2026-04-30 (revue sobriété M14 — 13 simplifications appliquées : E3 absorbé dans M13 E6 tab Everest, W7 replay UI supprimé (SQL Admin direct), polling 60s E1 supprimé, zone 3 webhooks E1 supprimée, test connexion réduit à M06 + M13 E6, hit rate cache retiré E5, `m14_everest_mission_late` désactivée par défaut, cache token mémoire only V1, colonne `everest_service_id_target` posée par M12, bandeau E1 critical only, scope E1/E5 clarifié, comptage alertes corrigé 13→10, Q5 réf cdc-migration-data).
**Précédente mise à jour** : 2026-04-25 (V1 rédigée — 10 décisions D1-D10, 5 écrans (E1-E4 propres + E5 sous-écran M13), 8 workflows W1-W8, 12 edge cases EC1-EC12, 8 règles R_M14.1-R_M14.8, 10 codes alertes catalogue M11 (1 existant `m14_everest_timeout` + 9 nouveaux après Bloc 3 sobriété A1 retrait 3 ex-info), 4 paramètres `m14_*` + 1 secret webhook Vault.)

---

## 1. Objectif métier

M14 relaie les ordres de collecte AG vers le système propriétaire d'A Toutes! (Everest) et reçoit en retour les confirmations de prise en charge et les statuts d'exécution. Aujourd'hui le contrat Bubble↔Everest tourne en production. M14 est la **migration** de ce contrat vers le TMS Savr — pas une refonte du contrat Everest lui-même.

**Ce que M14 résout** :

- Pousser automatiquement chaque collecte AG attribuée à A Toutes! dans Everest (vélo cargo standard, vélo express last-minute, camion backup Marathon).
- Recevoir les statuts de mission Everest pour observer le cycle de vie côté A Toutes! sans friction sur le terrain (le chauffeur saisit dans M05, Everest informe en miroir).
- Gérer les cas de défaillance API (timeout, 401, retry) sans bloquer la collecte sur le terrain (failover Ops manuel).
- Annuler proprement les missions Everest quand la cascade M12 réattribue à un autre prestataire (anti double-dispatch).
- Notifier A Toutes! en direct quand une collecte AG se termine en course incomplète (`realisee_sans_collecte`) pour que A Toutes! ait l'information côté gestion.
- Tracer toutes les interactions (sortantes + entrantes) dans `integrations_logs` + `everest_missions.payload_latest_update` pour audit, debug et rapprochement facture A Toutes! M08.

**Split avec autres modules** :

- **M14 = pont d'intégration** (ce module). Pas d'écran terrain, pas de calcul métier.
- [[M12 - Attribution transporteur]] = M14 est appelé par M12 pour vérifier la couverture zone (`is-handled-address`, déjà documenté M12). M14 push la mission Everest **après** que M12 a tranché et que `statut_dispatch = attribuee_en_attente_acceptation`.
- [[M02 - Dispatch Ops Savr]] = consomme l'attribution M12, déclenche indirectement M14 via la transition `statut_dispatch`.
- [[M05 - App mobile chauffeur]] = chauffeur A Toutes! utilise M05 pour la saisie terrain (pas l'interface Everest). Si "Aucun repas" → M14 notifie Everest.
- [[M06 - Référentiel prestataires]] = test connexion Everest (vue `tms.vue_prestataires_everest_status` dérivée de `integrations_logs`) déclenché depuis fiche prestataire A Toutes! — revue sobriété §04 2026-04-30 A3, colonnes `last_everest_ping_*` supprimées V1.
- [[M07 - Pilotage financier logistique]] = grille TMS prime sur `cout_everest_ht`. M14 ne gère pas les tarifs.
- [[M08 - Facturation prestataires]] = rapprochement facture A Toutes! lit `cout_everest_ht` pour audit écart (informational).
- [[M11 - Alerting transverse]] = catalogue 10 codes alertes M14 (1 existant `m14_everest_timeout` + 9 nouveaux après retrait Bloc 3 sobriété A1 et désactivation par défaut `m14_everest_mission_late` 2026-04-30 A_M14_07).
- [[M13 - Administration TMS]] = tab "Everest" dans E6 monitoring intégrations (vue système : santé API, latence, taux retry). Secrets Vault `everest_*`.

**KPI cibles V1** :

- Taux de missions créées avec succès (sans intervention Ops) : > 95%.
- Taux de webhooks Everest correctement traités (signature OK + mission connue) : > 98%.
- Temps de push création mission Everest p95 : < 1.5s end-to-end.
- Taux d'écart `cout_everest_ht` vs `cout_calcule_ht` < 5% (informational, audit M08).
- Taux de failover Ops manuel (Everest indisponible) : à mesurer V1, cible < 2% missions.

---

## 2. Personas et contexte d'usage

### Système (intégration permanente)

M14 tourne en **continu** : appels sortants à Everest dès qu'une collecte AG est attribuée à A Toutes!, webhooks entrants reçus 24/7, lazy refresh token sur 401, trigger DB cascade annulation. Aucune intervention humaine en régime nominal (≥ 95% des cas).

### Ops Savr (superviseur + failover)

- Consulte la page `/everest` (E1) pour vérifier que les missions du jour ont bien été pushées.
- Reçoit les alertes critiques (échec création mission, mission cancelled externally, mission failed) et exécute le **failover manuel** (E4) : appel téléphonique A Toutes! → bouton "Marquer accepté manuellement" → la collecte continue.
- Consulte le détail mission (E2) pour drilldown sur une collecte qui pose problème (timeline events Everest).

### Admin TMS (replay + monitoring système)

- Replay manuel des events `echec_final` depuis E3 (rate, ne devrait pas être déclenché en régime nominal).
- Consulte le tab "Everest" dans M13 E6 monitoring intégrations (latence p95, taux 4xx/5xx, taux retry, taux cache hit `is-handled-address`).
- Gère les secrets Everest dans M13 E5 (Vault) : `everest_client_id`, `everest_client_secret`, `everest_webhook_token`.
- Active/désactive le flag `m14_webhook_token_required` (M13 E2 paramètres) en cas de migration de méthode de sécurité webhook.

### Manager prestataire A Toutes!

- **Hors périmètre M14**. Continue d'utiliser Everest côté A Toutes! comme aujourd'hui. M14 est transparent pour eux.

### Chauffeur A Toutes!

- Utilise **uniquement M05** pour la saisie terrain (pesée, photo, signature, "Aucun repas"). Ne voit pas Everest.

---

## 3. Architecture des écrans

### Écrans M14 (page `/everest` Ops + Admin)

| Écran | Type | Persona | Rôle |
|-------|------|---------|------|
| **E1** | Dashboard `/everest` | Ops + Admin TMS | Vue d'ensemble missions actives + alertes M14 critical + KPIs métier |
| **E2** | Détail mission (drawer/page) | Ops + Admin TMS | Timeline events + payload latest + actions (cancel manuel) |
| **E4** | Modal "Acceptation manuelle" | Ops Savr | Failover Everest down — saisie après appel téléphone A Toutes! |

**Note sobriété 2026-04-30** : E3 "Logs webhooks reçus" supprimé en tant qu'écran indépendant (revue sobriété A_M14_05). La table "webhooks reçus 7j" lecture seule est absorbée dans M13 E6 tab Everest (cf. E5). Replay UI supprimé (A_M14_04) — Admin replay via SQL direct sur Supabase Studio (cf. runbook §15 Sécurité TMS).

### Sous-écran M13 (système)

| Sous-écran | Type | Persona | Rôle |
|------------|------|---------|------|
| **E5** | Tab "Everest" dans M13 E6 monitoring intégrations | Admin TMS | KPI système (latence, taux 4xx/5xx, taux retry) + table webhooks reçus 7j (absorbée de l'ex-E3) + taille cache + bouton invalider cache |

### Navigation

- Page `/everest` accessible depuis :
  - Sidebar TMS (lien "Everest" sous "Intégrations") — visible Ops + Admin
  - Liens contextuels depuis M02 (dashboard dispatch, badge mission Everest sur ligne collecte AG)
  - Liens contextuels depuis M04 (gestion tournées, badge mission Everest sur tournée camion A Toutes!)
- E5 (tab Everest M13) accessible uniquement via M13 E6 (héberge aussi l'audit webhooks 7j ex-E3 depuis sobriété 2026-04-30 A_M14_05).

### Pourquoi pas dans M13 monolithique (D1)

Le monitoring système (santé API, latence, taux 4xx/5xx) appartient à M13 E6 (cohérent avec Pennylane, Bridge, Strike, Marathon). Le métier (liste missions du jour, détail mission, failover Ops) mérite une page propre car Ops y va plusieurs fois par jour (vs M13 réservé à Admin). Cf. arbitrage 8 D1 ci-dessous.

---

## 4. Écran par écran

### E1 — Dashboard `/everest` (Ops + Admin)

**Rôle** : vue d'ensemble des missions Everest du jour, alertes actives, accès rapide aux actions.

**Layout** :

- **Header** : sélecteur date (default `aujourd'hui`), filtre statut (tous / actif / failed / cancelled), bouton "Rafraîchir" manuel (refresh KPIs + table). **Note sobriété 2026-04-30 A_M14_03** : bouton "Test connexion Everest" supprimé d'E1 (action rare, accessible depuis M06 fiche prestataire A Toutes! + M13 E6 tab Everest, 2 entrées suffisent).
- **Bandeau alertes M14 critical** (zone haute) : liste des alertes M14 non-acquittées de criticité `critical` uniquement (sobriété 2026-04-30 B_M14_03 — les `warning` restent accessibles via la vue M11 dédiée, l'info n'existe plus depuis Bloc 3 A1). Cliquable → drilldown E2 mission concernée si applicable. Source : `tms.alertes` filtré par `code LIKE 'm14_%' AND criticite = 'critical' AND acquittee_at IS NULL`.
- **Zone 1 — KPIs jour métier** (4 tuiles, granularité **mission**, cf. clarification scope sobriété 2026-04-30 C_M14_01) :
  - Missions créées aujourd'hui (count `everest_missions` créées entre 00h-now)
  - Missions actives en cours (count `statut_everest IN ('created','assigned','in_progress')`)
  - Missions terminées (count `statut_everest IN ('completed','completed_incomplete')`)
  - Échecs / failover (count `statut_everest IN ('creation_failed','failed','cancelled','cancelled_externally')`)
- **Zone 2 — Liste missions du jour** (table paginée 50/page) :
  - Colonnes : `client_ref` (= collecte_id, lien M02 collecte), prestataire = `A Toutes!`, service Everest (71/75/91), `mission_id` Everest, `statut_everest`, `cree_at`, `derniere_sync_at`, actions.
  - Tri : `cree_at DESC` par défaut.
  - Filtres : statut, service Everest, recherche par `mission_id` ou `client_ref`.
  - Actions ligne : "Voir détail" (E2), "Annuler mission" (Admin only, si `statut_everest IN ('created','assigned')`), "Marquer accepté manuellement" (Ops, si `statut_everest = 'creation_failed'` — déclenche E4).

**Note sobriété 2026-04-30 A_M14_02** : Zone 3 "Activité webhooks récente" supprimée (doublon avec M13 E6 tab Everest qui héberge l'audit webhooks 7j ex-E3). Ops/Admin consulte la table webhooks dans M13 E6 si besoin de drilldown système.

**Données affichées** :

```sql
SELECT em.id, em.tournee_id, em.collecte_tms_id, em.everest_mission_id, em.everest_service_id,
       em.statut_everest, em.cree_at, em.derniere_sync_at, em.cout_everest_ht
FROM tms.everest_missions em
WHERE em.cree_at >= $date_filter::date AND em.cree_at < ($date_filter::date + interval '1 day')
ORDER BY em.cree_at DESC
LIMIT 50 OFFSET $offset;
```

**RLS appliquée** :

- `everest_missions` : Ops + Admin TMS lecture full (cf. §09 ligne 2606 + section RLS M14 propagée).
- `integrations_logs` : Ops + Admin TMS lecture full (déjà spec §09).
- `alertes` : Ops + Admin TMS lecture full (M11).

**Actions** :

- "Rafraîchir" (Ops + Admin) → reload KPIs + table.
- "Voir détail mission" → E2.
- "Annuler mission" (Admin) → modal confirmation → W3 manuel.
- "Marquer accepté manuellement" (Ops) → E4.

**États** :

- Loading skeleton sur 4 tuiles + table.
- Empty state si aucune mission le jour : "Aucune mission Everest aujourd'hui."
- Refresh à l'arrivée sur la page + au focus tab + bouton "Rafraîchir" manuel (sobriété 2026-04-30 A_M14_01 — polling 60s + paramètre `m14_dashboard_polling_ms` supprimés. Volume V1 = 5-10 missions/jour, dashboard regardé ponctuellement, pas en wallboard).

### E2 — Détail mission Everest

**Rôle** : drilldown sur une mission Everest. Timeline complète, payload latest, actions.

**Layout** :

- **Header** : `mission_id` Everest, `client_ref` (= collecte_id avec lien M02), prestataire `A Toutes!`, service Everest (label + ID), `statut_everest` (badge couleur), tournée associée (lien M04 si applicable), `cree_at`, `derniere_sync_at`.
- **Zone 1 — Timeline events** : liste chronologique de tous les webhooks reçus pour cette mission (`integrations_logs` filtré `system='everest' AND payload->>'mission_id' = $mission_id`).
  - Format : timestamp + event_type + signature (OK/KO) + action TMS effectuée + lien expand JSON payload.
- **Zone 2 — Données mission** :
  - `everest_service_id`, `everest_client_id` snapshot, `coursier_nom` si dispo, `coursier_telephone` si dispo, `vehicule_type_everest`, `cout_everest_ht`, `preuve_course_url`, `payload_latest_update` (JSON brut).
- **Zone 3 — Actions** :
  - "Annuler la mission Everest" (Admin only, conditionné `statut_everest IN ('created','assigned','in_progress')`) → confirm modal → W3 manuel via API Everest.
  - "Voir collecte M02" → lien M02 collecte.
  - "Voir tournée M04" → lien M04 tournée (si camion).
  - **Note sobriété 2026-04-30 A_M14_04** : action "Replay event" supprimée. Replay d'event `echec_final` dans `integrations_inbox` extrêmement rare (cible <1% webhooks) — Admin replay via SQL direct sur Supabase Studio (cf. runbook §15 Sécurité TMS).

**Données affichées** :

```sql
SELECT em.*, t.id AS tournee_id, t.statut AS tournee_statut, ct.statut_dispatch
FROM tms.everest_missions em
LEFT JOIN tms.tournees t ON t.id = em.tournee_id
LEFT JOIN tms.collectes_tms ct ON ct.id = em.collecte_tms_id
WHERE em.id = $mission_id;
```

```sql
SELECT * FROM tms.integrations_logs
WHERE system = 'everest' AND payload->>'mission_id' = $everest_mission_id
ORDER BY occurred_at ASC;
```

**RLS** : idem E1.

### E3 — Logs webhooks Everest reçus (supprimé sobriété 2026-04-30)

**Statut** : écran indépendant supprimé (revue sobriété 2026-04-30 A_M14_05). Audit webhooks 7j absorbé dans M13 E6 tab Everest (cf. E5 ci-dessous).

**Ce qui reste (transposé dans M13 E6 tab Everest)** :

- Table lecture seule "Webhooks reçus 7j" : colonnes timestamp, event_type, signature, mission_id, client_ref, statut traitement, action TMS, retry count, dernière erreur. Tri timestamp DESC. Filtres minimaux event_type + statut signature.
- KPIs synthétiques 7j : taux signature invalide, taux event_type inconnu (le taux "replay manuel" disparaît avec A_M14_04).
- Action "Voir payload" (modal JSON) maintenue.

**Ce qui est supprimé** :

- Action "Replay" UI + workflow W7 + API route `/replay/:inbox_id` (sobriété 2026-04-30 A_M14_04). Admin replay via SQL direct sur Supabase Studio si cas exceptionnel survient (`UPDATE tms.integrations_inbox SET status='pending' WHERE id=$inbox_id` + ré-exécution worker manuelle).

**RLS** : Admin TMS only (héritée de M13 E6).

### E4 — Modal "Acceptation manuelle" (failover Ops)

**Rôle** : Ops a appelé A Toutes! par téléphone (Everest down), saisit l'acceptation manuelle pour ne pas bloquer la collecte.

**Trigger** : clic "Marquer accepté manuellement" depuis E1 sur une mission `statut_everest = 'creation_failed'`.

**Layout** (modal) :

- **Header** : `mission Everest échec création — saisie manuelle`
- **Champs lecture** :
  - collecte_id (lien M02)
  - service Everest cible (71/75/91)
  - heure prévue collecte
  - lieu adresse
  - prestataire = A Toutes!
- **Champs saisie** :
  - Contact joint chez A Toutes! (texte libre, obligatoire — qui a confirmé l'acceptation)
  - Heure d'appel (timestamp, défaut now)
  - Commentaire (texte libre, optionnel)
- **Boutons** :
  - "Confirmer acceptation manuelle" → W4
  - "Annuler"

**Validation** : champ "Contact joint" obligatoire (≥ 3 caractères).

**Effets** (W4) :
- INSERT `everest_missions` (si pas existant) ou UPDATE `statut_everest = 'created_manually'`
- INSERT audit_logs `acteur_user_id = $ops_user`, `acteur_type = 'user'`, `action = 'CREATE'`, `diff = { manuel: true, contact: ..., motif: ... }` (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m14_everest_acceptee_manuellement` info retirée du catalogue, audit_logs reste source de vérité du failover manuel).
- UPDATE `statut_dispatch = 'acceptee'` + émission webhook **S1 `collecte-acceptee`** vers la Plateforme (§08 déclencheur c). *(Corrigé test-scenarios 2026-06-07, floue #2 tranchée Val — l'ancienne mention « pas de transition `statut_dispatch` » contredisait W4 étape 4 et §08 S1 : la confirmation orale A Toutes! = acceptation, même logique que R_M14.1bis.)*

### E5 — Tab "Everest" dans M13 E6 (Admin TMS)

**Rôle** : monitoring système de l'intégration Everest + audit webhooks reçus 7j (absorbé de l'ex-E3 sobriété 2026-04-30 A_M14_05). Cohérent avec les autres tabs (Pennylane, Bridge, Strike, Marathon). **Granularité = call API** (vs E1 qui compte des **missions**, cf. clarification scope sobriété 2026-04-30 C_M14_01).

**Layout** (tab dans E6) :

- **Section santé API** :
  - Statut connexion (last ping OK/KO + horodatage) — lit la vue dérivée `tms.vue_prestataires_everest_status` (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping_*` supprimées V1, info dérivée de `integrations_logs`).
  - Bouton "Test connexion" (déclenche W8).
  - Bandeau "incident actif" si `m14_everest_auth_failed` ou `m14_everest_timeout` non-acquittés.
- **Section latence** :
 - p50/p95/p99 calls outbound 7j (par endpoint : create, cancel, get, is-handled-address). retiré (W5 reporté V1.1 — revue sobriété §05 2026-05-01 A5).
  - Source : `integrations_logs.duration_ms` filtré `system='everest'` direction `outbound`.
- **Section taux d'erreurs** :
  - Taux 2xx/4xx/5xx par endpoint 7j.
  - Taux retry effectifs.
  - Taux échec final (post-retry).
- **Section audit webhooks 7j** (absorbé ex-E3, sobriété 2026-04-30 A_M14_05) :
  - Table lecture seule des webhooks Everest reçus 7j. Colonnes timestamp, event_type, signature OK/KO, mission_id, client_ref, statut traitement (`success`/`failed_unknown_target`/`failed_unknown_event`), action TMS, retry count, dernière erreur.
  - Filtres event_type + statut signature.
  - Action "Voir payload" (modal JSON).
  - KPIs synthétiques : total webhooks reçus 7j, taux signature invalide, taux event_type inconnu.
  - Pas d'action "Replay" UI (sobriété 2026-04-30 A_M14_04 — SQL direct si besoin).
- **Section cache** :
  - Taille `everest_coverage_cache` (cf. M12).
  - Bouton "Invalider cache complet" (Admin) — utile post-incident A Toutes! (changement de zone).
  - **Note sobriété 2026-04-30 A_M14_06** : section "Hit rate cache 7j" supprimée. Métrique de tuning sans valeur opérationnelle V1, à reconsidérer V1.1 si besoin réel.
- **Section paramètres** : raccourci vers M13 E2 namespace `m14`.

**RLS** : Admin TMS only (cohérent M13 E6).

---

## 5. Workflows détaillés

### W1 — Push mission Everest à attribution M12

**Déclencheur** : transition `tms.collectes_tms.statut_dispatch` vers `attribuee_en_attente_acceptation` ET `prestataire.integration_externe = 'everest'`.

**Implémentation (refondue 2026-07-06 COH-03 option A, arbitrage Val)** : trigger DB `trg_m14_push_mission` AFTER UPDATE → **INSERT `tms.outbox_events`** (`event_type='everest.create'`, `aggregate_type='collecte'`) **dans la même transaction** (durable — ex-enqueue pg_notify-transport remplacé : une notification perdue = mission jamais créée, sans trace) + `pg_notify` en simple réveil. Le **worker outbox unique (§07 §18bis)** consomme la ligne (lease/claim, retry 3 paliers, head-of-line par collecte, DLQ → M11) sans bloquer la transaction M02/M12.

**Étapes** (worker) :

1. Lire `collecte_tms` + `tournee` + `prestataire`.
2. Lire `service_id` Everest depuis `tms.collectes_tms.everest_service_id_target` (colonne posée par M12 lors de l'attribution, cf. sobriété 2026-04-30 B_M14_02 — single source of truth, M14 ne re-calcule plus la fenêtre last-minute) :
   - 71 = vélo standard AG.
   - 75 = vélo express last-minute (M12 D2 a déjà tranché `heure_collecte - now() < 1h30`).
   - 91 = camion backup Marathon (cf. M12 R1.6).
   - NULL = collecte non-Everest (Strike/Marathon hors backup) → W1 ne devrait pas être déclenché, log warning si appelé.
3. Déterminer granularité (cf. D3) — **règle générale : 1 mission Everest = 1 tournée** :
   - Vélo : 1 mission Everest **par tournée vélo** → `everest_missions.collecte_tms_id = collecte.id` (l'unique collecte de cette tournée, D8) + `tournee_id = tournee.id` (cette tournée précise). **Multi-vélo (généralisation 2026-05-29)** : une collecte servie par N vélos = N tournées sœurs = **N missions Everest**, toutes avec le même `collecte_tms_id` mais un `tournee_id` distinct. Pas de no-op cross-tournée (l'idempotence est keyée sur `tournee_id`, cf. étape étape idempotence).
   - Camion : 1 mission Everest par tournée → `everest_missions.collecte_tms_id = NULL` + `tournee_id = tournee.id`. Si la tournée camion a déjà une mission Everest active (`statut_everest IN ('created','assigned')`), no-op + log `m14_mission_existing` info.
4. Construire payload Everest :
   ```json
   {
     "service_id": 71,
     "address_start": "<lieu_adresse_chargement>",
     "address_end": "<adresse_destination>",
     "start_date": "<heure_collecte ISO 8601>",
     "client_ref": "<tournee_id>",
     "metadata": {
       "savr_ref_type": "collecte | tournee",
       "savr_collecte_id": "<collecte_id si vélo, sinon null>",
       "savr_evenement_id": "...",
       "savr_traiteur_id": "..."
     }
   }
   ```
5. Lazy refresh token (cf. W6) si non présent en cache.
6. Appel `POST /missions/create` avec Bearer + timeout `m14_api_timeout_ms` (default 5000ms).
7. Si HTTP 200 :
   - INSERT `everest_missions` avec `statut_everest = 'created'`, `everest_mission_id = response.mission_id`, **`tournee_id` posé si camion / `collecte_tms_id` posé si vélo** (revue sobriété §04 2026-04-30 A6 — colonnes miroir `tournees.everest_mission_id` et `collectes_tms.everest_mission_id` supprimées V1, `everest_missions` est la source de vérité unique).
   - INSERT `integrations_logs` direction `outbound`, status `success`, duration_ms.
8. Si HTTP 401 :
   - Re-auth (W6) puis retry 1 fois.
9. Si HTTP 5xx ou timeout :
   - Retry 1 fois après `m14_api_retry_delay_ms` (default 30000ms).
   - Si échec final → INSERT `everest_missions` avec `statut_everest = 'creation_failed'` + alerte `m14_everest_mission_create_failed` (critical) → Ops voit dans E1 + reçoit email critical.
10. Si HTTP 4xx (autre que 401) :
    - Pas de retry. INSERT `everest_missions` avec `statut_everest = 'creation_failed'` + alerte `m14_everest_mission_create_failed` (critical) avec détail erreur.

**Idempotence** : la fonction worker check si `everest_missions` existe déjà pour `(tournee_id, service_id)` (= `client_ref`) avant de pousser. Si oui ET `statut_everest IN ('created','assigned','in_progress','completed','completed_incomplete')` → no-op + log info. Si `statut_everest IN ('creation_failed','cancelled')` → on retry (nouvelle tentative explicite). *(Clé `tournee_id` — généralisation 2026-05-29 : permet N missions par `collecte_tms_id` en multi-vélo, chaque tournée sœur étant une mission distincte ; chaque tournée n'a au plus qu'une mission active.)*

**Performance cible** : p95 < 1.5s end-to-end (timeout 5s).

### W2 — Réception webhook Everest entrant

**Déclencheur** : Everest POST `/api/webhooks/everest` (Next.js API route, public).

**Étapes** :

1. **Validation token webhook** (filet sécurité par défaut, cf. D6) :
   - Lire header `X-Webhook-Token` (ou query string `?token=` en fallback).
   - Comparer avec `secrets_metadata.everest_webhook_token` (lookup Vault).
   - Si match → continuer. Sinon → 401 + INSERT `integrations_logs` status `error` + alerte `m14_everest_webhook_signature_invalid` (warning).
2. Décoder payload `application/x-www-form-urlencoded`.
3. **Idempotence** :
   - Calculer `event_id = mission_id + event_type + occurred_at`.
   - INSERT `tms.integrations_inbox` avec `system = 'everest'`, `event_id`, `event_type`, `payload` JSON, `received_at = now()`, `status = 'pending'`.
   - Si conflit ON UNIQUE (`system`, `event_id`) → 200 OK silent (déjà reçu).
4. INSERT `integrations_logs` direction `inbound`, status `success`.
5. Lookup `everest_missions` par `everest_mission_id`. Si introuvable → alerte `m14_everest_webhook_unknown_mission` (warning) + 200 OK + statut inbox `failed_unknown_target`.
6. Switch sur `event_type` :
   - `mission_dispatched` : UPDATE `everest_missions.statut_everest = 'assigned'` + `coursier_nom`, `coursier_telephone`, `vehicule_type_everest` si présents + `derniere_sync_at = now()` + `payload_latest_update = payload`. **Exception acceptation nominale A Toutes! (arbitrage Val 2026-05-29)** : si `collectes_tms.statut_dispatch = 'attribuee_en_attente_acceptation'` → UPDATE `statut_dispatch = 'acceptee'` + émission webhook **S1 `collecte-acceptee`** vers la Plateforme (données coursier Everest : `chauffeur.nom = coursier_nom`, `chauffeur.chauffeur_id = null`, `vehicule.type = velo_cargo` via mapping `vehicule_type_everest`, `vehicule.vehicule_id = null`, `vehicule.plaque = null`, `acceptee_le = occurred_at`). C'est l'**unique** webhook Everest autorisé à muter `statut_dispatch` (cf. R_M14.3). Justification : A Toutes! n'a pas de portail M03 — l'assignation d'un coursier côté Everest **est** l'acceptation (équivalent du manager Strike/Marathon qui clique « Accepter »). Cohérent avec le modèle V1 Plateforme (confirmation Everest positive → `statut_tms = acceptee`, App §08 §3). Idempotent : no-op si `statut_dispatch != attribuee_en_attente_acceptation` (ex. déjà `acceptee` via failover W4). **Toujours pas de mutation `collectes_tms.statut_operationnel`** (M05 reste source de vérité terrain, cf. D4). **Multi-vélo (généralisation 2026-05-29, arbitrage Val 2) : en présence de N missions vélo pour une même collecte, c'est le `mission_dispatched` de la 1re mission qui fait passer la collecte `acceptee` (A Toutes! engage un coursier = collecte prise en charge) ; les `mission_dispatched` des autres missions sont des no-op idempotents sur `statut_dispatch`. Le passage `realisee` reste lui conditionné à la clôture de TOUTES les tournées sœurs (R6.1, M05 + R_M14.x).**
   - `mission_pickedup` : UPDATE `everest_missions.statut_everest = 'in_progress'` + `payload_latest_update`. Pas de mutation `collectes_tms.statut_*`.
   - `mission_finished` ou `mission_success` : UPDATE `everest_missions.statut_everest = 'completed'` + `cout_everest_ht` si présent + `preuve_course_url` si présente. Pas de mutation `collectes_tms.statut_*` (M05 reste source de vérité).
   - `mission_failed` : UPDATE `everest_missions.statut_everest = 'failed'` + alerte `m14_everest_mission_failed` (critical) → Ops contact A Toutes! pour comprendre incident terrain.
   - `mission_cancelled` : check `tms.audit_logs` pour voir si annulation initiée TMS (W3 trigger DB). Si oui → UPDATE statut silencieux. Si non → UPDATE `statut_everest = 'cancelled_externally'` + alerte `m14_everest_mission_cancelled_externally` (critical) → Ops contacte A Toutes!.
   - `mission_late` : UPDATE `payload_latest_update`. Émission alerte `m14_everest_mission_late` (warning) **uniquement si `alertes_catalogue.active = true`** — désactivée par défaut V1 (sobriété 2026-04-30 A_M14_07, cf. EC9 + Q4).
   - autre `event_type` : INSERT `tms.integrations_logs` statut `error` + statut inbox `failed_unknown_event` + 200 OK (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m14_everest_webhook_event_unknown` info retirée du catalogue, integrations_logs reste source de vérité). Admin investigue via M13 E6.
7. UPDATE `tms.integrations_inbox.status = 'success'`.
8. Retour HTTP 200.

**Garde statuts terminaux (ajout test-scenarios 2026-06-07, floue #4 tranchée Val)** : si `everest_missions.statut_everest` est déjà terminal (`completed`, `completed_incomplete`, `cancelled`, `cancelled_externally`, `failed`), un webhook tardif/out-of-order ne régresse **jamais** le statut : seul `payload_latest_update` est mis à jour + log info. Pas de machine d'états stricte V1 (les transitions intermédiaires non documentées d'Everest restent acceptées).

**Performance cible** : p95 < 500ms (le traitement est volontairement minimal côté webhook, pas de chaînage métier).

### W3 — Annulation cascade M12 → cancel mission Everest

**Déclencheur** (auto) : trigger DB `trg_m14_cascade_cancel` AFTER UPDATE on `tms.collectes_tms` quand `statut_dispatch` change vers `rejetee_par_prestataire` OU `annulee_par_traiteur` ET **au moins une mission Everest active existante**. Lookup **toutes** les missions actives de la collecte *(correction multi-camions/multi-vélo 2026-05-29 : `collectes_tms.tournee_id` retiré V1 — la jointure passe désormais par `collecte_tournees`)* :

```sql
SELECT em.* FROM tms.everest_missions em
WHERE (
   em.collecte_tms_id = NEW.id                       -- missions vélo de cette collecte (1 par tournée sœur)
   OR em.tournee_id IN (                              -- missions camion des tournées servant cette collecte
       SELECT ct.tournee_id FROM tms.collecte_tournees ct WHERE ct.collecte_tms_id = NEW.id
   )
)
AND em.statut_everest NOT IN ('cancelled','cancelled_externally','completed','completed_incomplete','failed','creation_failed');
```

**Multi-vélo (arbitrage Val 3, 2026-05-29) : annuler la collecte annule TOUTES ses missions Everest actives** (les N vélos). Le trigger insère **un event outbox `everest.cancel` par mission active** retournée (boucle), pas un seul *(transport refondu 2026-07-06 COH-03 option A)*.

**Déclencheur** (manuel Admin) : bouton "Annuler la mission" depuis E1/E2 (Admin only).

**Étapes** :

1. Trigger DB (`trg_m14_cascade_cancel`) **INSERT dans `tms.outbox_events` un event `everest.cancel` par mission active** (même transaction, payload `{everest_mission_id, collecte_id, tournee_id, cause}`) *(cascade auto : un event par mission retournée par le lookup ci-dessus — généralisation multi-vélo 2026-05-29 ; transport outbox 2026-07-06 COH-03 option A, consommé par le worker §07 §18bis)*.
2. Worker résout la mission ciblée par `everest_mission_id` du payload (lit `everest_missions.everest_mission_id` + `everest_client_id`). *(Le helper `tms.m14_lookup_mission_by_collecte(collecte_id)` retourne désormais **SETOF** — N missions possibles en multi-vélo — et sert au trigger pour énumérer les missions à annuler ; le worker, lui, traite une mission identifiée.)*
3. Lazy refresh token si nécessaire (W6).
4. Appel `POST /missions/cancel` avec Bearer.
5. Si HTTP 200 :
   - UPDATE `everest_missions.statut_everest = 'cancelled'` + `payload_latest_update = response`.
   - INSERT `integrations_logs` direction `outbound`, status `success`.
   - INSERT `audit_logs` avec `action = 'CANCEL'`, `diff = { cause: cascade_m12 | manuel_admin, motif: ... }` — cette trace permet à W2 de distinguer annulation TMS vs externe.
6. Si HTTP 4xx/5xx ou timeout :
   - Retry 1 fois (cohérence W1).
   - Si échec final → alerte `m14_everest_mission_cancel_failed` (warning) → Ops doit appeler A Toutes! pour annuler manuellement (risque double-dispatch).

**Idempotence** : la fonction worker check si `everest_missions.statut_everest IN ('cancelled','completed','completed_incomplete','failed')` avant d'appeler Everest. Si oui → no-op.

### W4 — Failover Everest down → acceptation manuelle Ops

**Déclencheur** : clic Ops "Marquer accepté manuellement" depuis E1 sur mission `statut_everest = 'creation_failed'` → ouverture E4.

**Étapes** :

1. Ops a appelé A Toutes! par téléphone et obtenu confirmation orale.
2. Saisie E4 (contact joint, heure appel, commentaire optionnel).
3. Soumission → API route `POST /api/internal/m14/missions/manual_accept`.
4. Worker :
   - Lookup `everest_missions` existant. Si présent (status `creation_failed`) → UPDATE `statut_everest = 'created_manually'` + `payload_latest_update = { manual: true, contact: ..., heure_appel: ..., commentaire: ... }`. Sinon (cas où push n'a même pas créé la ligne) → INSERT.
   - INSERT `audit_logs` `acteur_user_id = $ops_user`, `action = 'CREATE'` (ou `UPDATE`), `diff` complet (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 `m14_everest_acceptee_manuellement` info retirée du catalogue, audit_logs reste source de vérité).
   - UPDATE `statut_dispatch = 'acceptee'` + émission webhook **S1 `collecte-acceptee`** (§08 déclencheur c — payload avec `chauffeur.chauffeur_id = null`, données coursier inconnues à ce stade). A Toutes! n'a pas de portail M03 : la confirmation orale = acceptation (même logique que R_M14.1bis). L'acteur Ops est tracé par `audit_logs` — **pas de colonne `accepted_by_ops_user_id`** (corrigé test-scenarios 2026-06-07, floue #2 tranchée Val : colonne inexistante §04, référence retirée). Idempotence : si `mission_dispatched` arrive ensuite (W2), `statut_dispatch` déjà `acceptee` → no-op, pas de S1 redondant.

**Effet collatéral** : le chauffeur A Toutes! continue d'utiliser M05 normalement (la collecte est `acceptee`, donc dans la planification chauffeur).

### W5 — Notification course incomplète AG → Everest direct **Reporté V1.1 (revue sobriété §05 2026-05-01 A5)**

> **Suppression V1** : endpoint Everest exact non confirmé (Q1 ouverte). Développer un worker sur API non spécifiée = risque de refacto V1.1. Cas rare (AG `realisee_sans_collecte` ≈ quelques % des AG × % A Toutes! = très peu).
>
> **V1 fallback opérationnel** : à la déclaration `realisee_sans_collecte` chauffeur (M05 E5), le webhook S5 `collecte-terminee` part normalement vers la Plateforme. **Ops appelle A Toutes! manuellement** au moment de la clôture pour signaler la course incomplète. Le statut Everest reste `in_progress` côté `everest_missions` jusqu'au prochain webhook entrant Everest (`mission_finished` ou `mission_cancelled`) qui mute selon W2. La valeur enum `completed_incomplete` reste seedée (jamais atteinte V1, réservée V1.1).
>
> **À réactiver V1.1** dès que Q1 (endpoint exact côté dev Everest) est fermée. Spec V1.1 ci-dessous conservée pour mémoire.

**Conséquences propagées** :
- Endpoint `/api/internal/m14/missions/notify_incomplete` retiré V1 (cf. §07 + §08 internal API).
- EC10 retiré V1 (cf. §6 ci-dessous).
- Code alerte `m14_everest_incomplete_notify_failed` retiré du catalogue M11 V1.
- Transition `in_progress → completed_incomplete` jamais déclenchée V1.

---

**Spec V1.1 (référence) — Déclencheur** : chauffeur A Toutes! clique "Aucun repas à collecter" dans M05 E5 → workflow M05 W "Aucun repas" appelle `m14_notify_incomplete` en parallèle de l'émission webhook S5.

**Étapes (V1.1)** :

1. M05 worker appelle `POST /api/internal/m14/missions/notify_incomplete` avec `collecte_id` + `motif_aucun_repas` + `photo_url` (si requis par Everest).
2. Worker M14 :
   - Lookup `everest_missions` par `client_ref = collecte_id` (vélo) ou via `tournee_id` (camion).
   - Si statut courant `IN ('created','assigned','in_progress')` → continuer. Sinon → no-op + log warning.
   - **Endpoint Everest cible** : à confirmer avec dev Everest (Q1).
3. Lazy refresh token si nécessaire.
4. Appel API.
5. Si HTTP 200 → UPDATE `everest_missions.statut_everest = 'completed_incomplete'` + `payload_latest_update` + INSERT `integrations_logs` direction `outbound`, status `success`.
6. Si HTTP 4xx/5xx ou timeout → retry 1 fois. Si échec final → alerte `m14_everest_incomplete_notify_failed` (warning) → Ops appel A Toutes! manuel.

**Idempotence (V1.1)** : check `statut_everest = 'completed_incomplete'` → no-op si déjà notifié.

**Note V1.1** : cet appel ne bloque pas le flow M05 (le webhook S5 part vers la Plateforme indépendamment). C'est un appel best-effort en parallèle.

### W6 — Lazy refresh Bearer token sur 401

**Déclencheur** : tout appel sortant Everest qui retourne HTTP 401.

**Étapes** :

1. Premier appel échoue 401.
2. Worker lit `secrets_metadata.everest_client_id` + `everest_client_secret` (Vault reveal Edge Function M13).
3. Appel `POST /auth` avec credentials.
4. Si succès → cache token en **mémoire process Next.js uniquement** (Map global keyed sur `everest_access_token` avec TTL = TTL Everest si renvoyée, sinon 24h conservateur). Pas de persistance Vault `secrets_metadata.everest_access_token` V1 (sobriété 2026-04-30 B_M14_01 — single instance Next.js V1, à reconsidérer V1.1 si scale multi-instance).
5. Retry l'appel original 1 fois avec le nouveau token.
6. Si re-401 → alerte `m14_everest_auth_failed` (critical) → Admin TMS check credentials Vault.

**Performance** : auth Everest p95 < 500ms (rare).

### W7 — Replay manuel events `echec_final` (supprimé sobriété 2026-04-30 A_M14_04)

**Statut** : workflow supprimé. UI E3 + API route `/api/internal/m14/missions/replay/:inbox_id` + action `audit_logs.REPLAY` retirées.

**Motif** : cas d'usage extrêmement rare (cible <1% des webhooks finissent en `echec_final`, soit <1 event/semaine V1). Ne justifie pas une UI dédiée + API route + workflow versionné.

**Procédure manuelle Admin (runbook §15 Sécurité TMS)** : Admin authentifié SSO accède à Supabase Studio, identifie la ligne `tms.integrations_inbox.status = 'echec_final'` à rejouer, exécute :
```sql
UPDATE tms.integrations_inbox
SET status = 'pending', retry_count = 0
WHERE id = '<inbox_id>';
```
Puis ré-exécute le worker manuellement (Vercel CLI ou trigger NOTIFY selon impl). Trace via `audit_logs` Supabase Studio (acteur user_id Admin via SSO).

**À reconsidérer V1.1** si volume `echec_final` dépasse 1 event/semaine post-go-live (instrumentation via M13 E6 tab Everest).

### W8 — Test connexion Everest

**Déclencheur** : Admin clique "Test connexion Everest" depuis fiche prestataire M06 (A Toutes!) **ou** M13 E6 tab Everest. Sobriété 2026-04-30 A_M14_03 — entrées E1 et M13 E5 supprimées (action rare ~1-2/mois, 2 entrées suffisent : référentiel prestataires + monitoring système).

**Étapes** :

1. API route `POST /api/internal/m14/test_connection` (Admin only).
2. Worker :
   - Lazy refresh token (W6).
   - Appel `POST /availabilities` avec service_id 71 + date demain (endpoint léger choisi pour le test).
   - **Trace systématique dans `tms.integrations_logs`** (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping_*` supprimées V1) : `system='everest'`, `type_event='m14_ping'`, `direction='sortant'`, `payload={prestataire_id}`, `http_status`, `statut='succes' | 'echec_final'`, `duree_ms`.
   - Si HTTP 4xx/5xx ou timeout → alerte `m14_everest_timeout` (warning).
3. UI affiche résultat (toast + badge sur fiche prestataire) — lit `tms.vue_prestataires_everest_status` qui dérive `last_everest_ping_at`/`status` depuis `integrations_logs`.

---

## 6. Règles métier appliquées

### R_M14.1 — Push à l'attribution M12

Le TMS pousse la mission Everest dès la transition `collectes_tms.statut_dispatch → attribuee_en_attente_acceptation` ET `prestataire.integration_externe = 'everest'`. Cohérent avec le pattern Strike/Marathon (manager voit la collecte dans M03 dès `attribuee_en_attente_acceptation`).

### R_M14.1bis — Acceptation nominale A Toutes! par `mission_dispatched` (arbitrage Val 2026-05-29)

A Toutes! n'ayant pas de portail M03, l'acceptation nominale d'une collecte attribuée à A Toutes! est dérivée du webhook Everest `mission_dispatched` (assignation d'un coursier). À sa réception, si `collectes_tms.statut_dispatch = 'attribuee_en_attente_acceptation'`, M14 W2 mute `statut_dispatch → 'acceptee'` et émet S1 `collecte-acceptee` vers la Plateforme. Le cas Everest down (mission jamais `created`) reste couvert par le failover W4 (acceptation manuelle Ops). Le statut **opérationnel** n'est jamais touché (M05 = vérité terrain, R_M14.3). Équivalent V2 du modèle V1 Plateforme « confirmation Everest positive → `statut_tms = acceptee` » (App §08 §3).

### R_M14.2 — Granularité : 1 mission Everest = 1 tournée

Règle générale unifiée *(reformulée multi-vélo 2026-05-29)* : **une mission Everest correspond à une tournée**. Le `collecte_tms_id` n'est posé que sur le vélo (1 tournée vélo = 1 collecte, D8) ; il reste NULL sur le camion (1 tournée = N collectes).

- Vélo (service IDs 71/75) : 1 tournée vélo = 1 mission Everest. `everest_missions.collecte_tms_id = collecte.id` (l'unique collecte de la tournée), `tournee_id = tournee.id`. **Multi-vélo (généralisation 2026-05-29)** : une collecte servie par N vélos = N tournées sœurs = **N missions Everest** (même `collecte_tms_id`, `tournee_id` distinct, `client_ref = tournee_id`). N courses A Toutes! facturées (multi-facturation, arbitrage Val 5). D8 respecté (chaque vélo ne porte qu'1 collecte).
- Camion (service ID 91) : 1 tournée = 1 mission Everest globale. `everest_missions.collecte_tms_id = NULL`, `tournee_id = tournee.id`. Si la tournée a N collectes, une seule mission Everest est créée pour l'ensemble.

**Source du `service_id`** : lecture de `tms.collectes_tms.everest_service_id_target` posée par M12 lors de l'attribution (sobriété 2026-04-30 B_M14_02 — single source of truth, M14 ne re-évalue pas la fenêtre temporelle last-minute, M12 a déjà tranché).

### R_M14.3 — Webhooks Everest = observabilité, M05 = source de vérité opérationnelle

Les webhooks Everest ne mutent **jamais** `collectes_tms.statut_operationnel` ni `tournees.statut`. Ils mutent `everest_missions.statut_everest` + `payload_latest_update` uniquement. La vérité opérationnelle (en_route, arrivee, en_cours, realisee, realisee_sans_collecte) est posée par M05 chauffeur. Exceptions :
- `mission_dispatched` → **mute exceptionnellement `collectes_tms.statut_dispatch` `attribuee_en_attente_acceptation` → `acceptee`** + émet S1 (arbitrage Val 2026-05-29). C'est l'acceptation nominale A Toutes! (pas de portail M03 pour A Toutes! ; l'assignation coursier Everest = acceptation). N'affecte que le statut **dispatch**, jamais le statut **opérationnel** (M05). Idempotent. Cf. W2 + R_M14.1bis.
- `mission_failed` → alerte critique Ops (incident terrain à investiguer).
- `mission_cancelled` non initié TMS → alerte critique Ops (annulation externe à investiguer).
- `mission_late` → alerte warning Ops (info terrain mais pas de mutation).

### R_M14.4 — Auth Bearer lazy refresh sur 401

Pas de cron de refresh proactif. Token cache **mémoire process Next.js uniquement** (single instance V1, sobriété 2026-04-30 B_M14_01) + retry sur 401 → re-auth → retry une fois → alerte critical si re-échec. Si Everest expose une TTL token courte (< 1h, à valider swagger Q3), bascule V1.1 sur refresh proactif. Si Next.js scale en multi-instance V1.1 → persistance cross-process à arbitrer (Vault `secrets_metadata.everest_access_token` ou Redis).

### R_M14.5 — Idempotence webhooks via `integrations_inbox`

Tout webhook Everest entrant est dédupliqué via `integrations_inbox(system='everest', event_id)`. `event_id = mission_id + event_type + occurred_at`. Conflit unique → 200 OK silent. Cohérent avec le pattern M01 webhooks Plateforme.

### R_M14.6 — Failover Everest down = 1 retry 30s + Ops manuel

Pour tout appel sortant (création, annulation, test connexion) : 1 retry après `m14_api_retry_delay_ms` (default 30s). Si échec final → alerte critical (sauf cancel = warning, moins bloquant). Ops prend le relais : appel téléphone A Toutes! → E4 acceptation manuelle (pour création). Pas de retry boucle longue style Plateforme (5min/30min/2h) — la collecte AG part dans l'heure, pas le temps. retiré V1 (W5 reporté V1.1 — revue sobriété §05 2026-05-01 A5).

### R_M14.7 — Annulation cascade M12 = trigger DB auto

Quand `collectes_tms.statut_dispatch` transite vers `rejetee_par_prestataire` (M12 cascade) ou `annulee_par_traiteur` (M01 W4) avec **au moins une mission Everest active existante** → trigger DB enqueue **un job `m14_cancel_mission` par mission active**. Lookup *(corrigé multi-camions/multi-vélo 2026-05-29 : `collectes_tms.tournee_id` retiré V1 → jointure via `collecte_tournees`)* : `everest_missions WHERE (collecte_tms_id = NEW.id OR tournee_id IN (SELECT tournee_id FROM collecte_tournees WHERE collecte_tms_id = NEW.id)) AND statut_everest` non terminal. **Multi-vélo (arbitrage Val 3, 2026-05-29) : annuler la collecte annule TOUTES ses missions vélo actives (les N courses A Toutes!).** Idempotent par mission (no-op si statut Everest déjà terminal). Cf. W3.

### R_M14.8 — **Reportée V1.1 (revue sobriété §05 2026-05-01 A5)**

 Endpoint Everest exact non confirmé (Q1). Worker `m14_notify_incomplete` retiré V1. **V1 fallback** : webhook S5 émis vers Plateforme + Ops appelle A Toutes! manuellement à la clôture. Cf. W5 ci-dessus pour spec V1.1 conservée pour mémoire.

---

## 7. Edge cases

| # | Cas | Comportement TMS |
|---|-----|------------------|
| EC1 | Token Bearer expiré (401 sur appel) | W6 lazy re-auth + retry 1x. Si re-401 → alerte critical `m14_everest_auth_failed` |
| EC2 | Everest down création mission (timeout / 5xx) | Retry 1x après 30s. Si échec → `statut_everest = 'creation_failed'` + alerte critical `m14_everest_mission_create_failed` → Ops failover E4 (W4) |
| EC3 | Everest down annulation mission (timeout / 5xx) | Retry 1x. Si échec → alerte warning `m14_everest_mission_cancel_failed` → Ops appel manuel A Toutes! pour annuler chez eux |
| EC4 | Webhook reçu pour `mission_id` inconnu (jamais créé côté TMS) | Alerte warning `m14_everest_webhook_unknown_mission` + statut inbox `failed_unknown_target` + 200 OK Everest |
| EC5 | Webhook signature/token invalide | 401 retour Everest + alerte warning `m14_everest_webhook_signature_invalid` + log integrations_logs status `error`. Pas de traitement. |
| EC6 | Webhook `event_type` inconnu (Everest a ajouté un type sans préavis) | INSERT `integrations_logs` statut `error` + statut inbox `failed_unknown_event` + 200 OK (Bloc 3 sobriété 2026-04-25 A1 — alerte M11 info retirée). Admin investigue via M13 E6. |
| EC7 | `mission_cancelled` reçu mais non initié par TMS (annulation externe A Toutes!) | UPDATE `statut_everest = 'cancelled_externally'` + alerte critical `m14_everest_mission_cancelled_externally` → Ops contact A Toutes! pour comprendre |
| EC8 | `mission_failed` reçu (incident terrain) | UPDATE `statut_everest = 'failed'` + alerte critical `m14_everest_mission_failed` → Ops investigue avec A Toutes! et chauffeur |
| EC9 | `mission_late` reçu (retard chauffeur) | UPDATE `payload_latest_update`. Alerte `m14_everest_mission_late` désactivée par défaut V1 (sobriété 2026-04-30 A_M14_07 — `alertes_catalogue.active = false`) car risque bruit (Q4 — seuil Everest non confirmé). Le retard reste visible dans M02 collecte si problématique terrain. À activer V1.1 si Q4 confirme un seuil utile. |
| EC11 | Cascade M12 réattribution Marathon, mais `cancel` Everest échoue (W3) | Alerte warning `m14_everest_mission_cancel_failed`. Risque double-dispatch (A Toutes! + Marathon) → Ops doit appeler A Toutes! pour annuler manuellement chez eux. Bandeau permanent sur la collecte M02 tant que `statut_everest IN ('created','assigned','in_progress')` ET `prestataire_id != A Toutes!` |
| EC12 | Test connexion Everest échoue depuis M06 fiche A Toutes! ou M13 E5 | INSERT `tms.integrations_logs(system='everest', type_event='m14_ping', http_status=4xx/5xx, statut='echec_final')` + toast UI rouge + alerte warning `m14_everest_timeout`. Admin investigue (creds, network, Everest down). **Affichage UI** : vue dérivée `tms.vue_prestataires_everest_status` (revue sobriété §04 2026-04-30 A3 — colonnes `last_everest_ping_*` supprimées V1, info dérivée de `integrations_logs`). |

---

## 8. États et transitions

### États `tms.everest_missions.statut_everest`

```
                       ┌─────────────────┐
                       │  created        │ (W1 création OK)
                       └────────┬────────┘
                                │
                                ├──→ assigned          (W2 mission_dispatched)
                                │       │
                                │       └──→ in_progress  (W2 mission_pickedup)
                                │              │
                                │              ├──→ completed             (W2 mission_finished/success)
                                │              ├──→ completed_incomplete  (W5 notify_incomplete OK — réservé V1.1, jamais déclenché V1, revue sobriété §05 2026-05-01 A5)
                                │              ├──→ failed                (W2 mission_failed)
                                │              └──→ cancelled_externally  (W2 mission_cancelled non-TMS)
                                │
                                └──→ cancelled         (W3 cancel TMS)


  ┌──────────────────────┐
  │  creation_failed     │ (W1 retry échec)
  └──────────┬───────────┘
             │
             └──→ created_manually (W4 acceptation manuelle Ops)
                       │
                       └──→ (suite identique à `created`)
```

### Transitions autorisées par rôle

| Transition source → cible | Trigger | Acteur |
|---|---|---|
| `null → created` | W1 OK | Système (worker) |
| `null → creation_failed` | W1 échec | Système |
| `creation_failed → created_manually` | W4 | Ops Savr |
| `created → assigned` | W2 dispatched | Système (webhook) |
| `assigned → in_progress` | W2 pickedup | Système |
| `in_progress → completed` | W2 finished/success | Système |
| | | **Jamais déclenchée V1 (revue sobriété §05 2026-05-01 A5)** — W5 reporté V1.1. Valeur enum `completed_incomplete` reste seedée mais inatteignable V1. À réactiver V1.1 dès Q1 fermée. |
| `in_progress → failed` | W2 failed | Système |
| `* → cancelled` | W3 TMS-initiated | Système ou Admin |
| `* → cancelled_externally` | W2 cancelled non-TMS | Système |

---

## 9. Notifications

### Alertes émises (catalogue M11) — 10 codes V1

| Code | Criticité | Destinataire V1 | Émetteur | Quand | `active` V1 |
|------|-----------|-----------------|----------|-------|-------------|
| `m14_everest_timeout` (existant) | warning | Ops | M12 + M14 | Timeout `is-handled-address` ou autre call | true |
| `m14_everest_auth_failed` | critical | Admin TMS | M14 W6 | Re-auth échoue (creds invalides ou Everest down auth) | true |
| `m14_everest_mission_create_failed` | critical | Ops + Admin | M14 W1 | Création mission échec final post-retry | true |
| `m14_everest_mission_cancel_failed` | warning | Ops + Admin | M14 W3 | Annulation mission échec final | true |
| `m14_everest_webhook_signature_invalid` | warning | Admin TMS | M14 W2 | Token webhook entrant invalide | true |
| `m14_everest_webhook_unknown_mission` | warning | Admin TMS | M14 W2 | Webhook reçu pour `mission_id` inconnu | true |
| `m14_everest_mission_failed` | critical | Ops | M14 W2 | Webhook `mission_failed` reçu | true |
| `m14_everest_mission_cancelled_externally` | critical | Ops | M14 W2 | `mission_cancelled` non initié TMS | true |
| `m14_everest_mission_late` | warning | Ops | M14 W2 | `mission_late` reçu | **false** (sobriété 2026-04-30 A_M14_07 — bruit potentiel Q4, à activer V1.1 si seuil utile) |

**Codes ex-`info` retirés du catalogue M11 — Bloc 3 sobriété 2026-04-25 (A1)** :
- `m14_everest_coverage_stale` → trace via `tms.integrations_logs` (Admin investigue cache coverage > 7j via M13 E6 monitoring intégrations Everest)
- `m14_everest_webhook_event_unknown` → trace via `tms.integrations_logs` statut `error` + `tms.integrations_inbox.status = 'failed_unknown_event'` (W2 / EC6) — Admin investigue via M13 E6
- `m14_everest_acceptee_manuellement` → trace via `tms.audit_logs` action `CREATE`/`UPDATE` (W4) — déjà obligatoire pour audit gouvernance

### Canaux V1 (cf. M11 D1)

- `warning` → in-app + email ops si non-acquittée 30 min.
- `critical` → in-app + email Resend immédiat. dégagé V1 (revue sobriété 2026-04-25 A6).
- Criticité `info` dégagée Bloc 3 sobriété 2026-04-25 A1 — events ex-info tracés en `audit_logs`/`integrations_logs`.

### Pas de notification client/traiteur

M14 est **interne TMS**. Les notifications client/traiteur transitent par les webhooks Plateforme (S5 `collecte-terminee`, S7 `plaque-saisie`, etc.).

---

## 10. Performance cibles

| Mesure | Cible V1 | Source |
|--------|----------|--------|
| Push mission Everest p95 | < 1.5s end-to-end | `integrations_logs.duration_ms` outbound |
| Réception webhook Everest p95 | < 500ms | `integrations_logs.duration_ms` inbound |
| Cancel mission Everest p95 | < 1s | Idem outbound |
| Notify_incomplete p95 | < 1s | Idem outbound |
| Lazy auth refresh p95 | < 500ms | Sous-ensemble `POST /auth` |
| Test connexion Everest p95 | < 1s | `POST /availabilities` minimal |
| Disponibilité E1 dashboard p95 | < 800ms | Next.js API route + RLS |
| Refresh E1 | Bouton manuel + revalidation au focus tab (sobriété 2026-04-30 A_M14_01 — polling 60s + paramètre `m14_dashboard_polling_ms` supprimés) | UX pattern Tanstack Query |
| Volume webhooks/jour V1 | ~50-100 events (hypothèse 5-10 missions × 4-6 events) | Mesure post-go-live |

---

## 11. Décisions structurantes prises

| # | Décision | Alternatives écartées | Justification |
|---|----------|------------------------|---------------|
| **D1** | Périmètre V1 = reprise contrat Bubble↔Everest + supervision Ops (M11/M13) | (a) reprise stricte sans supervision / (c) reprise + features (estimate/availabilities V1) | Le contrat est stable, l'ambition est l'observabilité (qui manquait à Bubble). `availabilities` déjà tranché V2 (cf. M12 D8). |
| **D2** | Push mission Everest à transition `attribuee_en_attente_acceptation` (post-M12 attribution) | Push à validation Ops M02 / Push à acceptation prestataire | Cohérent avec pattern Strike/Marathon (manager voit dans M03 dès `attribuee_en_attente_acceptation`). Si Ops réattribue après → cascade W3 annule auto. |
| **D3** | **1 mission Everest = 1 tournée** (reformulé 2026-05-29) : camion → 1 mission/tournée (N collectes, `collecte_tms_id=NULL`) ; vélo → 1 mission/tournée vélo (`collecte_tms_id` posé, 1 collecte par vélo D8). `client_ref = tournee_id`, idempotence keyée `tournee_id`. **Multi-vélo (V2, 2026-05-29) : 1 collecte = N vélos = N missions** (même `collecte_tms_id`, `tournee_id` distinct) = N courses A Toutes! facturées. | N missions Everest pour camion (1/collecte) / keyer l'idempotence sur `collecte_id` (casserait le multi-vélo) | Granularité Everest-friendly (model Everest = 1 mission = 1 trajet start/end). Keyer sur `tournee_id` permet N missions par collecte en multi-vélo. **Source de vérité unique : `tms.everest_missions(everest_mission_id UNIQUE, tournee_id, collecte_tms_id)`** — pas d'unicité sur `collecte_tms_id` seul (N missions possibles) ; colonnes miroir `tournees.everest_mission_id` et `collectes_tms.everest_mission_id` retirées V1 (revue sobriété §04 2026-04-30 A6). Lookup via JOIN sur `everest_missions`. |
| **D4** | Webhooks Everest = observabilité pure (mutent `everest_missions` only). M05 chauffeur = source de vérité opérationnelle (`statut_operationnel`, `statut`) | Mapping fin webhooks → enums TMS (chaque event mute statut métier) / Mapping a minima | Évite les conflits temporels (webhook `mission_pickedup` arrive après que chauffeur a clôturé via M05 = drift statut). Chauffeur A Toutes! utilise M05 (déjà §04 ligne 2568). Sauf 3 cas durs (`mission_failed`, `mission_cancelled` non-TMS, `mission_late`) qui émettent alertes Ops. |
| **D5** | Auth Bearer lazy refresh sur 401 + cache token mémoire process Next.js **uniquement** V1 (sobriété 2026-04-30 B_M14_01) | Refresh à chaque appel / Cache token Vault avec cron refresh / Persistance cross-process Vault `secrets_metadata` V1 | Simple, robuste, pas de cron à maintenir. V1 single instance Next.js, volume faible. À reconsidérer V1.1 si TTL Everest < 1h (Q3) ou scale multi-instance. |
| **D6** | Sécurité webhook entrant = filet par défaut **token secret en header `X-Webhook-Token`** (Vault). À upgrader vers HMAC si Everest l'expose (à confirmer dev Everest pendant développement). | HMAC dès V1 / IP whitelist / aucune sécurité | Token en header = filet minimal, simple à upgrader. HMAC nécessite qu'Everest signe (à valider). IP whitelist fragile. |
| **D7** | Idempotence webhooks via `tms.integrations_inbox` (pattern unifié avec M01 webhooks Plateforme) | Dédup local sur `everest_missions.payload_latest_update` (timestamp) | Une seule source de dédup = cohérence + zéro nouvelle infra. `event_id = mission_id + event_type + occurred_at`. |
| **D8** | Failover Everest down = 1 retry 30s + Ops manuel via E4 (acceptation manuelle après appel téléphone) | Retry long Plateforme-style (5min/30min/2h) / pas de retry / 3 retries | Collecte AG part dans l'heure, pas le temps pour des retries longs. 1 retry court attrape les blips réseau, sinon humain prend le relais. |
| **D9** | Annulation cascade M12 / annulation traiteur = trigger DB auto AFTER UPDATE on `collectes_tms` qui appelle worker `m14_cancel_mission` | Annulation semi-auto (alerte Ops + bouton 1 clic) / Annulation manuelle Ops | Automatisable, idempotent, traçable. Évite double-dispatch (A Toutes! + nouveau prestataire) qui serait catastrophique terrain. Si cancel Everest échoue → alerte warning (EC11). |
| | **Reportée V1.1 (revue sobriété §05 2026-05-01 A5)** — Q1 ouverte = endpoint Everest exact non confirmé, développer un worker sur API non spécifiée = risque refacto. **V1 fallback opérationnel** : à la déclaration `realisee_sans_collecte` chauffeur, webhook S5 émis vers Plateforme + Ops appel manuel A Toutes! à la clôture. Réactiver V1.1 dès Q1 fermée. | Spec V1.1 conservée pour mémoire dans W5 ci-dessus. |

---

## 12. Questions ouvertes

1. **Q1 — Endpoint Everest pour notifier course incomplète AG** : `POST /missions/update` (avec `incomplete=true`) ? `POST /missions/finish` (avec `result=incomplete`) ? Fallback `POST /missions/cancel` (avec `cancellation_reason="aucun_repas_a_collecter"`) ? **Action** : à confirmer avec dev Everest **pendant le développement Claude Code** (avant cutover V1). Filet par défaut documenté W5 hypothèses 1/2/3. Référence swagger : https://a-toute.everst.io/api/swagger.json.
2. **Q2 — Sécurité webhook Everest entrant** : Everest expose-t-il une signature HMAC native ou un secret partagé ? Sinon → on reste sur token header (D6 filet). **Action** : à valider avec dev Everest avant go-live V1.
3. **Q3 — TTL token Bearer Everest** : durée de vie réelle ? Si < 1h → bascule V1.1 sur refresh proactif. **Action** : valider swagger + monitoring V1.
4. **Q4 — Format `mission_late` Everest** : seuil de retard configurable côté Everest ? Si oui → potentiellement bruyant. **Action** : valider avec dev Everest. Si bruyant → désactiver via `alertes_catalogue.active = false` (M11 D8).
5. **Q5 — Migration MTS-1 → TMS** : que fait-on des missions Everest en cours au moment du cutover (créées via Bubble, en exécution) ? **Action** : runbook traité dans la skill `cdc-migration-data` du pipeline CDC (livrable inter-modules, à exécuter avant cutover, cf. sobriété 2026-04-30 C_M14_03 — la référence à un §13 inexistant a été retirée). Hypothèse : laisser Bubble gérer les missions en cours, TMS prend les nouvelles missions à partir de T0.
6. **Q6 — Charge webhooks pic** : si A Toutes! ré-émet 6 webhooks par mission × 10 missions/jour × 1 retry × 2-3 events redondants = ~100-150 webhooks/jour. Volume gérable Next.js API route. À reconsidérer si volume V2 > 100 missions/jour.

---

## 13. Liens

### Au sein du CDC TMS

- [[../03 - Périmètre fonctionnel TMS#M14 — Intégration Everest (A Toutes!)]] — vue macro
- [[../04 - Data Model TMS]] — tables `everest_missions`, `everest_coverage_cache`, `integrations_inbox`, `integrations_logs`, `audit_logs`, colonnes `shared.prestataires.everest_*`, colonne `tms.collectes_tms.everest_service_id_target` (sobriété 2026-04-30 B_M14_02), paramètres `m14_*` (4 paramètres après suppression `m14_dashboard_polling_ms` sobriété 2026-04-30 A_M14_01)
- [[../05 - Règles métier TMS]] — section R_M14 (propagation 2026-04-25)
- [[../07 - Architecture technique TMS]] — section "API Routes M14" + trigger DB cascade (propagation 2026-04-25)
- [[../09 - Authentification et permissions TMS]] — RLS `everest_missions` (cf. ligne 2606 + propagation 2026-04-25)
- [[../15 - Sécurité et conformité TMS]] — secrets Vault Everest + token webhook (propagation 2026-04-25)
- [[M01 - Réception ordres de collecte]] — pattern `integrations_inbox` réutilisé
- [[M02 - Dispatch Ops Savr]] — déclenche indirectement W1 via `statut_dispatch`
- [[M05 - App mobile chauffeur]] — W "Aucun repas" appelle M14 W5 (propagation 2026-04-25)
- [[M06 - Référentiel prestataires]] — bouton test connexion Everest (W8) sur fiche A Toutes!
- [[M11 - Alerting transverse]] — catalogue 10 codes M14 (1 existant + 9 nouveaux après Bloc 3 sobriété 2026-04-25 A1 + désactivation par défaut `m14_everest_mission_late` sobriété 2026-04-30 A_M14_07)
- [[M12 - Attribution transporteur]] — `is-handled-address` cache (déjà documenté), branche `aucun_prestataire` si A Toutes! indisponible, **pose `everest_service_id_target` sur `collectes_tms` lors de l'attribution** (sobriété 2026-04-30 B_M14_02)
- [[M13 - Administration TMS]] — secrets Vault E5, tab Everest dans E6 monitoring intégrations (héberge audit webhooks 7j ex-E3 + bouton "Test connexion" depuis sobriété 2026-04-30 A_M14_03/A_M14_05)

### Vers le CDC Plateforme

- [[../../01 - Cahier des charges App/04 - Data Model]] — `courses_logistiques` (lit `cout_calcule_ht` côté TMS, pas `cout_everest_ht`)
- [[../../01 - Cahier des charges App/08 - APIs et intégrations]] — webhook S5 `collecte-terminee` côté Plateforme (pas impacté par M14, statut_final inchangé)

### Externes

- Documentation Everest : https://a-toute.everst.io/api/documentation
- Swagger Everest : https://a-toute.everst.io/api/swagger.json
