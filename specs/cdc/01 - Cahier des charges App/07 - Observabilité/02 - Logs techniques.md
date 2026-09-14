# 07 - Observabilité — 02 - Logs techniques

> Events **système** à émettre côté infra/runtime. Même format JSON 1 ligne que `01 - Logs business` (`ts`, `level`, `service`, `event`, `trace_id`, `payload`). Sert à diagnostiquer perf, sécurité d'accès et batchs.

---

## 1. Catalogue des events techniques (V1)

| Event | Quand | Niveau | Payload | Source |
|---|---|---|---|---|
| `db.query.slow` | requête > 500 ms | warn | `query_id, duree_ms, table` | `pg_stat_statements` / wrapper API Routes |
| `db.query.timeout` | requête > 10 s | error | `query_id, duree_ms` | Runtime |
| `api_route.invoked` | début exécution route Next.js | info | `route, method, actor_role` | Middleware API Routes |
| `api_route.error` | exception non catchée | error | `route, error_code, message` | Capté **aussi par Sentry** |
| `rls.policy.deny` | accès refusé par une policy RLS | warn | `table, role, operation(SELECT\|INSERT\|UPDATE\|DELETE)` | Hook / fonction `SECURITY DEFINER` de trace |
| `external_api.timeout` | appel sortant > 5 s | warn | `service, endpoint, duree_ms` | Wrapper HTTP sortant |
| `external_api.5xx` | tiers retourne 5xx | error | `service, endpoint, http_status` | Wrapper HTTP sortant |
| `job.cron.started` | batch démarré | info | `job_name, trace_id` | pg_cron / Vercel Cron |
| `job.cron.completed` | batch terminé OK — **éventuellement partiel** | info | `job_name, duree_ms, nb_traite` (+ `nb_errors` si batch par éléments) | Idem |
| `job.cron.failed` | batch échoué — exception, **ou** échec **global** d'un batch par éléments : (a) `etape='selection'` — toute lecture préalable en échec (collectes éligibles, **documents déjà émis**, entités de facturation AG) : **fail-closed**, car continuer sans la liste des documents déjà émis ré-émettrait bordereaux et attestations fiscales en double, en consommant des numéros gapless ; (b) `etape='traitement'` — **≥ 1 élément tenté et 0 produit** (défaut systémique : colonne renommée, INSERT cassé) | error | `job_name, error_code, etape` (`error_code` = code PostgREST/Postgres réel) | Idem (→ alerte `eleve` + **HTTP 500**, cf. `03`) |
| `pdf.batch.collecte_failed` | **une** collecte en échec dans un batch PDF J+1, les autres traitées (échec **partiel** : ≥ 1 produit et ≥ 1 en échec → le batch reste `completed` avec `nb_errors`) | warn | `job_name, collecte_id, error` | Batch J+1 6h — debug, **pas d'alerte Slack** : la collecte est re-sélectionnée au batch suivant (idempotence), anti-fatigue §07/03, et une panne sur *toutes* les collectes remonte déjà par `etape='traitement'` |
| `migration.applied` | migration SQL appliquée | info | `migration_file, env` | CI/CD (déploiement) |
| `webhook.signature_invalid` | HMAC/JWT entrant invalide | warn | `source, ip` | Endpoint webhook (V2 surtout ; V1 = polling) |

---

## 2. Jobs cron à instrumenter (`job.cron.*`)

Liste alignée sur `CLAUDE.md` §12 (cron) :

| `job_name` | Fréquence | Criticité si échec |
|---|---|---|
| `attestations_batch` | J+1 06h00 | élevée (attestation fiscale AG) |
| `bordereaux_rapports_batch` | J+1 06h00 | élevée (justificatif ZD) |
| `rapport_sans_excedent_batch` | J+1 06h00 | élevée (rapport client AG sans excédent, §12 §1.3-bis — job créé R21b, monté dans le même cron 6h) |
| `mts1_polling` | toutes les 15 min | élevée (statut/pesées collectes) |
| `pennylane_polling` | J+1 | moyenne (statut paiement) |
| `relance_factures` | quotidien | basse |
| `purge_logs` | quotidien | basse |

Chaque job émet `started` → `completed`|`failed`. Un `failed` sur les jobs de criticité élevée/moyenne déclenche une alerte Slack (cf. `03`).

---

## 3. Niveau RLS deny — précision

`rls.policy.deny` en `warn` sert à détecter **deux choses distinctes** :
- un **bug applicatif** (le front demande une donnée qu'il ne devrait pas → corriger le front) ;
- une **tentative d'accès anormale** (volume élevé même rôle → cf. alerte sécurité `03`).

Ne pas confondre avec le fonctionnement nominal `DENY ALL` (cf. `09 - Authentification`) : on ne logge un deny que lorsqu'une requête applicative authentifiée se fait refuser, pas les deny structurels par défaut.

---

## 4. Rétention

Tous ces events suivent la rétention Supabase/Vercel Logs (**7 j**) + Sentry pour les `error` applicatives (**90 j** free tier). Au-delà : seul l'`audit_log` (`06`) conserve la trace des actions sensibles (5 ans). `purge_logs` ne touche jamais `audit_log`.
