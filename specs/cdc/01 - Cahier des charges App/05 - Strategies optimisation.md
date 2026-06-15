# 08 - Performance / 05 - Strategies optimisation

**Statut** : Validé V1
**Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)
**Principe directeur** : pas de premature optimization. La liste autorisée reste sobre ; tout ce qui ajoute de l'infra ou de la complexité attend une validation Val.

---

## 1. Optimisations AUTORISÉES (Claude Code applique sans demander)

Ce sont les optimisations attendues par défaut — leur absence est un défaut, pas leur présence un excès.

- **Index Postgres sur colonnes filtrées par RLS** (`organisation_id`, `lieu_id`, `prestataire_id`, `client_organisateur_organisation_id`) — liste obligatoire figée [[14 - Scalabilité et évolutivité]] §2.
- **Index composites** sur les paires de listes paginées : `collectes(organisation_id, statut, created_at)`, `evenements(organisation_id, date_evenement DESC)`, `factures(organisation_id, statut, created_at)`.
- **Pagination obligatoire** au-delà de 50 lignes sur toute liste.
- **Cursor pagination** sur les tables > 100 k lignes (au lieu d'offset).
- **Cache mémoire LRU** sur les paramétrages globaux peu mutables (`shared.parametres_globaux`, tarifs ZD versionnés, templates emails).
- **Génération PDF en async** via la file `jobs_pdf` (Railway) — jamais synchrone dans la requête HTTP.
- **Appels API tierces en async** (Pennylane, Everest, POST MTS-1) hors transaction métier + retry 3 paliers. La réponse UI n'attend jamais l'appel externe.
- **Vues matérialisées Postgres** pour les dashboards agrégés (Admin global, `v_ops_*`), refresh toutes les 5 min via `pg_cron` en **`REFRESH MATERIALIZED VIEW CONCURRENTLY`** (impose un index unique sur chaque vue) — jamais de refresh on-trigger ni de refresh non-concurrent, qui verrouille la vue en lecture pendant le rebuild *(validé revue dev senior (frère) 2026-06-08)*.
- **Pooler Supabase en mode `transaction` (port 6543)** dès V1 pour toutes les connexions serverless Vercel — jamais le port session `5432` côté routes API. Conséquence à respecter : **prepared statements nommés désactivés** côté client (`prepare: false` / `?pgbouncer=true`), sinon erreurs intermittentes sous le pooler transaction *(validé revue dev senior (frère) 2026-06-08)*.
- **`EXPLAIN ANALYZE`** systématique sur toute requête > 500 ms en dev avant merge.

---

## 2. Optimisations INTERDITES sans validation Val

Overkill pour les volumes V1 — ajoutent de l'infra, du coût ou de la complexité disproportionnés.

- **Caches multi-couches** (Redis, Memcached) — inutile aux volumes An 1, ajoute un service à opérer.
- **CDN custom** devant Supabase.
- **Sharding / partitionnement** de tables.
- **Réplication read-only** / read replicas.
- **Optimisations qui sacrifient la lisibilité du SQL** (dénormalisation agressive, requêtes illisibles).
- **Edge Functions Supabase** comme couche de cache (la règle CLAUDE.md §2 impose déjà API Routes Vercel par défaut).

---

## 3. Règle de décision

Si une cible **À optimiser** de [[02 - SLA par endpoint]] n'est toujours pas tenue après application des optimisations autorisées (§1) → **STOP, alerter Val** avec le `EXPLAIN ANALYZE` et la stratégie envisagée. Ne jamais basculer unilatéralement sur une optimisation de la liste §2.

---

## Synthèse pour Claude Code

Les index et la pagination ne sont pas optionnels : ils font partie de la définition de « fini » d'un module qui lit des données métier. L'async (PDF, API tierces) est une contrainte d'architecture, pas une optimisation tardive. Tout le reste (Redis, replicas, partitionnement) = demander Val.
