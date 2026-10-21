#!/usr/bin/env bash
# scripts/sync-specs.sh — Synchronise specs/ depuis le Vault Obsidian.
# specs/ est un miroir DÉRIVÉ : ne jamais l'éditer à la main.
#
# Usage :
#   bash scripts/sync-specs.sh [VAULT_PATH]   # copie le Vault dans specs/
#   bash scripts/sync-specs.sh --self-test    # auto-test, dépôt et Vault jetables
#
# Le script copie et ne committe RIEN. Il refuse de tourner sur la branche
# `main` : la synchro se fait dans un worktree dédié créé depuis origin/main
# (commandes affichées par le refus), puis part par une PR « specs: sync ».
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
# Rejoue le script entier dans un dépôt git et un Vault jetables (dossier
# temporaire) : ni le dépôt réel ni le vrai Vault ne sont lus. Un faux `pnpm`
# (gen:cdc-metadata n'a pas d'objet dans le dépôt jetable) et, pour la copie en
# échec, un faux `rsync` qui sort en 23 sont placés en tête du PATH.
self_test() (
  set +e
  local script_abs bac depot vault tete rc sortie echec=false d
  script_abs="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  # Rien hors du dossier jetable — les trois parades de .claude/hooks/lib-auto-test.sh,
  # écrites sur place : variables GIT_* héritées retirées, chemin rendu par mktemp
  # contrôlé avant tout usage, configuration git de l'utilisateur (et ici aussi
  # celle du système) non lue avant le premier appel à git.
  # shellcheck disable=SC2086  # découpage voulu : un nom de variable par mot
  unset ${!GIT_*}
  bac=$(mktemp -d) || { echo "🔴 AUTO-TEST : mktemp -d impossible." >&2; return 2; }
  { [ -n "$bac" ] && [ -d "$bac" ]; } || { echo "🔴 AUTO-TEST : dossier jetable invalide." >&2; return 2; }
  bac=$(cd "$bac" && pwd -P) || { echo "🔴 AUTO-TEST : dossier jetable illisible." >&2; return 2; }
  trap 'rm -rf "$bac"' EXIT
  mkdir "$bac/maison" || { echo "🔴 AUTO-TEST : dossier jetable non inscriptible." >&2; return 2; }
  # shellcheck disable=SC2030  # voulu : HOME ne change que dans le sous-shell de l'auto-test
  export HOME="$bac/maison" XDG_CONFIG_HOME="$bac/maison/.config" GIT_CONFIG_NOSYSTEM=1
  depot="$bac/depot"
  vault="$bac/vault"
  mkdir -p "$bac/bin" "$bac/bin-ko" "$depot/scripts" "$depot/specs/cdc"
  printf '#!/bin/sh\nexit 0\n' > "$bac/bin/pnpm"
  cat > "$bac/bin-ko/rsync" <<'FAUX'
#!/bin/sh
echo "faux rsync : lecture refusée" >&2
: > "$FAUX_TRACE"
exit 23
FAUX
  chmod +x "$bac/bin/pnpm" "$bac/bin-ko/rsync"

  for d in "_DEV-FACING" "01 - Cahier des charges App/tests" "02 - Cahier des charges TMS/tests" \
    "_DDL-CIBLE-V2" "05 - Fixtures"; do
    mkdir -p "$vault/$d" && echo "contenu du Vault" > "$vault/$d/f.md"
  done
  echo "nouveau" > "$vault/_DEV-FACING/a.md"

  cp "$script_abs" "$depot/scripts/sync-specs.sh"
  echo "ancien" > "$depot/specs/cdc/a.md"
  echo "retiré depuis du Vault" > "$depot/specs/cdc/retire.md"
  echo "Dernier sync : avant" > "$depot/specs/SYNC.md"
  (cd "$depot" && git init -q -b main . && git add -A \
    && git -c user.email=t@t -c user.name=t commit -qm base) > /dev/null 2>&1 \
    || { echo "🔴 AUTO-TEST : dépôt jetable non construit." >&2; return 2; }
  tete=$(git -C "$depot" rev-parse HEAD)

  # joue <tête du PATH> <arguments…> : rejoue le script du dépôt jetable → $rc, $sortie
  joue() {
    local avant="$1"
    shift
    rc=0
    sortie=$(cd "$depot" && PATH="$avant:$PATH" FAUX_TRACE="$bac/faux-rsync-appele" \
      bash "$depot/scripts/sync-specs.sh" "$@" 2>&1) || rc=$?
  }
  ko() {
    echo "🔴 AUTO-TEST [$1] : $2" >&2
    echec=true
  }
  attendu() { # attendu <cas> <code de sortie voulu> <texte voulu dans la sortie>
    [ "$rc" -eq "$2" ] || ko "$1" "sortie $rc, $2 attendu — $sortie"
    case "$sortie" in *"$3"*) ;; *) ko "$1" "la sortie ne dit pas « $3 »" ;; esac
  }
  intact() { # intact <cas> : aucun fichier écrit dans le dépôt jetable, aucun commit
    [ -z "$(git -C "$depot" status --porcelain)" ] \
      || ko "$1" "fichiers écrits : $(git -C "$depot" status --porcelain | tr '\n' ' ')"
    [ "$(git -C "$depot" rev-parse HEAD)" = "$tete" ] || ko "$1" "un commit a été créé"
  }

  joue "$bac/bin" "$vault"
  attendu "sur main" 2 "refuse de tourner sur main"
  intact "sur main"

  git -C "$depot" checkout -q -b specs/sync-essai
  joue "$bac/bin" --auto "$vault"
  attendu "--auto" 2 "--auto est retiré"
  intact "--auto"

  joue "$bac/bin-ko:$bac/bin" "$vault"
  [ -e "$bac/faux-rsync-appele" ] || ko "copie en échec" "VACANT : le faux rsync n'a pas été appelé"
  attendu "copie en échec" 1 "Copie en échec"
  intact "copie en échec"

  mv "$vault/05 - Fixtures" "$bac/fixtures-de-cote"
  joue "$bac/bin" "$vault"
  mv "$bac/fixtures-de-cote" "$vault/05 - Fixtures"
  attendu "source absente" 1 "Source absente du Vault"
  intact "source absente"

  joue "$bac/bin" "$vault"
  attendu "copie réussie" 0 "Rien n'est commité"
  [ "$(cat "$depot/specs/cdc/a.md")" = "nouveau" ] || ko "copie réussie" "specs/cdc/a.md n'a pas été recopié"
  [ ! -e "$depot/specs/cdc/retire.md" ] || ko "copie réussie" "un fichier retiré du Vault est resté (--delete)"
  grep -q '^Dernier sync : 2' "$depot/specs/SYNC.md" || ko "copie réussie" "specs/SYNC.md n'est pas daté"
  [ "$(git -C "$depot" rev-parse HEAD)" = "$tete" ] || ko "copie réussie" "un commit a été créé"

  [ "$echec" = true ] && return 1
  echo "✅ sync-specs : auto-test OK (refus sur main, refus de --auto, copie en échec et source absente sans rien écrire, copie réussie sans commit)."
  return 0
)

if [[ "${1:-}" == "--self-test" ]]; then
  self_test || exit 2
  exit 0
fi

# ── Paramètres ──────────────────────────────────────────────────────────────
# shellcheck disable=SC2031  # le HOME de l'auto-test ne sort pas de son sous-shell
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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Jamais sur main ──────────────────────────────────────────────────────────
branche="$(git branch --show-current 2> /dev/null || true)"
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
