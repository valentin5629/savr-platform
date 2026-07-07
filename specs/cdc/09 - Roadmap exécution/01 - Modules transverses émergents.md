# 01 - Modules transverses émergents

> Transverses **non bloquants au démarrage**, posés dans `packages/shared` **au 1er usage métier** — jamais à blanc. Designés génériques pour servir toutes les verticales.
> ⚠ **Correction réalité V1** : la version générique du skill suppose des webhooks HMAC dès V1. **Faux ici** : V1 = adapter MTS-1 en **polling** + outbox sortante (POST `/v3/customerOrders`). Le contrat webhook HMAC §08 S1-S11 est la **cible V2**. Donc le transverse **H (webhooks HMAC entrants) est différé V2**.

---

## Catalogue

| Code | Transverse | 1er usage V1 | Servira aussi à | Statut V1 |
|---|---|---|---|---|
| **C** | Templates emails + envoi (Resend) | N0 0.5 (bienvenue/vérif) | Toutes verticales | ✅ posé en N0 |
| **G** | Wrappers API tierces | V1 M1.5 (MTS-1) puis M1.7 (Pennylane) | V2 (Everest, Pennylane AG) | ✅ V1 |
| **E** | Upload + stockage fichiers (R2 + `shared.fichiers`) | V1 M1.5 (photos pesées MTS-1) | M1.6 (PDF), V2 docs/attestations | ✅ V1 |
| **B** | Queue async (jobs, retry, idempotency) | V1 M1.6 (`jobs_pdf`) | V2 batch, V4 exports | ✅ V1 |
| **A** | Moteur PDF (Railway/Puppeteer) | V1 M1.6 (bordereau/rapport) | V2 attestation AG | ✅ V1 |
| **D** | Exports CSV / Excel | V4 M4.1 (reporting) | V3 espaces clients | ⏳ V4 (1er usage réel) |
| **F** | Recherche full-text Postgres | V3 dashboards (si besoin perf) | V4, listes admin | ⏳ V3+ (poser si SLA l'exige) |
| **H** | Webhooks signés HMAC + idempotency entrants | — | — | 🔵 **Différé V2** (V1 = polling) |

Règle de design : API générique dans `packages/shared` au 1er usage, pas d'anticipation. Le module métier de 1er usage **inclut** la pose du transverse dans son budget (pas de ligne budgétaire séparée).

---

## Spécifications par transverse

### C — Templates emails + envoi (Resend)
- **Pose** : Niveau 0 module 0.5 (emails bienvenue + vérification).
- **API shared** : `sendEmail(templateKey, to, vars)` ; **19 templates actifs** en **seed DB** (corrigé 2026-06-11 — vouvoiement, FR, 0 emoji, signature « L'équipe Savr ») ; gestion échec Resend (statut `echec`, 3 retries). UI d'édition templates = V1.1.
- **Réutilisé par** : confirmation collecte (V1), pré-bascule migration (V5), toutes notifs email V1 (pas d'in-app/SMS V1).

### G — Wrappers API tierces
- **Pose** : V1 module 1.5 (client MTS-1), étendu en M1.7 (client Pennylane).
- **API shared** : clients typés avec auth (MTS-1 = client-credentials, Bearer en Vault ; Pennylane v2 = polling J+1), retry, gestion 4xx/5xx, logs structurés. **Tout appel MTS-1/Everest passe par `packages/adapters/`** (garde-fou 3) — le wrapper shared fournit l'HTTP générique, l'adapter la sémantique métier.
- **Réutilisé par** : Everest (V2, 🔒 gate), Pennylane AG (V2).

### E — Upload + stockage fichiers
- **Pose** : V1 module 1.5 (download photos pesées MTS-1 → R2).
- **API shared** : upload/download R2 (URLs pré-signées) référencé via `shared.fichiers` (polymorphe, 9 `entity_type`, RLS `f_fichier_visible`). Fichiers volumineux → R2, jamais en base.
- **Réutilisé par** : PDF (M1.6), attestations/docs AG (V2).

### B — Queue async (jobs + retry + idempotency)
- **Pose** : V1 module 1.6 (file `jobs_pdf`).
- **API shared** : enqueue/worker, retry (PDF : 15 min / 4h), idempotency, statuts. `pg_cron` / Vercel Cron pour les batchs (attestations/bordereaux J+1 6h, polling MTS-1 15 min, relance factures, purge logs).
- **Réutilisé par** : batch AG (V2), exports lourds (V4).

### A — Moteur PDF
- **Pose** : V1 module 1.6.
- **API shared/Railway** : Puppeteer headless sur Railway, templates HTML→PDF, stockage R2 via E. Templates V1 : bordereau pesée ZD, rapport recyclage ZD (embargo H+24).
- **Réutilisé par** : attestation don AG 2041-GE (V2).

### D — Exports CSV / Excel
- **Pose** : V4 module 4.1 (1er usage réel ; les exports espace traiteur V3 peuvent réutiliser).
- **API shared** : génération CSV (collectes/événements/pesées/factures), streaming pour gros volumes, registre ZIP (bordereaux). Excel non requis V1 (CSV suffit).
- **Note** : si V3 (espace traiteur) a besoin d'exports CSV avant V4, poser D à ce moment-là — c'est le 1er usage qui déclenche, ajuster.

### F — Recherche full-text Postgres
- **Pose** : conditionnelle. À poser **seulement si** un SLA dashboard/liste l'exige (§16 Perf). Sinon pagination + index composites suffisent (optimisations autorisées sans Val, CLAUDE.md §16).
- **API shared** : `tsvector` + index GIN sur entités recherchées.

### H — Webhooks signés HMAC entrants — 🔵 DIFFÉRÉ V2
- **Pourquoi pas V1** : V1 ne reçoit pas de webhook entrant — l'adapter MTS-1 **interroge** (polling) MTS-1 et **pousse** vers MTS-1 (outbound `POST /v3/customerOrders`, auth Bearer, pas HMAC). Le contrat HMAC+JWT, dédup `body.event_id` TTL 7j, retry 3 paliers du §08 (S1-S11) = **cible V2 gelée**, validable en isolation contre `02 - …/08 - savr-api-contracts/` (Ajv).
- **Ce qui est quand même fait en V1** : l'**outbox** (`outbox_events`, E1/E2/E3/E5) est peuplée dès V1 (garde-fou 4) pour que le swap V2 (TMS natif consommant l'outbox en webhook) soit trivial. La pose de H se fera au moment du TMS natif V2.

---

## Récap : ce que V1 pose réellement

Posés : **C** (N0), **E + B + A + G** (V1). Conditionnels : **D** (V4, ou V3 si besoin), **F** (si SLA l'exige). Différé V2 : **H**.
