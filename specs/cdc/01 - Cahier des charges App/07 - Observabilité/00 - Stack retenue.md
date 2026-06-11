# 07 - Observabilité — 00 - Stack retenue

> Spec d'observabilité **minimum viable** de Savr en production. Objectif : qu'un bug en prod soit détecté par le système avant qu'un client le signale. Ce dossier consolide les décisions éparses (`07 - Architecture technique` §5, `14 - Scalabilité` §7) et les complète (catalogue de logs, liste d'alertes, audit trail).
>
> **Portée** : Plateforme V1 (`plateforme.*` + `shared.*`) + couche logistique V1 (adapter MTS-1 polling + Everest). Le TMS natif (`tms.*`) = V2, hors scope.
>
> Session de co-construction : 2026-06-08 (Val). 3 arbitrages tranchés (cf. §4).

---

## 1. Principe directeur

Trois questions auxquelles ce dossier répond :

1. **Quoi logger** → `01 - Logs business`, `02 - Logs techniques`
2. **Quoi déclenche une alerte** → `03 - Alertes` (liste **finie et actionnable**, pas « tout ce qui semble bizarre »)
3. **Où on regarde** → `04 - Dashboards business`, `05 - Health checks`, `06 - Audit trail`

Règle d'or : une alerte rare et actionnable. Trop d'alertes = ignorées. La sévérité conditionne le canal et l'horaire de ping.

---

## 2. Stack retenue V1

| Brique                                     | Outil                                                      | Plan V1                     | Rôle                                                                                                   | Source de décision                      |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **Logs structurés DB + Auth**              | Supabase Logs                                              | Inclus (Pro)                | Rétention native **7 j**, consultables dashboard Supabase                                              | `07 - Architecture` §5                  |
| **Logs business + techniques applicatifs** | Sortie `stdout` JSON Next.js → Supabase Logs / Vercel Logs | Inclus                      | Events métier (`01`) + système (`02`), format JSON 1 ligne                                             | Cette session                           |
| **Erreurs applicatives**                   | Sentry                                                     | Gratuit (< 5 000 err./mois) | Exceptions non catchées, stacktrace, contexte user (rôle, `organisation_id`)                           | `07 - Architecture` §5 (décision 9.1.3) |
| **Uptime**                                 | Better Uptime                                              | Gratuit (10 moniteurs)      | Ping `/health` (cf. `05`), détection indispo fenêtre 22h-3h                                            | `07 - Architecture` §5                  |
| **Routage alertes**                        | **Slack — 3 canaux par sévérité**                          | Gratuit                     | `#savr-alerts-critique` / `#savr-alerts-eleve` / `#savr-alerts-info`                                   | **Arbitrage Val 2026-06-08**            |
| **Dashboards métier**                      | Admin Savr (vues SQL `v_kpi_*`)                            | —                           | Déjà specés `11 - Dashboards` — **pas de re-spec ici**                                                 | `11 - Dashboards` §9                    |
| **Audit trail**                            | Table `plateforme.audit_log`                               | —                           | Déjà définie `04 - Data Model` (append-only) — couche **métier** conservée **5 ans**, ≠ logs éphémères | `04 - Data Model`                       |

**Pas en V1** (confirmé décision 9.1.3) : Datadog, Grafana, Metabase. OpenTelemetry est instrumenté dès V1 (wrapper léger sur les logs structurés) pour faciliter la bascule Datadog V1.1 sans refactoring — c'est le seul anticipé.

---

## 3. Distinction logs vs audit trail (ne pas confondre)

|           | Logs (`01`/`02`)                | Audit trail (`06`)                                      |
| --------- | ------------------------------- | ------------------------------------------------------- |
| Nature    | Flux technique éphémère         | Table métier `audit_log`                                |
| Rétention | 7 j (Supabase) / 90 j (Sentry)  | **5 ans** (obligation comptable + RGPD)                 |
| Usage     | Debug incident, alerting, perf  | Traçabilité légale des actions sensibles                |
| Écriture  | `console.log` JSON / SDK Sentry | INSERT trigger DB / `SERVICE_ROLE` (jamais API directe) |

L'audit trail **ne remplace pas** les logs et inversement. Un log facturation peut disparaître à J+8 ; la ligne `audit_log` de la même facture est conservée 5 ans.

---

## 4. Arbitrages de session (2026-06-08, Val)

| #     | Décision                                          | Alternative écartée                                | Impact                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OBS-1 | **Routage alertes = Slack 3 canaux par sévérité** | Email+SMS à Val seul (état `07 - Architecture` §5) | Met à jour `07 - Architecture` §5 : le SMS Better Uptime reste pour l'**uptime critique** (filet 24/7), mais le routage structuré des alertes applicatives passe par Slack. **À propager dans `07 - Architecture` §5.** |
| OBS-2 | **Audit trail = écritures sensibles seulement**   | + consultations RGPD (lectures)                    | Pas de log de lecture en V1. Cohérent volumétrie + `audit_log` append-only existant.                                                                                                                                    |
| OBS-3 | **`/health/full` = DB + Auth seulement**          | + ping APIs tierces (Pennylane)                    | Health check léger, pas de dépendance externe dans le check de vie. La santé Pennylane est surveillée via les alertes `api.external.failed` (cf. `03`).                                                                 |

---

## 5. Garde-fou RGPD (transverse à tout le dossier)

Aucune PII en clair dans les logs. Les emails loggés sont **hashés** (SHA-256) ou tronqués (`j***@domaine.fr`). Les payloads de logs ne contiennent jamais : mot de passe, token, contenu de facture nominatif, adresse personnelle. Voir détail par event dans `01 - Logs business`. L'`audit_log` (couche métier protégée RLS admin/ops) peut, lui, contenir des `ancienne_valeur`/`nouvelle_valeur` nominatives car cloisonné et non éphémère.

---

## 6. Livrables du dossier

- `00 - Stack retenue.md` _(ce fichier)_
- `01 - Logs business.md`
- `02 - Logs techniques.md`
- `03 - Alertes.md`
- `04 - Dashboards business.md`
- `05 - Health checks.md`
- `06 - Audit trail.md`

Référencé par `CLAUDE.md` §13 (à mettre à jour) et à régénérer dans `_DEV-FACING/` après cette session (`cdc-devfacing-export`).
