# 07 - Observabilité — 03 - Alertes

> Liste **finie et actionnable** des alertes V1. Une alerte = un problème qui exige une action humaine. Toute alerte non actionnable est un faux positif à supprimer. Routage : **Slack 3 canaux par sévérité** (arbitrage OBS-1).

---

## 1. Canaux Slack et règles de ping

| Canal                   | Sévérité    | Qui est pingué       | Horaire                    |
| ----------------------- | ----------- | -------------------- | -------------------------- |
| `#savr-alerts-critique` | 🔴 critique | Val + frère, `@here` | 24/7                       |
| `#savr-alerts-eleve`    | 🟠 élevé    | Val, `@here`         | 7h-22h (digest hors plage) |
| `#savr-alerts-info`     | 🟡 info     | Ops Savr             | heures ouvrées             |

Filet uptime : Better Uptime conserve **en plus** un SMS direct à Val pour le `Uptime down` critique (indépendant de Slack, au cas où Slack lui-même est inaccessible). C'est la seule redondance hors Slack.

---

## 2. Liste des alertes V1

| Alerte                                                                                                                                      | Trigger (source = `01`/`02`)                                                              | Sévérité    | Action attendue                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Erreur applicative non catchée**                                                                                                          | Sentry capture une _nouvelle_ erreur (pas un doublon connu)                               | 🔴 critique | Investiguer stacktrace, hotfix/rollback                                                                                                                 |
| **Event outbox en DLQ** _(ajout 2026-06-10, challenge logistique — câble l'alerte déjà référencée par [[04 - Data Model]] `outbox_events`)_ | `outbox_events.status = 'dead'` (après 4 tentatives)                                      | 🔴 critique | Collecte non transmise au transporteur = camion absent. Procédure déblocage DLQ (re-queue / skip motivé / résolution manuelle MTS-1, cf. §04 + RUNBOOK) |
| **Event outbox en échec, collecte imminente** _(ajout 2026-06-10)_                                                                          | `attempts ≥ 2` ET `date_collecte < now() + 24h` (sans attendre la DLQ)                    | 🔴 critique | Entre le palier 1 h et 24 h l'échec serait silencieux alors que la collecte est ce soir. Vérifier MTS-1, pousser manuellement si besoin                 |
| **Uptime down**                                                                                                                             | `/health` 2 KO consécutifs (Better Uptime)                                                | 🔴 critique | Vérifier Supabase/Vercel, rollback si déploiement                                                                                                       |
| **Job cron critique échoué**                                                                                                                | `job.cron.failed` sur `attestations_batch`, `bordereaux_rapports_batch` ou `mts1_polling` | 🟠 élevé    | Relancer le batch, vérifier cause                                                                                                                       |
| **API tierce HS**                                                                                                                           | 3× `external_api.5xx`/`timeout` consécutifs même `service`+`endpoint`                     | 🟠 élevé    | Vérifier statut Pennylane/Everest/Resend, basculer manuel si besoin                                                                                     |
| **Bruteforce login probable**                                                                                                               | > 5× `auth.login_failed` en 5 min même `email_hash` ou même `ip`                          | 🟠 élevé    | Vérifier compte, bloquer IP si attaque                                                                                                                  |
| **RLS deny anormal**                                                                                                                        | > 10× `rls.policy.deny`/h même `role`+`table`                                             | 🟠 élevé    | Bug front OU tentative d'accès → diagnostiquer                                                                                                          |
| **DB slow query**                                                                                                                           | `db.query.slow` > 2000 ms                                                                 | 🟠 élevé    | Analyser index (`pg_stat_statements`), cf. `14 - Scalabilité` §7                                                                                        |
| **PDF job en échec définitif**                                                                                                              | `pdf.job_failed` après épuisement des retries (15 min/4h)                                 | 🟠 élevé    | Régénérer manuellement, vérifier Railway                                                                                                                |
| **Job cron secondaire échoué**                                                                                                              | `job.cron.failed` sur `pennylane_polling`, `relance_factures`, `purge_logs`               | 🟡 info     | Vérifier au prochain créneau ouvré                                                                                                                      |
| **Pack épuisé**                                                                                                                             | `pack.exhausted`                                                                          | 🟡 info     | Info Ops — relancer le traiteur pour renouvellement                                                                                                     |
| **Seuil Sentry dépassé**                                                                                                                    | > 100 erreurs/jour (cf. `14` §7)                                                          | 🟠 élevé    | Sprint de stabilisation (signal qualité structurel)                                                                                                     |

---

## 3. Réconciliation : ce qui N'EST PAS une alerte Slack

Décisions tranchées en sessions test-scenarios — ne pas créer de doublon de notification :

- **Pesée hors seuil ZD (`pesee.hors_seuil`)** → **alerte in-app Admin seulement** (pas d'email, pas de template, pas de Slack). Décision figée (`05 - Règles métier` ; test-scenarios §11/§12). Le log `warn` existe pour le debug, mais le canal d'action est l'écran Admin, pas Slack.
- **Collecte non transmise au TMS** → **monitoring dans le Dashboard Admin** (carte `statut=programmee ET tms_reference IS NULL`, cf. `11 - Dashboards` §1.1), pas une alerte poussée. C'est une worklist, pas une interruption.
- **`realisee_sans_collecte`** → badge + alerte **in-app** Ops dans le back-office (`05 - Règles métier`), pas Slack.

Principe : une donnée qu'on **consulte dans un dashboard** n'est pas une alerte qu'on **pousse**. On ne pousse que l'inattendu actionnable immédiatement.

---

## 4. Seuils de décision long terme (rappel `14 - Scalabilité` §7)

Ces seuils ne sont pas des alertes temps réel mais des signaux de capacity planning (revue manuelle périodique) : DB storage > 4 Go, requêtes dashboard > 1 s, batch PDF > 100 collectes/nuit, connexions simultanées > 150, Supabase DB > 6 Go. Voir `14 - Scalabilité` §7 pour les actions associées.

---

## 5. Anti-fatigue d'alerte

- Toute alerte qui se déclenche > 3×/semaine sans action réelle est **revue** (seuil ajusté ou supprimée).
- Le digest hors plage horaire (canal élevé la nuit) regroupe en 1 message au lieu de N pings.
- Une nouvelle alerte ne s'ajoute à cette liste que si elle est actionnable ET non couverte par un dashboard.
