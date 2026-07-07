# Readiness DEV — 2026-06-11 (re-confirmation)

> Re-run go-dev demandé par Val. 6e passage. Objectif : confirmer que le verdict GO-DEV du run #11 (post revue adversariale) tient toujours, par **vérification empirique sur le Vault réel** (pas sur la mémoire ni sur le rapport précédent).

## Verdict global : 🟢 **GO-DEV** — 14/14 verts

Aucune régression depuis le run #11. Les 4 signaux de fraîcheur critiques (lease/claim, MTS-1 non-idempotent, `pesees_tournees` INC-0, gate N) sont confirmés présents dans le DDL cible **et** dans `_DEV-FACING`. La dette « reste : régé _DEV-FACING » des notes mémoire est **soldée** (vérifiée à la main, pas supposée).

## Preuves empiriques relevées ce run

| Signal | Attendu | Mesuré | OK |
|--------|---------|--------|----|
| DDL cible — tables | ~89 | 90 `CREATE TABLE` | ✅ |
| DDL — `pesees_tournees` (INC-0) | présent | 4 réfs | ✅ |
| DDL — `claimed_until` / `requires_reconciliation` / `txid` (lease/claim) | présents | 2 / 2 / 2 | ✅ |
| `_DEV-FACING` — `pesees_tournees` | présent | 4 fichiers | ✅ |
| `_DEV-FACING` — lease/claim | présent | 10 fichiers | ✅ |
| `_DEV-FACING` — « advisory lock » | seulement la note « supprimé » | 1 occ = « l'advisory lock est supprimé » | ✅ |
| Emails — résidu « 18 templates actifs » | 0 | 0 (source + _DEV-FACING) ; « 19 templates » dans 6 fichiers source | ✅ |

## Détail par check

| Check | Statut | Commentaire |
|-------|--------|-------------|
| 0. Fork V1 + Frontière figée | ✅ | Archive `…ARCHIVE V1+V2 2026-06-05/` + `_ARCHIVE — NE PAS MODIFIER.md` + `Journal divergence`. Scoping V1, Frontière TMS-Ready V1 (5 garde-fous, **0 placeholder** vérifié), Interface logistique_provider V1 présents. |
| 1. Pipeline de revue exécuté | ✅ | Livrables présents : migration, fixtures, observabilité, tests Gherkin, RLS, roadmap, handoff. |
| 2. Statuts modules CDC | ✅ | Aucun module App V1 non-validé. Les hits grep « À démarrer »/« Brouillon » dans l'Index TMS sont des change-logs en prose pointant §16 Roadmap TMS = **V2, hors scope V1**. |
| 3. Questions ouvertes critiques | ⚠️ non bloquant | Aucune P0/P1 ne bloque Phase 1. Gates (Everest V1.1, licence MTS-1, profils go-live, juriste RGPD) scopés PROD. |
| 4. Cohérence inter-CDC sans dette | ✅ | Audit 2026-06-11 : A1 audit_logs (123 réfs), B1 poids g→kg, B2 enum statut_tournee. Ajv 21/21. |
| 5. Couverture RLS exhaustive | ✅ | Audit RLS V1, BLOC A-E soldés ; scénarios `09-rls-app-transverse`. |
| 6. Tests Gherkin par module | ✅ | 12 fichiers App (`tests/`) + lots TMS. Modules critiques couverts (auth/RLS, formulaire, facturation, algo AG, APIs). |
| 7. Plan de migration complet | ✅ | `04 - Migration/` : inventaires Bubble+MTS-1, mappings, checks SQL, rollback, esquisse cohabitation V1→V2 (08). |
| 8. Fixtures spécifiées | ✅ | `05 - Fixtures/` : catalogue, couverture règles, timeline, fixtures API, spec injection. |
| 9. Observabilité spécifiée | ✅ | `07 - Observabilité/` 7 fichiers. |
| 10. CLAUDE.md prêt | ✅ | Sections 1-16, glossaire ≥15 termes, env dev/prod, pointeurs 13-16, 0 placeholder. Intègre lease/claim + pesees_tournees + 89 tables. |
| 11. Audit dev senior verrouillé | ✅ | Levé 2026-06-10 (frère a tout validé). |
| 12. Cibles de performance | ✅ | `08 - Performance/` 6 fichiers, SLA p95 figés, S1+S4 bloquants PROD. |
| 13. Roadmap d'exécution figée | ✅ | `09 - Roadmap exécution/` complet : N0 Foundations, transverses A-H, verticales V1-V5, briefs, estimation ~31-32M tokens, tracker, conventions exécution (12). |
| 14. Harnais qualité câblé | ✅ | Câblé + smoke-testé 2026-06-08 (commit-rouge exit 2), 7 artefacts, validé frère 2026-06-10. Inchangé. Traçabilité `_Harnais qualité dev/`. |

## Bloquants restants

Aucun.

## Finitions opérationnelles (NON bloquantes pour le DEV)

1. **Branch protection GitHub** (~15 min) — appliquer le ruleset à `savr-platform` avant le 1er merge sur `main`. Passer les 4 checks skip-conditionnels (pgtap, e2e, migrations, bundle) en required à leur module d'activation.
2. **Résidu §08 TMS** (~10 min) — 2 exemples illustratifs (L610 payload S3, L736 vue `v_courses_logistiques`) utilisent encore `realisee` au lieu de `terminee` pour le statut **tournée**. Enum canonique + JSON Schemas corrects (Ajv 21/21) → n'impacte pas le code. Contrat V2 gelé, donc non bloquant V1.
3. **Repo non monté dans Cowork** — smoke test harnais non rejouable ici (fait 2026-06-08, harnais inchangé) ; re-vérifiable côté CLI si doute.
4. **Q3bis-6** — retrouver le tour d'un customerOrder MTS-1 post-timeout (plan B scan `minDate/maxDate`) : spec présente, à valider à l'implémentation de l'adapter (M1.5), non bloquant Phase 1.

## Reportés en readiness PROD

DNS gosavr.io (✅ levé, CNAME à configurer Phase 1) · Gate Everest (V1.1) · échéance licence MTS-1 (conditionne cutover) · profils go-live · validation juriste RSE/RGPD.

## Prochaine étape — GO

1. Vérifier que `CLAUDE.md` est copié à la racine de `~/Code/savr-platform`.
2. Appliquer la branch protection (finition 1).
3. Lancer Claude Code sur la **Phase 1 — Fondations infra** (`00 - Niveau 0 Foundations.md`) : modules 0.2 Supabase → 0.10 Audit trail (0.1 Setup tooling déjà ✅). Checkpoint audit frère en fin de Niveau 0.
