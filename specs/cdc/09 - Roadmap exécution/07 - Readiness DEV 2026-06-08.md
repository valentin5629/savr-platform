# Readiness DEV — 2026-06-08

## Verdict global : 🔴 NO-GO → **1 bloquant restant**

Initialement 2 bloquants (Check 11 + Check 14). **Check 14 résolu le 2026-06-08** (harnais câblé + smoke test vert, cf. `_Harnais qualité dev/`). Reste **Check 11** (audit frère pas confirmé) avant GO. Plus deux finitions manuelles côté repo GitHub : appliquer la branch protection + validation syntaxe du frère.

---

## Détail par check

| Check | Statut | Commentaire |
|-------|--------|-------------|
| 0. Fork V1 + Frontière TMS-Ready | ✅ | Archive `… ARCHIVE V1+V2 2026-06-05` + `_ARCHIVE — NE PAS MODIFIER.md` + `Journal divergence`. CDC V1 vivant, `00 - Scoping V1.md`, `Frontière TMS-Ready V1.md` = 5 garde-fous remplis, 0 placeholder. |
| 1. Pipeline de revue | ⚠️ | coherence-inter-cdc ✅, review-sobriété ✅, v1-scoping ✅, audit-rls ✅, test-scenarios ✅, migration ✅, fixtures ✅, observabilité ✅, handoff ✅, **dev-quality-loop = spec seule, pas câblé** (cf. Check 14). |
| 2. Statuts modules | ✅ | Tous les modules V1 = `Validé`/`V1 rédigée`. Seul `§16 Roadmap TMS` = « À démarrer » = V2 hors scope. `§13 Migration` en draft = couvert par `04 - Migration/`. |
| 3. Questions ouvertes | ⚠️ | Aucune P0/P1 bloquant le **démarrage** Phase 1. Gates scopés : **Everest** (bloque Phase 10 seulement), **✅ DNS gosavr.io levé 2026-06-11** (OVH, demande 4468362 ; CNAME à configurer Phase 1 infra), profils go-live (Phase 9-10), MTS-1/juridique (readiness PROD). |
| 4. Cohérence inter-CDC | ✅ | Dernier audit 2026-06-07 = 26/26, 0 divergence, résidus soldés. |
| 5. Couverture RLS | ✅ | Audit RLS V1 App + TMS : blocs A-E résolus (28 tables App, helpers `f_collecte_visible`/`f_fichier_visible`, cross-schema validé). pgTAP spécifié bloquant CI. |
| 6. Tests Gherkin par module | ✅ | 12 fichiers `tests/` App + 14 TMS. Modules critiques couverts : Auth/RLS (`09-rls`), programmation (`06.01`/M01), tarif ZD, algo AG (`06.09`), packs AG, facturation (`06.08`), contrat API (`08-apis`). |
| 7. Plan de migration | ✅ | `04 - Migration/` complet : inventaires Bubble + MTS-1, mappings, ordre, transformations, checks réconciliation SQL, rollback, données abandonnées. |
| 8. Fixtures | ✅ | `05 - Fixtures/` : catalogue, couverture règles métier, timeline seed_demo, fixtures API, spec injection. Grilles réelles intégrées. |
| 9. Observabilité | ✅ | `07 - Observabilité/` 7 fichiers : stack (Supabase Logs + Sentry + Better Uptime + Slack 3 canaux), logs business/techniques, alertes, dashboards, health checks, audit trail. |
| 10. CLAUDE.md | ✅ | Racine Vault, §1-16 présentes, glossaire 14+ termes, env dev/prod, pointeurs migration/fixtures/observabilité/perf. Pas de placeholder. |
| 11. Audit dev senior (frère) | ❌ | **Pas encore confirmé** — ni engagement ferme, ni périmètre, ni dates. BLOQUANT. |
| 12. Cibles perf | ✅ | `08 - Performance/` 6 fichiers, SLA p95 figés, volumes an 1/an 3. (Recommandé, non bloquant DEV — fait.) |
| 13. Roadmap d'exécution | ✅ | `09 - Roadmap exécution/` : Niveau 0, transverses A-H, verticales, briefs V1 (M1.1→M1.7), template brief, estimation tokens (~31M), suivi. |
| 14. Harnais qualité câblé | ✅ (depuis 2026-06-08) | **Câblé + smoke-testé** : repo `savr-platform/`, hooks (commit rouge bloqué exit 2 prouvé), 4 reviewers, `quality.yml`, DoD/runbook/checklist. Cf. `_Harnais qualité dev/00 - Harnais câblé 2026-06-08.md`. Reste manuel : branch protection au repo GitHub + validation frère. |

---

## Bloquants à résoudre avant GO

### 1. Check 14 — Câbler le harnais qualité — ✅ RÉSOLU 2026-06-08
Harnais câblé dans `savr-platform/` + smoke test vert (commit rouge bloqué exit 2, commit vert exit 0, commandes destructives bloquées). Détail : `_Harnais qualité dev/00 - Harnais câblé 2026-06-08.md`. Restent 2 actions manuelles côté Val au moment de créer le repo GitHub : appliquer `BRANCH_PROTECTION.md` + faire valider la syntaxe hooks/CI par le frère.

<details><summary>Procédure d'origine (faite)</summary>

À faire avant tout module métier :
1. Créer le repo + squelette monorepo (pnpm/Turborepo).
2. Coller les configs depuis `_Plugin Savr/skills/cdc-dev-quality-loop/references/configs-pretes-a-coller/` : `.claude/settings.json` + hooks, `.claude/agents/{principal,rls-securite,conformite-spec}.md`, `.github/workflows/quality.yml`, `DEFINITION_OF_DONE.md`, `RUNBOOK_INCIDENT.md`, `CHECKLIST_CHECKPOINT.md`.
3. Activer branch protection sur `main` (PR + checks verts + token agent non-admin).
4. **Smoke test obligatoire** : tenter un `git commit` avec une erreur de type → doit être bloqué par le hook pré-commit. Sans ce test vert, le harnais n'est pas opérationnel.

</details>

### 2. Check 11 — Verrouiller l'audit du frère (≈ 1h de calage) — **seul bloquant restant**
- Confirmer son engagement ferme sur les 2 phases d'audit (avant dev + avant prod).
- Figer le périmètre : archi, sécurité hors RLS, perf DB, migration.
- Poser les dates dans le calendrier.

---

## Recommandations non bloquantes (à traiter tôt en Phase 1)

- ✅ **DNS `gosavr.io`** : **LEVÉE 2026-06-11** — registrar = OVH, contacts transférés (demande 4468362). CNAME Supabase/Railway/Vercel à configurer au démarrage Phase 1 infra.
- **Régénérer `_DEV-FACING/`** : les dossiers `07 - Observabilité/` et `08 - Performance/` ont été ajoutés après le dernier export. Régénérer (`cdc-devfacing-export`) avant le 1er run Claude Code, sinon il lit du périmé.
- **Gate Everest** : scopé Phase 10. Ne bloque pas Phase 1-9. Attendre la réponse du dev Everest avant de coder l'adapter (mail envoyé 2026-06-07).
- **Profils go-live** : trancher quels rôles sont indispensables au go-live avant d'ordonnancer Phases 9-10.

---

## Prochaine étape

NO-GO. Pour passer en GO-DEV :
1. Câbler le harnais qualité + smoke test commit rouge (Check 14).
2. Confirmer + calendariser l'audit frère (Check 11).
3. Relancer `cdc-readiness-check` (go-dev) pour re-vérifier ces 2 checks → si verts, GO.

En parallèle (sans débloquer le go) : régénérer `_DEV-FACING/`, attaquer le DNS.
