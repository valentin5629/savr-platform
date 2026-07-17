# 07 - Observabilité — 05 - Health checks

> Endpoints de santé + monitoring uptime externe. Critique pour Savr : les opérations se déroulent **22h-3h**, une indispo non détectée = collecte sans retour de statut. Arbitrage OBS-3 : `/health/full` = **DB + Auth seulement** (pas de ping APIs tierces).

---

## 1. Endpoints

### `GET /health` (liveness — léger)
- Répond **200** `{ "status": "ok" }` si le process API Route est vivant et la **DB répond** (un `SELECT 1` < 200 ms).
- Répond **503** sinon.
- Pas d'auth. Pas de logique métier. Doit rester < 100 ms.
- C'est l'endpoint pingé par Better Uptime (cf. §3).

### `GET /health/full` (readiness — diagnostic)
- Vérifie **DB** (`SELECT 1`) **+ Auth** (Supabase Auth joignable).
- Retourne le détail :
```json
{ "status": "ok", "checks": { "db": "ok", "auth": "ok" }, "ts": "..." }
```
- **N'inclut PAS** Pennylane/Everest/Resend/Railway (décision OBS-3) : leur santé est suivie via les alertes `api.external.failed` (`03`) et la vue `v_ops_integrations` (`04`), pas dans le check de vie. Évite qu'une panne Pennylane fasse passer Savr « down » alors que la plateforme fonctionne.
- Auth requise (`admin_savr`/`ops_savr`) ou token interne — endpoint de diagnostic, pas public.

### `GET /api/health/logistique` (ops — hors périmètre OBS-3) *(ajout 2026-07-16, divergence OBS-3)*
- **Outil ops assumé, explicitement distinct de `/health` et `/health/full`.** Sonde read-only la connectivité des transporteurs configurés via l'interface `logistique_provider`, par `type_tms` : MTS-1 = **ping de l'API MTS-1** (API tierce) ; Everest / manuel = `non_applicable`.
- **200** si tous les providers répondent `ok` ou `non_applicable`, sinon **503**. Ne lève jamais (toute erreur capturée dans le résultat). Read-only, aucun effet de bord métier.
- Auth : `admin_savr` **ou** token `HEALTH_INTERNAL_TOKEN` (ajouté à `.env.example`). *(Rôle `ops_savr` retiré du commit — inexistant côté Plateforme, c'est un rôle TMS/V2.)*
- **OBS-3 ne s'applique PAS à cet endpoint** : l'arbitrage OBS-3 (« DB + Auth seulement, pas de ping API tierce ») porte sur `/health` et `/health/full` uniquement, qui restent la cible V1 conforme. Cet endpoint de diagnostic ops dédié n'est pas câblé à Better Uptime.
- Implémenté via une 6e méthode `healthCheck()` de l'interface `logistique_provider` (mts1/everest/manuel) — à refléter dans [[Interface logistique_provider V1]].

### Endpoints surveillés par Better Uptime
Aligné `07 - Architecture` §5 :
- `app.gosavr.io` (frontend)
- `api.gosavr.io/health` (API)
- endpoint Railway PDF (santé worker Puppeteer)

*(`tms.gosavr.io` réservé V2, non surveillé en V1.)*

---

## 2. Comportement attendu des checks

| Check | OK si | KO si |
|---|---|---|
| `db` | `SELECT 1` répond < 200 ms | timeout / erreur connexion |
| `auth` | endpoint Supabase Auth répond 2xx | timeout / 5xx |

Un KO sur `db` dans `/health` → 503 → Better Uptime déclenche après 2 KO consécutifs.

---

## 3. Monitoring externe (Better Uptime)

- **Fréquence** : ping `/health` toutes les **3 min** (cohérent `07 - Architecture` §5).
- **Seuil d'alerte** : **2 KO consécutifs** → alerte 🔴 critique.
- **Canaux** : `#savr-alerts-critique` (Slack) **+ SMS direct Val** (filet hors Slack, cf. `03` §1).
- **Couverture nocturne** : la fenêtre 22h-3h est la plus sensible (opérations logistiques) — l'alerte est 24/7.

---

## 4. À implémenter (Claude Code)

1. Route `GET /health` (publique, liveness DB, < 100 ms, pas de log à chaque hit pour éviter le bruit).
2. Route `GET /health/full` (auth, DB + Auth, JSON détaillé).
3. Configurer Better Uptime : 3 moniteurs (app, api/health, Railway), ping 3 min, 2 KO → Slack critique + SMS Val.
4. Ne **pas** logger chaque ping `/health` en event business (bruit) — seuls les passages KO→OK / OK→KO sont notables.
