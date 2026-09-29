# 08 - Performance / 02 - SLA par endpoint

**Statut** : Validé V1
**Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)
**Périmètre** : V1 uniquement (MTS-1 polling + Everest direct + Pennylane polling). Les webhooks contrat §08 S1-S11 = cible V2 gelée, SLA listés en §6 pour référence.

---

## Convention

- **p95** = 95 % des requêtes doivent passer sous ce seuil. C'est la cible **bloquante** au benchmark.
- **p99** = toléré dégradé, mais 1 % des requêtes ne doit pas dépasser ce plafond.
- Mesure : sur `seed_demo` ([[../05 - Fixtures/]]) chargé au volume An 1 (~300 k lignes), via Sentry Performance / Vercel Analytics.
- « **À optimiser** » = la cible n'est pas atteignable sans une stratégie dédiée (cf. [[05 - Strategies optimisation]]).

---

## 1. Lecture (consultation)

| Endpoint / écran | p95 | p99 | Note |
|---|---|---|---|
| Liste collectes traiteur (paginée 50) | 200 ms | 500 ms | Index `collectes(organisation_id, statut, created_at)` |
| Liste événements (paginée) | 200 ms | 500 ms | Index `evenements(organisation_id, date_evenement DESC)` |
| Liste factures (paginée) | 200 ms | 500 ms | Index `factures(organisation_id, statut, created_at)` |
| Fiche événement (détail) | 250 ms | 600 ms | Jointures collectes/pesées/PDFs |
| Fiche collecte (détail) | 250 ms | 600 ms | |
| Fiche facture (détail) | 250 ms | 600 ms | |
| **Dashboard Admin global** | 800 ms | 2 s | **À optimiser** — agrégat multi-org, vue matérialisée `v_ops_*` refresh 5 min |
| Dashboard traiteur / lieux / agence | 500 ms | 1,2 s | Agrégat mono-org, index RLS suffisant |
| Recherche (orgas, lieux, collectes) | 400 ms | 1 s | Index trigram si full-text |
| Registre réglementaire ZD (vue) | 600 ms | 1,5 s | `cloturee` + ZD only, vue dédiée |
| Export CSV / Excel (≤ 10 k lignes) | 5 s | 15 s | **À optimiser** — async + cursor pagination si > 10 k |

---

## 2. Écriture (action)

| Endpoint / action | p95 | p99 | Note |
|---|---|---|---|
| Création / modif entité (orga, lieu, user) | 400 ms | 1 s | |
| Soumission formulaire programmation collecte | 600 ms | 1,5 s | Inclut tarif ZD auto + vérif pack AG + **écriture outbox E1 dans la même transaction** |
| Modification collecte (→ PATCH outbox E2) | 500 ms | 1,2 s | Écriture outbox dans la transaction |
| Annulation collecte (→ outbox E3) | 400 ms | 1 s | |
| Dispatch / réémission Admin | 800 ms | 2 s | Action multi-branche (non_envoye→E1 / dirty→E2 / rejetee→E1) |
| Validation facture (déclenche push Pennylane) | 500 ms | 1,5 s | Push Pennylane **hors transaction** (async, cf. §3) — la réponse UI ne l'attend pas |
| Génération PDF (bordereau / attestation) | 5 s end-to-end | 15 s | **Async** via `jobs_pdf` + Railway. Jamais synchrone dans la requête |

---

## 3. Intégrations tierces sortantes (V1)

| Flux | p95 | p99 | Note |
|---|---|---|---|
| Push Pennylane (create + finalize + send_email) | 2 s / appel | 5 s | Async, retry 3 paliers 5min/1h/24h. N'impacte pas le p95 UI |
| Polling statut paiement Pennylane (cron J+1 3h) | < 5 min total | — | Batch, sans borne temporelle de scope |
| Appel direct Everest (services 71/75/91) | 2 s / appel | 5 s | ⚠ Gate Everest §7 CLAUDE.md — SLA à confirmer après réponse dev Everest |
| POST `/v3/customerOrders` MTS-1 (depuis outbox) | 2 s / appel | 5 s | Consommé par `adapter_mts1`, retry sur échec |

---

## 4. Logistique MTS-1 entrante (V1 = polling)

| Job (cron 15 min) | Cible | Note |
|---|---|---|
| `GET /v3/customerOrders` (liste ordres ouverts) | < 30 s / cycle | Poids croît avec ordres ouverts — borne à surveiller |
| `GET /v3/tours/{id}` (détail tournée) | < 10 s / tournée | Itéré sur tournées actives |
| Download photos collecte → R2 | < 5 s / photo | Async, file de téléchargement |
| Cycle de poll complet (sync statut_tms + pesées) | < 2 min / cycle | Doit terminer avant le cycle suivant (15 min) |

---

## 5. Batch / cron internes

| Job | Cible totale | Note |
|---|---|---|
| Batch attestations + bordereaux J+1 6h | < 10 min pour 1 000 collectes | An 1 réel : 15-50 PDFs → ~2 min |
| Relance factures impayées | < 5 min | |
| Polling Pennylane J+1 3h | < 5 min | |
| Purge logs / audit | < 30 min (mensuel) | |

---

## 6. Auth

| Endpoint | p95 | Note |
|---|---|---|
| Login | 500 ms | Inclut résolution rôle + rattachement orga |
| Refresh token | 100 ms | |
| Inscription self-service (SIRET INSEE + TVA VIES) | 3 s | **À optimiser** — 2 appels externes (INSEE, VIES) ; afficher état de chargement, ne pas bloquer l'UI |

---

## 7. Référence V2 (contrat §08 gelé — NON benchmarké V1)

Pour mémoire, les webhooks du contrat API Plateforme↔TMS (cible V2) viseront :

| Type | p95 | p99 |
|---|---|---|
| Webhooks entrants E1-E5 / S1-S11 (signature HMAC + traitement) | 300 ms | 1 s |
| Endpoints inter-apps synchrones | 500 ms | 2 s |

Ces cibles ne sont **pas** des gates V1 — elles documentent la cible pour que l'outbox V1 soit déjà dimensionnée juste.

---

## Synthèse pour Claude Code

Tout endpoint marqué **À optimiser** doit embarquer sa stratégie dès la première implémentation (pas a posteriori) : dashboard Admin = vue matérialisée ; exports = async + cursor ; inscription = appels externes non bloquants ; PDF = toujours async via `jobs_pdf`. Les cibles p95 lecture/écriture standard sont atteignables avec les seuls index obligatoires du §14 §2.
