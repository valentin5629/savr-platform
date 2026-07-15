#!/usr/bin/env bash
# =============================================================================
# git-hygiene.sh — filet anti-dette de branches / worktrees (couche 4).
#
# Idempotent et SANS DANGER : ne supprime QUE les branches locales dont
# l'upstream a disparu (`[gone]`) = PR mergée + branche distante auto-supprimée
# par GitHub (`delete_branch_on_merge` activé). Protège toujours main / dev / la
# branche courante. Aucune suppression distante, aucun reset, aucun force.
#
# Lancé automatiquement pour TOUTE session du repo via le hook SessionStart de
# `.claude/settings.json` (dev plateforme ou TMS), et émis dans le bloc SETUP du
# prompt par le skill cdc-next-lot-prompt. À la demande :  pnpm git:hygiene
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
  elif ! git show-ref --verify --quiet "refs/heads/$name"; then
    # La branche a disparu entre l'énumération et ici = déjà purgée par une
    # session concurrente (plusieurs worktrees simultanés = pratique du projet).
    # Course bénigne : rien à faire, on ne compte ni ne signale.
    :
  else
    # La branche existe toujours mais -D refuse = extraite dans un AUTRE worktree
    # non encore démonté (couche 3 sautée).
    echo "  ⚠ $name : non purgée (extraite dans un worktree non démonté) → 'git worktree remove <wt>' puis relancer"
    skipped=$((skipped + 1))
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads)

if [ "$purged" -eq 0 ] && [ "$skipped" -eq 0 ]; then
  echo "→ aucune branche locale [gone] à purger"
fi

# Worktrees dont la branche est [gone] (mergée) = couche 3 probablement sautée.
# On NE les retire PAS (risque de WIP non commité) — alerte actionnable seulement.
current_root="$(git rev-parse --show-toplevel)"
stale_wt=0
while IFS=' ' read -r wt_path wt_branch; do
  [ "$wt_path" = "$current_root" ] && continue
  t="$(git for-each-ref --format='%(upstream:track)' "refs/heads/$wt_branch" 2>/dev/null || true)"
  if [ "$t" = "[gone]" ]; then
    echo "  ⚠ worktree probablement obsolète : $wt_path (branche $wt_branch mergée) → 'git worktree remove $wt_path'"
    stale_wt=$((stale_wt + 1))
  fi
done < <(git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{b=$2; sub("refs/heads/","",b); print p" "b}')

echo "hygiène git : OK ✅ ($purged purgée(s), $skipped ignorée(s), $stale_wt worktree(s) obsolète(s) signalé(s))"
