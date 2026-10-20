# Scénarios de test — M11 Alerting transverse

**Source CDC** : §06/M11 + §05 R_M11.1-R_M11.11 + §04 addendum §11 (`alertes`, `alertes_catalogue`, `alertes_archive_critical`) + §09 RLS §13.4
**Généré le** : 2026-06-07

> **Instructions Claude Code** : ces scénarios sont la source de vérité pour les tests du module M11.
> Pour chaque scénario :
> - Couche `db` → test pgTAP dans `supabase/tests/`
> - Couche `api` → test Vitest dans `packages/tms/tests/api/`
> - Couche `ui` → test Playwright dans `packages/tms/tests/e2e/`
> Les tests P1-critique sont bloquants CI. P2/P3 non-bloquants V1.
> Ne pas démarrer le développement du module sans avoir écrit les tests P1 d'abord.

> **Périmètre API** : M11 est **100% interne TMS V1**. Aucun endpoint E1-E6 / S1-S11 — la catégorie 6 est **vide et justifiée** : les alertes liées aux flux cross-app (`m01_dlq_event_rejected`, `m01_push_plateforme_dlq`, `m04_evenement_dlq`, `m14_everest_*`) sont émises par leurs modules respectifs et testées dans M01/M04/M14 (EC18 — la Plateforme a sa propre supervision, hors scope).
>
> **Périmètre migration** : catégorie 7 hors scope — `tms.alertes` et `tms.alertes_catalogue` sont des tables neuves sans équivalent MTS-1, peuplées par seed (catalogue 60 lignes §11.7). Les codes `m13_migration_*` appartiennent au périmètre M13. Le seed catalogue est testé en cat. 2/3 (EC17).

---

## Résumé de couverture

| Catégorie | Nb scénarios | Couverture |
|-----------|-------------|------------|
| 1. Happy path | 10 | W1, W2, W3 (in-app + email), W4, W5 + cron unsnoozer, W6, W7, W9, R_M11.10 |
| 2. Cas limites métier | 9 | Debounce 300s borné (R_M11.3), motif snooze ≥10 car, durées {1,4,24}, rétention 3 ans, dedup entity NULL, override criticité, merge payload |
| 3. Cas d'erreur | 9 | EC1/EC2-ALERT001-002, EC4, EC5, EC8 anti-boucle, EC9, EC13, EC17, snooze sur résolue |
| 4. Isolation RLS | 9 | staff vs manager_prestataire vs chauffeur, INSERT/DELETE deny, R_M11.11 colonnes immuables, catalogue admin-only, archive read-only |
| 5. Idempotence & états | 9 | Double ack (B2), `resolue` terminal, R_M11.7, EC11, EC12/R_M11.2, unsnooze reset ack, 3 CHECK, réactivation code |
| 6. Cross-app | 0 | N/A — M11 interne TMS (DLQ cross-app testées M01/M04/M14) |
| 7. Migration | 0 | N/A — tables neuves, seed testé en cat. 2/3 |
| **TOTAL** | **46** | |

**5 specs floues TRANCHÉES Val 2026-06-07 + propagées (M11 + §04 + §09).** Voir section finale.

---

## Catégorie 1 — Happy path

```gherkin
# Source : §06/M11 W1 + W3 matrice §5.1
# Couche : db + api
# Priorité : P1-critique
Scénario : emit_warning_cree_alerte_ouverte_inapp_sans_email
  Étant donné le code 'm08_facture_ecart_detecte' seedé actif criticite_par_defaut='warning' destinataires {"roles":["ops_savr"]}
  Et 2 users ops_savr actifs
  Quand tms.alerte_emit('m08_facture_ecart_detecte', 'facture_prestataire', <uuid>, '{"ecart": 50.00}') est appelée
  Alors une ligne tms.alertes est créée statut='ouverte', criticite='warning', occurrences=1, destinataires_user_ids = les 2 ops
  Et l'alerte apparaît dans le SELECT cloche des 2 ops (statut IN ('ouverte','snoozee') AND ackee_at IS NULL)
  Et aucun email n'est inséré dans email_queue_tms (warning = in-app only, matrice §5.1)
```

```gherkin
# Source : §06/M11 W3 §5.2
# Couche : db + api
# Priorité : P1-critique
Scénario : emit_critical_envoie_email_resend_destinataires
  Étant donné le code 'm07_horaires_manquants' seedé actif criticite='critical' destinataires {"roles":["ops_savr","admin_tms"]}
  Quand tms.alerte_emit('m07_horaires_manquants', 'tournee', <uuid>, '{"prestataire":"Strike"}') est appelée
  Alors l'alerte est créée et 1 entrée email_queue_tms template 'alerte_critical_v1' est insérée par destinataire
  Et l'objet email = '[Savr TMS / Critical] <titre>' avec reply-to ops@gosavr.io
```

```gherkin
# Source : §06/M11 W2 (étapes 1-3, 5-6)
# Couche : db
# Priorité : P1-critique
Scénario : routage_roles_users_extras_distinct
  Étant donné un catalogue destinataires_par_defaut {"roles":["ops_savr"],"users":["<user_X>"],"manager_prestataire_scope":"none"}
  Et user_X a aussi le rôle ops_savr (présent deux fois : via rôle + via users explicites)
  Quand alerte_emit est appelée avec p_destinataires_extra = [<user_Y>]
  Alors destinataires_user_ids = {ops actifs} ∪ {user_X} ∪ {user_Y} sans doublon (DISTINCT)
  Et les users_tms archivés avec rôle ops_savr sont exclus de la résolution
```

```gherkin
# Source : §06/M11 W2 étape 4 / R_M11.8
# Couche : db
# Priorité : P1-critique
Scénario : routage_manager_prestataire_scope_entity
  Étant donné un code catalogue avec manager_prestataire_scope='entity'
  Et une tournée appartenant au prestataire "Strike" qui a 2 managers actifs et 1 manager archivé
  Quand alerte_emit(code, 'tournee', tournee_id, ...) est appelée
  Alors les 2 managers actifs Strike sont ajoutés à destinataires_user_ids
  Et le manager archivé n'y figure pas
```

```gherkin
# Source : §06/M11 W4 (Bloc 6 B2)
# Couche : db + api
# Priorité : P1-critique
Scénario : ack_metadata_statut_reste_ouverte
  Étant donné une alerte statut='ouverte', ackee_at IS NULL, et une Ops destinataire connectée
  Quand tms.m11_ack(alerte_id) est appelée
  Alors ackee_par_user_id = ops_id et ackee_at = now() — le statut reste 'ouverte'
  Et un tms.audit_logs (entity_type='alerte', row_id=alerte_id, action='M11_ACK') est inséré
  Et l'alerte disparaît du badge cloche (compte uniquement ackee_at IS NULL) mais reste dans le KPI 'Ouvertes' E1
```

```gherkin
# Source : §06/M11 W5 + cron m11_unsnoozer §11.6
# Couche : db
# Priorité : P1-critique
Scénario : snooze_4h_puis_unsnooze_cron
  Étant donné une alerte warning 'ouverte' et une Ops destinataire
  Quand tms.m11_snooze(alerte_id, 4, NULL) est appelée
  Alors statut='snoozee', snoozee_jusqu_a = now()+4h, audit_log 'M11_SNOOZE' inséré
  Quand snoozee_jusqu_a est dépassé et que le cron m11_unsnoozer s'exécute
  Alors statut repasse 'ouverte'
```

```gherkin
# Source : §06/M11 W6
# Couche : db + api
# Priorité : P1-critique
Scénario : resolution_manuelle_avec_motif
  Étant donné une alerte 'ouverte' non ackée et une Ops staff connectée
  Quand tms.m11_resoudre_manuel(alerte_id, 'grille corrigée chez Strike') est appelée
  Alors statut='resolue', resolue_source='manuel', resolue_par_user_id, resolue_at renseignés
  Et audit_log 'M11_RESOLVE_MANUEL' avec contexte {motif} inséré
  Et l'ack préalable n'est PAS requis (règle §7)
```

```gherkin
# Source : §06/M11 W7 / exemple m10_bac_satur
# Couche : db
# Priorité : P1-critique
Scénario : resolution_auto_trigger_disparu
  Étant donné une alerte 'm10_bac_satur' (entity stocks_bacs_entrepot:X) statut='ouverte'
  Quand le passage Veolia passe à 'realise' et que trg_m10_reset_total_pleins appelle alerte_resoudre_auto('m10_bac_satur', 'stocks_bacs_entrepot', X, 'passage_veolia_realise')
  Alors l'alerte passe statut='resolue', resolue_source='auto', resolue_raison='passage_veolia_realise'
  Et audit_log 'M11_RESOLVE_AUTO' inséré, aucune notification émise (résolution silencieuse)
```

```gherkin
# Source : §06/M11 W9 / R_M11.4 / EC2
# Couche : db + api
# Priorité : P1-critique
Scénario : mute_code_silence_total_historique_conserve
  Étant donné le code 'm14_everest_timeout' avec 3 alertes historiques et un Admin TMS sur E4
  Quand il clique "Désactiver" (active=false, desactive_motif renseigné)
  Alors tout appel ultérieur alerte_emit('m14_everest_timeout', ...) RETOURNE NULL sans INSERT ni exception
  Et les 3 alertes historiques restent visibles dans E1
```

```gherkin
# Source : §06/M11 R_M11.10 / cron m11_purger_archives §11.6
# Couche : db
# Priorité : P2-important
Scénario : purge_mensuelle_dump_critical_puis_delete
  Étant donné 1 alerte critical 'resolue' avec resolue_at = now() - 3 ans - 1 jour et 1 alerte warning idem
  Quand le cron m11_purger_archives s'exécute
  Alors la critical est copiée dans tms.alertes_archive_critical AVANT suppression
  Et les 2 alertes (critical + warning) sont supprimées de tms.alertes
  Et la warning n'apparaît PAS dans l'archive (dump critical only)
```

---

## Catégorie 2 — Cas limites métier

```gherkin
# Source : §05 R_M11.3 / W1 step 2 / D6
# Couche : db
# Priorité : P1-critique
Scénario : debounce_meme_cle_sous_300s_incremente_occurrences
  Étant donné m11.debounce_seconds = 300 et une alerte (code C, entity E) émise à T0, occurrences=1
  Quand alerte_emit(C, E) est rappelée à T0 + 299s
  Alors AUCUNE nouvelle ligne tms.alertes — la même alerte a occurrences=2, derniere_occurrence_at mis à jour
  Et AUCUNE nouvelle notification (ni in-app supplémentaire ni email)
  Et le retour de la fonction = id de l'alerte existante
```

```gherkin
# Source : §05 R_M11.3
# Couche : db
# Priorité : P1-critique
Scénario : debounce_meme_cle_apres_300s_nouvelle_alerte
  Étant donné la même alerte (code C, entity E) émise à T0
  Quand alerte_emit(C, E) est rappelée à T0 + 301s
  Alors une NOUVELLE ligne tms.alertes est créée (occurrences=1) avec ses notifications
```

```gherkin
# Source : §06/M11 W1 step 2 (dedup hors fenêtre par statut)
# Couche : db
# Priorité : P1-critique
Scénario : debounce_ignore_alertes_resolues
  Étant donné une alerte (code C, entity E) émise à T0 puis résolue à T0+60s
  Quand alerte_emit(C, E) est rappelée à T0+120s (dans la fenêtre 300s)
  Alors une NOUVELLE alerte est créée — la dédup ne matche que statut IN ('ouverte','snoozee')
```

```gherkin
# Source : §06/M11 W1 (v_dedup_key COALESCE)
# Couche : db
# Priorité : P2-important
Scénario : dedup_entity_null_par_code_seul
  Étant donné le code transverse 'integration_ocr_mistral_down' émis sans entity (NULL, NULL)
  Quand il est émis 2 fois en moins de 300s
  Alors une seule alerte existe avec dedup_key = 'integration_ocr_mistral_down::' et occurrences=2
```

```gherkin
# Source : §06/M11 W5 / paramètre m11.snooze_motif_min_car_critical
# Couche : api + db
# Priorité : P1-critique
Scénario : snooze_critical_motif_borne_10_caracteres
  Étant donné une alerte criticite='critical' ouverte
  Quand m11_snooze(id, 1, 'attente rea') est appelée (motif 11 caractères ≥ 10)
  Alors le snooze passe
  Quand m11_snooze est appelée sur une autre alerte critical avec motif 'trop court' tronqué à 9 caractères
  Alors rejet avec erreur explicite motif insuffisant
  Et pour une alerte 'warning', le snooze sans motif passe (motif optionnel)
```

```gherkin
# Source : §06/M11 W5 / EC6 (durées hardcodées RPC — F4 tranché 2026-06-07, paramètre supprimé)
# Couche : api
# Priorité : P1-critique
Scénario : snooze_durees_strictes_1_4_24
  Étant donné une alerte warning ouverte
  Quand m11_snooze est appelée avec duree_heures = 24
  Alors le snooze passe (borne max incluse)
  Quand m11_snooze est appelée avec duree_heures = 2, puis 25
  Alors rejet dans les 2 cas (liste hardcodée {1,4,24} dans la RPC, message "Snooze max 24h" pour 25)
  Et aucune ligne parametres_tms 'm11.snooze_durees_autorisees' n'existe (paramètre supprimé F4)
```

```gherkin
# Source : §05 R_M11.10 / D8
# Couche : db
# Priorité : P2-important
Scénario : retention_borne_exacte_3_ans
  Étant donné une alerte resolue_at = now() - 3 ans + 1 jour et une autre resolue_at = now() - 3 ans - 1 jour
  Et une alerte 'ouverte' émise il y a 4 ans (jamais résolue)
  Quand le cron m11_purger_archives s'exécute
  Alors seule la résolue > 3 ans est purgée
  Et l'alerte 'ouverte' de 4 ans est CONSERVÉE (R_M11.6 — purge sur resolue uniquement)
```

```gherkin
# Source : §06/M11 W1 (p_criticite_override) / R_M11.2
# Couche : db
# Priorité : P2-important
Scénario : override_criticite_emission
  Étant donné le code 'm05_signalement_incident' criticite_par_defaut='warning'
  Quand alerte_emit est appelée avec p_criticite_override='critical' (catégorie bloquante acces_refuse)
  Alors l'alerte est créée criticite='critical' et l'email Resend part (matrice critical)
```

```gherkin
# Source : §06/M11 W1 dedup hit (payload merge) / EC7
# Couche : db
# Priorité : P3-nominal
Scénario : dedup_merge_dernier_payload_et_affichage_compteur
  Étant donné une alerte avec payload initial {"a":1}
  Quand un dedup hit arrive avec p_payload {"a":2}
  Alors payload contient la clé 'dernier_payload' = {"a":2} (payload initial conservé)
  Et E1 affiche 'titre (xN)' quand occurrences > 10
```

---

## Catégorie 3 — Cas d'erreur métier

```gherkin
# Source : §06/M11 EC1 / R_M11.1
# Couche : db
# Priorité : P1-critique
Scénario : code_inconnu_alert001_rollback_transaction
  Étant donné un code 'm99_typo_dev' absent de alertes_catalogue
  Quand un trigger métier appelle alerte_emit('m99_typo_dev', ...) au sein d'une transaction
  Alors exception ERRCODE 'ALERT001' levée
  Et la transaction appelante est rollback (l'écriture métier underlying n'est pas commitée)
```

```gherkin
# Source : §06/M11 EC3 / R_M11.5
# Couche : db
# Priorité : P1-critique
Scénario : code_supprime_alert002
  Étant donné un code avec supprime_at IS NOT NULL
  Quand alerte_emit est appelée avec ce code
  Alors exception ERRCODE 'ALERT002' (pas de zombie silencieux)
```

```gherkin
# Source : §06/M11 EC5 / W4 contraintes
# Couche : api + db
# Priorité : P1-critique
Scénario : ack_sur_alerte_resolue_rejet
  Étant donné une alerte statut='resolue'
  Quand m11_ack(alerte_id) est appelée
  Alors erreur 'alerte_non_ackable' retournée avec le statut courant
  Et ackee_at reste NULL
```

```gherkin
# Source : §06/M11 W5 contraintes + §7 transitions
# Couche : api + db
# Priorité : P1-critique
Scénario : snooze_sur_alerte_resolue_rejet
  Étant donné une alerte statut='resolue'
  Quand m11_snooze(alerte_id, 1, NULL) est appelée
  Alors rejet — aucune transition depuis 'resolue' (terminal V1)
```

```gherkin
# Source : §06/M11 EC13 + W4 (F5 tranché 2026-06-07 : ack/snooze staff only)
# Couche : db (pgTAP RLS) + api
# Priorité : P1-critique
Scénario : ack_reserve_au_staff
  Étant donné un chauffeur connecté et une alerte dont il n'est pas destinataire
  Quand m11_ack(alerte_id) est appelée sous son identité
  Alors rejet (rôle ∉ {ops_savr, admin_tms, admin_savr})
  Et un manager_prestataire DESTINATAIRE de l'alerte ne peut pas non plus acker ni snoozer (F5 : SELECT only, policy alertes_staff_update)
  Et une Ops NON destinataire peut acker (ack au nom de l'équipe — EC13)
  Et un admin_savr peut acker et résoudre (F1 : staff complet, ex-« lecture seule » E1 retiré)
```

```gherkin
# Source : §06/M11 EC8 / code m11_notification_email_failed
# Couche : api
# Priorité : P1-critique
Scénario : resend_down_alerte_meta_sans_email_anti_boucle
  Étant donné Resend en échec (mock 500)
  Quand une alerte critical est émise
  Alors l'alerte originale est créée normalement et reste visible in-app
  Et une alerte 'm11_notification_email_failed' (critical) est émise vers Admin TMS en in-app UNIQUEMENT (aucune tentative email — anti-boucle infinie)
  Et l'échec est tracé dans integrations_logs (contrat W1 "jamais bloquant")
```

```gherkin
# Source : §06/M11 EC9
# Couche : db
# Priorité : P1-critique
Scénario : emission_dans_transaction_rollback_pas_orpheline
  Étant donné une transaction métier qui appelle alerte_emit avec succès puis échoue plus loin
  Quand la transaction rollback
  Alors aucune ligne tms.alertes n'existe (INSERT rollback avec la transaction — comportement voulu)
```

```gherkin
# Source : §06/M11 EC4
# Couche : db + api
# Priorité : P2-important
Scénario : destinataires_tous_archives_alerte_reste_ouverte
  Étant donné une alerte dont tous les destinataires sont archivés entre émission et dispatch notif
  Quand le service de notification filtre les destinataires à T+ε
  Alors aucune notification n'est délivrée mais l'alerte reste statut='ouverte' (pas d'auto-résolution)
  Et le cas reste visible dans E1 pour investigation Admin (signal catalogue mal configuré)
```

```gherkin
# Source : §06/M11 EC17
# Couche : db (pgTAP CI)
# Priorité : P1-critique
Scénario : catalogue_couvre_tous_les_codes_emis
  Étant donné l'ensemble des appels alerte_emit('xxx', ...) présents dans le code (migrations, triggers, services)
  Quand le pgTAP de réconciliation catalogue s'exécute en CI
  Alors chaque code utilisé existe dans alertes_catalogue (seed 60 lignes §11.7, dont 2 active=false)
  Et le test échoue si un PR introduit un émetteur sans seed catalogue
```

---

## Catégorie 4 — Isolation RLS

```gherkin
# Source : §09 §13.4 / §06/M11 §2
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : staff_voit_toutes_alertes
  Étant donné des alertes dont ops_user n'est PAS destinataire
  Quand ops_savr, admin_tms et admin_savr exécutent SELECT sur tms.alertes
  Alors les 3 rôles voient toutes les alertes (policy staff)
```

```gherkin
# Source : §09 §13.4 (manager destinataires_user_ids)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : manager_prestataire_ne_voit_que_ses_alertes
  Étant donné une alerte A1 avec manager Strike dans destinataires_user_ids et une alerte A2 destinée au manager Marathon
  Quand le manager Strike exécute SELECT sur tms.alertes
  Alors il voit A1 et ne voit PAS A2 (cloisonnement cross-prestataire)
```

```gherkin
# Source : §09 §13.4 / §06/M11 §2 (chauffeur non concerné)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : chauffeur_aucun_acces_alertes
  Étant donné un chauffeur authentifié
  Quand il exécute SELECT sur tms.alertes et tms.alertes_catalogue
  Alors 0 ligne retournée dans les 2 cas (aucune policy chauffeur M11)
```

```gherkin
# Source : §09 §13.4 (INSERT via SECURITY DEFINER uniquement)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : insert_direct_alertes_deny_meme_staff
  Étant donné un admin_tms authentifié
  Quand il tente INSERT INTO tms.alertes directement (hors fonction alerte_emit)
  Alors l'INSERT est refusé par RLS — seules les fonctions SECURITY DEFINER insèrent
```

```gherkin
# Source : §05 R_M11.11 (trigger BEFORE UPDATE colonnes immuables)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : update_colonnes_immuables_bloque
  Étant donné une alerte existante et un admin_tms
  Quand il tente UPDATE de code, criticite, emise_at, entity_type, entity_id ou dedup_key
  Alors le trigger BEFORE UPDATE lève exception pour chacune
  Et l'incrément occurrences par le debounce W1 et la résolution auto W7 restent autorisés (exceptions du trigger)
```

```gherkin
# Source : §09 §13.4 (pas de DELETE user)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : delete_alertes_deny_tous_roles
  Quand ops_savr, admin_tms, admin_savr et manager_prestataire tentent DELETE sur tms.alertes
  Alors refusé pour les 4 — la purge passe uniquement par service_role (cron R_M11.10)
```

```gherkin
# Source : §09 §13.4 / E4
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : catalogue_ecriture_admin_tms_uniquement
  Étant donné le catalogue alertes_catalogue
  Quand admin_tms UPDATE criticite_par_defaut d'un code
  Alors OK
  Quand ops_savr tente le même UPDATE (E4 lecture seule) ou un INSERT
  Alors refusé par RLS
```

```gherkin
# Source : §05 R_M11.10 (archive append-only, RLS admin_tms read-only)
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : archive_critical_admin_read_only
  Étant donné tms.alertes_archive_critical peuplée par le cron
  Quand admin_tms SELECT → OK ; admin_tms INSERT/UPDATE/DELETE → refusé
  Et ops_savr SELECT → refusé (admin_tms read-only seul)
```

```gherkin
# Source : §06/M11 §12.4 cloche / §5.3
# Couche : db (pgTAP)
# Priorité : P2-important
Scénario : badge_cloche_filtre_destinataires_et_ack
  Étant donné 3 alertes : A (ops destinataire, non ackée), B (ops destinataire, ackée), C (ops non destinataire)
  Quand la requête cloche s'exécute sous l'identité ops (auth.uid() = ANY(destinataires_user_ids) AND statut IN ('ouverte','snoozee') AND ackee_at IS NULL)
  Alors le badge compte 1 (A uniquement)
```

---

## Catégorie 5 — Idempotence et états

```gherkin
# Source : §06/M11 W4 (Bloc 6 B2) / pgTAP test_m11_ack_idempotent_no_error
# Couche : db + api
# Priorité : P1-critique
Scénario : double_ack_idempotent_silencieux
  Étant donné une alerte déjà ackée (ackee_at IS NOT NULL, statut='ouverte')
  Quand un second m11_ack est appelé (même user ou autre staff)
  Alors retour silencieux SANS erreur, ackee_par_user_id/ackee_at INCHANGÉS (premier ack conservé)
  Et aucun second audit_log M11_ACK n'est inséré
```

```gherkin
# Source : §06/M11 §7 (resolue terminal)
# Couche : db
# Priorité : P1-critique
Scénario : resolue_terminal_aucune_reouverture
  Étant donné une alerte statut='resolue'
  Quand on tente ack, snooze, résolution manuelle à nouveau, ou UPDATE statut='ouverte' direct
  Alors les 4 tentatives échouent — resolue → * impossible V1 (RPC m11_rouvrir_alerte = V2)
```

```gherkin
# Source : §05 R_M11.7
# Couche : db
# Priorité : P1-critique
Scénario : resoudre_auto_idempotente
  Étant donné 2 alertes ouvertes même (code, entity) hors fenêtre debounce
  Quand alerte_resoudre_auto(code, entity_type, entity_id, raison) est appelée
  Alors les 2 passent 'resolue' et la fonction retourne 2
  Quand elle est rappelée immédiatement avec les mêmes arguments
  Alors 0 ligne affectée, retour 0, AUCUNE erreur
```

```gherkin
# Source : §06/M11 EC11
# Couche : db
# Priorité : P1-critique
Scénario : resolution_auto_prioritaire_sur_snoozee
  Étant donné une alerte statut='snoozee' (jusqu'à demain)
  Quand alerte_resoudre_auto matche son (code, entity)
  Alors elle passe 'resolue' malgré le snooze
  Et le log porte snoozee_avant_resolution_auto=true
```

```gherkin
# Source : §05 R_M11.2 / EC12
# Couche : db
# Priorité : P1-critique
Scénario : criticite_immuable_changement_catalogue_non_retroactif
  Étant donné une alerte émise criticite='warning' pour le code C
  Quand Admin TMS passe C à criticite_par_defaut='critical' dans le catalogue
  Alors l'alerte existante reste 'warning' (aucun UPDATE rétroactif)
  Et une nouvelle émission de C produit une alerte 'critical' avec email
```

```gherkin
# Source : §06/M11 §7 règles de transition (unsnooze reset ack)
# Couche : db
# Priorité : P1-critique
Scénario : unsnooze_remet_ackee_a_null
  Étant donné une alerte ackée puis snoozée 1h
  Quand le cron m11_unsnoozer la repasse 'ouverte'
  Alors ackee_at = NULL et ackee_par_user_id = NULL (revient non ackée pour re-traitement)
```

```gherkin
# Source : §04 addendum §11.3 CHECK constraints
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : check_constraints_coherence_etats
  Quand on tente UPDATE statut='snoozee' sans snoozee_jusqu_a → rejet CHECK alertes_statut_snooze
  Quand on tente UPDATE statut='resolue' sans resolue_source → rejet CHECK alertes_statut_resolue
  Quand on tente ackee_at sans ackee_par_user_id (ou l'inverse) → rejet CHECK alertes_ackee_coherence
```

```gherkin
# Source : §06/M11 W9 (réactivation)
# Couche : db
# Priorité : P2-important
Scénario : reactivation_code_reprend_emissions
  Étant donné un code désactivé (active=false) dont les émissions retournent NULL
  Quand Admin TMS rebascule active=true
  Alors l'émission suivante crée une alerte normalement (toggle sans redéploiement)
```

```gherkin
# Source : §04 addendum §11.1 (enums 3 valeurs)
# Couche : db (pgTAP)
# Priorité : P1-critique
Scénario : enums_m11_valeurs_strictes
  Alors alerte_statut contient exactement {ouverte, snoozee, resolue} — ni 'ackee' ni 'expiree'
  Et alerte_criticite contient exactement {warning, critical} — pas 'info'
  Et alerte_resolution_source contient exactement {manuel, auto}
  Et tout INSERT avec une valeur hors enum est rejeté
```

---

## Catégorie 6 — Cross-app (Plateforme ↔ TMS)

**VIDE — justifiée.** M11 n'expose ni ne consomme aucun endpoint E1-E6 / S1-S11. Les alertes nées d'événements cross-app sont émises et testées par leurs modules : `m01_webhook_gap_critical`, `m01_dlq_event_rejected`, `m01_push_plateforme_dlq`, `m01_hmac_invalide` (M01), `m04_evenement_dlq` (M04), `m14_everest_*` (M14). EC18 : la supervision côté Plateforme est hors scope TMS.

---

## Catégorie 7 — Migration

**HORS SCOPE — justifiée.** `tms.alertes`, `tms.alertes_catalogue` et `tms.alertes_archive_critical` sont des tables neuves sans données MTS-1 à reprendre. Le seed catalogue (60 lignes dont 2 `active=false` → 58 émettables, solde autoritaire §11.7) est validé par le pgTAP EC17 (cat. 3). Les codes `m13_migration_*` relèvent des scénarios M13.

---

## Specs floues — TRANCHÉES Val 2026-06-07, propagées (M11 + §04 + §09)

**F1 — `admin_savr` : PEUT ack/résoudre** (inverse de la reco). Mention « lecture seule » retirée de E1 et §2 Personas ; W4/EC13 font foi. Propagé M11.

**F2 — EC10 réécrit** : double ack simultané = idempotent silencieux (W4 Bloc 6 B2 canonique), l'ancienne erreur `alerte_non_ackable` via row lock était un résidu pré-Bloc 6. Propagé M11 EC10.

**F3 — `dedup_key`** : DDL complété — `GENERATED ALWAYS AS (code || ':' || COALESCE(entity_type,'') || ':' || COALESCE(entity_id::text,'')) STORED` (aligné v_dedup_key W1). Propagé M11 §11.3 + §04. *(Bonus : résidu `'test'` dans l'enum entity_type §04 corrigé — retiré Bloc 4 A5.)*

**F4 — Durées snooze : hardcode {1,4,24} dans la RPC fait foi**, paramètre `m11.snooze_durees_autorisees` supprimé (EC6 « max 24h » garanti par construction, D11). Propagé M11 W5/§9 + §04 §5.

**F5 — Manager prestataire : SELECT only V1** (reco suivie). W4/W5/§7 amendés « staff uniquement » ; policy §09 `alertes_staff_or_destinataire_update` → `alertes_staff_update` (USING/WITH CHECK `user_is_staff()`) ; pgTAP renommé `test_m11_ack_requires_staff`. Ack manager = V1.1 si un code scope entity apparaît. Propagé M11 + §09.

---

## Scénarios hors scope (V1.1)

- KPI header E1 (4 tuiles) et tri/pagination table : UI Playwright P3, à couvrir avec le dashboard global §11.
- Latence email < 60s (`m11.email_batch_latence_cible_seconds`) : SLA soft non binaire — observabilité, pas test CI.
- Affichage « Entité introuvable » EC14 (entity dangling) : UI P3.
- Digest matinal (D7), SLA 2h + escalade (D10), réouverture admin (`m11_rouvrir_alerte`) : V2.
- Realtime Supabase dashboard : V1.1 (polling 30s V1).
