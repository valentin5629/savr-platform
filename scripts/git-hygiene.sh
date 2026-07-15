#!/usr/bin/env bash
# =============================================================================
# git-hygiene.sh — filet anti-dette de branches / worktrees (couche 4).
#
# Idempotent et SANS DANGER : ne supprime QUE les branches locales dont
# l'upstream a disparu (`[gone]`) = PR mergée + branche distante auto-supprimée
# par GitHub (`delete_branch_on_merge` activé). Protège toujours main / dev / la
# branche courante. Aucune suppression distante, aucun reset, aucun force.
#
# À lancer en début de session (le skill cdc-next-lot-prompt l'émet dans le
# bloc SETUP du prompt généré) ou à la demande :  pnpm git:hygiene
#
# Compatible bash 3.2 (macOS) — pas de `mapfile`, pas de `readarray`.
# =============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "→ git fetch --prune (récupère les suppressions distantes → marque les [gone])"
git fetch --prune --quiet || echo "  (fetch échoué — hors ligne ? on continue sur l'état local)"

echo "→ git worktree prune (métadonnées de worktrees disparus)"
git worktree prune

current="$(git branch --show-current 2>/dev/null || true)"
purged=0
skipped=0

# Branches locales dont l'upstream est 'gone' = mergées + remote supprimé.
while IFS=' ' read -r name track; do
  [ "$track" = "[gone]" ] || continue
  case "$name" in
    main | dev | "$current" | '') continue ;;
  esac
  # git branch -D refuse (exit 1) si la branche est extraite dans un AUTRE
  # worktree non encore démonté (couche 3 sautée) — on garde le `|| ` pour ne
  # PAS laisser `set -e` avorter la boucle : on la saute avec un message
  # actionnable et on continue avec les branches suivantes.
  if git branch -D "$name" 2>/dev/null; then
    purged=$((purged + 1))
  else
    echo "  ⚠ $name : non purgée (extraite dans un worktree non démonté ?) → 'git worktree remove <wt>' puis relancer"
    skipped=$((skipped + 1))
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads)

if [ "$purged" -eq 0 ] && [ "$skipped" -eq 0 ]; then
  echo "→ aucune branche locale [gone] à purger"
fi

echo "hygiène git : OK ✅ ($purged purgée(s), $skipped ignorée(s))"
