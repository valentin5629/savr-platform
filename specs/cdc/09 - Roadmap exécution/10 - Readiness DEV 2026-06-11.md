# Readiness DEV — 2026-06-11

> Re-run du go-dev après les 35 patchs data models + audit coherence-inter-cdc du 2026-06-11 et la régénération intégrale de `_DEV-FACING`. Vérification faite sur le Vault réel (pas sur la mémoire).

## Verdict global : 🟢 **GO-DEV** — 14/14 verts

Aucune régression introduite par les patchs 2026-06-11. Les deux bloquants du run du 2026-06-08 (Check 11 audit frère, Check 14 harnais) étaient déjà levés au 2026-06-10 ; le risque de ce run était la péremption de `_DEV-FACING` → résolu (régénéré ce jour, 0 barré / 0 stale / Ajv 21-21).

## Détail par check

| Check | Statut | Commentaire |
|-------|--------|-------------|
| 0. Fork V1 + Frontière figée | ✅ | Archive `…ARCHIVE V1+V2 2026-06-05/` + `_ARCHIVE — NE PAS MODIFIER.md` + `Journal divergence`. Scoping V1, Frontière TMS-Ready V1, Interface logistique_provider V1 présents dans `_DEV-FACING`. |
| 1. Pipeline de revue exécuté | ✅ | Tous les livrables présents (cohérence, sobriété, scoping, RLS, gherkin, migration, fixtures, observabilité, handoff). |
| 2. Statuts modules CDC | ✅ | Pas de régression statut depuis le GO du 2026-06-10. |
| 3. Questions ouvertes critiques | ⚠️ non bloquant | Aucune P0/P1 ne bloque le start Phase 1. Gates scopés plus loin (cf. ci-dessous). |
| 4. Cohérence inter-CDC sans dette | ✅ | Audit 2026-06-11 : A1 audit_logs propagé (123 réfs), B1 poids g→kg, B2 enum statut_tournee realisee→terminee. Ajv 21/21. |
| 5. Couverture RLS exhaustive | ✅ | Audit RLS V1 passé, BLOC A-E soldés (pipeline antérieur). |
| 6. Tests Gherkin par module | ✅ | 10+ fichiers App + 14 TMS. Modules critiques couverts (Auth/RLS, prog. collecte, tarif ZD, algo AG, packs, facturation, contrat API). |
| 7. Plan de migration complet | ✅ | `04 - Migration/` : inventaires Bubble+MTS-1, mappings, checks SQL, rollback, esquisse cohabitation V1→V2 (08). |
| 8. Fixtures spécifiées | ✅ | `05 - Fixtures/` : catalogue, couverture règles, timeline seed_demo, fixtures API, spec injection. |
| 9. Observabilité spécifiée | ✅ | `07 - Observabilité/` 7 fichiers (stack, logs, alertes, dashboards, health, audit trail). |
| 10. CLAUDE.md prêt | ✅ | Sections 1-16 présentes, glossaire ≥15 termes, env dev/prod, pointeurs 13-16, **0 placeholder**. |
| 11. Audit dev senior verrouillé | ✅ | Levé 2026-06-10 : frère a tout validé (hooks/Actions, G3+G4, E2=RPC dispatch, arbitrages Frontière). |
| 12. Cibles de performance | ✅ | `08 - Performance/` 6 fichiers (volumes, SLA p95, scénarios charge S1+S4 bloquants PROD). |
| 13. Roadmap d'exécution figée | ✅ | `09 - Roadmap exécution/` : N0 Foundations, transverses A-H, verticales, 11 briefs chirurgicaux, estimation tokens, tracker. |
| 14. Harnais qualité câblé | ✅ | Câblé + smoke-testé 2026-06-08 (commit-rouge bloqué exit 2), 7 artefacts, validé frère 2026-06-10. Inchangé depuis (les patchs data model ne touchent pas le harnais). |

## État `_DEV-FACING` (cœur de ce run)

- 64 fichiers code-facing régénérés (mode AGGRESSIVE), 7 dossiers.
- Invariants harnais : **0 barré résiduel, 0 fichier stale**, sentinelles Design System + Adapter MTS-1 présentes.
- 3 contrôles source pré-régé PASS : `shared.audit_logs` 0 usage actif ; §08 TMS poids kg + enum `terminee` ; `08 - savr-api-contracts` validate **21/21**.
- DDL cible V2 déjà aligné (regen 2026-06-11) — pas de regen nécessaire.

## Bloquants restants

Aucun.

## Finitions opérationnelles (NON bloquantes pour le DEV)

1. **Branch protection GitHub** — appliquer le ruleset au repo `savr-platform` (token agent rôle `write` non-admin). Action manuelle, ~15 min. À faire avant le 1er merge sur `main`, pas avant le 1er commit.
2. **Réserve §08 TMS** — 2 exemples illustratifs utilisent encore `realisee` au lieu de `terminee` pour le statut **tournée** : L610 (payload S3) et L736 (vue `v_courses_logistiques`). Enum canonique L303 + JSON Schemas corrects → n'impacte pas le code généré. À corriger côté source en prochaine session CDC, ~10 min.
3. **Repo `savr-platform` non monté dans Cowork** — le smoke test du harnais ne peut pas être rejoué depuis Cowork ; il l'a été le 2026-06-08 et le harnais n'a pas bougé depuis. Re-vérifiable côté CLI si doute.

## Reportés en readiness PROD (ne bloquent pas le DEV)

- **DNS `gosavr.io`** : ✅ levé 2026-06-11 (OVH, contacts transférés). CNAME à configurer au démarrage Phase 1 infra.
- **Gate Everest** : V1.1, hors go-live (figé). Ne bloque pas le DEV V1 (fallback MTS-1/Marathon).
- **Date d'échéance licence MTS-1** : conditionne le cutover (PROD), pas le lancement DEV.
- **Profils go-live** : à trancher avant Phases 9-10.
- **Validation juriste RSE/RGPD** : avant go-live (PROD).

## Repriorisation garde-fous TMS-Ready — respectée ✅

G3 (grep anti-couplage : `check-coupling.sh` + job CI + hook pré-commit + allowlist) et G4 (outbox par mutation : `outbox_par_mutation.test.sql` pgTAP auto-activé) **câblés en premier** (2026-06-08). Le diff schéma (garde-fou 1, contre `_DDL-CIBLE-V2/schema_cible_v2.sql`) vient ensuite, conforme à CLAUDE.md §3bis.

## Prochaine étape

GO. Concrètement :
1. Vérifier que `CLAUDE.md` est copié à la racine du repo `~/Code/savr-platform`.
2. Appliquer la branch protection au repo (finition 1 ci-dessus).
3. Lancer Claude Code sur la **Phase 1 — Fondations infra** (`09 - Roadmap exécution/00 - Niveau 0 Foundations.md`) : Supabase prod+dev `eu-west-3`, Railway, Resend, R2, repo + CI/CD, migrations DENY ALL, seed dev. DNS/CNAME en fin de Phase 1.
