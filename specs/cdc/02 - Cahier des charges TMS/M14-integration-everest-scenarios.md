# Scénarios de test — M14 Intégration Everest (A Toutes!)

**Source CDC** : §06/M14 (W1-W4, W6, W8, R_M14.1-R_M14.7, EC1-EC12) + §04 (`everest_missions`, `trg_m14_cascade_cancel`, params `m14_*`) + §08 (S1) + §09 (§18/§18bis, T_M14.1-5)
**Généré le** : 2026-06-07
**Statut** : À implémenter par Claude Code — **5 specs floues TRANCHÉES Val 2026-06-07 et propagées (cf. section dédiée)**

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M14.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.
> Tous les appels Everest sont mockés (pas d'appel réel à `a-toute.everst.io` en CI).

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture estimée |
|-----------|-------------|-------------------|
| 1. Happy path | 9 | W1 (71/75/91), W2 (dispatched/pickedup/finished), W3, W4, W8 |
| 2. Cas limites métier | 8 | Multi-vélo N missions, idempotence push, no-op camion, retry post-échec |
| 3. Cas d'erreur métier | 14 | EC1-EC9, EC11, EC12 + token webhook + 4xx/5xx/401 |
| 4. Isolation RLS | 6 | T_M14.1-3 + manager A Toutes! + routes API par rôle |
| 5. Idempotence/états | 8 | R_M14.5 dedup, CHECK created_manually, no-op terminaux, T_M14.4 |
| 6. Cross-app (S1) | 4 | Émission S1 (schéma Ajv, multi-vélo, effet Plateforme, enveloppe) |
| 7. Migration | 1 | Webhook mission ère-Bubble pendant double run (Q5) |
| **TOTAL** | **50** | |

**Note cat. 6** : M14 ne consomme aucun endpoint E1-E6 et n'émet qu'un seul webhook S (S1, cas A Toutes!). Le webhook **entrant** `/api/webhooks/everest` est un contrat externe Everest (hors contrat §08 Plateforme↔TMS) — couvert en cat. 1/3/5.
**Note cat. 7** : aucune donnée `everest_missions` n'est migrée depuis MTS-1/Bubble (Q5 hypothèse : Bubble garde les missions en cours, TMS prend les nouvelles à T0). 1 seul scénario de frontière.

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M14 W1 / R_M14.1 / R_M14.2
# Couche : api
# Priorité : P1-critique

Scénario : push_mission_velo_standard_creation_ok
  Étant donné une collecte AG Kaspia attribuée à A Toutes! (`statut_dispatch` passe à 'attribuee_en_attente_acceptation')
    Et `collectes_tms.everest_service_id_target = 71` (posé par M12)
    Et une tournée vélo T1 liée à la collecte via `collecte_tournees`
    Et le mock Everest répond 200 avec `mission_id = 'EVR-1001'`
  Quand le trigger `trg_m14_push_mission` enqueue le job `m14_create_mission` et que le worker s'exécute
  Alors un POST `/missions/create` est émis avec `service_id = 71`, `client_ref = <T1.id>` et `metadata.savr_collecte_id = <collecte.id>`
    Et une ligne `everest_missions` est créée : `statut_everest = 'created'`, `everest_mission_id = 'EVR-1001'`, `collecte_tms_id = <collecte.id>`, `tournee_id = <T1.id>`, `payload_create` snapshot non NULL
    Et `integrations_logs` contient 1 ligne `system='everest'`, direction outbound, statut succès, `duration_ms` renseigné
```

```gherkin
# Source : §06/M14 W1 étape 2 / sobriété B_M14_02
# Couche : api
# Priorité : P1-critique

Scénario : push_mission_velo_express_75_sans_recalcul
  Étant donné une collecte AG last-minute avec `everest_service_id_target = 75` posé par M12
    Et `heure_collecte - now() = 3h` (volontairement HORS fenêtre last-minute 1h30)
  Quand W1 s'exécute
  Alors le payload Everest contient `service_id = 75` (lecture stricte de la colonne, M14 ne re-calcule PAS la fenêtre)
```

```gherkin
# Source : §06/M14 W1 étape 3 / R_M14.2 / D3
# Couche : api
# Priorité : P1-critique

Scénario : push_mission_camion_backup_91_collecte_tms_id_null
  Étant donné une tournée camion Marathon-backup A Toutes! avec 3 collectes liées et `everest_service_id_target = 91`
  Quand W1 s'exécute pour cette tournée
  Alors UNE SEULE mission Everest est créée : `tournee_id = <tournée.id>`, `collecte_tms_id IS NULL`, `client_ref = <tournée.id>`
```

```gherkin
# Source : §06/M14 W2 mission_dispatched / R_M14.1bis / R_M14.3 / §08 S1
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_dispatched_acceptation_nominale_s1
  Étant donné une mission EVR-1001 `statut_everest = 'created'` et sa collecte `statut_dispatch = 'attribuee_en_attente_acceptation'`
  Quand le webhook Everest `mission_dispatched` arrive avec `coursier_nom = 'Léo'`, `coursier_telephone`, `vehicule_type_everest = 'bike_cargo'` et token valide
  Alors `everest_missions` : `statut_everest = 'assigned'`, `coursier_nom = 'Léo'`, `derniere_sync_at = now()`, `payload_latest_update` posé
    Et `collectes_tms.statut_dispatch = 'acceptee'`
    Et un webhook S1 `collecte-acceptee` est enqueué vers la Plateforme avec `chauffeur.chauffeur_id = null`, `chauffeur.nom = 'Léo'`, `vehicule.type = 'velo_cargo'`, `vehicule.vehicule_id = null`, `vehicule.plaque = null`, `acceptee_le = occurred_at`
    Et `collectes_tms.statut_operationnel` est INCHANGÉ (R_M14.3)
```

```gherkin
# Source : §06/M14 W2 mission_pickedup / D4
# Couche : api
# Priorité : P2-important

Scénario : webhook_mission_pickedup_observabilite_pure
  Étant donné une mission `statut_everest = 'assigned'`
  Quand le webhook `mission_pickedup` arrive
  Alors `statut_everest = 'in_progress'` + `payload_latest_update` mis à jour
    Et AUCUNE colonne de `collectes_tms` ni `tournees` n'est mutée
```

```gherkin
# Source : §06/M14 W2 mission_finished / D4
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_finished_completed_cout_preuve
  Étant donné une mission `statut_everest = 'in_progress'`
  Quand le webhook `mission_finished` arrive avec `cout_everest_ht = 38.50` et `preuve_course_url`
  Alors `statut_everest = 'completed'`, `cout_everest_ht = 38.50`, `preuve_course_url` posée
    Et `collectes_tms.statut_operationnel` est INCHANGÉ (M05 = source de vérité terrain ; `tournees.cout_calcule_ht` prime sur `cout_everest_ht`)
```

```gherkin
# Source : §06/M14 W3 / R_M14.7 / §04 trg_m14_cascade_cancel
# Couche : db + api
# Priorité : P1-critique

Scénario : cascade_cancel_rejet_prestataire
  Étant donné une mission EVR-1001 `statut_everest = 'created'` liée à une collecte AG
    Et le mock Everest cancel répond 200
  Quand `collectes_tms.statut_dispatch` transite vers 'rejetee_par_prestataire'
  Alors le trigger émet 1 `pg_notify('m14_cancel_queue', …)` avec `everest_mission_id = 'EVR-1001'` et `cause = 'rejetee_par_prestataire'`
    Et après exécution du worker : `statut_everest = 'cancelled'` + `audit_logs` action 'CANCEL' avec `diff.cause = 'cascade_m12'`
    Et `integrations_logs` outbound succès
```

```gherkin
# Source : §06/M14 W4 / E4
# Couche : api + ui
# Priorité : P1-critique

Scénario : failover_acceptation_manuelle_ops
  Étant donné une mission `statut_everest = 'creation_failed'` (Everest down)
    Et Ops connecté sur E1
  Quand Ops clique "Marquer accepté manuellement", saisit "Contact joint = Julie (A Toutes!)" (≥ 3 car.) et confirme
  Alors `statut_everest = 'created_manually'`, `manual_acceptance_at/by_user_id/contact` posés (CHECK §04 satisfait)
    Et `audit_logs` contient une ligne `acteur_type='user'` avec le diff complet
    Et `collectes_tms.statut_dispatch = 'acceptee'` (arbitrage FLOUE #2 — pas de colonne `accepted_by_ops_user_id`, l'acteur est tracé par audit_logs)
    Et un webhook S1 `collecte-acceptee` est émis vers la Plateforme (§08 déclencheur c)
```

```gherkin
# Source : §06/M14 W8 / EC12
# Couche : api
# Priorité : P3-nominal

Scénario : test_connexion_everest_ok
  Étant donné Admin TMS sur la fiche prestataire A Toutes! (M06)
    Et le mock Everest `/availabilities` répond 200
  Quand Admin clique "Test connexion Everest"
  Alors `integrations_logs` reçoit 1 ligne `type_event='m14_ping'`, `statut='succes'`, `duree_ms` posé
    Et `tms.vue_prestataires_everest_status` reflète le ping OK (pas de colonne `last_everest_ping_*`, vue dérivée)
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : R_M14.2 multi-vélo / D3 / §04 cardinalité collecte_tms_id
# Couche : api + db
# Priorité : P1-critique

Scénario : multi_velo_n_missions_meme_collecte
  Étant donné une collecte AG servie par 2 tournées vélo sœurs T1 et T2 (multi-vélo)
  Quand W1 s'exécute pour T1 puis T2
  Alors 2 missions Everest existent avec le MÊME `collecte_tms_id` et des `tournee_id` distincts
    Et `client_ref` de chaque mission = son `tournee_id`
    Et l'INSERT de la 2e mission ne viole aucune contrainte (pas d'unicité sur `collecte_tms_id` seul)
```

```gherkin
# Source : W2 mission_dispatched multi-vélo / §08 S1 arbitrage Val 2
# Couche : api
# Priorité : P1-critique

Scénario : multi_velo_premier_dispatched_emet_s1_unique
  Étant donné 2 missions M1 et M2 pour la même collecte, `statut_dispatch = 'attribuee_en_attente_acceptation'`
  Quand `mission_dispatched` arrive pour M1 puis pour M2
  Alors après M1 : `statut_dispatch = 'acceptee'` + 1 webhook S1 émis
    Et après M2 : `statut_everest` de M2 passe à 'assigned' mais `statut_dispatch` est no-op et AUCUN second S1 n'est émis
```

```gherkin
# Source : R_M14.7 multi-vélo (arbitrage Val 3) / §04 trigger boucle
# Couche : db
# Priorité : P1-critique

Scénario : multi_velo_cancel_collecte_annule_n_missions
  Étant donné 2 missions actives (created/assigned) pour la même collecte
  Quand la collecte transite vers 'annulee_par_traiteur'
  Alors le trigger émet 2 `pg_notify` distincts (1 par mission active) et les 2 missions finissent `cancelled`
```

```gherkin
# Source : W1 étape 3 camion
# Couche : api
# Priorité : P2-important

Scénario : camion_mission_active_existante_noop
  Étant donné une tournée camion ayant déjà une mission `statut_everest = 'assigned'`
  Quand W1 est re-déclenché pour cette tournée
  Alors aucun appel Everest n'est émis (no-op) + log info `m14_mission_existing`
```

```gherkin
# Source : W1 idempotence keyée (tournee_id, service_id)
# Couche : api
# Priorité : P1-critique

Scénario : idempotence_push_keyee_tournee_service
  Étant donné une mission `statut_everest = 'created'` pour (T1, 71)
  Quand le job `m14_create_mission` est rejoué pour (T1, 71)
  Alors aucun POST `/missions/create` n'est émis et aucune 2e ligne `everest_missions` n'est créée
```

```gherkin
# Source : W1 idempotence — statuts retry-ables
# Couche : api
# Priorité : P2-important

Scénario : retry_apres_creation_failed_autorise
  Étant donné une mission (T1, 71) `statut_everest = 'creation_failed'`
    Et le mock Everest répond désormais 200
  Quand une nouvelle tentative W1 explicite est déclenchée
  Alors le push est relancé (les statuts 'creation_failed' et 'cancelled' n'inhibent PAS le retry)
```

```gherkin
# Source : W1 étape 2 — service NULL
# Couche : api
# Priorité : P2-important

Scénario : service_id_target_null_pas_de_push
  Étant donné une collecte attribuée à Strike (`everest_service_id_target IS NULL`)
  Quand W1 est appelé par erreur
  Alors aucun appel Everest, aucune ligne `everest_missions`, 1 log warning
```

```gherkin
# Source : §8 États — created_manually reprend le cycle
# Couche : api
# Priorité : P2-important

Scénario : created_manually_reprend_cycle_normal
  Étant donné une mission `statut_everest = 'created_manually'` (failover W4 déjà fait, collecte 'acceptee')
  Quand `mission_dispatched` arrive pour cette mission
  Alors `statut_everest = 'assigned'`
    Et `statut_dispatch` est no-op (déjà 'acceptee') et AUCUN S1 supplémentaire n'est émis
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : EC1 / W6 / R_M14.4
# Couche : api
# Priorité : P1-critique

Scénario : http_401_lazy_refresh_puis_retry_ok
  Étant donné le mock Everest répond 401 au 1er POST `/missions/create` puis 200 après ré-auth
  Quand W1 s'exécute
  Alors le worker appelle `POST /auth` avec `everest_client_id/secret` (Vault reveal), met le token en cache mémoire process, rejoue l'appel 1 fois
    Et la mission finit `created` sans alerte
```

```gherkin
# Source : EC1 / W6 étape 6
# Couche : api
# Priorité : P1-critique

Scénario : re_401_alerte_auth_failed_critical
  Étant donné le mock Everest répond 401 y compris après ré-auth
  Quand W1 s'exécute
  Alors alerte `m14_everest_auth_failed` criticité critical créée (destinataire Admin TMS) + email Resend immédiat
```

```gherkin
# Source : EC2 / W1 étapes 9 / R_M14.6 / D8
# Couche : api
# Priorité : P1-critique

Scénario : timeout_5xx_retry_30s_puis_creation_failed
  Étant donné le mock Everest répond 503 aux 2 tentatives
  Quand W1 s'exécute
  Alors exactement 2 appels sont émis, espacés de `m14_api_retry_delay_ms` (30 000 ms, horloge mockée)
    Et la mission finit `statut_everest = 'creation_failed'` (cf. FLOUE #3 sur `everest_mission_id` NOT NULL)
    Et alerte `m14_everest_mission_create_failed` critical créée → visible bandeau E1
```

```gherkin
# Source : W1 étape 10
# Couche : api
# Priorité : P1-critique

Scénario : http_4xx_pas_de_retry_creation_failed
  Étant donné le mock Everest répond 422 (payload invalide)
  Quand W1 s'exécute
  Alors UN SEUL appel est émis (pas de retry sur 4xx ≠ 401)
    Et mission `creation_failed` + alerte critical avec le détail de l'erreur dans le payload d'alerte
```

```gherkin
# Source : EC3 / EC11 / W3 étape 6
# Couche : api + ui
# Priorité : P1-critique

Scénario : cancel_echec_alerte_warning_bandeau_double_dispatch
  Étant donné une cascade M12 réattribue la collecte à Marathon et le mock Everest cancel répond 500 aux 2 tentatives
  Quand W3 s'exécute
  Alors alerte `m14_everest_mission_cancel_failed` warning créée
    Et la mission reste dans son statut actif
    Et M02 affiche un bandeau permanent sur la collecte tant que `statut_everest IN ('created','assigned','in_progress')` ET `prestataire_id != A Toutes!`
```

```gherkin
# Source : EC5 / W2 étape 1 / D6
# Couche : api
# Priorité : P1-critique

Scénario : webhook_token_invalide_401
  Étant donné `m14_webhook_token_required = true`
  Quand un POST `/api/webhooks/everest` arrive avec `X-Webhook-Token` ≠ `secrets_metadata.everest_webhook_token`
  Alors réponse 401, AUCUNE ligne `integrations_inbox`, 1 ligne `integrations_logs` statut error
    Et alerte `m14_everest_webhook_signature_invalid` warning créée
```

```gherkin
# Source : D6 / §04 param m14_webhook_token_required
# Couche : api
# Priorité : P2-important

Scénario : webhook_token_required_false_bypass
  Étant donné `m14_webhook_token_required = false` (migration HMAC en cours)
  Quand un webhook arrive sans header `X-Webhook-Token`
  Alors le webhook est traité normalement (200, inbox insérée)
```

```gherkin
# Source : EC4 / W2 étape 5
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_inconnue_failed_unknown_target
  Quand un webhook `mission_finished` arrive (token valide) pour `mission_id = 'EVR-FANTOME'` inconnu de `everest_missions`
  Alors réponse 200 OK (Everest ne retry pas), `integrations_inbox.status = 'failed_unknown_target'`
    Et alerte `m14_everest_webhook_unknown_mission` warning créée
```

```gherkin
# Source : EC6 / W2 étape 6
# Couche : api
# Priorité : P2-important

Scénario : webhook_event_type_inconnu_sans_alerte
  Quand un webhook `mission_teleported` (type inconnu) arrive pour une mission connue
  Alors réponse 200, `integrations_inbox.status = 'failed_unknown_event'`, `integrations_logs` statut error
    Et AUCUNE alerte M11 n'est créée (code ex-info retiré Bloc 3 A1 — logs = source de vérité)
```

```gherkin
# Source : EC8 / W2 mission_failed
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_failed_alerte_critical
  Quand `mission_failed` arrive pour une mission `in_progress`
  Alors `statut_everest = 'failed'` + alerte `m14_everest_mission_failed` critical (destinataire Ops) + email immédiat
```

```gherkin
# Source : EC7 / W2 mission_cancelled
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_cancelled_externe
  Étant donné une mission `assigned` SANS `audit_logs` action 'CANCEL' TMS associée
  Quand `mission_cancelled` arrive
  Alors `statut_everest = 'cancelled_externally'` + alerte `m14_everest_mission_cancelled_externally` critical
```

```gherkin
# Source : W2 mission_cancelled (branche TMS-initiated)
# Couche : api
# Priorité : P1-critique

Scénario : webhook_mission_cancelled_initie_tms_silencieux
  Étant donné W3 a annulé la mission (audit_logs CANCEL présent, `statut_everest = 'cancelled'`)
  Quand Everest renvoie son webhook `mission_cancelled` en écho
  Alors update silencieux (statut reste 'cancelled') et AUCUNE alerte n'est créée
```

```gherkin
# Source : EC9 / sobriété A_M14_07
# Couche : api
# Priorité : P2-important

Scénario : mission_late_alerte_desactivee_par_defaut
  Étant donné `alertes_catalogue.code = 'm14_everest_mission_late'` avec `active = false` (seed V1)
  Quand `mission_late` arrive
  Alors `payload_latest_update` est mis à jour, `statut_everest` INCHANGÉ
    Et AUCUNE ligne `alertes` n'est créée
```

```gherkin
# Source : EC12 / W8
# Couche : api
# Priorité : P3-nominal

Scénario : test_connexion_echec_alerte_timeout
  Étant donné le mock Everest `/availabilities` répond timeout
  Quand Admin lance le test connexion
  Alors `integrations_logs` ligne `m14_ping` `statut='echec_final'` + toast rouge + alerte `m14_everest_timeout` warning
```

---

## Catégorie 4 — Isolation RLS

```gherkin
# Source : §09 §18 / T_M14.1
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : manager_strike_deny_missions_atoutes
  Étant donné un manager prestataire Strike authentifié
  Quand il SELECT `tms.everest_missions` (missions A Toutes!)
  Alors 0 ligne retournée
```

```gherkin
# Source : §09 §18 / T_M14.2
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : chauffeur_atoutes_deny_everest_missions
  Étant donné un chauffeur A Toutes! authentifié
  Quand il SELECT `tms.everest_missions`
  Alors 0 ligne (rôle `chauffeur` exclu des policies)
```

```gherkin
# Source : §09 §18 policy everest_manager_atoutes_read — cf. FLOUE #1
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : manager_atoutes_read_ses_missions
  Étant donné un manager prestataire A Toutes! authentifié et 1 mission liée à une tournée A Toutes!
  Quand il SELECT `tms.everest_missions`
  Alors il voit cette mission (y compris `manual_acceptance_contact`, §18bis)
    -- Prédicat tranché FLOUE #1 : `tournee_id IN (SELECT id FROM tms.tournees WHERE prestataire_id = auth.user_prestataire_id())`
```

```gherkin
# Source : §09 §18 (policy SELECT only pour manager)
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : manager_atoutes_deny_update
  Étant donné un manager A Toutes! authentifié
  Quand il tente UPDATE `everest_missions.statut_everest = 'completed'` sur sa propre mission
  Alors 0 ligne affectée (aucune policy UPDATE pour manager)
```

```gherkin
# Source : §09 §18 everest_staff_all
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : staff_full_access_everest_missions
  Étant donné un user `ops_savr` puis un `admin_tms`
  Quand chacun SELECT + UPDATE `everest_missions`
  Alors accès complet pour les deux (`auth.user_is_staff()`)
```

```gherkin
# Source : §09 §18bis routes API / T_M14.3 / E1 actions
# Couche : api
# Priorité : P1-critique

Scénario : routes_m14_protegees_par_role
  Quand un manager prestataire appelle `POST /api/internal/m14/missions/manual_accept` → 403
    Et un ops_savr appelle la même route → 200 (T_M14.3)
    Et un ops_savr appelle `POST /api/internal/m14/test_connection` → 403 (Admin only)
    Et un ops_savr tente "Annuler mission" E1/E2 → action refusée (Admin only)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : R_M14.5 / D7 / W2 étape 3
# Couche : api + db
# Priorité : P1-critique

Scénario : dedup_webhook_event_id
  Étant donné un webhook `mission_pickedup` (mission_id + event_type + occurred_at identiques) déjà traité
  Quand le même webhook est rejoué (retry Everest)
  Alors réponse 200 silent, conflit UNIQUE `integrations_inbox(system, event_id)`, AUCUN second traitement métier
```

```gherkin
# Source : §04 CHECK created_manually / T_M14.5
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : check_created_manually_rejette_incoherence
  Quand on UPDATE `statut_everest = 'created_manually'` SANS poser `manual_acceptance_at/by_user_id/contact`
  Alors la mutation est rejetée par le CHECK constraint
    Et inversement : poser `manual_acceptance_*` avec un autre statut est rejeté (égalité stricte du CHECK)
```

```gherkin
# Source : T_M14.4 / §04 trigger
# Couche : db (pgTAP)
# Priorité : P1-critique

Scénario : trigger_cascade_noop_sans_mission_active
  Étant donné une collecte Strike SANS mission Everest (ou avec missions toutes terminales)
  Quand `statut_dispatch` transite vers 'rejetee_par_prestataire'
  Alors AUCUN `pg_notify('m14_cancel_queue')` n'est émis
```

```gherkin
# Source : W3 idempotence
# Couche : api
# Priorité : P1-critique

Scénario : cancel_worker_noop_statut_terminal
  Étant donné une mission `statut_everest = 'completed'`
  Quand un job `m14_cancel_mission` arrive pour cette mission
  Alors AUCUN appel Everest n'est émis (no-op, statut terminal)
```

```gherkin
# Source : W5 reporté V1.1 / §8 transitions
# Couche : db + api
# Priorité : P2-important

Scénario : completed_incomplete_inatteignable_v1
  Alors la valeur enum `completed_incomplete` est seedée
    Et aucun chemin de code V1 ne mute `statut_everest` vers cette valeur (l'endpoint `/notify_incomplete` n'existe pas → 404)
    Et le code alerte `m14_everest_incomplete_notify_failed` est ABSENT du seed `alertes_catalogue`
```

```gherkin
# Source : W2 mission_dispatched idempotence / R_M14.1bis
# Couche : api
# Priorité : P1-critique

Scénario : dispatched_noop_si_deja_acceptee
  Étant donné une collecte `statut_dispatch = 'acceptee'` (failover W4 déjà passé)
  Quand `mission_dispatched` arrive
  Alors `statut_everest = 'assigned'` mais `statut_dispatch` INCHANGÉ et AUCUN S1 émis
```

```gherkin
# Source : W2 / D4 — ordre des webhooks. Cf. FLOUE #4
# Couche : api
# Priorité : P2-important

Scénario : webhook_out_of_order_ne_regresse_pas_un_statut_terminal
  Étant donné une mission `statut_everest = 'completed'` (mission_finished déjà traité)
  Quand un `mission_pickedup` tardif arrive (occurred_at antérieur, event_id distinct → passe la dedup)
  Alors `statut_everest` reste 'completed' (garde terminaux tranchée FLOUE #4 : les 5 statuts terminaux ne sont jamais régressés)
    Et `payload_latest_update` seul est mis à jour + log info
```

```gherkin
# Source : W4 / E4 effets / Bloc 3 A1
# Couche : api
# Priorité : P2-important

Scénario : audit_trail_failover_complet
  Quand W4 est exécuté (acceptation manuelle)
  Alors `audit_logs` contient `acteur_user_id = <ops>`, `acteur_type = 'user'`, `diff` incluant `manuel: true` + contact + heure d'appel
    Et AUCUNE alerte `m14_everest_acceptee_manuellement` n'est créée (code retiré du catalogue, audit_logs = source de vérité)
```

---

## Catégorie 6 — Cross-app (TMS → Plateforme, S1)

```gherkin
# Source : §08 S1 + 08 - savr-api-contracts/s1 schema
# Couche : api
# Priorité : P1-critique

Scénario : s1_everest_payload_conforme_schema
  Quand le S1 déclenché par `mission_dispatched` est construit
  Alors il valide le JSON Schema S1 (Ajv) : `type = 'collecte.acceptee'`, `chauffeur.chauffeur_id = null`, `prenom = null`, `vehicule.type = 'velo_cargo'`, `vehicule.vehicule_id/plaque = null`, `acceptee_le` ISO 8601
```

```gherkin
# Source : §08 S1 effet Plateforme
# Couche : api
# Priorité : P1-critique

Scénario : s1_effet_plateforme_statut_tms
  Quand la Plateforme reçoit le S1 (HMAC valide, X-API-Version 2026.04)
  Alors `plateforme.collectes.statut_tms = 'acceptee'` + `statut_tms_at` posé
    Et la Plateforme accepte les nulls A Toutes! sans erreur de validation
```

```gherkin
# Source : §08 S1 enveloppe / harnais commun webhooks sortants
# Couche : api
# Priorité : P1-critique

Scénario : s1_everest_enveloppe_hmac_retry
  Quand l'émission S1 échoue (Plateforme 500) puis réussit au retry
  Alors le retry standard (5min/1h/24h) s'applique, même `event_id` → un seul effet métier côté Plateforme (dédup `body.event_id`)
    Et un S1 avec HMAC invalide est rejeté 401 par la Plateforme
```

```gherkin
# Source : §08 S1 déclencheur (c) failover — cf. FLOUE #2
# Couche : api
# Priorité : P1-critique

Scénario : s1_failover_w4_emis
  Quand W4 (acceptation manuelle Ops) est confirmé
  Alors un S1 `collecte-acceptee` est émis vers la Plateforme (tranché FLOUE #2, conforme §08 déclencheur c)
    Et le payload utilise le contact manuel (chauffeur inconnu → `chauffeur.chauffeur_id = null`)
```

---

## Catégorie 7 — Migration (Bubble/MTS-1 → Supabase)

```gherkin
# Source : Q5 / EC4 — frontière cutover
# Couche : api
# Priorité : P2-important

Scénario : webhook_mission_bubble_pendant_double_run
  Étant donné le cutover T0 est passé et une mission créée par Bubble avant T0 (inconnue de `tms.everest_missions`)
  Quand Everest envoie un webhook pour cette mission au TMS
  Alors comportement EC4 : 200 OK + `failed_unknown_target` + alerte warning
    Et le runbook cutover (cdc-migration-data, Q5) documente que c'est attendu : Bubble gère les missions en vol, TMS prend les missions à partir de T0
```

**Justification couverture migration** : aucune table M14 n'est migrée (hypothèse Q5 : zéro reprise de missions en vol). Pas de check de réconciliation `everest_missions` dans `04 - Migration/05 - Checks reconciliation`. Le scénario unique couvre la frontière temporelle.

---

## Specs floues — TRANCHÉES Val 2026-06-07 (propagées §09 + M14 + §04)

### FLOUE #1 — BLOQUANT (tranché : jointure tournees) : policy RLS `everest_manager_atoutes_read` référençait une colonne inexistante

§09 §18 filtrait sur `prestataire_id`, colonne absente de `tms.everest_missions`. **Tranché** : prédicat réécrit `tournee_id IN (SELECT id FROM tms.tournees WHERE prestataire_id = auth.user_prestataire_id())`. Zéro changement de schéma. Propagé §09 §18.

### FLOUE #2 — BLOQUANT (tranché : acceptee + S1, sans colonne) : contradiction interne W4/E4

E4 disait « pas de transition `statut_dispatch` », W4 étape 4 disait l'inverse. **Tranché** : W4 mute `statut_dispatch → 'acceptee'` + émet S1 `collecte-acceptee` (aligné §08 déclencheur c). E4 corrigé. Pas de colonne `accepted_by_ops_user_id` (inexistante §04) — l'acteur Ops est tracé par `audit_logs`. Propagé M14 E4 + W4.

### FLOUE #3 — BLOQUANT (tranché : nullable + CHECK) : `creation_failed` impossible à insérer

`everest_mission_id` était NOT NULL alors que W1 échec n'a pas d'ID Everest. **Tranché** : colonne nullable + CHECK `((statut_everest IN ('creation_failed','created_manually')) OR everest_mission_id IS NOT NULL)`. UNIQUE conservé (ignore les NULL). Propagé §04.

### FLOUE #4 — (tranché : garde terminaux) : webhooks out-of-order

**Tranché** : les 5 statuts terminaux (`completed`, `completed_incomplete`, `cancelled`, `cancelled_externally`, `failed`) ne sont jamais régressés par W2 ; event tardif → `payload_latest_update` seul + log info. Pas de machine d'états stricte V1. Propagé M14 W2.

### FLOUE #5 — Mineure (correction appliquée) : `everest_service_id` harmonisé

§04 : `everest_service_id` passe de `text` (« 71 ou 91 ») à `smallint CHECK IN (71, 75, 91)`, aligné sur `collectes_tms.everest_service_id_target`. Le 75 (vélo express) manquait à la description. Propagé §04.

---

## Scénarios hors scope (à générer en V1.1)

- **W5 `notify_incomplete`** + transition `in_progress → completed_incomplete` + alerte `m14_everest_incomplete_notify_failed` — reportés V1.1 (Q1 endpoint Everest non confirmé). Seul le test d'inatteignabilité V1 est couvert (cat. 5).
- **HMAC webhook entrant Everest** — D6 V1 = token header ; scénarios HMAC à générer si Q2 confirme une signature native.
- **Refresh token proactif / cache cross-process** — V1.1 si Q3 (TTL < 1h) ou multi-instance.
- **Alerte `mission_late` active** — V1.1 si Q4 confirme un seuil utile (V1 testée désactivée).
- **Replay UI W7** — supprimé V1 (SQL direct Studio) ; pas de test E2E de replay.
