#!/usr/bin/env bash
# scripts/sync-specs.sh — Synchronise specs/ depuis le Vault Obsidian.
# specs/ est un miroir DÉRIVÉ : ne jamais l'éditer à la main.
# Usage : bash scripts/sync-specs.sh [--auto] [VAULT_PATH]
#   --auto  : commit "specs: sync (auto)" si git status est propre après le sync
#             (jamais de push automatique)
set -euo pipefail

# ── Paramètres ──────────────────────────────────────────────────────────────
AUTO=false
VAULT="${HOME}/Desktop/Obsidian Savr"
for arg in "$@"; do
  case "$arg" in
    --auto) AUTO=true ;;
    *) VAULT="$arg" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Vérifications préalables ─────────────────────────────────────────────────
if [[ ! -d "$VAULT" ]]; then
  echo "❌  Vault introuvable : $VAULT" >&2
  echo "    Passer le chemin en argument : bash scripts/sync-specs.sh /chemin/vault" >&2
  exit 1
fi

if ! command -v rsync &>/dev/null; then
  echo "❌  rsync introuvable (brew install rsync)" >&2; exit 1
fi

EXCLUDE_OPTS="--exclude=.obsidian/ --exclude=.DS_Store --exclude=_ARCHIVE*"

echo "🔄  Sync specs/ ← Vault : ${VAULT}"
echo

# ── Sync de chaque cible (bash 3.2 compatible — pas de declare -A) ────────────
# fd 3 = progress visible en temps réel ; stdout = comptage capturé par $()

sync_one() {
  local dest="$1"
  local src="$2"
  if [[ ! -d "$src" ]]; then
    echo "⚠️   Source absente, ignorée : $src" >&3
    echo "0"
    return
  fi
  mkdir -p "$dest"
  # shellcheck disable=SC2086
  rsync -a --delete $EXCLUDE_OPTS "$src" "$dest/" 2>/dev/null
  local n
  n=$(find "$dest" -type f | wc -l | tr -d ' ')
  echo "  ✓  $dest  ($n fichiers)" >&3
  echo "$n"
}

exec 3>&1
n_cdc=$(sync_one       "specs/cdc"       "${VAULT}/_DEV-FACING/")
n_tests_app=$(sync_one "specs/tests/app" "${VAULT}/01 - Cahier des charges App/tests/")
n_tests_tms=$(sync_one "specs/tests/tms" "${VAULT}/02 - Cahier des charges TMS/tests/")
n_ddl=$(sync_one       "specs/ddl-cible" "${VAULT}/_DDL-CIBLE-V2/")
n_fix=$(sync_one       "specs/fixtures"  "${VAULT}/05 - Fixtures/")

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

# ── specs/SYNC.md ────────────────────────────────────────────────────────────
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
cat > specs/SYNC.md <<EOF
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

# ── Mode --auto : commit si working tree propre ───────────────────────────────
if [[ "$AUTO" == "true" ]]; then
  OTHER_CHANGES=$(git status --porcelain | grep -Ev '^.. (specs/|CLAUDE\.md)' || true)
  if [[ -n "$OTHER_CHANGES" ]]; then
    echo
    echo "⚠️  --auto : working tree non propre (fichiers hors specs/ modifiés) — commit ignoré."
  else
    if [[ -z "$(git status --porcelain specs/ CLAUDE.md 2>/dev/null)" ]]; then
      echo "⚠️  --auto : aucun changement dans specs/ ni CLAUDE.md — rien à commiter."
    else
      git add specs/ CLAUDE.md
      git commit -m "specs: sync (auto) — ${TIMESTAMP}"
      echo "🎉  Commit automatique posé : specs: sync (auto)"
    fi
  fi
fi
