# 08 - Checkpoint repo pré-dev (2026-06-10)

> Vérification de l'état réel du repo `~/Code/savr-platform` avant de lancer le 1er module de dev (0.1 Setup tooling).
> Faite en session Cowork (accès lecture au repo monté). Cocher les actions au fur et à mesure.

---

## ✅ Vérifié — PRÊT

- **Squelette monorepo** : `packages/{plateforme,tms,shared,adapters}` présents (vides sauf `shared/src` — normal, aucun module codé). Configs racine OK : `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`, `eslint.config.js`, `package.json`, `pnpm-lock.yaml`.
- **Harnais qualité — 7 artefacts présents** : `.claude/settings.json` + 3 hooks (`pre-commit-gate`, `block-destructive`, `format-file`), 4 agents reviewers, `.github/workflows/quality.yml`, `BRANCH_PROTECTION.md`, `DEFINITION_OF_DONE.md`, `RUNBOOK_INCIDENT.md`, `CHECKLIST_CHECKPOINT.md` + annexes (`.gitignore`, `.gitleaks.toml`, `.size-limit.json`, `.env.example`, `.nvmrc`).
- **Garde-fous TMS-Ready 3 & 4 câblés** : `scripts/check-coupling.sh` + `coupling-allowlist.txt`, `supabase/tests/outbox_par_mutation.test.sql`.
- **GitHub** : remote `origin` configuré et poussé → `valentin5629/savr-platform`. (La dette §6 « pas encore poussé » est levée.)
- **Secrets** : `.env.local` correctement gitignoré et NON tracké. Seul `.env.example` est versionné. Working tree propre.

## 🔧 À corriger AVANT le module 0.1

- [x] **CLAUDE.md rafraîchi + mergé sur `main`** (PR #2, commit `3306d61`). Corrige `packs_ag`→`packs_antgaspi`, outbox durci, multi-camions, Gate Everest V1.1, pointeurs §9.
- [x] **`_DEV-FACING/` rendu accessible** : symlink local `_DEV-FACING` dans le repo → `~/Desktop/Obsidian Savr/_DEV-FACING` (gitignoré, machine-specific). Claude Code trouvera les specs.
- [x] **Fichier parasite `.env.local^c` supprimé.**
- [ ] **Token GitHub en clair (ACTION VAL)** : le PAT est stocké en clair dans l'URL du remote (`.git/config`). → **Régénérer le token + passer en SSH ou credential helper.**
- [x] **Housekeeping git** : sur `main`, branches temporaires supprimées (local + remote), `main` local aligné sur `origin/main`.

## 🧭 Décisions workflow (2026-06-10)

- **Self-merge sur `main`** : ruleset GitHub passé à `required approvals = 0` (Val merge seul, sans relecture frère obligatoire). Trade-off acté en connaissance de cause : la sécurité de `main` repose désormais sur la CI seule.
- **À FAIRE dès le module 0.1 livré + CI verte** : rendre les checks CI **obligatoires** sur `main` (le filet automatique qui remplace la relecture humaine). Squelette vide actuel = CI rouge normale (rien à tester), laissée non-bloquante pour avancer.
- Découverte : la **branch protection était déjà active** sur GitHub (dette §6 "branch protection à appliquer" → en partie levée ; reste à durcir les required checks).

## 🔒 Bloquants hors repo (déjà connus, rappel)

- Validation du harnais par le frère (Check 11 readiness DEV).
- Branch protection GitHub à appliquer manuellement (`BRANCH_PROTECTION.md`).
- ✅ DNS `gosavr.io` levé 2026-06-11 (OVH, demande 4468362) · échéance licence MTS-1 · validation juriste RGPD.

---

*Source : vérification repo 2026-06-10. Met à jour les cases au fil des correctifs.*
