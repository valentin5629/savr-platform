# 12 - Conventions d'exécution Claude Code (accès specs, tests par module, mocks)

> Créé 2026-06-11 (challenge roadmap). Corrige 3 failles d'autonomie : (1) pointeurs specs illisibles depuis le repo, (2) conditions /goal vacues, (3) CI dépendante de services externes. **Ces conventions priment sur les formulations antérieures des briefs.**

---

## 1. Accès aux specs depuis le repo — dossier `specs/` versionné

**Problème** : les briefs pointent `_DEV-FACING/…` et `01 - Cahier des charges App/tests/…` = chemins du Vault Obsidian, **inaccessibles** depuis `~/Code/savr-platform`. CLAUDE.md interdit par ailleurs de lire les sources brutes — or les scénarios de test n'existaient que dans les sources brutes.

**Règle** : le repo contient un dossier `specs/` versionné, miroir dérivé du Vault :

| Repo | Source Vault | Régénération |
|---|---|---|
| `specs/cdc/` | `_DEV-FACING/` (App + TMS) | `cdc-devfacing-export` puis copie |
| `specs/tests/` | `01 - Cahier des charges App/tests/` + `02 - …/tests/` (scénarios Gherkin) | copie à chaque modif |
| `specs/ddl-cible/schema_cible_v2.sql` | `_DDL-CIBLE-V2/` | à chaque regel du DDL |
| `specs/fixtures/` | `05 - Fixtures/` | copie à chaque modif |
| `specs/manifests/` | générés par brief (cf. §2) | à la re-validation JIT du brief |

- **Lecture des pointeurs** : dans tous les briefs, `_DEV-FACING/X` se lit `specs/cdc/X` et `01 - …/tests/X` se lit `specs/tests/X`.
- `specs/` est **dérivé et regénérable** — ne jamais l'éditer à la main dans le repo ; toute correction passe par le Vault puis re-sync. Commit dédié `specs: sync YYYY-MM-DD`.
- La pose initiale de `specs/` = complément du module 0.1 (script `scripts/sync-specs.sh` documenté, exécuté côté Mac par Val/Cowork puisque le Vault n'est pas dans le repo).
- CLAUDE.md (racine repo) reste la 1re lecture ; ses pointeurs §9 se résolvent dans `specs/cdc/`.

## 2. Convention tests par module — anti-/goal vacue

**Problème** : `pnpm test --filter M1.1` ne correspond à rien (`--filter` cible un package pnpm) et un filtre qui matche 0 test est vert → le vérificateur /goal validerait un module vide. « Scénarios 06.06 verts » est en plus inatteignable (06.06 contient des scénarios packs AG = V2).

**Règles** :

1. **Nommage** : chaque test (Vitest, pgTAP, Playwright) porte l'ID de son module et du scénario couvert dans son titre : `test("M1.2 / 06.01-S14 — pax obligatoire", …)`. Fichiers : `*.m1-2.test.ts` (Vitest), `m1_2__*.test.sql` (pgTAP), `m1-2.*.spec.ts` (Playwright).
2. **Script `pnpm test:module <id>`** (posé en 0.1) : lance tous les tests dont le titre/fichier matche l'ID. **Échoue si 0 test collecté** (anti-vacuité).
3. **Manifest de couverture** : `specs/manifests/M1.2.json` = liste fermée des IDs de scénarios du module (sous-ensemble des fichiers `specs/tests/…`, arbitré à la rédaction du brief — c'est lui qui définit le « volet ZD » de 06.01, les scénarios non-packs de 06.06, etc.).
4. **Script `pnpm check:coverage <id>`** (posé en 0.1) : échoue si un ID du manifest n'apparaît dans aucun titre de test vert. C'est le mécanisme qui transforme « scénarios verts » en condition binaire complète, sur le modèle du script de couverture RLS (0.6).
5. **Condition /goal canonique** (remplace `pnpm test --filter M_X.Y` partout, template 04 inclus) :
   > `pnpm test:module M_X.Y` vert ET `pnpm check:coverage M_X.Y` vert ET `pnpm build` ET `pnpm lint` [ET pgTAP module ET Playwright parcours].

## 3. Mocks API tierces — la CI ne dépend jamais d'un service externe

**Problème** : « mock MTS-1 dispo en dev » est un pré-requis de M1.5 qu'aucun module ne construit ; le Playwright signup (0.5) appelle INSEE/VIES ; M1.7 suppose la sandbox Pennylane ; 0.9 teste Sentry/Slack en e2e. Tests flaky = /goals qui échouent ou valident de travers.

**Règles** :

1. **Aucun test CI n'appelle un service externe réel.** Sandbox Pennylane et Slack réel = vérifs manuelles au checkpoint humain, jamais dans le /goal.
2. **Module 0.11 — Mocks & fixtures API tierces** (cf. `00 - Niveau 0`) fournit dans `packages/shared/testing/` : mock MTS-1 (customerOrders/tours/photos, scénarios par fixture dont `tours_pesees_flux.json`, multi-camions, KO partiel, timeout post-POST pour Q3bis-6), mock INSEE + VIES (vérifié/rejeté/down — teste la dégradation gracieuse), mock Pennylane v2, mock Resend, sink Sentry/Slack (assertion sur le payload émis, pas sur la livraison).
3. Chaque brief référence explicitement les mocks qu'il consomme dans ses pré-requis.

## 4. Re-validation JIT des briefs — anti-péremption

**Problème** : les briefs V1 du 2026-06-08 étaient périmés au 2026-06-11 (revue adversariale : lease/claim, `pesees_tournees`, multi-camions). Un brief statique contredit un CDC vivant, et c'est le brief qui cadre la session.

**Règles** :

1. **Avant chaque /goal** : re-valider le brief contre `specs/cdc/` à jour (même logique que les squelettes V2-V5 générés juste-à-temps). Toute divergence brief ↔ spec = régénérer le brief, jamais « on corrigera en route ».
2. Check rapide : la date du dernier `specs: sync` doit être ≥ la date du dernier audit/revue du Vault.
3. Le manifest du module (cf. §2) est produit/revu à ce moment-là.

## 5. Checkpoint humain & mesure de conso

- Checkpoint entre modules = dérouler `CHECKLIST_CHECKPOINT.md` (harnais, `_Harnais qualité dev/`), pas une relecture libre du diff. Rollback module = `RUNBOOK_INCIDENT.md`.
- Conso réelle = `/cost` en fin de session → reporter dans `06 - Suivi exécution` colonne « Tokens réels ».

## 6. Sessions XL — sous-lots obligatoires

Un module > ~800k tokens ne tient pas dans « 1 session < 2h » : compactions de contexte multiples = dérive. Les modules XL (0.3, 0.4, M1.1, M1.5) sont découpés en **sous-lots avec /goal propre et checkpoint propre** (détail dans chaque brief). La règle « 1 module = 1 session » devient « 1 sous-lot = 1 session » pour ces modules.
