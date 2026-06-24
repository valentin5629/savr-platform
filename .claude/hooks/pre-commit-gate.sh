#!/usr/bin/env bash
# Bloque tout `git commit` si anti-couplage / typecheck / lint / tests unitaires echouent.
set -euo pipefail
INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

if ! printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit'; then
  exit 0
fi

# Worktree-aware (cf. lib-worktree.sh) : ce hook tourne dans le clone principal.
# Le commit cible un worktree (`cd <worktree> && git commit`) → on s'y place pour
# que typecheck/lint/test:unit valident le DIFF DU WORKTREE, pas le clone principal.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-worktree.sh"
CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
cd_worktree_for "$CD_DIR"

echo "Gate pre-commit : anti-couplage + typecheck + lint + tests unitaires..." >&2
# Garde-fou 3 TMS-Ready (anti-couplage MTS-1/Everest) — deterministe, sans dependance npm.
if ! bash scripts/check-coupling.sh >&2; then echo "KO anti-couplage -- commit bloque." >&2; exit 2; fi
if ! pnpm -w typecheck >&2; then echo "KO typecheck -- commit bloque." >&2; exit 2; fi
if ! pnpm -w lint >&2;      then echo "KO lint -- commit bloque." >&2;      exit 2; fi
if ! pnpm -w test:unit >&2; then echo "KO tests unitaires -- commit bloque." >&2; exit 2; fi
echo "OK Gate pre-commit." >&2
exit 0
