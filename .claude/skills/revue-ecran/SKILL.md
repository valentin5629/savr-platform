---
name: revue-ecran
description: >-
  Protocole de revue et correction d'un écran pendant les tests E2E Savr, screenshot par screenshot. À utiliser
  dès que Val envoie une capture d'un écran à corriger, dit « revue écran », « corrige cet écran », « voici un
  bug E2E », « ce KPI est faux », « ce libellé cloche », ou signale un défaut visuel/fonctionnel constaté en
  testant l'app. Encode les 4 garanties : (1) contexte cherché au bon endroit, (2) toutes les règles de dev
  respectées (gates mécaniques + DS par défaut), (3) rien de déjà validé n'est cassé, (4) zéro collision de
  branche (worktree dédié, jamais `main`, jamais la branche d'une autre session).
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent
---

# revue-ecran — corriger un écran signalé en E2E, sans rien casser

But : transformer un screenshot + un constat de Val en **un fix scopé, conforme au CDC, vérifié dans le
navigateur, livré sur une branche isolée** — sans jamais toucher à `main`, à la branche d'une autre session,
ni à une zone déjà figée.

> **Principe cardinal : un écran signalé n'est PAS forcément un bug de code.** Avant de coder, trancher :
> défaut de code (→ je corrige) OU écart de spec / règle métier (→ `spec-resolver`, et **STOP + demande à Val**
> si non couvert). On ne réinterprète jamais une règle métier pour « faire coller » l'écran au screenshot.

> **Deuxième principe : les garde-fous sont mécaniques, pas déclaratifs.** gate-brief, pre-commit (coupling G3
>
> - typecheck + lint + test:unit, exit 2 = bloqué), gate-pr (tests verts + `conformite-spec` GO), pgTAP RLS,
>   outbox G4 — ils BLOQUENT. Cette skill s'appuie dessus, elle ne les remplace pas par de la bonne volonté.

## Sources de contexte (ordre strict — ne jamais sauter un niveau)

1. `CLAUDE.md` (racine du repo) — décisions non-négociables.
2. Mémoire projet (`MEMORY.md` + fichiers `~/.claude/projects/-Users-valentinleblan-Code-savr-platform/memory/`) — ce qui a été mergé / figé / appris.
3. `specs/cdc/…` — export dev-facing du Vault. **JAMAIS** les sources brutes `01 - …/` `02 - …/` du Vault.
4. Subagent `spec-resolver` si une règle est ambiguë ou absente.
5. Introuvable après recherche exhaustive → **STOP, demander à Val** (ne pas interpréter).

## Procédure (dans l'ordre — chaque étape conditionne la suivante)

### 0. Pré-vol — collision de session concurrente (AVANT tout, une seule fois par session)

But : au démarrage, détecter si **une autre session est déjà en cours** et présente un risque, ALERTER Val, et
lui laisser **reporter cette session** plutôt que de courir un incident. À exécuter dès la première invocation de
la skill dans la session (pas à chaque screenshot). Tout est en **lecture seule**.

```bash
REPO="$(git rev-parse --show-toplevel)"
# [1] Clone principal hors 'main' → une autre session l'occupe (RISQUE FORT : HEAD/index partagés)
git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || echo "(HEAD détaché sur le clone principal)"
# [2] Working tree principal sale → WIP d'une autre session
git -C "$REPO" status --short
# [3] Worktrees actifs sur branche feature (sessions parallèles)
git -C "$REPO" worktree list | awk 'NR>1 && $0 !~ /detached/'
# [4] Attestations/briefs récents (< 3h) → module/lot en cours ailleurs
find "$REPO/.claude" -maxdepth 1 -type f \( -name 'brief-ack-*' -o -name 'conformite-ok-*' -o -name 'securite-ok-*' \) -newermt '-3 hours'
# [5] Dev server déjà up → collision preview + seed savr-dev partagé
lsof -ti tcp:3001 || true
```

Interprétation :

- **Signal FORT** = [1] clone principal ≠ `main`, **ou** [2] working tree principal sale, **ou** [3] worktree(s)
  sur `feat/*`/`fix/*` (hors spikes détachés). → une ou plusieurs sessions tournent en parallèle.
- **Signal RESSOURCE** = [5] `:3001` occupé (deux dev servers se marchent dessus, et le seed `savr-dev` est
  partagé → une seule session « possède » le seed pour l'E2E à un instant T). [4] = contexte (du travail s'atteste ailleurs).

Sortie du pré-vol :

- **Aucun signal** → une ligne « ✅ Pré-vol OK, pas de session concurrente détectée » et enchaîner sur l'Intake.
- **≥ 1 signal** → **ALERTE en tête de réponse** : lister ce qui est détecté (branche du clone principal,
  worktrees actifs + leur branche, PID sur `:3001`), rappeler les risques (corruption HEAD/index si on partage un
  working tree, conflit de merge si le fix vise un **sujet commun** à une session active, écrasement du seed
  `savr-dev` / du port `:3001`). Puis **demander à Val** : _reporter cette session, ou continuer_ ? Ne pas
  démarrer le fix tant qu'il n'a pas tranché.
- **Rappel** : la skill impose déjà un worktree DÉDIÉ (étape 3), donc le git du NOUVEAU travail est isolé par
  construction. Le pré-vol protège de ce que l'isolation git ne couvre pas : ne pas rajouter une session dans un
  clone déjà occupé, repérer un **chevauchement de sujet** avec une session active (→ conflit de merge annoncé),
  et les ressources partagées hors git (DB dev, port).

### 1. Intake du screenshot (contexte au bon endroit)

Extraire / réclamer à Val **3 infos** (les demander si absentes) :

- **Rôle / persona connecté** (admin_savr, traiteur_manager, traiteur_commercial, agence, gestionnaire_lieux, client_organisateur) → détermine RLS + espace + ce qui DOIT être visible.
- **Route / URL** visible → localise le fichier exact.
- **Attendu vs constaté** → distingue le bug de code de la question de spec.

Puis charger le contexte de l'écran dans l'ordre des sources ci-dessus. Identifier le module CDC concerné
(`CLAUDE.md` §9 « Pointeurs CDC par module ») et lire la section `specs/cdc/…` pertinente **avant** de coder.

### 2. Diagnostic : bug de code OU question de spec ?

- **Zone FIGÉE ?** Vérifier la mémoire projet. Blocs Cockpit R24/R24b (présentationnel validé GO-VISUAL),
  logo « + savr » (#221), et tout écran marqué GO-VISUAL. **Si le fix les touche → prévenir Val AVANT de coder.**
- **Session parallèle ?** `git worktree list` — un screenshot peut porter sur un écran en cours de refonte par
  une autre session (une branche `feat/…` active). Si oui → signaler à Val, ne pas entrer en collision.
- **Localiser** le fichier via la route (`packages/plateforme/src/app/…`). Confirmer le symbole réel
  (`grep -rn`), ne jamais se fier à un chemin supposé.
- **Trancher** : écart visuel/logique isolé = bug de code → étape 3. Comportement conforme au code mais
  divergent du CDC, ou règle métier non couverte = **question de spec** → `spec-resolver`, sinon STOP + Val.
  Bug/ambiguïté de spec détecté → écrire un fichier `_Divergences/` (cf. CLAUDE.md §4), ne pas patcher `specs/`.

### 3. Isolation branche (anti-collision — le cœur de la garantie 4)

Reconnaître l'état AVANT tout : `git fetch --quiet && git branch -a && git worktree list && git branch --show-current`.

- **Jamais coder sur `main`.** Jamais sur la branche/worktree d'une autre session (voir `worktree list`).
- Créer une branche **au nom neuf et unique**, vérifiée absente en local ET en remote :
  - `<slug>` = sujet court en minuscules (ex. `kpi-co2-traiteur-libelle`), `<branche>` = `fix/e2e-<slug>` (ou `fix/<slug>` / `feat/<slug>` selon la nature — voir étape 6).
  - `git branch --list <branche>` et `git ls-remote --exit-code --heads origin <branche>` → si l'un répond, changer de nom.
- **Worktree dédié** (isolation forte, recommandé) :
  `git -C "$(git rev-parse --show-toplevel)" worktree add -b <branche> ../savr-<slug> origin/main`
  puis `cd ../savr-<slug> && pnpm install --frozen-lockfile && git branch --show-current` (chaîné : le
  `show-current` doit s'exécuter DANS le worktree et afficher `<branche>`). Toute la session se déroule dans ce worktree.
- ⚠️ Worktree neuf ou recyclé sans `node_modules` → `pnpm install --prefer-offline --frozen-lockfile` avant tout vitest.
- Ré-vérifier `git branch --show-current` juste avant chaque commit. Anomalie (HEAD détaché, mauvaise branche) → **STOP**, récupérer la branche seule, jamais de `reset`, prévenir Val.

### 4. Fix (respect des règles — garantie 2)

- **Diff minimal et scopé** : 1 screenshot = 1 correction ciblée. Pas de refactor opportuniste.
- **Design System par défaut** : dès qu'on touche/revoit une page, la mettre en conformité DS sans demande
  explicite — tokens (jamais de couleur en dur), 14 composants §6, cible 44px, espacements. Cf. `specs/cdc/… 10 - Design System`.
- **Anti-couplage G3** : 0 référence `mts1`/`everest` hors `packages/adapters/` (le grep matche AUSSI les
  commentaires et les mots contenant la sous-chaîne — attention aux faux positifs, cf. allowlist `scripts/coupling-allowlist.txt`).
- **Colonne DB touchée ?** Vérifier qu'elle existe réellement (routes lisant une colonne inexistante = échec
  silencieux runtime, invisible aux gates manifeste). `database.types.ts` : éditer **via Bash uniquement**, jamais Edit/Write (le formateur reformate tout).
- **Migration SQL ?** timestamp > max du **DOSSIER** `supabase/migrations/` (pas de l'état local périmé) ;
  backward-compatible (add column nullable OK, jamais de drop non maîtrisé) ; nom ⊆ DDL cible V2 ; table créée
  après 0.4a → GRANT explicite `authenticated`. Reviewer `reviewer-data-model-migration` obligatoire.
- **RLS** : toute lecture/écriture reste cloisonnée par organisation. Rôle métier RLS = claim JWT `user_role` (via `f_app_role()`), jamais `role`.

### 5. Vérifier (ne rien casser — garantie 3)

- **Preuve navigateur** — mécanisme principal = les outils Browser directement (recharger l'écran,
  `read_console_messages` / `read_network_requests` pour les erreurs, `read_page` pour le contenu, screenshot
  avant/après) ; le skill `/verify`, s'il est disponible dans la session, l'orchestre mais n'est pas requis.
  ⚠️ La preview tourne depuis le **clone principal**, pas le worktree → une route worktree-only renvoie 404 en
  preview. Pour valider visuellement une branche worktree, c'est un **checkpoint avec Val** (GO-VISUAL), pas une preview auto.
  Connexion en local : personas `<role>.<slug>@savr-test.local` / `SavrTest2026!` (agence = `agence.caromy`), après `pnpm seed:minimal && pnpm seed:auth`, dev sur `:3001`.
- **Tests** : `pnpm test:module <M>` + `pnpm check:coverage <M>` (jamais `pnpm test --filter`). Reproduire chaque
  GET/POST touché contre `savr-dev` — les mocks masquent les 400 réels.
- **Reviewers à contexte neuf**, lancés **séquentiellement** (jamais en parallèle = corruption git), read-only :
  `reviewer-principal` + `reviewer-conformite-spec` (verdict item-par-item, jamais GO implicite) + `reviewer-rls-securite`
  (si RLS/colonne touchée) + `reviewer-sobriete` (anti-sur-ingénierie) + `reviewer-data-model-migration` (si migration).

### 6. Livraison

- **Découpage** : proposer à Val au cas par cas — fix isolé = sa propre branche/PR ; série cohérente (ex. tous
  les cosmetics d'un même espace) = un lot thématique. Val tranche. Nommer la branche en conséquence
  (`fix/e2e-<slug>` pour un correctif, `feat/<slug>` pour un lot).
- **PR** via gate-pr : impossible sans tests verts + `conformite-spec` GO. Si le pre-commit bloque (exit 2), le
  staging est perdu (lint-staged stash) → **re-`git add` la liste COMPLÈTE** avant de recommiter.
- **Merge autonome** si CI vert + gate-pr OK. Escalade à Val uniquement en fin de module ou sur ambiguïté métier.
- **Dette purgée avant le screenshot suivant** (règle Val) : ne pas empiler.
- En fin de fix (après merge), depuis le clone principal : `git worktree remove ../savr-<slug>`.

## Barre de qualité (ce qui rend une revue « propre »)

- ✅ Pré-vol collision de session passé en tête ; si une session concurrente est détectée, ALERTE + décision de Val (reporter/continuer) AVANT de démarrer.
- ✅ Rôle + route + attendu établis avant de coder ; module CDC lu dans `specs/cdc/…`.
- ✅ Diagnostic explicite bug-de-code vs question-de-spec ; STOP + Val si non couvert (jamais d'interprétation).
- ✅ Zone figée / session parallèle vérifiée et signalée AVANT de coder.
- ✅ Branche neuve, unique (local + remote), en worktree dédié ; `main` jamais touché ; branche re-vérifiée avant commit.
- ✅ Diff minimal ; DS appliqué par défaut ; G3/RLS/colonne-DB/migration respectés.
- ✅ Preuve navigateur (screenshot après) + `test:module` + `check:coverage` verts + reviewers séquentiels GO.
- ✅ Découpage proposé à Val ; PR passée par gate-pr ; worktree nettoyé.
- ❌ Jamais : coder sur `main` ou la branche d'autrui ; lire les sources brutes du Vault ; réinterpréter une
  règle métier ; toucher une zone GO-VISUAL sans prévenir ; lancer les reviewers en parallèle ; recopier un
  chemin/symbole sans l'avoir re-vérifié ; empiler la dette d'un fix sur le suivant.

## Ne PAS faire

- Ne pas élargir le scope au-delà du screenshot (pas de refactor « tant qu'on y est »).
- Ne pas patcher `specs/` à la main (dérivé) — une divergence de spec = fichier `_Divergences/` + STOP/Val.
- Ne pas ouvrir deux sessions Claude sur le même clone/worktree (collision HEAD/index).
- Ne pas déclarer « ça marche » sans preuve navigateur.
