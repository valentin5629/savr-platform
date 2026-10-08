#!/usr/bin/env bash
# Bloque tout `git commit` si anti-couplage / typecheck / lint / tests LIÉS echouent.
#
# Les tests joues ici sont ceux que la branche a pu casser (graphe d'imports) plus
# les cliquets de securite, pas la suite entiere : cf. l'en-tete de tests-lies.sh
# pour la mesure et pour ce qui reste joue en entier (gate-pr avant la PR, job CI
# requis `lint-typecheck-test`).
set -euo pipefail
INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')"

if ! printf '%s' "$CMD" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+commit'; then
  exit 0
fi

# Resolu AVANT tout `cd` : le dossier du hook REELLEMENT execute. Les commandes de
# settings.json sont relatives — c'est donc le clone principal pour une session
# qui y est enracinee, et le worktree de la session sinon. C'est la version de
# tests-lies.sh de CE dossier qui doit servir, pas celle de la branche visee par
# la commande : une branche ouverte avant ce lot ne porte pas le script.
HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Worktree-aware (cf. lib-worktree.sh) : ce hook tourne dans le clone principal.
# Le commit cible un worktree (`cd <worktree> && git commit`) → on s'y place pour
# que typecheck/lint/tests valident le DIFF DU WORKTREE, pas le clone principal.
. "$HOOKS/lib-worktree.sh"
CD_DIR="$(printf '%s' "$CMD" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;|]+).*/\1/p' | head -1 | xargs 2>/dev/null || true)"
cd_worktree_for "$CD_DIR"

echo "Gate pre-commit : anti-couplage + typecheck + lint + tests lies..." >&2
# Garde-fou 3 TMS-Ready (anti-couplage MTS-1/Everest) — deterministe, sans dependance npm.
if ! bash scripts/check-coupling.sh >&2; then echo "KO anti-couplage -- commit bloque." >&2; exit 2; fi
if ! pnpm -w typecheck >&2; then echo "KO typecheck -- commit bloque." >&2; exit 2; fi
if ! pnpm -w lint >&2;      then echo "KO lint -- commit bloque." >&2;      exit 2; fi
if ! bash "$HOOKS/tests-lies.sh" >&2; then echo "KO tests lies -- commit bloque." >&2; exit 2; fi
echo "OK Gate pre-commit." >&2
exit 0
