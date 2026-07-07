# Readiness DEV — 2026-06-11 (post revue adversariale concurrence)

> Re-run du go-dev demandé après la **revue adversariale concurrence** (lease/claim outbox, MTS-1 non-idempotent, table `pesees_tournees` INC-0, gate N + agrégation `FOR UPDATE`). Risque ciblé de ce run : péremption de `_DEV-FACING` / DDL cible vis-à-vis de ces 4 bloquants. Vérification faite sur le Vault réel.

## Verdict global : 🟢 **GO-DEV** — 14/14 verts

Le risque pivot est levé : `_DEV-FACING` **et** `_DDL-CIBLE-V2/schema_cible_v2.sql` intègrent déjà les changements de la revue adversariale. La note mémoire « reste : régé `_DEV-FACING` » est **résolue** (vérifiée empiriquement, pas sur la mémoire).

## Preuves de fraîcheur (cœur de ce run)

- **DDL cible** : 89 tables schéma-qualifiées (55 `plateforme` + 32 `tms` + 2 `shared`) ; `pesees_tournees` présente ; `claimed_until` / `requires_reconciliation` présents → lease/claim + INC-0 absorbés.
- **`_DEV-FACING`** : `pesees_tournees` dans 4 fichiers ; lease/claim dans 3 fichiers ; l'unique occurrence « advisory lock » est la note explicite « **l'advisory lock est supprimé** » (R2) — pas un résidu du pattern abandonné.
- **Cohérence email** : correction « 19 templates actifs » (2026-06-11) propagée source §06.02 **et** `_DEV-FACING` ; zéro résidu « 18 templates actifs ».

## Détail par check

| Check | Statut | Commentaire |
|-------|--------|-------------|
| 0. Fork V1 + Frontière figée | ✅ | Archive `…ARCHIVE V1+V2 2026-06-05/` + `_ARCHIVE — NE PAS MODIFIER.md` + `Journal divergence`. Scoping V1, Frontière TMS-Ready V1 (5 garde-fous, 0 placeholder), Interface logistique_provider V1 présents. |
| 1. Pipeline de revue exécuté | ✅ | Livrables présents : cohérence, sobriété, scoping, RLS, gherkin, migration, fixtures, observabilité, handoff. |
| 2. Statuts modules CDC | ✅ | Aucun module App au statut non-validé (les 2 hits grep = états collecte / brouillons factures, faux positifs). TMS §16 Roadmap « À démarrer » = V2, hors scope V1. |
| 3. Questions ouvertes critiques | ⚠️ non bloquant | Aucune P0/P1 ne bloque Phase 1. Gates (Everest, licence MTS-1, profils go-live, juriste) scopés PROD. |
| 4. Cohérence inter-CDC sans dette | ✅ | Audit 2026-06-11 : A1 audit_logs (123 réfs), B1 poids g→kg, B2 enum `statut_tournee` realisee→terminee. Ajv 21/21. |
| 5. Couverture RLS exhaustive | ✅ | Audit RLS V1, BLOC A-E soldés. |
| 6. Tests Gherkin par module | ✅ | 12 fichiers App + 42 TMS. Modules critiques couverts. |
| 7. Plan de migration complet | ✅ | `04 - Migration/` : inventaires Bubble+MTS-1, mappings, checks SQL, rollback, esquisse cohabitation V1→V2 (08). |
| 8. Fixtures spécifiées | ✅ | `05 - Fixtures/` complet. |
| 9. Observabilité spécifiée | ✅ | `07 - Observabilité/` 7 fichiers. |
| 10. CLAUDE.md prêt | ✅ | Sections 1-16, glossaire ≥15 termes, env dev/prod, pointeurs 13-16, 0 placeholder. Intègre lease/claim + pesees_tournees + 89 tables. |
| 11. Audit dev senior verrouillé | ✅ | Levé 2026-06-10 (frère a tout validé). |
| 12. Cibles de performance | ✅ | `08 - Performance/` 6 fichiers, SLA p95 figés, S1+S4 bloquants PROD. |
| 13. Roadmap d'exécution figée | ✅ | `09 - Roadmap exécution/` : N0 Foundations, transverses A-H, verticales, briefs chirurgicaux, estimation tokens (~31M), tracker. PR #3 mergée (0.1 Setup tooling ✅). |
| 14. Harnais qualité câblé | ✅ | Câblé + smoke-testé 2026-06-08 (commit-rouge exit 2), 7 artefacts, validé frère 2026-06-10. Inchangé (la revue adversariale touche le data model, pas le harnais). Traçabilité `_Harnais qualité dev/`. |

## Bloquants restants

Aucun.

## Finitions opérationnelles (NON bloquantes pour le DEV)

1. **Branch protection GitHub** — appliquer le ruleset au repo `savr-platform` avant le 1er merge sur `main` (~15 min). 0.1 a déjà posé 4 checks required ; passer les 4 skip-conditionnels (pgtap, e2e, migrations, bundle) en required à leur module d'activation.
2. **Réserve §08 TMS** — 2 exemples illustratifs utilisent encore `realisee` au lieu de `terminee` pour le statut **tournée** (L610 payload S3, L736 vue `v_courses_logistiques`). Enum canonique + JSON Schemas corrects → n'impacte pas le code. À corriger en source, ~10 min.
3. **Repo `savr-platform` non monté dans Cowork** — smoke test harnais non rejouable ici (fait le 2026-06-08, harnais inchangé). Re-vérifiable côté CLI si doute.
4. **Q3bis-6 (revue adversariale)** — retrouver le tour d'un customerOrder MTS-1 post-timeout (plan B scan `minDate/maxDate`) : spec présente, à valider à l'implémentation de l'adapter (M1.5), non bloquant pour Phase 1 Foundations.

## Reportés en readiness PROD

DNS gosavr.io (✅ levé, CNAME à configurer Phase 1) · Gate Everest (V1.1) · échéance licence MTS-1 (conditionne cutover) · profils go-live · validation juriste RSE/RGPD.

## Prochaine étape — GO

1. Vérifier que `CLAUDE.md` est copié à la racine de `~/Code/savr-platform`.
2. Appliquer la branch protection (finition 1).
3. Lancer Claude Code sur la **Phase 1 — Fondations infra** (`00 - Niveau 0 Foundations.md`) : modules 0.2 Supabase → 0.10 Audit trail (0.1 déjà ✅). Checkpoint audit frère en fin de Niveau 0.
