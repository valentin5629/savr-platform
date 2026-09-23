# 08 - Performance / 06 - Monitoring perf prod

**Nature** : extension perf du dossier [[../07 - Observabilité/]]. Stack inchangée (décision 2026-06-08) : **Supabase Logs + Sentry + Better Uptime + Slack 3 canaux**. Aucun outil ajouté.

---

## 1. Métriques perf à surveiller

| Métrique | Source | Référence |
|---|---|---|
| p50 / p95 / p99 par endpoint critique | Sentry Performance | [[02 - SLA par endpoint]] |
| Slow queries Postgres (> 500 ms warn / > 2 s alerte) | Supabase Logs (pg_stat_statements) | [[03 - Cibles techniques transverses]] §2 |
| Taux d'erreur global et par endpoint | Sentry | §3 cibles transverses |
| Connexions DB en cours | Supabase dashboard | seuil < 160 (80 % pool) |
| Taille des files de jobs (`jobs_pdf`, retry API) | Vue ops `v_ops_*` | [[../07 - Observabilité/04 - Dashboards business]] |
| Web Vitals (LCP / FID-INP / CLS) | Vercel Analytics | §1 cibles transverses |
| Durée cycle de poll MTS-1 | Logs adapter | < 2 min / cycle |

Instrumentation : OpenTelemetry léger (déjà décidé V1, cf. CLAUDE.md §13).

---

## 2. Alertes perf

S'ajoutent aux alertes fonctionnelles de [[../07 - Observabilité/03 - Alertes]]. Canaux Slack par sévérité (OBS-1).

| Condition | Sévérité | Canal |
|---|---|---|
| p95 d'un endpoint critique > 2× sa cible pendant 10 min | Élevé | `#savr-alerts-eleve` |
| Taux d'erreur global > 1 % sur 5 min | Critique | `#savr-alerts-critique` (+ SMS Better Uptime) |
| Pool connexions DB > 90 % (180/200) | Critique | `#savr-alerts-critique` |
| Slow query > 2 s | Élevé | `#savr-alerts-eleve` |
| Cycle de poll MTS-1 > 14 min (déborde sur le suivant) | Élevé | `#savr-alerts-eleve` |
| Uptime mensuel sous 99,5 % (trajectoire) | Info | `#savr-alerts-info` |

> Rappel anti-doublon (cf. CLAUDE.md §13) : les alertes **fonctionnelles** (pesée hors seuil ZD, collecte non transmise TMS, `realisee_sans_collecte`) restent **in-app / dashboard**, jamais Slack. Ce fichier ne traite que la couche **perf/technique**.

---

## 3. Cadence de vérification

- **Avant chaque release significative** : vérifier qu'aucune requête ne dépasse 500 ms sur `seed_demo` au volume An 1 (`EXPLAIN ANALYZE`).
- **Hebdo** : revue des p95 Sentry des 10 endpoints les plus appelés.
- **Mensuel** : revue uptime + tendance taille DB / storage vs trajectoire [[01 - Volumes attendus]] §3.

---

## Synthèse pour Claude Code

Pas de nouvel outil à intégrer — réutiliser Sentry/Supabase Logs/Better Uptime/Vercel Analytics déjà spécifiés. Le travail de dev consiste à : (1) instrumenter OTel sur les endpoints critiques, (2) câbler les 6 alertes perf ci-dessus dans les canaux Slack existants, (3) exposer les métriques de files de jobs dans les vues `v_ops_*`.
