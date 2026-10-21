#!/usr/bin/env bash
# scripts/sync-specs.sh — Synchronise specs/ depuis le Vault Obsidian.
# specs/ est un miroir DÉRIVÉ : ne jamais l'éditer à la main.
#
# Usage :
#   bash scripts/sync-specs.sh [VAULT_PATH]   # copie le Vault dans specs/
#   bash scripts/sync-specs.sh --self-test    # auto-test, dépôt et Vault jetables
#
# Le script copie et ne committe RIEN. Il refuse de tourner sur la branche
# `main`, et quand le parent de son dossier n'est pas la racine d'un dépôt git
# (sa place : scripts/ du dépôt). La synchro se fait dans un worktree dédié créé
# depuis origin/main (commandes affichées par le refus de main), puis part par
# une PR « specs: sync ».
#
# Pourquoi (2026-10-21) : l'option --auto, retirée ce jour-là, committait sur la
# branche extraite. Un agent macOS la lançait sur le clone principal, dont le
# `main` local divergeait ainsi de origin/main. La copie depuis le Vault n'y
# aboutissait pas, sans que rien ne le montre : la sortie d'erreur de rsync était
# jetée, et `set -e` ne s'applique pas dans une substitution $(…) (mesuré sous le
# bash 3.2 de macOS) ; specs/SYNC.md était pourtant daté du jour. Désormais une
# source absente ou une copie en échec arrête le script avant d'écrire
# specs/SYNC.md.
set -euo pipefail

EXCLUDE_OPTS="--exclude=.obsidian/ --exclude=.DS_Store --exclude=_ARCHIVE* --exclude=.fuse_hidden*"

# copie <destination> <source> — rsync --delete, puis compte des fichiers dans $NB.
# Appelée directement, jamais dans $(…) : un échec y arrête bien le script.
copie() {
  local dest="$1" src="$2"
  mkdir -p "$dest"
  # shellcheck disable=SC2086
  if ! rsync -a --delete $EXCLUDE_OPTS "$src" "$dest/"; then
    echo "❌  Copie en échec : $src → $dest" >&2
    echo "    specs/SYNC.md n'est pas mis à jour ; les cibles déjà copiées le restent (voir git status)." >&2
    exit 1
  fi
  NB=$(find "$dest" -type f | wc -l | tr -d ' ')
  echo "  ✓  $dest  ($NB fichiers)"
}

# ── Auto-test (`--self-test`) — joué en CI (job `migration-timestamp`) ────────
# Rejoue le script entier dans un dépôt git jetable (reconstruit par
# `depot_neuf`) et un Vault jetable : ni le dépôt réel ni le vrai Vault ne sont
# lus. En tête du PATH : un faux `pnpm` (gen:cdc-metadata n'a pas d'objet dans un
# dépôt jetable) et un faux `rsync`, qui sort en 23 quand l'un de ses arguments
# contient $FAUX_RSYNC_ECHEC et passe la main au vrai rsync sinon.
# Pour ne rien écrire hors du dossier jetable : les parades de
# .claude/hooks/lib-auto-test.sh, épinglées par ses rejeux sous pièges
# (`pieges_tenus` ; la bibliothèque dit ce qu'ils ne couvrent pas). En plus de
# `git_isole`, la configuration git du système n'est pas lue (GIT_CONFIG_NOSYSTEM).
# Code 3 : auto-test non joué. Code 2 : auto-test en échec.
self_test() (
  set +e
  local ici lib bac depot vault vrai_rsync echec_rsync="" tete rc sortie echec=false src paire n i
  ici="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
  # shellcheck disable=SC2086  # découpage voulu : un nom de variable par mot
  unset ${!GIT_*}
  lib="$(dirname "$ici")/../.claude/hooks/lib-auto-test.sh"
  [ -f "$lib" ] || { echo "🔴 sync-specs : lib-auto-test.sh introuvable — auto-test non joué." >&2; exit 3; }
  # shellcheck source=/dev/null
  . "$lib"
  bac="$(bac_jetable)" || { echo "🔴 sync-specs : pas de dossier temporaire — auto-test non joué." >&2; exit 3; }
  trap 'rm -rf "$bac"' EXIT
  git_isole "$bac" || { echo "🔴 sync-specs : dossier d'isolement non créé — auto-test non joué." >&2; exit 3; }
  export GIT_CONFIG_NOSYSTEM=1
  vrai_rsync="$(command -v rsync)" || { echo "🔴 sync-specs : rsync introuvable — auto-test non joué." >&2; exit 3; }
  depot="$bac/depot"
  vault="$bac/vault"
  mkdir -p "$bac/bin" "$bac/hors-depot/scripts" "$bac/autre" \
    || { echo "🔴 sync-specs : dossier jetable non inscriptible — auto-test non joué." >&2; exit 3; }
  printf '#!/bin/sh\nexit 0\n' > "$bac/bin/pnpm"
  cat > "$bac/bin/rsync" << 'FAUX'
#!/bin/sh
if [ -n "$FAUX_RSYNC_ECHEC" ]; then
  for a in "$@"; do
    case "$a" in
      *"$FAUX_RSYNC_ECHEC"*)
        echo "faux rsync : lecture refusée" >&2
        : > "$FAUX_TRACE"
        exit 23
        ;;
    esac
  done
fi
exec "$FAUX_VRAI_RSYNC" "$@"
FAUX
  chmod +x "$bac/bin/pnpm" "$bac/bin/rsync"

  # Un nombre de fichiers différent par source (2 à 6 avec a.md) : chaque compte
  # écrit dans specs/SYNC.md se vérifie à part.
  for paire in "_DEV-FACING|1" "01 - Cahier des charges App/tests|3" "02 - Cahier des charges TMS/tests|4" \
    "_DDL-CIBLE-V2|5" "05 - Fixtures|6"; do
    src="${paire%|*}"
    n="${paire#*|}"
    i=0
    mkdir -p "$vault/$src" || { echo "🔴 sync-specs : Vault jetable non construit — auto-test non joué." >&2; exit 3; }
    while [ "$i" -lt "$n" ]; do
      echo "contenu du Vault" > "$vault/$src/f$i.md"
      i=$((i + 1))
    done
  done
  echo "nouveau" > "$vault/_DEV-FACING/a.md"
  (cd "$bac/autre" && git init -q -b lot . && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m autre) \
    > /dev/null 2>&1 || { echo "🔴 sync-specs : dépôt témoin non construit — auto-test non joué." >&2; exit 3; }

  # depot_neuf <branche> : reconstruit le dépôt jetable sur <branche> — le script,
  # un specs/ ancien dont un fichier retiré depuis du Vault, un specs/SYNC.md daté
  # « avant », un commit — et garde son HEAD dans $tete.
  depot_neuf() {
    { rm -rf "$depot" && mkdir -p "$depot/scripts" "$depot/specs/cdc" \
      && cp "$ici" "$depot/scripts/sync-specs.sh" \
      && echo "ancien" > "$depot/specs/cdc/a.md" \
      && echo "retiré depuis du Vault" > "$depot/specs/cdc/retire.md" \
      && echo "Dernier sync : avant" > "$depot/specs/SYNC.md" \
      && (cd "$depot" && git init -q -b "$1" . && git add -A \
        && git -c user.email=t@t -c user.name=t commit -qm base) > /dev/null 2>&1; } \
      || { echo "🔴 sync-specs : dépôt jetable non construit — auto-test non joué." >&2; exit 3; }
    tete=$(git -C "$depot" rev-parse HEAD)
  }
  # joue <arguments…> : lance le script du dépôt jetable depuis sa racine → $rc,
  # $sortie. $echec_rsync nomme la source dont la copie échoue (vide : aucune).
  joue() {
    rc=0
    sortie=$(cd "$depot" && PATH="$bac/bin:$PATH" FAUX_VRAI_RSYNC="$vrai_rsync" FAUX_RSYNC_ECHEC="$echec_rsync" \
      FAUX_TRACE="$bac/faux-rsync-appele" bash "$depot/scripts/sync-specs.sh" "$@" 2>&1) || rc=$?
  }
  ko() {
    echo "🔴 AUTO-TEST [$1] : $2" >&2
    echec=true
  }
  attendu() { # attendu <cas> <code de sortie voulu> <texte voulu dans la sortie>
    [ "$rc" -eq "$2" ] || ko "$1" "sortie $rc, $2 attendu — $sortie"
    case "$sortie" in *"$3"*) ;; *) ko "$1" "la sortie ne dit pas « $3 »" ;; esac
  }
  intact() { # intact <cas> : `git status` vide et HEAD inchangé dans le dépôt jetable
    [ -z "$(git -C "$depot" status --porcelain)" ] \
      || ko "$1" "fichiers écrits : $(git -C "$depot" status --porcelain | tr '\n' ' ')"
    [ "$(git -C "$depot" rev-parse HEAD)" = "$tete" ] || ko "$1" "un commit a été créé"
  }

  depot_neuf main
  joue "$vault"
  attendu "sur main" 2 "refuse de tourner sur main"
  intact "sur main"

  # Un GIT_DIR hérité désigne un autre dépôt, sur une autre branche : la garde lit
  # quand même la branche du dépôt qui porte le script.
  rc=0
  sortie=$(cd "$depot" && GIT_DIR="$bac/autre/.git" PATH="$bac/bin:$PATH" FAUX_VRAI_RSYNC="$vrai_rsync" \
    FAUX_RSYNC_ECHEC="" FAUX_TRACE="$bac/faux-rsync-appele" bash "$depot/scripts/sync-specs.sh" "$vault" 2>&1) || rc=$?
  attendu "sur main, GIT_DIR vers un autre dépôt" 2 "refuse de tourner sur main"
  intact "sur main, GIT_DIR vers un autre dépôt"

  # Copié hors d'un dépôt git : refus, rien d'écrit.
  cp "$ici" "$bac/hors-depot/scripts/sync-specs.sh"
  rc=0
  sortie=$(cd "$bac/hors-depot" && PATH="$bac/bin:$PATH" FAUX_VRAI_RSYNC="$vrai_rsync" FAUX_RSYNC_ECHEC="" \
    FAUX_TRACE="$bac/faux-rsync-appele" bash "$bac/hors-depot/scripts/sync-specs.sh" "$vault" 2>&1) || rc=$?
  attendu "hors d'un dépôt git" 2 "n'est pas la racine d'un dépôt git"
  [ ! -e "$bac/hors-depot/specs" ] || ko "hors d'un dépôt git" "specs/ a été écrit"

  # Placé dans un sous-dossier d'un autre dépôt (le parent de son dossier n'est pas
  # la racine de ce dépôt) : refus, rien d'écrit.
  { mkdir -p "$bac/autre/sous/scripts" && cp "$ici" "$bac/autre/sous/scripts/sync-specs.sh"; } \
    || { echo "🔴 sync-specs : copie dans le dépôt témoin impossible — auto-test non joué." >&2; exit 3; }
  rc=0
  sortie=$(cd "$bac/autre/sous" && PATH="$bac/bin:$PATH" FAUX_VRAI_RSYNC="$vrai_rsync" FAUX_RSYNC_ECHEC="" \
    FAUX_TRACE="$bac/faux-rsync-appele" bash "$bac/autre/sous/scripts/sync-specs.sh" "$vault" 2>&1) || rc=$?
  attendu "dans un sous-dossier d'un dépôt" 2 "n'est pas la racine d'un dépôt git"
  [ ! -e "$bac/autre/sous/specs" ] || ko "dans un sous-dossier d'un dépôt" "specs/ a été écrit"

  # Lancé par un chemin qui passe par un lien vers le dépôt : c'est le même dépôt
  # (chemins comparés une fois les liens résolus), donc le refus de main s'applique.
  ln -s "$depot" "$bac/lien-vers-depot" \
    || { echo "🔴 sync-specs : lien vers le dépôt jetable non créé — auto-test non joué." >&2; exit 3; }
  rc=0
  sortie=$(cd "$bac/lien-vers-depot" && PATH="$bac/bin:$PATH" FAUX_VRAI_RSYNC="$vrai_rsync" FAUX_RSYNC_ECHEC="" \
    FAUX_TRACE="$bac/faux-rsync-appele" bash "$bac/lien-vers-depot/scripts/sync-specs.sh" "$vault" 2>&1) || rc=$?
  attendu "sur main, par un lien vers le dépôt" 2 "refuse de tourner sur main"
  intact "sur main, par un lien vers le dépôt"

  depot_neuf specs/sync-essai
  joue --auto "$vault"
  attendu "--auto" 2 "--auto est retiré"
  intact "--auto"

  joue -x "$vault"
  attendu "option inconnue" 2 "Option inconnue : -x"
  intact "option inconnue"

  rm -f "$bac/faux-rsync-appele"
  echec_rsync="_DEV-FACING"
  joue "$vault"
  echec_rsync=""
  [ -e "$bac/faux-rsync-appele" ] || ko "copie en échec, 1re cible" "VACANT : le faux rsync n'a pas refusé la copie"
  attendu "copie en échec, 1re cible" 1 "Copie en échec"
  intact "copie en échec, 1re cible"

  # Échec à la 2e cible : la 1re reste copiée, specs/SYNC.md n'est pas réécrit.
  rm -f "$bac/faux-rsync-appele"
  echec_rsync="01 - Cahier des charges App/tests"
  joue "$vault"
  echec_rsync=""
  [ -e "$bac/faux-rsync-appele" ] || ko "copie en échec, 2e cible" "VACANT : le faux rsync n'a pas refusé la copie"
  attendu "copie en échec, 2e cible" 1 "les cibles déjà copiées le restent"
  [ "$(cat "$depot/specs/cdc/a.md")" = "nouveau" ] || ko "copie en échec, 2e cible" "la 1re cible n'a pas été copiée"
  [ "$(cat "$depot/specs/SYNC.md")" = "Dernier sync : avant" ] || ko "copie en échec, 2e cible" "specs/SYNC.md a été réécrit"
  [ "$(git -C "$depot" rev-parse HEAD)" = "$tete" ] || ko "copie en échec, 2e cible" "un commit a été créé"

  # Chacune des 5 sources absente, l'une après l'autre : arrêt avant toute copie.
  for src in "_DEV-FACING" "01 - Cahier des charges App/tests" "02 - Cahier des charges TMS/tests" \
    "_DDL-CIBLE-V2" "05 - Fixtures"; do
    depot_neuf specs/sync-essai
    mv "$vault/$src" "$bac/source-de-cote"
    joue "$vault"
    mv "$bac/source-de-cote" "$vault/$src"
    attendu "source absente : $src" 1 "Source absente du Vault"
    case "$sortie" in *"$src"*) ;; *) ko "source absente : $src" "la source absente n'est pas nommée" ;; esac
    intact "source absente : $src"
  done

  depot_neuf specs/sync-essai
  joue "$vault"
  attendu "copie réussie" 0 "Rien n'est commité"
  [ "$(cat "$depot/specs/cdc/a.md")" = "nouveau" ] || ko "copie réussie" "specs/cdc/a.md n'a pas été recopié"
  [ ! -e "$depot/specs/cdc/retire.md" ] || ko "copie réussie" "un fichier retiré du Vault est resté (--delete)"
  grep -q '^Dernier sync : 2' "$depot/specs/SYNC.md" || ko "copie réussie" "specs/SYNC.md n'est pas daté"
  for src in "cdc       : 2" "tests/app : 3" "tests/tms : 4" "ddl-cible : 5" "fixtures  : 6"; do
    grep -qF "  specs/$src fichiers" "$depot/specs/SYNC.md" \
      || ko "copie réussie" "specs/SYNC.md ne dit pas « specs/$src fichiers »"
  done
  [ "$(git -C "$depot" rev-parse HEAD)" = "$tete" ] || ko "copie réussie" "un commit a été créé"
  [ -n "$(git -C "$depot" status --porcelain)" ] || ko "copie réussie" "VACANT : rien n'a changé dans le dépôt"

  pieges_tenus "$ici" "$bac" || echec=true
  # Le retrait de l'appel ci-dessus se voit : hors d'un rejeu, son bilan doit être
  # posé (retirer aussi ce contrôle ne se verrait pas).
  [ -n "${SAVR_AUTO_TEST_SOUS_PIEGE:-}" ] || [ -n "$PIEGES_BILAN" ] \
    || ko "rejeux sous pièges" "pieges_tenus n'a pas posé son bilan"

  [ "$echec" = true ] && exit 2
  echo "✅ sync-specs : auto-test OK (refus sur main, y compris sous un GIT_DIR qui désigne un autre dépôt et par un chemin qui passe par un lien ; refus hors d'un dépôt git et dans un sous-dossier d'un autre dépôt ; refus de --auto et d'une option inconnue ; copie en échec à la 1re cible et chacune des 5 sources absente : git status vide, HEAD inchangé ; copie en échec à la 2e cible : 1re cible copiée, specs/SYNC.md non réécrit ; copie réussie sans commit, comptes de specs/SYNC.md compris${PIEGES_BILAN})."
  exit 0
)

if [[ "${1:-}" == "--self-test" ]]; then
  rc=0
  self_test || rc=$?
  exit "$rc"
fi

# ── Paramètres ──────────────────────────────────────────────────────────────
VAULT="${HOME}/Desktop/Obsidian Savr"
for arg in "$@"; do
  case "$arg" in
    --auto)
      echo "❌  --auto est retiré (2026-10-21) : ce script ne committe plus rien." >&2
      echo "    Le lancer sans option dans un worktree dédié, puis ouvrir une PR « specs: sync »." >&2
      exit 2
      ;;
    -*)
      echo "❌  Option inconnue : $arg" >&2
      exit 2
      ;;
    *) VAULT="$arg" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"

# ── À la racine du dépôt qui porte ce script, jamais sur main ────────────────
# Variables GIT_* retirées : un GIT_DIR hérité ferait lire la branche d'un autre
# dépôt. Le parent du dossier du script doit être la racine d'un dépôt git (sa
# place : scripts/) ; sinon — copie ou lien hors d'un dépôt, copie plus profond
# dans un dépôt — il refuse.
# shellcheck disable=SC2086  # découpage voulu : un nom de variable par mot
unset ${!GIT_*}
racine="$(git rev-parse --show-toplevel 2> /dev/null || true)"
if [[ "$racine" != "$REPO_ROOT" ]]; then
  echo "❌  sync-specs refuse : ${REPO_ROOT} n'est pas la racine d'un dépôt git (script copié ou lancé par un lien ?) — rien n'est copié." >&2
  exit 2
fi
branche="$(git branch --show-current)"
if [[ "$branche" == "main" ]]; then
  jour="$(date +%Y%m%d)"
  echo "❌  sync-specs refuse de tourner sur main : la synchro se fait dans un worktree dédié, puis part par PR." >&2
  echo "    git fetch origin main" >&2
  echo "    git worktree add --no-track -b specs/sync-${jour} .claude/worktrees/specs-sync-${jour} origin/main" >&2
  echo "    cd .claude/worktrees/specs-sync-${jour} && pnpm install --frozen-lockfile --prefer-offline" >&2
  echo "    bash scripts/sync-specs.sh" >&2
  exit 2
fi

# ── Vérifications préalables ─────────────────────────────────────────────────
if [[ ! -d "$VAULT" ]]; then
  echo "❌  Vault introuvable : $VAULT" >&2
  echo "    Passer le chemin en argument : bash scripts/sync-specs.sh /chemin/vault" >&2
  exit 1
fi

if ! command -v rsync &> /dev/null; then
  echo "❌  rsync introuvable (brew install rsync)" >&2
  exit 1
fi

SRC_CDC="${VAULT}/_DEV-FACING"
SRC_TESTS_APP="${VAULT}/01 - Cahier des charges App/tests"
SRC_TESTS_TMS="${VAULT}/02 - Cahier des charges TMS/tests"
SRC_DDL="${VAULT}/_DDL-CIBLE-V2"
SRC_FIX="${VAULT}/05 - Fixtures"

# Toutes les sources sont vérifiées avant la première copie : une source absente
# n'écrit rien.
absentes=""
for src in "$SRC_CDC" "$SRC_TESTS_APP" "$SRC_TESTS_TMS" "$SRC_DDL" "$SRC_FIX"; do
  [[ -d "$src" ]] || absentes="${absentes}    ${src}"$'\n'
done
if [[ -n "$absentes" ]]; then
  echo "❌  Source absente du Vault — rien n'est copié :" >&2
  printf '%s' "$absentes" >&2
  exit 1
fi

echo "🔄  Sync specs/ ← Vault : ${VAULT}"
echo

# ── Copie de chaque cible ────────────────────────────────────────────────────
copie "specs/cdc" "$SRC_CDC/"
n_cdc=$NB
copie "specs/tests/app" "$SRC_TESTS_APP/"
n_tests_app=$NB
copie "specs/tests/tms" "$SRC_TESTS_TMS/"
n_tests_tms=$NB
copie "specs/ddl-cible" "$SRC_DDL/"
n_ddl=$NB
copie "specs/fixtures" "$SRC_FIX/"
n_fix=$NB

# ── CLAUDE.md : copie directe depuis le Vault ────────────────────────────────
VAULT_CLAUDE="${VAULT}/CLAUDE.md"
if [[ -f "$VAULT_CLAUDE" ]]; then
  cp "$VAULT_CLAUDE" "${REPO_ROOT}/CLAUDE.md"
  echo "  ✓  CLAUDE.md (depuis Vault)"
else
  echo "⚠️   CLAUDE.md absent dans le Vault, CLAUDE.md du repo non modifié"
fi

# ── specs/manifests/ ─────────────────────────────────────────────────────────
mkdir -p specs/manifests
if [[ ! -f specs/manifests/README.md ]]; then
  printf "Manifests de couverture par module — générés à la re-validation JIT de chaque brief.\n" \
    > specs/manifests/README.md
fi

# ── .cdc-metadata.json (G10/G11 — hash par fichier CDC) ──────────────────────
# DÉRIVÉ de specs/cdc/ (régénéré à chaque sync). Référence de complétude (G10)
# et de détection de drift (G11). N'altère PAS le cdc_source_hash figé des
# manifestes (lui n'est ré-aligné qu'au re-brief d'un module — sinon G11 inutile).
if command -v pnpm &> /dev/null; then
  pnpm -s gen:cdc-metadata || echo "⚠️   gen:cdc-metadata a échoué (non bloquant pour le sync)"
else
  echo "⚠️   pnpm absent — .cdc-metadata.json non régénéré"
fi

# ── specs/SYNC.md ────────────────────────────────────────────────────────────
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
cat > specs/SYNC.md << EOF
Dernier sync : ${TIMESTAMP}
  specs/cdc       : ${n_cdc} fichiers
  specs/tests/app : ${n_tests_app} fichiers
  specs/tests/tms : ${n_tests_tms} fichiers
  specs/ddl-cible : ${n_ddl} fichiers
  specs/fixtures  : ${n_fix} fichiers
EOF
echo
echo "📝  specs/SYNC.md mis à jour : ${TIMESTAMP}"

# ── Résumé ───────────────────────────────────────────────────────────────────
echo
echo "✅  Sync terminé — ${TIMESTAMP}"
echo "    specs/cdc       : ${n_cdc} fichiers"
echo "    specs/tests/app : ${n_tests_app} fichiers"
echo "    specs/tests/tms : ${n_tests_tms} fichiers"
echo "    specs/ddl-cible : ${n_ddl} fichiers"
echo "    specs/fixtures  : ${n_fix} fichiers"
echo
# .cdc-metadata.json (régénéré ci-dessus) vit à la racine du dépôt, hors de specs/ :
# il part dans la même PR, sinon G11 (cdc-drift) lit un hash périmé (R0d, finding #10).
echo "    Rien n'est commité : relire git status et git diff (specs/ et .cdc-metadata.json, à la racine du dépôt), puis préparer la PR « specs: sync »."
