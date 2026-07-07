# Squelette V5 — Migration Bubble + go-live

> Briefs détaillés générés juste-à-temps. La matière existe déjà dans `04 - Migration/` (plan figé 2026-06-07 : 12 types, 8 mappings, checks SQL, rollback). Le cutover sera raffiné par la skill `cdc-cutover-plan` (post-roadmap).

**Dépend de** : V1→V4 (le modèle doit être complet pour importer l'historique).

| Module | Périmètre | Sources | Tests | Budget (≈) |
|---|---|---|---|---|
| M5.1 — Extraction Bubble + mapping | Scripts extraction (~1 500 AG + ~175 ZD + lieux + orgas + users), mapping table par table | `04 - Migration/01-02` | checks réconciliation | M ~500k |
| M5.2 — Transformation + import Supabase | Logique de transformation + scripts d'import, `statut_tms=non_envoye`, `origine`/`migration_bubble` | `04 - Migration/03-04` | réconciliation | M ~600k |
| M5.3 — Checks réconciliation + rollback | Checks SQL (comptages, intégrité), plan de rollback | `04 - Migration/05-06` | SQL réconciliation | S ~300k |
| M5.4 — Double-run + bascule DNS + go-live | Test parallèle 2-4 sem, email pré-bascule J-15, bascule DNS `app.gosavr.io`, go-live | `04 - Migration/07`, §13 | manuel | M ~400k |

**🔒 Pré-requis go-live (CLAUDE.md §7)** :
- Gate Everest tranché (M2.5 livré ou Everest reporté V1.1).
- DNS `gosavr.io` : registrar/hébergeur identifié (CNAME Supabase/Railway/Vercel).
- Date échéance licence MTS-1 connue (go-live ≥ échéance − 1 mois double-run).
- Validation juriste RSE/RGPD (base légale géoloc, notice, AIPD).
- Scénarios de charge S1 nominal + S4 endurance passés (`cdc-readiness-check` PROD).

**Ordre** : M5.1 → M5.2 → M5.3 → (double-run) → M5.4.
**Budget V5 ≈ 1,8M** (scripts + bascule ; hors période de double-run).
