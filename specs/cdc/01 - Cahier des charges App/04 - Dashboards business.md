# 07 - Observabilité — 04 - Dashboards business

> ⚠ **Les dashboards métier par rôle sont déjà entièrement spécifiés dans `11 - Dashboards`** (6 dashboards : `admin_savr`/`ops_savr`, `traiteur_manager`/`traiteur_commercial`, `agence`, `gestionnaire_lieux`, `client_organisateur`) et leurs vues SQL `v_kpi_*` (`11 - Dashboards` §9). **Ce fichier ne les redéfinit pas.**
>
> Objet ici : la **couche monitoring/ops** d'observabilité — ce qu'on regarde pour détecter un incident, distinct des KPI business. Si un besoin chevauche `11`, **`11 - Dashboards` fait foi.**

---

## 1. Ce qui existe déjà (ne pas re-spécifier)

| Dashboard | Spec source | Vue SQL |
|---|---|---|
| Admin Savr (pilotage opérationnel) | `11 - Dashboards` §1.1 + `06.06 Back-office` | `v_kpi_admin` |
| Client (vue restituée Admin) | `11 - Dashboards` §1.2 | — |
| Traiteur manager/commercial | `11 - Dashboards` §2 | `v_kpi_traiteur` |
| Agence | `11 - Dashboards` §4 | `v_kpi_traiteur` (RLS agence) |
| Gestionnaire lieux | `11 - Dashboards` §5 | `v_kpi_lieu` |
| Client organisateur | `11 - Dashboards` §7 | `v_kpi_client_organisateur` |

Le Dashboard Admin porte déjà les cartes de **monitoring opérationnel** utiles à l'observabilité métier : collectes non transmises au TMS (`statut=programmee ET tms_reference IS NULL`), picto plaque TMS, statut acceptance par collecte. Ces cartes restent dans `11`.

---

## 2. Couche monitoring ops à ajouter (nouveau, observabilité)

Vues SQL **techniques** dédiées au suivi d'exploitation, lisibles dans une page « Santé système » du back-office Admin (`admin_savr` + `ops_savr` only). Légères, calculées à la volée (cohérent décision `11` §9 : pas de vue matérialisée V1).

| Vue / widget | Contenu | Sert à détecter |
|---|---|---|
| `v_ops_integrations` | Dernier `mts1_polling` réussi (timestamp + âge), dernier `pennylane_polling`, nb d'échecs `external_api.failed` 24h par service | Intégration muette / API tierce HS |
| `v_ops_outbox` | Nb `outbox_events` non consommés, plus ancien non consommé (âge) | Adapter bloqué / event coincé |
| `v_ops_jobs_pdf` | Nb `jobs_pdf` en attente / en échec, plus ancien en attente | File PDF engorgée |
| `v_ops_batchs` | Statut dernier run de chaque cron (`attestations`, `bordereaux`, polling) + nb traité | Batch nocturne non passé |
| `v_ops_factures_bloquees` | Factures `emise` sans retour Pennylane > 48h, échecs 4xx | Push facturation cassé |

Ces vues **doublent** ce que Slack pousse (`03`), mais en mode consultation : Slack alerte sur l'événement, le dashboard ops donne l'état courant et l'historique récent.

---

## 3. Principe de séparation

- **`11 - Dashboards`** = valeur métier (CA, kg, CO₂, packs, marge) → consommé par les clients ET l'Admin.
- **Ce dossier (page Santé système)** = état d'exploitation (intégrations, files, batchs) → Admin/Ops only, jamais exposé aux clients.

Une même donnée n'est jamais spécifiée deux fois : si elle est métier, elle est dans `11` ; si elle est d'exploitation, elle est ici.

---

## 4. Implémentation pour Claude Code

Chaque vue `v_ops_*` = une vue SQL non matérialisée + un composant front dans la section « Santé système » du back-office Admin (RLS `admin_savr` + `ops_savr`). Pas d'outil externe (Metabase/Grafana) en V1. Réévaluation V1.1 si le volume justifie un outil dédié.
