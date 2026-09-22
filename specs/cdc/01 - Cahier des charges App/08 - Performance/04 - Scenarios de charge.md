# 08 - Performance / 04 - Scenarios de charge

**Statut** : Validé V1
**Dernière mise à jour** : 2026-06-08 (skill `cdc-perf-load`)
**Décision Val 2026-06-08** : scénarios **1 (nominal) + 4 (endurance) = BLOQUANTS** avant `cdc-readiness-check` mode PROD. Scénarios 2 / 3 / 5 = documentés, exécution reportée V1.1 (ou avant go-live grand compte si pic anticipé).
**Outil** : k6 (gratuit, scripts versionnés dans `tests/load/`). Base de données : `seed_demo` chargé au volume An 1.

---

## Scénario 1 — Charge nominale ✅ BLOQUANT

Dimensionné An 1 ([[01 - Volumes attendus]] = 50 users simultanés en pic).

- **Charge** : 50 utilisateurs simultanés actifs (ramp-up 2 min).
- **Mix** : 70 % lecture, 25 % écriture, 5 % batch déclenché.
- **Durée** : 30 minutes.
- **Profil** : reproduit le pic lundi matin (listes + fiches + soumission formulaire collecte).
- **Critère de succès (gate PROD)** :
  - Tous les SLA **p95** de [[02 - SLA par endpoint]] respectés.
  - Taux d'erreur global < 0,1 %.
  - Connexions DB < 80 % du pool (< 160).

---

## Scénario 4 — Endurance 24 h ✅ BLOQUANT

- **Charge** : charge nominale soutenue (≈ profil scénario 1 atténué) sur 24 h.
- **Critère de succès (gate PROD)** :
  - Pas de fuite mémoire (RSS stable côté Vercel/Railway).
  - Pas de dégradation progressive des p95 (delta < 20 % entre h+1 et h+24).
  - Connexions DB stables, pas de saturation progressive du pool.
  - File `jobs_pdf` ne s'accumule pas anormalement.

---

## Scénario 2 — Pic d'activité ×3 ⏸ V1.1

- **Charge** : 150 users simultanés (pic événementiel / grand compte).
- **Mix** : 80 % écriture, 20 % lecture.
- **Durée** : 15 minutes.
- **Critère** : p95 respecté à ±50 %, p99 dégradé toléré, 5xx < 1 %.
- **Déclencheur d'activation anticipée** : tout déploiement grand compte (type Viparis) avant 12 mois → exécuter ce scénario avant le go-live concerné.

---

## Scénario 3 — Batch concurrent ⏸ V1.1

- **Charge** : batch attestations J+1 lancé pendant la charge nominale (scénario 1).
- **Critère** : le front continue de répondre dans ses SLA, le batch termine dans son SLA (< 10 min), pas de contention sur le pool DB.

---

## Scénario 5 — Résilience API tierces lentes ⏸ V1.1

- **Charge** : simuler Pennylane (et/ou Everest) à 5 s de latence pendant 10 min.
- **Critère** : le front reste réactif (push async, jamais bloquant), les files de retry s'accumulent sans crash, les alertes Slack `#savr-alerts-eleve` sont reçues.
- **Pré-requis V1** : ce comportement est **déjà conçu** (push Pennylane/Everest async hors transaction, retry 3 paliers). Le scénario ne fait que le **vérifier sous charge**.

---

## Spec d'implémentation (pour Claude Code)

- Scripts k6 dans `tests/load/` : `s1_nominal.js`, `s4_endurance.js` (bloquants) ; `s2_pic.js`, `s3_batch.js`, `s5_resilience.js` (squelettes V1.1).
- Chaque script tag les requêtes par endpoint pour vérifier les p95 par catégorie de [[02 - SLA par endpoint]].
- Cible : environnement **dev** (`dev.app.gosavr.io`) avec `seed_demo` au volume An 1 — **jamais la prod**.
- Les seuils k6 (`thresholds`) encodent directement les critères de succès → le run échoue (exit ≠ 0) si un p95 bloquant est dépassé, ce qui alimente le gate `cdc-readiness-check` PROD.
