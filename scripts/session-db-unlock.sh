#!/usr/bin/env bash
# =============================================================================
# session-db-unlock.sh — libère le « lease savr-dev ».
# À utiliser quand la session qui le détient est MORTE (fermée sans finir son
# écriture DB) et bloque à tort les autres. Sinon, laisse le lease expirer seul
# (périmé après 30 min) ou attends la fin de l'autre session.
#
#   pnpm session:db-unlock
# =============================================================================
set -uo pipefail

top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$top" ] || {
  echo "hors dépôt git — rien à libérer."
  exit 0
}
common="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
case "$common" in /*) : ;; *) common="$(cd "$top" && cd "$common" && pwd)" ;; esac
lease="$common/.savr-dev.lease"

if [ -f "$lease" ]; then
  IFS='|' read -r l_wt l_branch l_epoch <"$lease" 2>/dev/null || true
  rm -f "$lease"
  echo "✅ lease savr-dev libéré (était détenu par '$l_branch' — $l_wt)."
else
  echo "→ aucun lease savr-dev à libérer (déjà libre)."
fi
