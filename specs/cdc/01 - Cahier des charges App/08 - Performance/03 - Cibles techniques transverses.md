# 08 - Performance / 03 - Cibles techniques transverses

**Stack** : Next.js 15 App Router (Vercel) + Supabase Pro + Railway (PDF). Pas d'Edge Functions Supabase par défaut (cf. CLAUDE.md §2).

---

## 1. Frontend (par front Vercel : `app.gosavr.io`)

| Cible                          | Valeur   | Mesure                                       |
| ------------------------------ | -------- | -------------------------------------------- |
| Time to First Byte (TTFB)      | < 200 ms | Vercel Analytics                             |
| Largest Contentful Paint (LCP) | < 2,5 s  | Web Vitals                                   |
| First Input Delay (FID) / INP  | < 100 ms | Web Vitals                                   |
| Cumulative Layout Shift (CLS)  | < 0,1    | Web Vitals                                   |
| Bundle JS initial (gzip)       | < 250 Ko | `next build` analyze, bloquant CI si dépassé |

---

## 2. Backend / DB

| Cible                                          | Valeur                                                | Action si dépassé                                                      |
| ---------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Cold start fonction serveur (route API Vercel) | < 3 s                                                 | Surveiller, garder les routes légères                                  |
| Slow query Postgres — warn                     | > 500 ms                                              | Log warn (pg_stat_statements)                                          |
| Slow query Postgres — alerte                   | > 2 s                                                 | Alerte Slack `#savr-alerts-eleve`                                      |
| Connexions DB simultanées                      | < 80 % du quota Supabase Pro (200 pooled) → **< 160** | Alerte à 90 % (180). Pooler transaction (port 6543) obligatoire dès V1 |
| Job PDF (Railway, par unité)                   | < 5 s                                                 | File `jobs_pdf`, 5 simultanés max, retry 15 min / 4 h                  |

---

## 3. Fiabilité globale

| Cible                                  | Valeur                           | Note                                              |
| -------------------------------------- | -------------------------------- | ------------------------------------------------- |
| Taux d'erreur global                   | < 0,1 % des requêtes / 24 h      | Au-delà → investigation                           |
| Uptime mensuel                         | 99,5 % (≤ 3,6 h downtime / mois) | Mesuré Better Uptime                              |
| Taux d'erreur 5xx sous charge nominale | < 0,1 %                          | Critère scénario 1 ([[04 - Scenarios de charge]]) |
| Taux d'erreur 5xx sous pic ×3          | < 1 %                            | Critère scénario 2 (V1.1)                         |

---

## 4. Articulation avec l'observabilité

Ces seuils sont les **valeurs de déclenchement** des alertes spécifiées dans [[../07 - Observabilité/03 - Alertes]] et étendues dans [[06 - Monitoring perf prod]]. Aucun seuil ici ne doit diverger de ceux du dossier `07 - Observabilité/` : en cas de conflit, ce fichier (perf) fait foi pour les seuils de **performance**, le dossier Observabilité fait foi pour les seuils **fonctionnels/business**.

---

## Synthèse pour Claude Code

Le bundle JS < 250 Ko gzip est **bloquant CI**. Les Web Vitals (LCP/FID/CLS) sont mesurés en continu via Vercel Analytics et reportés au dashboard ops. Le **pooler Supabase en mode `transaction` (port 6543, pas le port session 5432)** est non négociable dès la première mise en service pour les routes API serverless ; prepared statements nommés désactivés côté client _(correction revue dev senior (frère) 2026-06-08 — l'ancien « port pooling 5432 » visait le mode session, inadapté au serverless)_. Toute requête > 500 ms en dev = signal à indexer avant merge.
