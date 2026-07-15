#!/usr/bin/env bash
# =============================================================================
# session-doctor.sh — état de coordination des sessions parallèles.
#
# Répond à : « sur quelle DB je pointe ? une autre session risque-t-elle
# d'impacter la mienne ? puis-je paralléliser sans danger ? »
#
#   pnpm session:doctor
#
# Read-only : n'écrit ni ne supprime rien (le lease est posé par le hook
# db-guard, libéré par 'pnpm session:db-unlock'). Compatible bash 3.2.
# =============================================================================
set -uo pipefail

SAVR_DEV_REF="nvbyuajdvtuezcvyxtkd"
LEASE_STALE=1800

top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$top" ] || {
  echo "hors dépôt git — rien à diagnostiquer."
  exit 0
}
common="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
case "$common" in /*) : ;; *) common="$(cd "$top" && cd "$common" && pwd)" ;; esac
lease="$common/.savr-dev.lease"
me="$top"
mybranch="$(git branch --show-current 2>/dev/null || echo '?')"

# Cible DB d'un worktree : savr-dev | local | autre-distant | aucune
db_target() {
  local envf="$1/.env.local"
  [ -f "$envf" ] || {
    echo "aucune"
    return
  }
  if grep -q "$SAVR_DEV_REF" "$envf" 2>/dev/null; then
    echo "savr-dev"
  elif grep -Eq '127\.0\.0\.1:54321|localhost:54321' "$envf" 2>/dev/null; then
    echo "local"
  elif grep -Eq 'https://[a-z0-9]{20}\.supabase\.co' "$envf" 2>/dev/null; then
    echo "autre-distant"
  else
    echo "aucune"
  fi
}

mytarget="$(db_target "$me")"

echo "══ Session courante ══"
echo "  worktree : $me"
echo "  branche  : $mybranch"
echo "  DB       : $mytarget"

echo
echo "══ Worktrees & cibles DB ══"
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  t="$(db_target "$wt")"
  tag=""
  [ "$wt" = "$me" ] && tag="  ← courant"
  printf "  %-13s %s%s\n" "$t" "$wt" "$tag"
done
savrdev_count="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do db_target "$wt"; done | grep -c '^savr-dev$' || true)"

echo
echo "══ Lease savr-dev (sérialisation des écritures) ══"
now="$(date +%s 2>/dev/null || echo 0)"
if [ -f "$lease" ]; then
  IFS='|' read -r l_wt l_branch l_epoch <"$lease" 2>/dev/null || true
  age=$((now - ${l_epoch:-0}))
  if [ "$age" -ge "$LEASE_STALE" ]; then
    echo "  ⏱  périmé (${age}s) — détenu par '$l_branch' — considéré LIBRE"
  elif [ "${l_wt:-}" = "$me" ]; then
    echo "  ✅ détenu par TOI ('$mybranch', il y a ${age}s)"
  else
    echo "  🔴 détenu par une AUTRE session : '$l_branch' ($l_wt), il y a ${age}s"
    echo "     → attends, coordonne, ou 'pnpm session:db-unlock' si elle est morte."
  fi
else
  echo "  libre"
fi

echo
echo "══ Verdict ══"
if [ "$mytarget" = "savr-dev" ]; then
  if [ "${savrdev_count:-0}" -ge 2 ]; then
    echo "  ⚠️  ${savrdev_count} worktrees pointent sur savr-dev → SÉRIALISE les écritures DB (seed/migration)."
    echo "     Le hook db-guard bloque automatiquement en cas de conflit réel."
    echo "     Pour paralléliser vraiment du travail DB : isole cette session sur une base jetable/local."
  else
    echo "  ✅ seul worktree sur savr-dev — écritures DB OK (tout nouveau worktree savr-dev = coordination)."
  fi
else
  echo "  ✅ tu ne pointes pas sur savr-dev (DB=$mytarget) → parallèle libre, même côté DB."
fi
echo "  Rappel : code / UI / tests mockés = toujours parallèle. Écriture savr-dev = une session à la fois."
