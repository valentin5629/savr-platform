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
#   2. Une configuration git globale dont le modèle `init.templateDir` déplace
#      le dépôt qu'on vient de créer : avec un fichier `commondir`, les quatre
#      scripts écrivaient leurs commits de test dans le dépôt désigné, et trois
#      d'entre eux rendaient « auto-test OK » ; avec un `core.worktree`,
#      `suite-verte` et `gate-pr` y posaient une trace « suite verte » portant
#      l'empreinte du contenu de CE dépôt — celle que la garde de PR lit pour
#      ne pas rejouer la suite.
#   3. Un `mktemp` qui rend 0 sans rien écrire : le dossier « jetable » devenait
#      le dossier de LANCEMENT. `suite-verte` et `tests-lies` y écrivaient
#      commits et identité ; `pre-commit-gate` et `gate-pr` le supprimaient en
#      sortie, le second en rendant « auto-test OK ».
# Les trois pièges ont été relevés par la revue sécurité d'un lot voisin, sur un
# autre hook.
#
# CE QUE CE FICHIER NE COUVRE PAS : un `mktemp` ou un `git` remplacés par un
# programme qui fait autre chose que se taire, et toute configuration git qui
# lance une commande. Qui tient le `PATH` ou la configuration git de la session
# n'a pas besoin de l'auto-test pour écrire où il veut.
#
# USAGE, dans le bloc `--self-test` du script :
#   unset ${!GIT_*}                                  # avant tout appel à git
#   . "$(dirname "$ICI")/lib-auto-test.sh" || exit 3
#   bac="$(bac_jetable)" || exit 3                   # le SEUL dossier temporaire
#   trap 'rm -rf "$bac"' EXIT
#   depot_jetable "$bac/depot" || exit 3             # chaque dépôt, avant d'y écrire
#   …
#   pieges_tenus "$ICI" "$bac" || echec=true         # en fin d'auto-test
#   echo "✅ … auto-test OK (…${PIEGES_BILAN})."
# Le code 3 veut dire « auto-test non joué : environnement piégé », à distinguer
# du code 2, « auto-test en échec ». `pieges_tenus` s'appuie sur cette différence.
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

# depot_jetable <dossier> : `git init` dans <dossier> (chemin réel, créé au
# besoin), puis code 1 si git ne place pas là les deux valeurs que les pièges de
# l'en-tête déplacent — l'arbre de travail et le `.git` commun. À appeler avant
# toute écriture dans le dépôt : `git config`, `git commit` et la trace de
# `suite-verte` vont dans le `.git` commun, `git rm` et `git checkout` dans
# l'arbre de travail.
depot_jetable() {
  local d="$1" commun
  git init -q -b main "$d" > /dev/null 2>&1 || return 1
  [ "$(git -C "$d" rev-parse --show-toplevel 2> /dev/null)" = "$d" ] || return 1
  commun="$(git -C "$d" rev-parse --git-common-dir 2> /dev/null)" || return 1
  case "$commun" in
    /*) ;;
    *) commun="$(cd "$d" 2> /dev/null && cd "$commun" 2> /dev/null && pwd -P)" || return 1 ;;
  esac
  [ "$commun" = "$d/.git" ]
}

# empreinte_dossier <dossier> : une somme du contenu complet du dossier — noms de
# tout ce qu'il contient, octets de chaque fichier, `.git` compris. « ABSENT »
# s'il n'existe plus.
empreinte_dossier() {
  [ -d "$1" ] || { echo ABSENT; return 0; }
  (
    cd "$1" || exit 1
    find . -print | LC_ALL=C sort
    find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do cksum < "$f"; done
  ) | cksum
}

# constructions_directes <fichier> : nombre de lignes, commentaires écartés, qui
# créent un dossier temporaire ou un dépôt sans passer par les deux fonctions
# ci-dessus. Compte (`grep -c`), pas « au premier trouvé » : sous `pipefail`, un
# grep qui sort tôt fait échouer le tube.
constructions_directes() {
  grep -vE '^[[:space:]]*#' "$1" | grep -cE 'mktemp|git[[:space:]]+init' || true
}

# pieges_tenus <script> <bac> : rejoue l'auto-test de <script> sous chacun des
# trois pièges de l'en-tête et rend 1, avec une ligne par défaut, s'il a écrit
# hors de son dossier jetable ou s'il ne s'est pas arrêté quand il le devait.
# Deux témoins dans <bac>, dont l'empreinte ne doit pas bouger : `leurre`, le
# dépôt que les pièges désignent, et `lancement`, le dossier d'où l'auto-test
# est rejoué. Chaque rejeu porte SAVR_AUTO_TEST_SOUS_PIEGE, qui fait rendre 0 à
# cette fonction sans rien rejouer : pas de rejeu dans le rejeu.
#   — sous les variables GIT_* : l'auto-test doit rester vert (code 0). C'est ce
#     qui épingle le `unset ${!GIT_*}` de tête du script ;
#   — sous chacune des deux configurations git : il doit s'arrêter (code 3).
#     C'est ce qui épingle, dans `depot_jetable`, la vérification de l'arbre de
#     travail puis celle du `.git` commun, et son appel par le script ;
#   — sous le `mktemp` muet : il doit s'arrêter (code 3). C'est ce qui épingle
#     le contrôle de `bac_jetable`, et son appel par le script.
# Avant les rejeux, le texte du script est contrôlé : il ne crée ni dossier
# temporaire ni dépôt autrement que par `bac_jetable` et `depot_jetable`. Un
# second appel direct, placé après le premier, ne serait vu par aucun rejeu.
pieges_tenus() {
  local script="$1" bac="$2" nom p leurre lance maison rc ko=0 avant_x avant_l
  [ -z "${SAVR_AUTO_TEST_SOUS_PIEGE:-}" ] || return 0
  nom="$(basename "$script" .sh)"
  p="$bac/pieges"
  leurre="$p/leurre"
  lance="$p/lancement"
  mkdir -p "$p/faux" "$p/maison-1/modele" "$p/maison-2/modele" "$lance" \
    || { echo "🔴 $nom : dossier des rejeux non construit." >&2; return 1; }

  printf 'd="$(mktemp -d)"\n' > "$p/texte-1"
  printf '  git init -q .\n' > "$p/texte-2"
  printf '# mktemp, git init\nmkdir depot\n' > "$p/texte-3"
  { [ "$(constructions_directes "$p/texte-1")" = 1 ] && [ "$(constructions_directes "$p/texte-2")" = 1 ] \
    && [ "$(constructions_directes "$p/texte-3")" = 0 ]; } \
    || { echo "🔴 $nom : le contrôle du texte ne reconnaît plus une création directe, ou prend un commentaire pour une création." >&2; ko=1; }
  [ "$(constructions_directes "$script")" = 0 ] \
    || { echo "🔴 $nom : le script crée un dossier temporaire ou un dépôt sans passer par bac_jetable / depot_jetable." >&2; ko=1; }

  depot_jetable "$leurre" && echo leurre > "$leurre/temoin" && echo lancement > "$lance/temoin" \
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

  rc=0
  (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 GIT_DIR="$leurre/.git" GIT_WORK_TREE="$leurre" GIT_COMMON_DIR="$leurre/.git" \
    "$BASH" "$script" --self-test > /dev/null 2>&1) || rc=$?
  { [ "$rc" = 0 ] && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
    || { echo "🔴 $nom [variables GIT_* héritées] : code $rc (attendu 0), ou un dossier hors du bac a été touché." >&2; ko=1; }

  printf '[core]\n\tworktree = %s\n' "$leurre" > "$p/maison-1/modele/config"
  printf '%s\n' "$leurre/.git" > "$p/maison-2/modele/commondir"
  for maison in "$p/maison-1" "$p/maison-2"; do
    printf '[init]\n\ttemplateDir = %s\n' "$maison/modele" > "$maison/.gitconfig"
    rc=0
    (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 HOME="$maison" XDG_CONFIG_HOME="$maison/.config" \
      "$BASH" "$script" --self-test > /dev/null 2>&1) || rc=$?
    { [ "$rc" = 3 ] && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
      || { echo "🔴 $nom [configuration git globale, ${maison##*/}] : code $rc (attendu 3), ou un dossier hors du bac a été touché." >&2; ko=1; }
  done

  printf '#!/bin/sh\nexit 0\n' > "$p/faux/mktemp"
  chmod +x "$p/faux/mktemp"
  rc=0
  (cd "$lance" && SAVR_AUTO_TEST_SOUS_PIEGE=1 PATH="$p/faux:$PATH" "$BASH" "$script" --self-test > /dev/null 2>&1) || rc=$?
  { [ "$rc" = 3 ] && [ "$(empreinte_dossier "$leurre")" = "$avant_x" ] && [ "$(empreinte_dossier "$lance")" = "$avant_l" ]; } \
    || { echo "🔴 $nom [mktemp sans dossier] : code $rc (attendu 3), ou un dossier hors du bac a été touché." >&2; ko=1; }

  [ "$ko" = 0 ] || return 1
  PIEGES_BILAN=" ; rejoué sous des variables GIT_*, deux configurations git et un mktemp piégés : rien d'écrit hors du dossier jetable"
  return 0
}

# Ce que le script ajoute à sa ligne « auto-test OK » : vide tant que
# `pieges_tenus` n'a pas tout rejoué avec succès (donc vide dans un rejeu).
PIEGES_BILAN=""
