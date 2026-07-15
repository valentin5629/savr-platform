---
name: cdc-next-lot-prompt
description: >-
  Génère le prompt de lancement du PROCHAIN lot de remédiation (ou module) Savr, prêt à coller dans une
  nouvelle session Claude Code. À utiliser en FIN de session de dev (après merge d'un lot) ou dès que Val dit
  « génère le prompt du lot suivant », « prompt du prochain module », « prépare R<N> », « prompt de fin de
  session », « on enchaîne quel lot ». Le prompt produit est le plus JUSTE possible : préambule live + lot ré-
  ancré par SYMBOLE sur `main` courant + bloqueurs (divergences, manifeste manquant) détectés en amont.
allowed-tools: Read, Grep, Glob, Bash
---

# cdc-next-lot-prompt — générateur de prompt du lot suivant

But : produire un prompt de lancement **auto-suffisant et exact** pour le prochain lot, afin de maximiser la
performance du dev (zéro temps perdu sur des références périmées, zéro bloqueur découvert en cours de route).

> **Principe cardinal : ne RIEN coder en dur.** Tout (préambule, ordre des lots, tickets, symboles cibles,
> état des gates) se lit en direct sur `main` courant + le Vault. Un prompt juste = un prompt dérivé de l'état
> réel au moment où il est généré, pas d'un copier-coller du backlog figé (2026-06-23, déjà périmé).

## Chemins sources (lire en direct)

- Préambule + blocs de lot : `~/Desktop/Obsidian Savr/30. Review Code/Backlog final priorisé/PROMPTS DEV - lots R0-R23.md`
- Ordre + avancement des lots : `…/00 - Backlog priorisé.md`
- Détail par ticket BL-\* (fichier:ligne, fix 3-temps, Gherkin) : `…/Backlog final priorisé - 2026-06-23.md`
- Avancement modules + dernier mergé : mémoire projet `project-progress` (auto-chargée en contexte ; fichier hors repo : `~/.claude/projects/-Users-valentinleblan-Code-savr-platform/memory/project-progress.md`)
- Repo : `specs/manifests/`, `docs/audit/gate-baseline.json`, `supabase/migrations/`, `scripts/scan-divergences.sh`, `specs/cdc/`

> **Commandes dans les prompts générés** : n'utiliser `pnpm <x>` QUE pour un script réellement enregistré dans
> `package.json` (`test:module`, `check:coverage`, `check:ratchet`, `gen:cdc-metadata`…). Pour un script non
> enregistré, écrire la forme complète `pnpm tsx scripts/<nom>.ts <args>` — ex. **`pnpm tsx scripts/seed-manifest-cdc-hash.ts <module>`**
> (PAS `pnpm seed-manifest-cdc-hash`). Vérifier la présence dans `package.json` avant d'écrire un `pnpm <x>`.

## Procédure (dans l'ordre — chaque étape conditionne la suivante)

### 1. Déterminer le lot cible

- Si un id est passé en argument (ex. `R2`, `M2.6`), c'est le lot cible.
- Sinon AUTO-DÉTECTION : lire l'ordre dans `00 - Backlog priorisé.md` (R0→R23, P0 avant P1…) ; déterminer les
  lots déjà mergés via `git log --oneline main | grep -iE '\b(R[0-9]+[a-z]?|M[0-9])'` (messages de squash
  « … (#N) ») et la mémoire projet `project-progress` (« Next = … », auto-chargée en contexte) ; le lot cible
  = **premier non-mergé dans l'ordre dont toutes les dépendances sont mergées**.
- Annoncer le lot retenu + pourquoi (et s'il y a un choix, le signaler à Val).

### 2. Vérifier que la/les dépendance(s) sont mergées

- Lire la colonne « Dépend » du bloc de lot. Pour chaque dépendance, confirmer le merge :
  `git log --oneline main | grep -i "<dep>"`. Si une dépendance manque → STOP, prévenir Val (ne pas générer
  un prompt pour un lot dont le prérequis n'est pas en place).

### 3. Bloqueurs amont (les détecter MAINTENANT, pas en cours de lot)

- `bash scripts/scan-divergences.sh <label>` — l'argument est un **label d'affichage seulement** (il ne filtre
  PAS par lot ; le script scanne toujours TOUT `_Divergences/` non traité). Si exit ≠ 0, des divergences sont
  en attente : **le lot sera bloqué par gate-brief** (R0d) tant qu'elles ne sont pas traitées (Cowork
  `cdc-patch-divergences` → `specs
sync`). Inclure ce bloqueur en TÊTE du pré-flight, avant le prompt.
- Manifestes des modules cibles : `ls specs/manifests/` → pour chaque module touché par le lot, le manifeste
  existe-t-il ? Sinon (cf. G10 : modules sans manifeste), le prompt doit imposer sa création au grain livrable
  AVANT de coder (forcing-function `check:coverage`).
- État ratchet : lire `docs/audit/gate-baseline.json` → indiquer quel(s) gate(s) le lot devra faire baisser
  (`pnpm check:ratchet --update`) après le fix.

### 4. CITE-PUIS-CONFIRME par SYMBOLE (le cœur de la justesse)

Pour chaque cible du ticket BL-\* (fonctions/RPC, colonnes, fichiers, routes) :

- Les `fichier:ligne` du backlog sont **périmés** — ne JAMAIS les recopier tels quels.
- Re-localiser chaque symbole sur `main` courant : `grep -rn '<symbole>' supabase/migrations packages` ,
  `ls <chemin>` pour confirmer l'existence, identifier la **dernière** définition d'une fonction
  (`grep -rln 'FUNCTION <nom>' supabase/migrations | sort | tail -1` — attention aux migrations qui ne font
  que CITER une fonction en commentaire vs la (re)définir).
- Confirmer la structure des tables citées (`grep -n 'CREATE TABLE.*<table>'` puis lire les colonnes réelles).
- Produire des **ancres symbole** (nom de fonction/colonne/fichier), les numéros de ligne en indicatif « ~lNN ».
- Signaler tout écart entre le backlog et le réel (symbole déplacé/renommé/déjà corrigé par un lot antérieur).

### 5. Assembler le prompt

Le prompt généré DOIT s'ouvrir par le **bloc SETUP worktree**, PUIS le préambule, PUIS le bloc de lot.

- **SETUP — working tree DÉDIÉ (en TÊTE du prompt généré, OBLIGATOIRE)** : chaque session de lot tourne dans
  SON propre worktree git — JAMAIS le clone partagé d'une autre session (deux sessions sur un même working tree
  = collision HEAD/index : l'une déplace le HEAD de l'autre et tire son WIP sur la mauvaise branche — incident
  vécu R1, 2026-06-24). Calculer :
  - `<repo>` = racine du clone principal (`git rev-parse --show-toplevel`),
  - `<slug>` = id du lot en minuscules (ex. `r2-pdf-preuves`), `<branche>` = `feat/<slug>`, `<wt>` = `../savr-<slug>` (dossier frère du clone),
  - existence de la branche : `git branch --list <branche>`.
    Émettre dans le prompt, **en 1ʳᵉ commande du bloc SETUP (depuis le clone principal, avant de créer le
    worktree)** : `pnpm -C <repo> git:hygiene` — filet anti-dette couche 4 (`fetch --prune` + `git worktree
prune` + purge des branches locales `[gone]` des lots déjà mergés ; sans danger, protège main/dev/courante).
    Puis émettre la bonne commande de setup worktree :
  - branche absente : `git -C <repo> worktree add -b <branche> <wt> origin/main` (ordre canonique : `-b` avant le chemin)
  - branche déjà existante : `git -C <repo> worktree add <wt> <branche>`
    suivie de `cd <wt> && pnpm install --frozen-lockfile && git branch --show-current` (TOUT chaîné : le
    `show-current` doit s'exécuter DANS `<wt>` et afficher `<branche>` — sinon il montre la branche du clone principal).
    Mentionner : « toute la session se déroule dans `<wt>` » et le **nettoyage de fin de lot** (cf.
    `DEFINITION_OF_DONE.md` § Merge & nettoyage) : merger en `gh pr merge <n> --squash --delete-branch`
    (supprime la branche locale ET distante — couche 2), puis depuis le clone principal
    `git worktree remove <wt>` (couche 3). ⚠️ Ne JAMAIS ouvrir deux sessions Claude sur le même clone.
- **Préambule** : copier VERBATIM le `[PRÉAMBULE COMMUN]` actuel de `PROMPTS DEV` (il évolue — ne pas le
  réécrire de mémoire). Y substituer le nom de branche du lot dans les exemples de marker.
- **Bloc de lot** : suivre la « Convention d'un bloc de lot (R0d) » de `PROMPTS DEV` :
  titre + statut + Dépend · Modules (→ `/goal`) · Manifestes requis (créer si absent) · Gate(s) à baisser ·
  Tickets BL-\* · État cite-puis-confirmé (symboles réels) · FIX en 3 temps (1 CODE, 2 MANIFESTE deliverables[],
  3 TESTS/Gherkin) · `/goal` exact (`pnpm test:module M<a> M<b> && pnpm check:coverage M<a> && …`) · reviewers
  requis (+ data-model-migration si migration SQL ; rappeler timestamp > max du dossier) · après-merge ratchet.
- Réfs CDC : pointer les sections `specs/cdc/…` exactes que la session devra lire (depuis le ticket + le module).

### 6. Sortie

1. **Pré-flight** (court, AVANT le prompt) : lot retenu · worktree dédié à créer (`../savr-<slug>` sur `feat/<slug>`)
   · dépendances OK ? · bloqueurs (divergences/manifeste) · drift détecté (symboles déplacés vs backlog) ·
   verdict « prêt à lancer » ou « à débloquer d'abord ».
2. **Le prompt complet** dans un seul bloc copiable (préambule + bloc de lot).
3. Proposer de **persister** le bloc de lot ré-ancré dans `PROMPTS DEV - lots R0-R23.md` (remplacer l'ancien
   bloc du lot) pour que le doc reste à jour — le faire si Val acquiesce, ou directement si l'écart est mineur.

## Barre de qualité (ce qui rend le prompt « juste »)

- ✅ Lot suivant correct (ordre + deps + état mergé réels).
- ✅ Préambule = copie live (jamais une version mémorisée).
- ✅ Chaque symbole RE-CONFIRMÉ sur `main` ; ancres par nom, lignes indicatives ; écarts backlog↔réel signalés.
- ✅ Bloqueurs (divergences en attente, manifeste manquant) en tête, AVANT le prompt — pas découverts en vol.
- ✅ 3-temps explicite (code + deliverables[] manifeste + Gherkin) et `/goal` exact par module.
- ✅ Scope rappelé (copie parfaite V1, circuit-breaker, \_Divergences si ambiguïté).
- ✅ Le prompt impose en PREMIÈRE étape un **worktree DÉDIÉ** (`git worktree add ../savr-<slug>`) — jamais deux
  sessions sur le même clone (anti-collision HEAD/index).
- ✅ Le bloc SETUP émet `pnpm git:hygiene` avant de créer le worktree (filet anti-dette couche 4) et rappelle le
  nettoyage de fin de lot (`gh pr merge --squash --delete-branch` + `git worktree remove`).
- ❌ Jamais : recopier un `fichier:ligne` du backlog sans l'avoir re-vérifié ; inventer un symbole ; omettre un
  bloqueur connu ; générer le prompt d'un lot dont une dépendance n'est pas mergée ; faire travailler la session
  suivante dans le clone partagé.

## Ne PAS faire

- Ne pas coder le fix (cette skill génère le prompt, elle ne lance pas le lot).
- Ne pas trancher une ambiguïté métier rencontrée en lisant le ticket → la noter pour le prompt (\_Divergences
  - STOP/Val dans la session du lot).
- Ne pas modifier `specs/` à la main (dérivé) ; éditer uniquement `PROMPTS DEV` (authored) si persistance.
