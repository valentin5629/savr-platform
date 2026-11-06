#!/usr/bin/env bash
# =============================================================================
# lib-auto-test.sh — ce que partagent les auto-tests (`--self-test`) des scripts
# de garde qui construisent un dépôt git jetable. Chargé par l'auto-test seul,
# jamais par le chemin qu'un hook exécute.
#
# POURQUOI. Un auto-test ne doit rien écrire hors de son dossier jetable. Mesuré
# le 2026-10-09 sur des copies de `suite-verte.sh`, `tests-lies.sh`,
# `pre-commit-gate.sh` et `gate-pr.sh` (commit 8f4a61cc), lancées depuis un dépôt
# témoin jetable, sous macOS (bash 3.2, git 2.50.1) et sous Ubuntu 22.04 (bash
# 5.1, git 2.34.1), mêmes scripts en cause et mêmes codes de sortie des deux
# côtés — trois façons de le faire sortir :
#   1. Des variables GIT_* héritées (auto-test lancé depuis un hook git, un
#      `rebase --exec`, un alias) : `suite-verte` et `tests-lies` écrivaient
#      l'identité `t@t`, et `tests-lies` une branche, dans le dépôt qu'elles
#      désignent. Les deux autres scripts portaient déjà la parade.
#   2. Une configuration git de l'utilisateur dont le modèle `init.templateDir`
#      détourne le dépôt qu'on vient de créer. Avec un fichier `commondir`, les
#      quatre scripts écrivaient leurs commits de test dans le dépôt désigné, et
#      trois d'entre eux rendaient « auto-test OK ». Avec un `core.worktree`,
#      `suite-verte` et `gate-pr` y posaient une trace « suite verte » portant
#      l'empreinte du contenu de CE dépôt — celle que la garde de PR lit pour
#      ne pas rejouer la suite. Avec des liens symboliques `objects` et `refs`,
#      ou un lien `config`, les écritures traversent les liens alors que git
#      place bien le dépôt neuf là où il vient d'être créé : vérifier après coup
#      où git le place ne suffit donc pas (relevé en revue sécurité de ce lot).
#   3. Un `mktemp` qui rend 0 sans rien écrire : le dossier « jetable » devenait
#      le dossier de LANCEMENT. `suite-verte` et `tests-lies` y écrivaient
#      commits et identité ; `pre-commit-gate` et `gate-pr` le supprimaient en
#      sortie, le second en rendant « auto-test OK ».
# Les trois pièges ont d'abord été relevés sur `db-guard.sh` (PR #533), dont
# l'auto-test porte sa propre parade, écrite sur place.
#
# LES PARADES, une par piège :
#   1. `unset ${!GIT_*}` en tête de l'auto-test, dans le script lui-même ;
#   2. `git_isole` : la configuration git de l'utilisateur n'est plus lue du tout
#      pendant l'auto-test — ni modèle, ni aucune autre clé ;
#   3. `bac_jetable` : ce que `mktemp` a rendu est contrôlé avant tout usage.
#
# CE QUE CE FICHIER NE COUVRE PAS :
#   — la configuration git du SYSTÈME et le modèle livré avec git, qui restent
#     lus : `/etc/gitconfig` ; sous macOS, le fichier livré avec le git d'Apple
#     (`/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig`, lu
#     sur le poste de mesure avec un `HOME` vide). Mesuré en revue sous Ubuntu
#     avec un `/etc/gitconfig` piégé : les quatre scripts écrivent dans le dépôt
#     désigné ;
#   — un `mktemp` ou un `git` remplacés par un programme qui fait autre chose
#     que se taire.
#   Qui tient le système ou le `PATH` de la session n'a pas besoin de
#   l'auto-test pour écrire où il veut.
# CE QUE L'AUTO-TEST N'ÉPINGLE PAS (mesuré en revue, sondes vivantes) :
#   — l'appel à `pieges_tenus` lui-même : retiré d'un script, l'auto-test reste
#     vert et seule la fin de sa ligne « OK » disparaît ;
#   — un `unset` réduit aux quatre variables que le premier rejeu pose : il reste
#     vert, alors que `git_isole` compte sur le `unset` pour retirer aussi
#     GIT_CONFIG_GLOBAL.
# ROUGES À TORT CONNUS, dans des environnements inhabituels (mesurés en revue
# sous Ubuntu) : un `LC_ALL` qui nomme une locale absente — bash 5.1 écrit un
# avertissement au démarrage, et le rejeu sous `mktemp` muet ne rend plus une
# seule ligne ; un `TMPDIR` relatif.
#
# USAGE, dans le bloc `--self-test` du script :
#   unset ${!GIT_*}                                  # avant tout appel à git
#   LIB="$(dirname "$ICI")/lib-auto-test.sh"
#   [ -f "$LIB" ] || { echo "… lib-auto-test.sh introuvable …" >&2; exit 3; }
#   . "$LIB"
#   bac="$(bac_jetable)" || { echo "… pas de dossier temporaire …" >&2; exit 3; }
#   trap 'rm -rf "$bac"' EXIT                        # le SEUL dossier temporaire
#   git_isole "$bac" || exit 3                       # avant tout appel à git
#   …
#   pieges_tenus "$ICI" "$bac" || echec=true         # en fin d'auto-test
#   echo "✅ … auto-test OK (…${PIEGES_BILAN})."
# La présence du fichier est testée avant de le charger : sous `set -e`, bash 3.2
# quitte en code 1 sur un fichier absent sans exécuter un `|| { … }` placé
# derrière le `.` (relevé en revue sécurité de ce lot).
# Le code 3 veut dire « auto-test non joué », à distinguer du code 2, « auto-test
# en échec ». `pieges_tenus` s'appuie sur cette différence et sur les deux
# messages cités ci-dessus.
# =============================================================================

# bac_jetable : crée un dossier temporaire et écrit son chemin réel. Code 1, sans
# rien écrire, si `mktemp` n'a pas rendu un dossier. L'appelant ne pose son
# `trap 'rm -rf …'` qu'après : avec un chemin vide, `cd ""` ne bouge pas et c'est
# le dossier courant qui passait pour le dossier jetable.
bac_jetable() {
  local d
  d="$(mktemp -d)" || return 1
  { [ -n "$d" ] && [ -d "$d" ]; } || return 1
  (cd "$d" && pwd -P) || return 1
}

# git_isole <bac> : à partir de cet appel, git ne lit plus la configuration de
# l'utilisateur (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config`) : `HOME` désigne
# un dossier vide du bac, `XDG_CONFIG_HOME` un sous-dossier de celui-ci qui
# n'existe pas. Vaut pour tout ce que l'auto-test lance ensuite ; `pieges_tenus`
# redonne exprès un `HOME` piégé au script qu'il rejoue, qui s'isole à son tour.
# À appeler après le `unset` de tête (qui retire aussi GIT_CONFIG_GLOBAL) et
# avant tout appel à git.
git_isole() {
  mkdir "$1/maison" || return 1
  export HOME="$1/maison" XDG_CONFIG_HOME="$1/maison/.config"
}

# empreinte_dossier <dossier> : une somme du contenu du dossier — noms de tout ce
# qu'il contient et octets de chaque fichier ordinaire, `.git` compris. Elle ne
# voit ni la cible d'un lien symbolique, ni un mode, ni une date. « ABSENT » s'il
# n'existe plus.
empreinte_dossier() {
  [ -d "$1" ] || { echo ABSENT; return 0; }
  (
    cd "$1" || exit 1
    find . -print | LC_ALL=C sort
    find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do cksum < "$f"; done
  ) | cksum
}

# mktemp_directs <fichier> : nombre de lignes, commentaires écartés, qui citent
# `mktemp`. Compte (`grep -c`), pas « au premier trouvé » : sous `pipefail`, un
# grep qui sort tôt fait échouer le tube.
mktemp_directs() {
  grep -vE '^[[:space:]]*#' "$1" | grep -c 'mktemp' || true
}

# pieges_tenus <script> <bac> : contrôle le texte de <script>, puis rejoue son
# auto-test trois fois ; rend 1, avec une ligne par défaut constaté, si l'un de
# ces contrôles échoue. Deux dossiers témoins dans <bac>, dont l'empreinte ne
# doit bouger sous aucun rejeu : `leurre`, le dépôt que les pièges désignent, et
# `lancement`, le dossier d'où l'auto-test est rejoué. Ce qui serait écrit
# ailleurs que dans ces deux dossiers n'est pas vu.
# Chaque rejeu porte SAVR_AUTO_TEST_SOUS_PIEGE, qui fait rendre 0 à
# cette fonction sans rien rejouer : pas de rejeu dans le rejeu. Si cette
# variable traîne dans l'environnement, rien n'est rejoué et la ligne « OK » du
# script ne porte pas le bilan des rejeux.
# Trois rejeux :
#   — sous quatre variables GIT_* ET une configuration d'utilisateur piégée (le
#     modèle à fichier `commondir`), ensemble : l'auto-test doit rester vert
#     (code 0). Sans le `unset` du script, les variables font écrire dans le
#     leurre ; sans `git_isole`, c'est le modèle. Ce rejeu épingle donc les deux.
#     Les autres formes du piège 2 ne sont pas rejouées ici ; mesurées au banc
#     externe le 2026-10-09, sous macOS et Ubuntu 22.04 (modèle à `core.worktree`,
#     modèle à liens `objects` et `refs`, modèle à lien `config`), aucune ne fait
#     plus rien écrire dans le dépôt désigné ;
#   — sous un `mktemp` muet : il doit s'arrêter en code 3 et ne dire qu'une
#     chose, « pas de dossier temporaire ». C'est ce qui épingle le contrôle de
#     `bac_jetable`, son appel par le script, et l'arrêt qui le suit ;
#   — le script copié SEUL dans un dossier, sans ce fichier à côté : code 3 et
#     « lib-auto-test.sh introuvable ».
# Avant les rejeux, le texte du script est contrôlé : il ne cite `mktemp` nulle
# part hors commentaire. Un second `mktemp`, placé après le premier, ne serait vu
# par aucun rejeu. Ce contrôle ne lit qu'un mot : un dossier temporaire créé
# autrement (un `mkdir` sous `$TMPDIR`) n'est pas vu, et le mot `mktemp` dans un
# message compte comme un appel.
pieges_tenus() {
  local script="$1" bac="$2" nom p leurre lance rc ko=0 avant_x avant_l
  [ -z "${SAVR_AUTO_TEST_SOUS_PIEGE:-}" ] || return 0
  nom="$(basename "$script" .sh)"
  p="$bac/pieges"
  leurre="$p/leurre"
  lance="$p/lancement"
  mkdir -p "$p/faux" "$p/maison/modele" "$p/seul" "$lance" \
    || { echo "🔴 $nom : dossier des rejeux non construit." >&2; return 1; }

  printf 'd="$(mktemp -d)"\n' > "$p/texte-1"
  printf '# mktemp\nmkdir depot\n' > "$p/texte-2"
  { [ "$(mktemp_directs "$p/texte-1")" = 1 ] && [ "$(mktemp_directs "$p/texte-2")" = 0 ]; } \
    || { echo "🔴 $nom : le contrôle du texte ne reconnaît plus un mktemp, ou prend un commentaire pour un appel." >&2; ko=1; }
  [ "$(mktemp_directs "$script")" = 0 ] \
    || { echo "🔴 $nom : le script cite mktemp hors commentaire — un dossier temporaire se crée par bac_jetable." >&2; ko=1; }

  git init -q -b main "$leurre" > /dev/null 2>&1 && echo leurre > "$leurre/temoin" && echo lancement > "$lance/temoin" \
    || { echo "🔴 $nom : témoins des rejeux non construits." >&2; return 1; }
  avant_x="$(empreinte_dossier "$leurre")"
  avant_l="$(empreinte_dossier "$lance")"
  # L'empreinte doit bouger pour un octet changé (ses sommes) comme pour un
  # dossier vide ajouté (ses noms), et dire quand le dossier a disparu : sans
  # cela, « rien de touché » ne prouve rien.
  echo a >> "$lance/temoin"
  [ "$(empreinte_dossier "$lance")" != "$avant_l" ] || { echo "🔴 $nom : l'empreinte ne voit pas un fichier modifié." >&2; ko=1; }
  echo lancement > "$lance/temoin"
  mkdir "$lance/de-trop"
  [ "$(empreinte_dossier "$lance")" != "$avant_l" ] || { echo "🔴 $nom : l'empreinte ne voit pas un dossier ajouté." >&2; ko=1; }
  rmdir "$lance/de-trop"
  { [ "$(empreinte_dossier "$lance")" = "$avant_l" ] && [ "$(empreinte_dossier "$p/absent")" = ABSENT ]; } \
    || { echo "🔴 $nom : l'empreinte change sans raison, ou ne dit pas qu'un dossier a disparu." >&2; ko=1; }

  # La configuration piégée est posée aux deux endroits où git lit celle de
  # l'utilisateur : `git_isole` doit détourner l'un et l'autre.
  printf '%s\n' "$leurre/.git" > "$p/maison/modele/commondir"
  mkdir -p "$p/maison/.config/git"
  printf '[init]\n\ttemplateDir = %s\n' "$p/maison/modele" > "$p/maison/.gitconfig"
  printf '[init]\n\ttemplateDir = %s\n' "$p/maison/modele" > "$p/maison/.config/git/config"
  rc=0
  (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 HOME="$p/maison" XDG_CONFIG_HOME="$p/maison/.config" \
    GIT_DIR="$leurre/.git" GIT_WORK_TREE="$leurre" GIT_COMMON_DIR="$leurre/.git" GIT_INDEX_FILE="$leurre/.git/index" \
    "$BASH" "$script" --self-test > /dev/null 2>&1) || rc=$?
  { [ "$rc" = 0 ] && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
    || { echo "🔴 $nom [variables GIT_* et configuration git héritées] : code $rc (attendu 0), ou un dossier témoin a bougé." >&2; ko=1; }

  printf '#!/bin/sh\nexit 0\n' > "$p/faux/mktemp"
  chmod +x "$p/faux/mktemp"
  rc=0
  (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 PATH="$p/faux:$PATH" "$BASH" "$script" --self-test > "$p/sortie-mktemp" 2>&1) || rc=$?
  { [ "$rc" = 3 ] && [ "$(grep -c '' "$p/sortie-mktemp")" = 1 ] && [ "$(grep -c 'pas de dossier temporaire' "$p/sortie-mktemp")" = 1 ] \
    && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
    || { echo "🔴 $nom [mktemp sans dossier] : code $rc (attendu 3), autre chose que le seul message attendu, ou un dossier témoin a bougé." >&2; ko=1; }

  cp "$script" "$p/seul/" || { echo "🔴 $nom : copie du script impossible." >&2; return 1; }
  rc=0
  (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 "$BASH" "$p/seul/${script##*/}" --self-test > "$p/sortie-seul" 2>&1) || rc=$?
  { [ "$rc" = 3 ] && [ "$(grep -c 'lib-auto-test.sh introuvable' "$p/sortie-seul")" = 1 ] \
    && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
    || { echo "🔴 $nom [script sans lib-auto-test.sh] : code $rc (attendu 3), message absent, ou un dossier témoin a bougé." >&2; ko=1; }

  [ "$ko" = 0 ] || return 1
  PIEGES_BILAN=" ; rejoué sous des variables GIT_* et une configuration git piégées, sous un mktemp muet et sans sa bibliothèque : les deux dossiers témoins sont intacts"
  return 0
}

# Ce que le script ajoute à sa ligne « auto-test OK » : vide tant que
# `pieges_tenus` n'a pas tout rejoué avec succès (donc vide dans un rejeu).
PIEGES_BILAN=""
