#!/usr/bin/env bash
# =============================================================================
# session-new.sh — crée un worktree DÉDIÉ pour une nouvelle session de code
# parallèle. Applique la règle « 1 worktree par session » (jamais deux sessions
# Claude sur le même clone = collision HEAD/index, incident R1 2026-06-24).
#
#   pnpm session:new <slug|branche> [base]
#
#   pnpm session:new ma-tache        → branche feat/ma-tache, base origin/main
#   pnpm session:new fix/mon-bug     → branche fix/mon-bug (slug avec '/' pris tel quel)
#   pnpm session:new ma-tache dev    → base origin/dev
#
# Crée ../savr-<slug> à côté du clone principal, y installe les deps, affiche le
# dossier à ouvrir. Refuse d'écraser un worktree/dossier existant. Non
# destructif (aucune suppression). Compatible bash 3.2 (macOS).
# =============================================================================
set -euo pipefail

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: pnpm session:new <slug|branche> [base]   (ex: pnpm session:new ma-tache)" >&2
  exit 2
fi

arg="$1"
base="${2:-main}"

# Durcissement : refuser tout argument commençant par '-' (sinon un slug/base
# hostile — ex. base '--force' — pourrait s'injecter comme option de
# `git worktree add`). Aucun refname/slug légitime ne commence par '-'.
case "$arg" in -*) echo "✗ slug/branche invalide (commence par '-') : $arg" >&2; exit 2 ;; esac
case "$base" in -*) echo "✗ base invalide (commence par '-') : $base" >&2; exit 2 ;; esac

# Nom de branche : un '/' dans l'arg = branche complète ; sinon on préfixe feat/.
case "$arg" in
  */*) branch="$arg" ;;
  *) branch="feat/$arg" ;;
esac
slug="${branch##*/}" # dernier segment → nom du dossier worktree

# Racine du clone principal = parent du .git commun (marche depuis n'importe quel
# worktree). Le nouveau worktree est un dossier FRÈRE : ../savr-<slug>.
common="$(git rev-parse --git-common-dir 2>/dev/null)" || {
  echo "✗ pas dans un dépôt git." >&2
  exit 1
}
main_root="$(cd "$(dirname "$common")" && pwd)"
wt="$(dirname "$main_root")/savr-$slug"

if [ -e "$wt" ]; then
  echo "✗ $wt existe déjà — choisis un autre slug, ou : git worktree remove $wt" >&2
  exit 1
fi

echo "→ git fetch origin (partir d'une base à jour)"
git fetch origin --quiet || echo "  (fetch échoué — hors ligne ? on continue sur l'état local)"

# Base : origin/<base> si la remote-tracking existe, sinon la ref telle quelle.
baseref="origin/$base"
git rev-parse --verify --quiet "$baseref" >/dev/null || baseref="$base"

echo "→ git worktree add $wt  (branche $branch, base $baseref)"
if git show-ref --verify --quiet "refs/heads/$branch"; then
  # Branche locale déjà existante → on l'attache sans -b (pas de la recréer).
  git worktree add "$wt" "$branch"
else
  git worktree add -b "$branch" "$wt" "$baseref"
fi

echo "→ pnpm install"
if ! (cd "$wt" && pnpm install --frozen-lockfile --prefer-offline); then
  echo "  ⚠ pnpm install a échoué — lance-le à la main : cd $wt && pnpm install --frozen-lockfile" >&2
fi

echo
echo "✅ Session prête."
echo "   Dossier : $wt"
echo "   Branche : $branch"
echo "   → Ouvre une NOUVELLE session Claude DANS ce dossier (jamais 2 sessions sur le même clone)."
echo "   → Fin de session, après merge, depuis le clone principal : git worktree remove $wt"
