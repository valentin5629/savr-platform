# Scénarios de test — M01 Réception ordres de collecte

**Source CDC** : `§06/M01` + `§05` R6.1 / R2.7 bis + `§04` (`collectes_tms`, `integrations_inbox`, `integrations_logs`) + `§08` E1/E2/E3/S11 (+ schémas `08 - savr-api-contracts`) + `§09` §16 RLS `integrations_*`
**Généré le** : 2026-06-05

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M01.
> Pour chaque scénario :
> - Couche `db` → écrire un test pgTAP dans `supabase/tests/`
> - Couche `api` → écrire un test Vitest dans `packages/tms/tests/api/` (Edge Function webhook)
> - Couche `ui` → écrire un test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. Les tests P2 et P3 sont non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture estimée |
|-----------|-------------|-------------------|
| Happy path | 4 | W1 (E1), W3 (E2), W4 (E3), notif M02 |
| Cas limites | 7 | nb_pax=0, coords ZD-IDF/AG, payload 256 KB, heure_collecte borne, cap retries 5 |
| Cas d'erreur | 10 | HMAC, JSON, schema_version, heure passée, UUID, champ requis absent, 404, modif tardive, heure rétrograde, champ non modifiable, DELETE terminée |
| Isolation RLS | 5 | manager_prestataire, chauffeur (deny) ; ops_savr, admin_tms (allow) ; write authenticated (deny) |
| Idempotence/états | 5 | dedup event_id, retry 500, out-of-order, ON CONFLICT inbox, rejet DLQ terminal |
| Cross-app | 7 | S11, association AG, re-confirmation (heure), nb_pax sans re-confirm, controle_acces notif, gap cold-start >24h / ≤24h |
| Migration | 0 | Hors scope V1 (voir section dédiée) |
| **TOTAL** | **38** | |

**Enum de référence `statut_dispatch` (6 valeurs, R6.1)** : `a_attribuer`, `attribuee_en_attente_acceptation`, `acceptee`, `en_attente_execution`, `rejetee_par_prestataire`, `annulee_par_traiteur`.
**Motifs DLQ (`dlq_motif`)** : `schema_invalide`, `validation_metier_echec`, `schema_version_divergence`, `ref_plateforme_manquante`, `erreur_technique`.
**En-têtes HTTP autoritatifs** : `X-API-Version: 2026.04` + signature HMAC. **Idempotence = champ `event_id` du corps** (dédup `integrations_inbox`, TTL 7j) — pas de header `Idempotency-Key` (aligné M02).

---

## Scénarios

### Catégorie 1 — Happy path (nominal)

```gherkin
# Source : §06/M01 W1 / §08 E1 / §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : reception_e1_collecte_zd_valide
  Étant donné une Plateforme qui pousse un webhook E1 `collecte.creee` signé HMAC valide
  Et un payload `data` complet (collecte_id, evenement_id, traiteur_id, traiteur_operationnel, programmateur, lieu, contacts, heure_collecte future, type_collecte="zd", nb_pax=120, controle_acces_requis=false)
  Et un en-tête `X-API-Version: 2026.04`
  Quand le webhook est reçu sur `POST /api/webhooks/collectes`
  Alors la réponse HTTP est `201 Created` avec `{"collecte_id": ..., "statut_tms": "recue"}`
  Et une ligne `collectes_tms` existe avec `statut_dispatch = 'a_attribuer'`
  Et `lieu_snapshot` est figé (JSONB non null) à partir du payload
  Et le trigger M12 T1 a écrit `suggestion_prestataire_id` + une ligne `suggestions_attribution_log` `trigger_source='T1_creation'`
  Et une ligne `integrations_logs` existe avec `statut='success'` et `retry_count=0`
  Et une notification M02 Ops Savr a été émise (toast + email)
```

```gherkin
# Source : §06/M01 W1 / §08 E1
# Couche : api
# Priorité : P3-nominal

Scénario : reception_e1_collecte_ag_valide
  Étant donné un webhook E1 `collecte.creee` valide avec `type_collecte="ag"` et `nb_pax=300`
  Quand le webhook est reçu
  Alors la réponse est `201 Created` et `collectes_tms.statut_dispatch = 'a_attribuer'`
  Et aucun `association_snapshot` n'est figé à ce stade (la destination AG arrive via E2 `association_attribuee`)
```

```gherkin
# Source : §06/M01 W3 / §08 E2 / M12 T3
# Couche : api
# Priorité : P1-critique

Scénario : patch_e2_modification_nb_pax_avant_acceptation
  Étant donné une collecte existante en TMS avec `statut_dispatch='a_attribuer'` et `nb_pax=120`
  Quand un webhook E2 `collecte.modifiee` arrive avec `diff.nb_pax = {ancien:120, nouveau:200}` et un `occurred_at` postérieur au `last_occurred_at`
  Alors la réponse est `200 OK`
  Et `collectes_tms.nb_pax = 200` et `last_occurred_at` est mis à jour
  Et M12 est ré-exécuté avec `trigger_source='T3_re_confirmation'`
  Et `re_confirmation_requise` reste `false` (collecte non encore acceptée)
```

```gherkin
# Source : §06/M01 W4 / §08 E3 / §05 R6.1
# Couche : api
# Priorité : P1-critique

Scénario : delete_e3_annulation_avant_attribution
  Étant donné une collecte avec `statut_dispatch='a_attribuer'`
  Quand un webhook E3 `collecte.annulee` valide est reçu (motif, annule_par_user_id, annule_le présents)
  Alors `collectes_tms.statut_dispatch = 'annulee_par_traiteur'`
  Et aucun coût n'est généré (0 € facturé)
  Et un audit log complet est écrit
```

---

### Catégorie 2 — Cas limites métier

```gherkin
# Source : §08 E1 schema (nb_pax minimum 0)
# Couche : api
# Priorité : P2-important

Scénario : e1_nb_pax_borne_basse_zero
  Étant donné un webhook E1 valide avec `nb_pax=0`
  Quand le webhook est reçu
  Alors la réponse est `201 Created` (0 est la borne basse valide du schéma)
```

```gherkin
# Source : §06/M01 W1 étape 4 / edge case 7.11
# Couche : api
# Priorité : P1-critique

Scénario : e1_zd_idf_sans_coords_gps
  Étant donné un webhook E1 valide `type_collecte="zd"` dont le `lieu` a un `code_postal` en Île-de-France et pas de `coordonnees_gps`
  Quand le webhook est reçu
  Alors la collecte est acceptée (`201`)
  Et `collectes_tms.coords_manquantes = false` (ZD IDF fonctionne sans coords précises)
  Et aucune alerte Ops coords n'est émise
```

```gherkin
# Source : §06/M01 W1 étape 4 / edge case 7.11 / §09 notif M02
# Couche : api
# Priorité : P1-critique

Scénario : e1_ag_sans_coords_gps_declenche_alerte
  Étant donné un webhook E1 valide `type_collecte="ag"` dont le `lieu` n'a pas de `coordonnees_gps`
  Quand le webhook est reçu
  Alors la collecte est acceptée (`201`) avec `coords_manquantes = true`
  Et une alerte Ops M02 de gravité `high` est émise (template `dispatch_coords_manquantes`)
```

```gherkin
# Source : §06/M01 edge case 7.12
# Couche : api
# Priorité : P2-important

Scénario : e1_coords_incoherentes_hors_france_metro
  Étant donné un webhook E1 valide avec `coordonnees_gps = {lat:0, lng:0}`
  Quand le webhook est reçu
  Alors la collecte est acceptée avec `coords_manquantes = true` (sanity check lat∈[41,51], lng∈[-5,10] FR métro échoue)
  Et une alerte Ops est émise
```

```gherkin
# Source : §06/M01 W1 étape 2 / D22 (256 KB)
# Couche : api
# Priorité : P2-important

Scénario : e1_payload_taille_borne_256ko
  Étant donné un webhook E1 valide dont le corps fait exactement 256 KB
  Quand le webhook est reçu
  Alors la collecte est acceptée (`201`) — la borne 256 KB est inclusive
  Et un webhook de 257 KB est rejeté `413` + DLQ motif `schema_invalide`
```

```gherkin
# Source : §06/M01 W1 étape 3 / C_M01_02 (règle heure unifiée)
# Couche : api
# Priorité : P1-critique

Scénario : e1_heure_collecte_borne_future_vs_passee
  Étant donné deux webhooks E1 par ailleurs identiques
  Quand le premier porte une `heure_collecte` 1 minute dans le futur
  Alors il est accepté (`201`)
  Et quand le second porte une `heure_collecte` 1 minute dans le passé
  Alors il est rejeté `422` + DLQ motif `validation_metier_echec`
```

```gherkin
# Source : §06/M01 W8 / D19 (cap 5 retries manuels)
# Couche : ui
# Priorité : P2-important

Scénario : dlq_cap_retries_manuels_5
  Étant donné un event en DLQ avec `retry_count_manual = 4`
  Quand l'Admin TMS clique "Rejouer" une 5e fois (échec à nouveau)
  Alors `retry_count_manual = 5`
  Et au 6e affichage le bouton "Rejouer" est grisé (seul "Rejeter définitivement" reste actif)
```

---

### Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M01 edge case 7.1 / §12bis m01_hmac_invalide
# Couche : api
# Priorité : P1-critique

Scénario : e1_signature_hmac_invalide
  Étant donné un webhook E1 dont la signature HMAC ne correspond pas au corps
  Quand le webhook est reçu
  Alors la réponse est `401` et l'event n'est PAS placé en DLQ (protection anti-pollution)
  Et `integrations_logs.erreur_code = 'auth_failed'`
  Et une alerte `critical` `m01_hmac_invalide` est émise par email
```

```gherkin
# Source : §06/M01 edge case 7.2
# Couche : api
# Priorité : P1-critique

Scénario : e1_json_malforme
  Étant donné un webhook E1 dont le corps n'est pas un JSON valide
  Quand le webhook est reçu
  Alors la réponse est `400` + DLQ motif `schema_invalide`
  Et une alerte Admin TMS `high` est émise
```

```gherkin
# Source : §06/M01 edge case 7.4 / D4 / §08 principe 5
# Couche : api
# Priorité : P1-critique

Scénario : e1_schema_version_divergente
  Étant donné un webhook E1 avec `X-API-Version: 2027.01` (version inconnue du TMS)
  Quand le webhook est reçu
  Alors la réponse est `422` + DLQ motif `schema_version_divergence`
  Et une alerte `critical` est émise
  Et l'event n'entre PAS dans le cycle de retry automatique (défaut de déploiement)
```

```gherkin
# Source : §06/M01 W1 étape 3
# Couche : api
# Priorité : P2-important

Scénario : e1_collecte_id_non_uuid
  Étant donné un webhook E1 dont `data.collecte_id` n'est pas un UUID valide
  Quand le webhook est reçu
  Alors la réponse est `400`
```

```gherkin
# Source : §08 E1 schema (required) / edge case 7.2
# Couche : api
# Priorité : P1-critique

Scénario : e1_champ_obligatoire_absent
  Étant donné un webhook E1 dont `data.controle_acces_requis` est absent
  Quand le webhook est reçu
  Alors la réponse est rejetée (`400`/`422`) + DLQ motif `schema_invalide`
  Et le message d'erreur nomme précisément le champ manquant
```

```gherkin
# Source : §06/M01 W3 étape 2
# Couche : api
# Priorité : P1-critique

Scénario : patch_e2_collecte_inconnue
  Étant donné un webhook E2 `collecte.modifiee` dont `collecte_id` n'existe pas en TMS
  Quand le webhook est reçu
  Alors la réponse est `404` + DLQ motif `ref_plateforme_manquante`
```

```gherkin
# Source : §06/M01 W3 étape 4 / edge case 7.13
# Couche : api
# Priorité : P1-critique

Scénario : patch_e2_sur_collecte_en_cours
  Étant donné une collecte avec `statut_operationnel='en_cours'`
  Quand un webhook E2 modifie `nb_pax`
  Alors la réponse est `422` + DLQ motif `validation_metier_echec` ("modification trop tardive")
  Et une alerte Admin TMS est émise pour investigation
```

```gherkin
# Source : §06/M01 W3 étape 4 / C_M01_02
# Couche : api
# Priorité : P2-important

Scénario : patch_e2_heure_collecte_retrograde
  Étant donné une collecte modifiable
  Quand un webhook E2 porte `diff.heure_collecte.nouveau` dans le passé
  Alors la réponse est `422` + DLQ motif `validation_metier_echec` ("heure_collecte rétrograde")
```

```gherkin
# Source : §08 E2 schema (additionalProperties false / champs non modifiables)
# Couche : api
# Priorité : P1-critique

Scénario : patch_e2_champ_non_modifiable
  Étant donné un webhook E2 dont le `diff` contient `type_collecte` (ou collecte_id/evenement_id/traiteur_id/lieu_id)
  Quand le webhook est reçu
  Alors la réponse est `422` (champ non modifiable rejeté par le schéma)
  Et aucune modification n'est appliquée en base
```

```gherkin
# Source : §06/M01 edge case 7.14
# Couche : api
# Priorité : P2-important

Scénario : delete_e3_collecte_deja_terminee
  Étant donné une collecte avec `statut_operationnel='realisee'`
  Quand un webhook E3 `collecte.annulee` est reçu
  Alors la réponse est `422` + log `warn`
  Et l'event n'est PAS placé en DLQ (aucune action à prendre)
```

---

### Catégorie 4 — Isolation données (RLS)

```gherkin
# Source : §09 §16 RLS integrations_logs/inbox (staff read only)
# Couche : db
# Priorité : P1-critique

Scénario : rls_manager_prestataire_deny_read_integrations_logs
  Étant donné un utilisateur `manager_prestataire` (Strike) authentifié
  Quand il exécute `SELECT * FROM tms.integrations_logs`
  Alors aucune ligne n'est retournée (policy `staff_read` exige `auth.user_is_staff()`)
```

```gherkin
# Source : §09 §16 RLS integrations_inbox
# Couche : db
# Priorité : P1-critique

Scénario : rls_chauffeur_deny_read_integrations_inbox
  Étant donné un utilisateur `chauffeur` authentifié
  Quand il exécute `SELECT * FROM tms.integrations_inbox`
  Alors aucune ligne n'est retournée
```

```gherkin
# Source : §09 §16 RLS (auth.user_is_staff = ops_savr + admin_tms)
# Couche : db
# Priorité : P1-critique

Scénario : rls_ops_savr_allow_read_integrations_logs
  Étant donné un utilisateur `ops_savr` authentifié
  Quand il exécute `SELECT * FROM tms.integrations_logs`
  Alors les lignes sont retournées (staff autorisé en lecture)
```

```gherkin
# Source : §09 §16 RLS / §06/M01 E1-E2 (UI Admin TMS only)
# Couche : db
# Priorité : P3-nominal

Scénario : rls_admin_tms_allow_read_integrations_inbox
  Étant donné un utilisateur `admin_tms` authentifié
  Quand il exécute `SELECT * FROM tms.integrations_inbox`
  Alors les lignes sont retournées
```

```gherkin
# Source : §09 §16 (écriture = service_role only, pas de policy authenticated)
# Couche : db
# Priorité : P1-critique

Scénario : rls_authenticated_deny_write_integrations_inbox
  Étant donné un utilisateur `admin_tms` authentifié (rôle le plus élevé côté client)
  Quand il exécute `INSERT INTO tms.integrations_inbox (...)`
  Alors l'opération est refusée (aucune policy INSERT pour `authenticated` → deny par défaut, écriture réservée `service_role`)
```

---

### Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M01 §1 / §08 principe 2 / edge case 7.5
# Couche : api
# Priorité : P1-critique

Scénario : e1_event_id_rejoue_dedup
  Étant donné un webhook E1 déjà traité avec succès pour `event_id = X` (champ du corps)
  Quand le même `event_id = X` est repoussé (TTL inbox 7j non expiré)
  Alors la réponse est `200 OK` + `{"status":"already_processed"}`
  Et aucune nouvelle ligne `collectes_tms` n'est créée
  Et `integrations_logs` enregistre `statut='skipped_duplicate'`
  Et aucune alerte n'est émise
```

```gherkin
# Source : §06/M01 edge case 7.6 / §08 principe 4 (retry)
# Couche : api
# Priorité : P1-critique

Scénario : e1_retry_apres_erreur_500_sans_doublon
  Étant donné un webhook E1 dont le 1er traitement a commité en DB mais dont l'ACK a échoué (timeout)
  Quand la Plateforme rejoue le même `event_id` au palier de retry suivant
  Alors le dedup `integrations_inbox` court-circuite le traitement
  Et il n'existe qu'une seule ligne `collectes_tms` pour cette collecte (zéro double dispatch)
```

```gherkin
# Source : §06/M01 W3 étape 3 / D18 (sérialisation occurred_at)
# Couche : api
# Priorité : P1-critique

Scénario : e2_out_of_order_ignore
  Étant donné une collecte avec `last_occurred_at = T2`
  Quand un webhook E2 arrive avec `occurred_at = T1` (T1 < T2)
  Alors la réponse est `200 OK` avec log `statut='skipped_out_of_order'`
  Et aucune modification n'est appliquée à la collecte
```

```gherkin
# Source : §06/M01 W8 / D20 / §12bis (S11)
# Couche : api
# Priorité : P1-critique

Scénario : dlq_rejet_definitif_terminal_irreversible
  Étant donné un event `collecte.*` en DLQ
  Quand l'Admin TMS "Rejette définitivement" avec un commentaire ≥10 caractères
  Alors `integrations_logs.statut = 'rejected_manual'` (état terminal)
  Et un webhook sortant S11 `tms/collecte-rejetee` est émis vers la Plateforme
  Et toute tentative ultérieure de reprise de cet event est refusée (lecture seule, badge "Rejeté définitivement")
```

```gherkin
# Source : §06/M01 edge case 7.5 / §08 principe 2
# Couche : db
# Priorité : P2-important

Scénario : inbox_insert_on_conflict_do_nothing
  Étant donné une ligne `integrations_inbox` existante pour `event_id = X`
  Quand un `INSERT ... ON CONFLICT DO NOTHING` est tenté pour le même `event_id = X`
  Alors aucune ligne n'est dupliquée (contrainte d'unicité event_id respectée)
```

---

### Catégorie 6 — Scénarios cross-app (Plateforme ↔ TMS)

```gherkin
# Source : §08 S11 / §06/M01 W8 / D20
# Couche : api
# Priorité : P1-critique

Scénario : s11_collecte_rejetee_notifie_plateforme
  Étant donné un event de type `collecte.creee` rejeté définitivement en DLQ par l'Admin TMS
  Quand le backend émet S11 `tms/collecte-rejetee` avec `{event_id_tms_source, collecte_id, motif_dlq, commentaire_admin, rejete_par_admin_id, rejete_at}`
  Alors la Plateforme passe la collecte en `statut_tms='rejetee_par_tms'`
  Et une alerte Admin Plateforme + bannière dashboard sont déclenchées
```

```gherkin
# Source : §06/M01 W3 étape 5 (association_attribuee AG)
# Couche : api
# Priorité : P2-important

Scénario : e2_association_attribuee_ag_push_silencieux
  Étant donné une collecte AG `statut_dispatch='acceptee'`
  Quand un webhook E2 porte `diff.association_attribuee.nouveau` (destination de livraison des excédents)
  Alors `collectes_tms.association_snapshot` est figé avec l'objet reçu
  Et `re_confirmation_requise` reste `false` (champ non sensible, push silencieux)
  Et AUCUNE notification de re-confirmation prestataire n'est émise
```

```gherkin
# Source : §06/M01 W3 étape 7 / §08 E2 (date/heure_collecte) / D6 / arbitrage 6
# Couche : api
# Priorité : P1-critique

Scénario : e2_modification_heure_post_acceptation_declenche_reconfirmation
  Étant donné une collecte avec `statut_dispatch='acceptee'`
  Quand un webhook E2 modifie `diff.heure_collecte` (ou `diff.date_collecte`)
  Alors `collectes_tms.re_confirmation_requise = true` et `statut_dispatch` repasse à `attribuee_en_attente_acceptation`
  Et un badge "Modifiée — re-confirm" est exposé côté M02 et M03
  Et le manager prestataire reçoit une notification "Collecte modifiée, merci de re-confirmer"
```

```gherkin
# Source : §06/M01 W3 étape 6+7 / §08 E2 (nb_pax push silencieux) — arbitrage Val 2026-06-05
# Couche : api
# Priorité : P1-critique

Scénario : e2_modification_nb_pax_post_acceptation_sans_reconfirmation
  Étant donné une collecte avec `statut_dispatch='acceptee'`
  Quand un webhook E2 modifie uniquement `diff.nb_pax`
  Alors `collectes_tms.nb_pax` est mis à jour
  Et `re_confirmation_requise` reste `false` et `statut_dispatch` reste `acceptee` (pas de réacceptation)
  Et M12 est ré-exécuté (`trigger_source='T3_re_confirmation'`, suggestion interne Ops)
  Et AUCUNE notification de re-confirmation n'est envoyée au prestataire
```

```gherkin
# Source : §06/M01 W3 étape 7 / §08 E2 (controle_acces_requis notification simple) — arbitrage Val 2026-06-05
# Couche : api
# Priorité : P2-important

Scénario : e2_controle_acces_requis_active_notification_simple
  Étant donné une collecte avec `statut_dispatch='acceptee'` et `controle_acces_requis=false`
  Quand un webhook E2 porte `diff.controle_acces_requis = {ancien:false, nouveau:true}`
  Alors `collectes_tms.controle_acces_requis = true`
  Et `re_confirmation_requise` reste `false` (pas de réacceptation)
  Et le manager prestataire reçoit une notification simple "contrôle d'accès désormais requis — pré-saisir plaque + chauffeur en M03 E4"
```

```gherkin
# Source : §06/M01 W5 / edge case 7.8-7.9 / §12bis m01_webhook_gap_critical
# Couche : api
# Priorité : P1-critique

Scénario : cold_start_gap_superieur_24h_alerte_critical
  Étant donné un TMS qui redémarre après un downtime
  Et `MAX(occurred_at)` dans `integrations_logs` qui date de plus de 24h
  Quand l'Edge Function `on_startup` calcule le gap
  Alors une alerte `critical` `m01_webhook_gap_critical` est émise (intervention manuelle / ré-émission Plateforme)
  Et aucun rattrapage automatique n'est lancé (polling supprimé V1)
```

```gherkin
# Source : §06/M01 W5 / edge case 7.7
# Couche : api
# Priorité : P2-important

Scénario : cold_start_gap_inferieur_24h_aucune_action
  Étant donné un TMS qui redémarre avec un gap ≤ 24h
  Quand l'Edge Function `on_startup` calcule le gap
  Alors aucune alerte n'est émise
  Et le rattrapage est assuré passivement par le retry natif Plateforme (≤24h) + dédup `integrations_inbox`
```

---

### Catégorie 7 — Scénarios de migration (Bubble + MTS-1 → Supabase)

**Hors scope V1 pour M01.** M01 est le point d'entrée webhook runtime du TMS : il ne consomme aucune donnée historique Bubble/MTS-1. Les tables qu'il alimente (`collectes_tms`) sont peuplées en production exclusivement par les webhooks E1/E2/E3 émis par la Plateforme une fois celle-ci en service. La migration des collectes historiques (s'il y en a) relève du périmètre `04 - Migration` côté collectes Plateforme, pas de l'ingress TMS. Les tables `integrations_inbox` / `integrations_logs` démarrent vides (rétention 7j / 2 ans, aucun antécédent à importer).

Scénarios de réconciliation migration à générer lors de la passe `cdc-migration-data` si un import de collectes legacy est décidé.

---

## Scénarios hors scope (à générer en V1.1)

- **Sanity check coords réseau-routier** : V1 se limite au check borne FR métro (lat∈[41,51], lng∈[-5,10]). Le check réseau-routier est V2 (QO §12 M01).
- **Motifs DLQ complémentaires** (`traiteur_inconnu`, `evenement_annule_deja`) : à ajouter à l'enum si le volume observé le justifie (V1.1, QO §12 M01).
- **Geocoding fallback API externe** : si `coords_manquantes` > 5% après 3 mois (QO §12 M01).
- **E5 `PATCH /lieux/:id`** (notif seule, snapshot divergent) : couplé à M02 (bandeau "Synchroniser snapshot"). Scénarios à générer avec M02 plutôt qu'avec M01 (M01 n'applique aucune mutation rétroactive).

---

## ⚠ Specs floues à figer AVANT implémentation

1. — **RÉSOLU 2026-06-05 (arbitrage Val : règle supprimée)**. Aucun plafond métier nb_pax. Seule la borne `minimum: 0` du schéma E1 s'applique (un nb_pax négatif est rejeté en amont comme `schema_invalide`). Mention `nb_pax > max` retirée du motif DLQ et de l'edge case 7.3 dans M01. Scénario `e1_nb_pax_hors_borne_haute` supprimé.
2. — **RÉSOLU 2026-06-05 (arbitrage Val : Trust, M01 D25)**. M01 stocke les deux valeurs sans contrôler leur égalité (invariant garanti à la source, et destiné à diverger en V2). Aucun scénario d'erreur dédié — pas de validation côté ingress.
3. — **RÉSOLU 2026-06-05 (arbitrage Val, aligné §08 E2 canonique)**. Réacceptation prestataire (`re_confirmation_requise=true`) **uniquement** sur `date_collecte` / `heure_collecte`. `nb_pax` retiré (→ re-run M12 interne seul, push silencieux prestataire). `controle_acces_requis` passe à `true` → **notification simple** au manager (pré-saisir plaque), sans réacceptation. `informations_supplementaires` / `contacts` / `association_attribuee` → push 100 % silencieux. `lieu` non concerné (non modifiable au PATCH E2).
